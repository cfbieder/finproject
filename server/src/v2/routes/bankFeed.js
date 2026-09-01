/**
 * /api/v2/bank-feed/* — read-only proxy to the bank-feed microservice (CR021).
 *
 * Phase 7 spike: exposes bank-feed's /v1/* data through fin's API so the
 * BankFeedDiagnostic page can fetch it without the API key going to the
 * browser. No mutations — diagnostic / verification only.
 *
 * v3 cutover (planned CR022) will swap PocketSmith calls in fin's data
 * pipelines for these. For now this is purely additive.
 */

const express = require('express');
const router = express.Router();

const client = require('../services/bankFeedClient');
const accountSourceMappings = require('../repositories/accountSourceMappings');
const bankFeedReconciliation = require('../repositories/bankFeedReconciliation');
const { reconcileToFeed } = require('../services/reconcileToFeed');
const refreshBankFeed = require('../services/refreshBankFeedV2');
const manualStatementImport = require('../services/manualStatementImport');
const db = require('../db');
const validate = require('../utils/validate');

// Reconcile is a deliberate action that wants CURRENT balances — pull fresh
// upstream data on a tight freshness window before reconciling.
const RECONCILE_SYNC_MAX_AGE_MIN = 15;

// Wrap a client call so any error becomes a clean JSON 502.
function proxy(fn) {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.json(data);
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      res.status(status).json({
        error: err.message,
        bank_feed_url: client.baseUrl,
      });
    }
  };
}

router.get('/health',         proxy(() => client.health()));
router.get('/health/feeds',   proxy(() => client.feedsHealth()));
router.get('/connections',    proxy(() => client.connections()));
router.get('/accounts',       proxy(() => client.accounts()));
router.get('/balances',       proxy((req) => client.balances(req.query.as_of)));
router.get('/transactions',   proxy((req) => client.transactions({
  since:     req.query.since,
  until:     req.query.until,
  accountId: req.query.account_id,
  limit:     req.query.limit,
  offset:    req.query.offset,
})));

/**
 * POST /api/v2/bank-feed/connections/link            — connect a NEW bank
 * POST /api/v2/bank-feed/connections/:id/link        — RE-AUTHORISE an existing one
 *
 * CR060. Returns `{link:{url,expires_at}}` — a single-use browser URL with a
 * 30-minute TTL that the owner opens. Nothing is connected, re-authorised or
 * changed by this call: a bank login needs a real browser, so minting is the
 * only part a server can do, and the upstream treats it as a read operation.
 *
 * ⚠️ After a reconnect completes, check `GET /account-mappings` →
 * `orphaned_mappings`. A re-consent can mint NEW fintable account ids, which is
 * what fin's mappings key on, so the account can go on looking mapped while it
 * has quietly stopped feeding (CR059 §25.3 — two Revolut wallets, seven weeks).
 *
 * ⚠️ There is deliberately no delete/disconnect route here. Upstream's DELETE
 * purges the connection's data; "reset" means the reconnect link above.
 */
async function mintLink(req, res) {
  try {
    const out = await client.mintConnectionLink({
      connectionId: req.params.id || null,
      institution: (req.body && req.body.institution) || null,
    });
    res.status(201).json(out);
  } catch (err) {
    // A 4xx from upstream is an ANSWER, not a fault — 422 is the documented
    // "no plan headroom" reply (connection limit, monthly attempts, volume).
    // Flattening it to 502 would report fintable's clear refusal as our outage.
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 502;
    res.status(status).json({ error: err.message, bank_feed_url: client.baseUrl });
  }
}

router.post('/connections/link',     mintLink);
router.post('/connections/:id/link', mintLink);

// Diagnostic: aggregate everything BankFeedDiagnostic.jsx needs in one call.
router.get('/diagnostic', async (req, res) => {
  const out = {
    bank_feed_url: client.baseUrl,
    fetched_at: new Date().toISOString(),
  };
  const safe = async (key, fn) => {
    try { out[key] = await fn(); }
    catch (err) { out[key] = { error: err.message }; }
  };
  await Promise.all([
    safe('health',           () => client.health()),
    safe('feeds_health',     () => client.feedsHealth()),
    safe('accounts',         () => client.accounts()),
    safe('balances',         () => client.balances()),
    safe('recent_transactions',
      () => client.transactions({ limit: 20 })),
    // fin-side last pull (bank-feed → staging/transactions), distinct from the
    // bank-feed service's own Sheet-pull cadence in feeds_health.
    safe('last_fin_sync', async () => {
      const r = await db.query(
        `SELECT last_sync_at, last_sync_status, last_sync_count
         FROM sync_metadata WHERE sync_type = 'bank_feed_transactions'`
      );
      return r.rows[0] || null;
    }),
  ]);
  res.json(out);
});

