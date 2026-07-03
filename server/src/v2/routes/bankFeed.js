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
        currency: a.currency,
        type: a.type,
        mapped_account_id: m ? m.account_id : null,
        mapped_account_name: m ? finNameById.get(m.account_id) || null : null,
        ignored: m ? m.ignored === true : false,
        status: !m ? 'pending' : (m.ignored ? 'ignored' : 'mapped'),
        staged_unpromoted: stagedByUuid.get(a.external_id) || 0,
      };
    });

    res.json({ accounts: rows, fin_accounts: finRows });
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
      for (const a of result.accounts) {
        a.institution = extIdToInstitution.get(a.feed_external_id) || null;
      }
    } catch (e) {
      console.warn('[v2/bank-feed] institution enrich failed (non-fatal):', e.message);
    }
    res.json(result);
  } catch (err) {
    console.error('[v2/bank-feed] balance-recon failed:', err.message);
    next(err);
  }
});

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
    const { asOf = null, dryRun = false, force = false, bookDate = null } = req.body || {};
    validate.assertDateString(asOf, 'asOf', { optional: true });
    validate.assertDateString(bookDate, 'bookDate', { optional: true });
    // Sync-before-reconcile: pull fresh upstream data (best-effort) and refresh
    // fin's local balance cache so we reconcile on current, not morning-stale,
    // balances. Both steps are non-fatal — fall back to cached data on failure.
    // Ingest up to the booking date (an MTM may target a past period-end snapshot).
    const synced = await refreshBankFeed.syncUpstream({ maxAgeMin: RECONCILE_SYNC_MAX_AGE_MIN });
    try {
      await refreshBankFeed.ingestBalances({ asOf: bookDate || asOf });
    } catch (e) {
      console.warn('[v2/bank-feed] pre-reconcile balance ingest failed (non-fatal):', e.message);
    }
    const result = await reconcileToFeed(accountId, { asOf, dryRun: dryRun === true, force: force === true, bookDate });
    res.json({ ...result, _synced: synced && !synced.error ? (synced.skipped ? 'fresh' : 'synced') : 'cached' });
  } catch (err) {
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
 */
router.patch('/reconcile-mode/:accountId', async (req, res, next) => {
  try {
    const accountId = Number(req.params.accountId);
    const { mode } = req.body || {};
    if (!Number.isInteger(accountId)) return res.status(400).json({ error: 'invalid accountId' });
    if (!['calibrate', 'mtm'].includes(mode)) {
      return res.status(400).json({ error: "mode must be 'calibrate' or 'mtm'" });
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

router.post('/manual/preview', async (req, res) => {
  try {
    const { accountExternalId, csv, profileId } = req.body || {};
    if (!accountExternalId || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'accountExternalId and csv (string) are required' });
    }
    const result = await manualStatementImport.preview({ accountExternalId, csv, profileId });
    res.json(result);
  } catch (err) {
    console.error('[v2/bank-feed] manual preview failed:', err.message);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message });
  }
});

router.post('/manual/commit', async (req, res) => {
  try {
    const { accountExternalId, csv, profileId } = req.body || {};
    if (!accountExternalId || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'accountExternalId and csv (string) are required' });
    }
    const result = await manualStatementImport.commit({ accountExternalId, csv, profileId });
    res.json(result);
  } catch (err) {
    console.error('[v2/bank-feed] manual commit failed:', err.message);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