// ---------------------------------------------------------------------------
// CR022 R1 — per-account mapping + ignore management (drives the diagnostic UI)
// ---------------------------------------------------------------------------

/**
 * GET /api/v2/bank-feed/account-mappings
 * Each bank-feed account joined with its fin mapping (source='bank-feed') + the
 * R1 ignore flag + its unpromoted staged count, so the UI shows what needs action.
 */
router.get('/account-mappings', async (req, res) => {
  try {
    const acctResp = await client.accounts();
    const feedAccounts = Array.isArray(acctResp) ? acctResp : (acctResp && acctResp.accounts) || [];

    const mappings = await accountSourceMappings.listBySource('bank-feed');
    const byExternal = new Map(mappings.map((m) => [m.external_name, m]));

    // Which bank each feed account belongs to. Owner-asked, and it earns its
    // column: several feed accounts carry near-identical names across DIFFERENT
    // banks — measured on prod, "Christopher Biedermann (PLN) (8325)" is
    // REVOLUT while "CHRISTOPHER F BIEDERMANN (PLN) (1791)" is Erste Bank
    // Polska, same currency and nothing in the name to separate them. A shared
    // display name is precisely what once rerouted a whole feed.
    // Best-effort, exactly as on /balance-recon:
    // institution lives in bank-feed, not fin's DB, and a page that will not
    // render because that service is down has made an outage worse.
    let extIdToInstitution = new Map();
    try {
      extIdToInstitution = await buildExternalIdToInstitution();
    } catch (e) {
      console.warn('[v2/bank-feed] institution enrich failed on account-mappings (non-fatal):', e.message);
    }

    // Selectable fin accounts (active) + id→name map for display. Queried
    // directly: the accounts repo doesn't export a flat list method.
    const finRows = (await db.query(
      `SELECT id, name, section, account_type FROM accounts WHERE is_active = TRUE ORDER BY section, name`
    )).rows;
    const finNameById = new Map(finRows.map((a) => [a.id, a.name]));

    // unpromoted staged counts per feed account UUID
    const staged = await db.query(`
      SELECT feed_account_external_id AS uuid, COUNT(*)::int AS n
      FROM bankfeed_staging
      WHERE promoted_transaction_id IS NULL AND feed_account_external_id IS NOT NULL
      GROUP BY feed_account_external_id
    `);
    const stagedByUuid = new Map(staged.rows.map((r) => [r.uuid, r.n]));

    const rows = feedAccounts.map((a) => {
      const m = byExternal.get(a.external_id) || null;
      return {
        external_id: a.external_id,
        name: a.name,
        institution: extIdToInstitution.get(a.external_id) || null,
        currency: a.currency,
        type: a.type,
        mapped_account_id: m ? m.account_id : null,
        mapped_account_name: m ? finNameById.get(m.account_id) || null : null,
        ignored: m ? m.ignored === true : false,
        status: !m ? 'pending' : (m.ignored ? 'ignored' : 'mapped'),
        staged_unpromoted: stagedByUuid.get(a.external_id) || 0,
      };
    });

    // CR060 — the other direction; see findOrphanedMappings.
    const orphanedMappings = findOrphanedMappings(feedAccounts, mappings, finNameById);

    res.json({
      accounts: rows,
      fin_accounts: finRows,
      orphaned_mappings: orphanedMappings,
      orphaned_checked: feedAccounts.length > 0,
    });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message, bank_feed_url: client.baseUrl });
  }
});

/**
 * PUT /api/v2/bank-feed/account-mappings/:externalId
 * Body: { accountId, ignored }. Three outcomes (CR022 R1):
 *   - ignored=true                  → ignore this account on every feed upload;
 *                                     never imported. accountId optional (an
 *                                     ignore-only row has account_id=NULL).
 *   - accountId set, ignored=false  → map + import.
 *   - accountId null, ignored=false → unmap (delete row → back to pending).
 */
router.put('/account-mappings/:externalId', async (req, res, next) => {
  try {
    const { externalId } = req.params;
    const { accountId, ignored } = req.body || {};
    const ignore = ignored === true;

    // Pure unmap: no account, not ignored → remove the row entirely (pending).
    if (accountId == null && !ignore) {
      const removed = await accountSourceMappings.removeBySourceAndName('bank-feed', externalId);
      return res.json({ external_id: externalId, status: 'pending', removed: !!removed });
    }

    // Otherwise upsert. account_id may be NULL (ignore-only, no mapping).
    const row = await accountSourceMappings.setBankFeedMapping(
      externalId,
      accountId != null ? accountId : null,
      ignore
    );
    res.json({
      external_id: externalId,
      mapped_account_id: row.account_id,
      ignored: row.ignored === true,
      status: row.ignored ? 'ignored' : (row.account_id != null ? 'mapped' : 'pending'),
    });
  } catch (err) {
    console.error('[v2/bank-feed] set account-mapping failed:', err.message);
    next(err);
  }
});

/**
 * GET /api/v2/bank-feed/reconciliation?sinceDays=30
 * CR022 §G trust signal: per mapped account, matched / ps_only / bank_feed_only
 * over the window. ps_only > 0 means bank-feed MISSED transactions PS has — the
 * regression that must reach 0 before PS removal. Read-only.
 */
router.get('/reconciliation', async (req, res, next) => {
  try {
    const sinceDays = req.query.sinceDays != null ? Number(req.query.sinceDays) : 30;
    const result = await bankFeedReconciliation.reconcile({ sinceDays });
    res.json(result);
  } catch (err) {
    console.error('[v2/bank-feed] reconciliation failed:', err.message);
    next(err);
  }
});

/**
 * GET /api/v2/bank-feed/balance-recon?asOf=YYYY-MM-DD
 * CR023 §4.C: per mapped account, fin computed balance vs the bank's reported
 * `feed_balances` (sign-aware), drift, and reconciled flag. The live cutover
 * gate now PS is off — drives the source-aware "Reconcile to feed" action.
 * Read-only.
 */
router.get('/balance-recon', async (req, res, next) => {
  try {
    const asOf = req.query.asOf || null;
    const result = await bankFeedReconciliation.balanceReconcile({ asOf });
    // Enrich each row with its institution (Chase, PKO, …) so the UI can offer a
    // per-feed filter. Institution lives in the bank-feed service, not fin's DB:
    // account.external_id → account.connection_id → connection.institution_name.
    // Best-effort — if the service is unreachable, rows keep institution=null and
    // the filter simply shows them under "Unknown".
    try {
      const extIdToInstitution = await buildExternalIdToInstitution();
      // CR060 — the orphan check rides along for free: this map's KEYS are the
      // live feed account ids, so "does this mapping still resolve" is a lookup
      // on data the route already fetched. No extra upstream call.
      //
      // ⚠️ Only when the map is non-empty. An empty one means bank-feed had
      // nothing to say, and marking all 27 rows orphaned on an upstream blip is
      // how an alarm gets trained away — `null` says we could not check, which
      // the UI must not render as "fine".
      const canCheckOrphans = extIdToInstitution.size > 0;
      for (const a of result.accounts) {
        a.institution = extIdToInstitution.get(a.feed_external_id) || null;
        a.feed_orphaned = canCheckOrphans ? !extIdToInstitution.has(a.feed_external_id) : null;
      }
      result.orphans_checked = canCheckOrphans;
    } catch (e) {
      console.warn('[v2/bank-feed] institution enrich failed (non-fatal):', e.message);
      for (const a of result.accounts) a.feed_orphaned = null;
      result.orphans_checked = false;
    }

    // CR060: attach the upstream CONNECTION's health to each row, so a dead feed
    // is visible next to the account it kills rather than in a page nobody opens.
    // This is the failure this CR exists for: a GoCardless re-consent silently
    // cut Revolut from three wallets to one and went unnoticed for SEVEN WEEKS,
    // because a feed that stops produces no error — the balance simply stops
    // moving, and a stale number looks exactly like an unchanged one.
    //
    // Keyed on feed_external_id, which since CR059 P3a IS the fintable account
    // id, so the join is exact rather than by name.
    //
    // Separate try/catch from the institution enrich above, deliberately: these
    // are independent signals and one being unavailable must not blank the other.
    // Non-fatal either way — a reconciliation page that will not render because
    // the health service is down has made an outage worse rather than visible.
    try {
      const feeds = await client.feedsHealth();
      attachFeedHealth(result, feeds && feeds.upstream);
    } catch (e) {
      console.warn('[v2/bank-feed] upstream health enrich failed (non-fatal):', e.message);
      attachFeedHealth(result, { ok: false, reason: e.message });
    }
    res.json(result);
  } catch (err) {
    console.error('[v2/bank-feed] balance-recon failed:', err.message);
    next(err);
  }
});

/**
 * CR060 — attach each row's upstream CONNECTION health, in place.
 *
 * Extracted from the route so the one distinction that matters is testable
 * without a container: **`feed_health: null` means "we could not ask"**, while
 * **`state: 'unknown'` means "we asked and this account has no upstream
 * counterpart"**. Collapsing those would let a health-service outage render as a
 * quiet blank on every row — a page that looks fine precisely when the thing
 * reporting breakage is itself broken.
 *
 * @param {{accounts: object[]}} result   mutated in place
 * @param {object|null} upstream          the `upstream` block from /v1/health/feeds
 */
/**
 * CR060 — mappings that point at a feed account which no longer exists.
 *
 * THE OTHER DIRECTION, and nothing looked at it until now. `/account-mappings`
 * builds its rows by walking the FEED's accounts, so a mapping whose
 * `external_name` matches no live feed account does not appear in that list at
 * all — it is invisible on the one page whose job is to show what needs action.
 *
 * That is exactly the shape a bank RECONNECT produces. Since CR059 P3a the
 * mapping keys on fintable's account id, and a re-consent can mint NEW ids: the
 * mapping then points at nothing, the account silently stops feeding, and every
 * surface goes on reporting it as fine. A 2026-06-06 Revolut re-consent did this
 * to two wallets and it went SEVEN WEEKS unnoticed (CR060 §Why, CR059 §25.3).
 *
 * Scoped to mapped-and-not-ignored, per CR060's own correction: the ignored rows
 * are switched off deliberately (OCME's bank) and must stay silent.
 *
 * ⚠️ Returns null — not [] — when the feed list is EMPTY. An empty list is not
 * evidence that every mapping is orphaned, it is evidence that bank-feed had
 * nothing to say, and reporting 27 orphans on an upstream blip is how an alarm
 * gets trained away. Same distinction attachFeedHealth pins for feed_health:
 * could-not-ask is not asked-and-absent.
 *
 * @param {Array} feedAccounts  live feed accounts (each with `external_id`)
 * @param {Array} mappings      account_source_mappings rows for source='bank-feed'
 * @param {Map}   finNameById   fin account id → name, for display
 * @returns {Array|null} orphans, or null when the feed list was empty
 */
function findOrphanedMappings(feedAccounts, mappings, finNameById) {
  if (!Array.isArray(feedAccounts) || feedAccounts.length === 0) return null;
  const live = new Set(feedAccounts.map((a) => a.external_id));
  return (mappings || [])
    .filter((m) => m.account_id != null && m.ignored !== true && !live.has(m.external_name))
    .map((m) => ({
      mapping_id: m.id,
      external_id: m.external_name,
      mapped_account_id: m.account_id,
      mapped_account_name: (finNameById && finNameById.get(m.account_id)) || null,
    }));
}

function attachFeedHealth(result, upstream) {
  const ok = !!(upstream && upstream.ok);
  const byAccount = (ok && upstream.accounts_health) || null;
  result.upstream_ok = ok;
  result.upstream_reason = !ok ? ((upstream && upstream.reason) || 'upstream health unavailable') : null;
  for (const a of result.accounts || []) {
    a.feed_health = byAccount ? (byAccount[a.feed_external_id] || null) : null;
  }
  return result;
}

/**
 * Build a map of feed account external_id → institution_name by joining the
 * bank-feed service's /v1/accounts (external_id → connection_id) with
 * /v1/connections (id → institution_name). Used to label/filter recon rows.
 */
async function buildExternalIdToInstitution() {
  const [accResp, connResp] = await Promise.all([client.accounts(), client.connections()]);
  const accList = Array.isArray(accResp) ? accResp : (accResp && accResp.accounts) || [];
  const connList = Array.isArray(connResp) ? connResp : (connResp && connResp.connections) || [];
  const connToInstitution = new Map();
  for (const cn of connList) {
    if (cn && cn.id != null) connToInstitution.set(String(cn.id), cn.institution_name || null);
  }
  const map = new Map();
  for (const a of accList) {
    if (a && a.external_id != null) {
      map.set(String(a.external_id), connToInstitution.get(String(a.connection_id)) || null);
    }
  }
  return map;
}

/**
 * POST /api/v2/bank-feed/reconcile/:accountId  body: { asOf?, dryRun? }
 * CR023: the source-aware "Reconcile to feed" action — brokerage posts an
 * Unrealized-G/L (MTM) entry, cash re-anchors opening_balance. dryRun=true
 * previews without writing. Manual only.
 */
router.post('/reconcile/:accountId', async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId);
    if (!Number.isInteger(accountId)) {
      return res.status(400).json({ error: 'invalid accountId' });
    }
    const { asOf = null, dryRun = false, force = false, bookDate = null, balanceDate = null, expect = null } = req.body || {};
    validate.assertDateString(asOf, 'asOf', { optional: true });
    validate.assertDateString(bookDate, 'bookDate', { optional: true });
    // CR065 §11: which OBSERVATION to mark against, when it is not the one the
    // booking date would pick (the feed labels a balance with its sync date).
    validate.assertDateString(balanceDate, 'balanceDate', { optional: true });
    const isDryRun = dryRun === true;
    // Sync-before-reconcile: pull fresh upstream data (best-effort) and refresh
    // fin's local balance cache so we reconcile on current, not morning-stale,
    // balances. Both steps are non-fatal — fall back to cached data on failure.
    // Ingest up to the booking date (an MTM may target a past period-end snapshot).
    //
    // ⚠️ CR087 P0c — SKIPPED ENTIRELY ON A DRY RUN. `ingestBalances` UPSERTS into
    // `bankfeed_balances` and `syncUpstream` calls the bank-feed service, so the
    // old unconditional form meant a *preview* hit the microservice and wrote to
    // fin's database. A preview that writes is not a preview, and CR087 §3 said
    // "no new server work" on the strength of it being free — which it was not.
    let synced = null;
    if (!isDryRun) {
      synced = await refreshBankFeed.syncUpstream({ maxAgeMin: RECONCILE_SYNC_MAX_AGE_MIN });
      try {
        await refreshBankFeed.ingestBalances({ asOf: bookDate || asOf });
      } catch (e) {
        console.warn('[v2/bank-feed] pre-reconcile balance ingest failed (non-fatal):', e.message);
      }
    }
    // CR060 — hand the engine the live feed account ids so it can refuse to
    // reconcile a mapping that points at nothing. Fetched HERE rather than in
    // the engine: reconcileToFeed runs inside a db.transaction, and a network
    // call in that path would hold a transaction open on an upstream timeout.
    // Best-effort — on failure the set is null and the engine skips the check
    // rather than refusing everything, the same could-not-ask rule as above.
    let liveFeedAccountIds = null;
    try {
      const accResp = await client.accounts();
      const accList = Array.isArray(accResp) ? accResp : (accResp && accResp.accounts) || [];
      if (accList.length > 0) liveFeedAccountIds = new Set(accList.map((a) => String(a.external_id)));
    } catch (e) {
      console.warn('[v2/bank-feed] orphan pre-check unavailable (non-fatal):', e.message);
    }

    const result = await reconcileToFeed(accountId, {
      asOf, dryRun: isDryRun, force: force === true, bookDate, balanceDate, liveFeedAccountIds,
      // Only an apply carries an expectation; a preview has nothing to compare to.
      expect: isDryRun ? null : expect,
    });
    res.json({
      ...result,
      // A dry run deliberately syncs nothing, so say `preview` rather than
      // `cached`, which would imply a sync was attempted and fell back.
      _synced: isDryRun ? 'preview' : (synced && !synced.error ? (synced.skipped ? 'fresh' : 'synced') : 'cached'),
    });
  } catch (err) {
    // CR087 P0c — a stale preview is not a bad request, it is a conflict: the
    // client's view of the figures is out of date. 409 so the UI can tell the
    // two apart and re-preview rather than reporting a generic failure.
    if (err.code === 'PREVIEW_STALE') {
      console.warn('[v2/bank-feed] apply refused, preview stale:', err.message);
      return res.status(409).json({ error: err.message, code: 'PREVIEW_STALE', current: err.summary });
    }
    console.error('[v2/bank-feed] reconcile failed:', err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * PATCH /api/v2/bank-feed/reconcile-mode/:accountId  body: { mode }
 * CR023: set how an account reconciles — 'calibrate' (bank/cash: re-anchor
 * opening_balance; drift shows as DRIFT) or 'mtm' (brokerage / mark-to-market
 * holdings: post an Unrealized-G/L entry; drift shows as MTM GAP). Setting the
 * mode is harmless on its own — the reconcile action it governs is confirm-gated.
 * CR080 adds 'accrue' (yield the feed reports in its balance but never posts as a
 * transaction; drift shows as ACCRUAL) — which needs a category, so selecting it
 * without one set is refused HERE rather than at reconcile time. A mapping parked
 * in a mode its own reconcile action will refuse is a trap for whoever clicks next.
 */
router.patch('/reconcile-mode/:accountId', async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId);
    const { mode } = req.body || {};
    if (!Number.isInteger(accountId)) return res.status(400).json({ error: 'invalid accountId' });
    if (!['calibrate', 'mtm', 'accrue'].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'calibrate', 'mtm' or 'accrue'" });
    }
    if (mode === 'accrue') {
      const cur = (await db.query(
        `SELECT accrual_category_id FROM account_source_mappings
          WHERE source = 'bank-feed' AND account_id = $1`,
        [accountId]
      )).rows[0];
      if (!cur) return res.status(404).json({ error: 'no bank-feed mapping for that account' });
      if (cur.accrual_category_id == null) {
        return res.status(400).json({
          error: "set an accrual category before selecting 'accrue' — the mode has no default category by design",
        });
      }
    }
    const r = await db.query(
      `UPDATE account_source_mappings SET reconcile_mode = $2
       WHERE source = 'bank-feed' AND account_id = $1
       RETURNING account_id, reconcile_mode`,
      [accountId, mode]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'no bank-feed mapping for that account' });
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error('[v2/bank-feed] set reconcile-mode failed:', err.message);
    next(err);
  }
});

/**
 * PATCH /api/v2/bank-feed/accrual-category/:accountId  body: { categoryId }
 * CR080: which income category an `accrue` account's yield is booked to. `null`
 * clears it — refused while the mapping is actually IN 'accrue' mode, which would
 * otherwise leave the account in a mode that can no longer run.
 */
router.patch('/accrual-category/:accountId', async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId);
    const { categoryId } = req.body || {};
    if (!Number.isInteger(accountId)) return res.status(400).json({ error: 'invalid accountId' });
    if (categoryId !== null && !Number.isInteger(categoryId)) {
      return res.status(400).json({ error: 'categoryId must be an integer or null' });
    }
    if (categoryId !== null) {
      const cat = (await db.query(
        `SELECT id, account_type FROM accounts WHERE id = $1 AND section = 'profit_loss'`,
        [categoryId]
      )).rows[0];
      if (!cat) return res.status(400).json({ error: 'categoryId is not a P&L category' });
    } else {
      const cur = (await db.query(
        `SELECT reconcile_mode FROM account_source_mappings
          WHERE source = 'bank-feed' AND account_id = $1`,
        [accountId]
      )).rows[0];
      if (cur && cur.reconcile_mode === 'accrue') {
        return res.status(400).json({
          error: "cannot clear the accrual category while the account is in 'accrue' mode — change the mode first",
        });
      }
    }
    const r = await db.query(
      `UPDATE account_source_mappings SET accrual_category_id = $2
       WHERE source = 'bank-feed' AND account_id = $1
       RETURNING account_id, accrual_category_id`,
      [accountId, categoryId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'no bank-feed mapping for that account' });
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error('[v2/bank-feed] set accrual-category failed:', err.message);
    next(err);
  }
});

/**
 * PATCH /api/v2/bank-feed/feed-negate-tx/:accountId  body: { negate }
 * CR028 (migration 030): set whether this account's feed transactions are
 * sign-flipped vs fin's convention (e.g. Chase cards report purchases positive).
 * When TRUE the promote negates amount/base. Governs FUTURE promotes only — set
 * it before importing the account's feed tx (does not rewrite promoted rows).
 */
router.patch('/feed-negate-tx/:accountId', async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId);
    const negate = req.body && req.body.negate === true;
    if (!Number.isInteger(accountId)) return res.status(400).json({ error: 'invalid accountId' });
    const r = await db.query(
      `UPDATE account_source_mappings SET feed_negate_tx = $2
       WHERE source = 'bank-feed' AND account_id = $1
       RETURNING account_id, feed_negate_tx`,
      [accountId, negate]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'no bank-feed mapping for that account' });
    res.json({ data: r.rows[0] });
  } catch (err) {
    console.error('[v2/bank-feed] set feed-negate-tx failed:', err.message);
    next(err);
  }
});

/**
 * GET /api/v2/bank-feed/fed-accounts
 * Account names that are on a direct bank feed (non-ignored bank-feed mapping).
 * Used by the COA page to badge balance-sheet accounts linked to a feed.
 */
router.get('/fed-accounts', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT a.id AS account_id, a.name
       FROM account_source_mappings m
       JOIN accounts a ON a.id = m.account_id
       WHERE m.source = 'bank-feed' AND m.ignored = FALSE AND m.account_id IS NOT NULL`
    );
    res.json({ data: r.rows });
  } catch (err) {
    console.error('[v2/bank-feed] fed-accounts failed:', err.message);
    next(err);
  }
});

/**
 * CR036 — manual statement upload (stale-feed fallback).
 *
 * GET  /manual/profiles                  installed statement formats (for the UI)
 * POST /manual/preview  { accountExternalId, csv, profileId? }
 *        Parse + dedup-classify + hypothetical drift. NO writes — the gate.
 * POST /manual/commit   { accountExternalId, csv, profileId? }
 *        Write to the feed service, promote (import only-new), reconcile.
 *
 * Both accept the raw CSV text in the JSON body (no multipart dep); the browser
 * reads the file client-side and posts its text.
 */
router.get('/manual/profiles', proxy(() => client.manualProfiles()));

// CR036 P2 — column-mapper support: inspect a file's headers/samples, and save
// a mapper-built profile for reuse. Both proxy straight to the feed service.
router.post('/manual/inspect', async (req, res) => {
  try {
    const { csv } = req.body || {};
    if (typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'csv (string) is required' });
    }
    res.json(await client.manualInspect({ csv }));
  } catch (err) {
    console.error('[v2/bank-feed] manual inspect failed:', err.message);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message });
  }
});

router.post('/manual/save-profile', async (req, res) => {
  try {
    const { label, kind, currency, spec } = req.body || {};
    if (!label || !spec) {
      return res.status(400).json({ error: 'label and spec are required' });
    }
    res.status(201).json(await client.manualSaveProfile({ label, kind, currency, spec }));
  } catch (err) {
    console.error('[v2/bank-feed] manual save-profile failed:', err.message);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message });
  }
});

router.post('/manual/preview', async (req, res) => {
  try {
    const { accountExternalId, csv, profileId, profile, statedBalance } = req.body || {};
    if (!accountExternalId || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'accountExternalId and csv (string) are required' });
    }
    const result = await manualStatementImport.preview({ accountExternalId, csv, profileId, profile, statedBalance });
    res.json(result);
  } catch (err) {
    console.error('[v2/bank-feed] manual preview failed:', err.message);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message });
  }
});

router.post('/manual/commit', async (req, res) => {
  try {
    const { accountExternalId, csv, profileId, profile, statedBalance } = req.body || {};
    if (!accountExternalId || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'accountExternalId and csv (string) are required' });
    }
    const result = await manualStatementImport.commit({ accountExternalId, csv, profileId, profile, statedBalance });
    res.json(result);
  } catch (err) {
    console.error('[v2/bank-feed] manual commit failed:', err.message);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
// Exported for tests. The route is an Express handler needing a live service and
// a database; the enrichment logic is neither, and it carries the one rule worth
// pinning down (null = could-not-ask vs 'unknown' = asked-and-absent).
module.exports.attachFeedHealth = attachFeedHealth;
module.exports.findOrphanedMappings = findOrphanedMappings;
