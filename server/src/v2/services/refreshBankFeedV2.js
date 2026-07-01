/**
 * refreshBankFeedV2 — bank-feed parallel-import orchestrator (CR022 Phase C).
 *
 * Pipeline: fetch (/v1/accounts + /v1/transactions) → normalize → stage
 * (bankfeed_staging) → promote (→ transactions, source='bank-feed').
 *
 * Promote enforces the two §2.3 gates:
 *   R1 opt-in   — a staged row promotes only if its feed account UUID resolves
 *                 to an account_source_mappings row (source='bank-feed') that is
 *                 NOT ignored. Unmapped or ignored accounts stay in staging
 *                 (pending, never silently ingested) and are reported.
 *   R2 dedup    — before inserting, look for an existing source='pocketsmith'
 *                 row matching (account_id, ABS(amount), currency) within ±1 day
 *                 via the shared findPsMatch predicate. On a hit, LINK (stamp
 *                 transactions.bank_feed_external_id on that row) instead of
 *                 inserting, so the canonical id stays stable. Gated by
 *                 BANK_FEED_DEDUP_ENABLED (default true).
 *
 * Implementation note (deviation from CR022 §3 sketch): promote is JS-orchestrated
 * rather than a single SQL CTE. The ±1-day tolerance and the same-day/same-amount
 * description tie-break are impractical and error-prone in pure SQL; doing it in
 * JS reuses the unit-tested findPsMatch and keeps the two dedup directions on one
 * code path. Volume is hundreds of rows per refresh, so row-by-row is fine.
 */

const bankFeedClient = require('./bankFeedClient');
const { normalizeBatch, findPsMatch, categorizeFidelityActivity } = require('../converters/bankFeedToCanonical');
const staging = require('../repositories/bankfeedStaging');
const db = require('../db');
const { usdBaseAmount } = require('./fx');

const SOURCE = 'bank-feed';
// Default freshness window for the pre-read upstream sync: skip the Sheet pull
// if the bank-feed synced within this many minutes (it has its own ~hourly cron,
// so this only forces a pull when data is genuinely stale). Override per caller.
const SYNC_MAX_AGE_MIN = Number(process.env.BANK_FEED_SYNC_MAX_AGE_MIN || 60);

function dedupEnabled() {
  return process.env.BANK_FEED_DEDUP_ENABLED !== 'false';
}

function isoDaysAgo(days) {
  const ms = Date.now() - days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Build internal account_id ("6") → stable account UUID map from /v1/accounts. */
async function buildAccountIdToUuid() {
  const resp = await bankFeedClient.accounts();
  const list = Array.isArray(resp) ? resp : (resp && resp.accounts) || [];
  const map = {};
  for (const a of list) {
    if (a && a.id != null) map[String(a.id)] = a.external_id || null;
  }
  return map;
}

/**
 * Ingest /v1/balances into the local bankfeed_balances cache (CR024 Phase 1).
 *
 * Read-only snapshots — safe on the unattended cron path (no ledger writes). The
 * balance-sheet read-override reads this cache for `balance_from_feed` accounts.
 * The contract carries the feed's internal account_id ("1"); we resolve it to the
 * stable UUID (the key shared with account_source_mappings.external_name) so a
 * later re-auth that renumbers internal ids doesn't orphan the override.
 * Upserts one row per (UUID, balance_date, source); idempotent on re-run.
 */
async function ingestBalances({ accountExternalIdById, asOf } = {}) {
  const idToUuid = accountExternalIdById || (await buildAccountIdToUuid());
  // asOf backfills a historical snapshot (e.g. a month-end the daily cron never
  // cached); omitted → latest, the cron's default. The service returns the latest
  // balance per account ≤ asOf, stamped with its real balance_date.
  const resp = await bankFeedClient.balances(asOf || undefined);
  const list = (resp && resp.balances) || (Array.isArray(resp) ? resp : []);

  let upserted = 0;
  let unresolved = 0;
  for (const b of list) {
    const uuid = idToUuid[String(b.account_id)];
    if (!uuid) { unresolved++; continue; }
    await db.query(`
      INSERT INTO bankfeed_balances
        (feed_account_external_id, balance, currency, balance_date, source, source_synced_at, raw)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (feed_account_external_id, balance_date, source)
      DO UPDATE SET balance = EXCLUDED.balance,
                    currency = EXCLUDED.currency,
                    source_synced_at = EXCLUDED.source_synced_at,
                    fetched_at = NOW(),
                    raw = EXCLUDED.raw
    `, [uuid, b.balance, b.currency, b.balance_date, b.source || 'fintable', b.source_synced_at || null, b.raw || null]);
    upserted++;
  }
  return { fetched: list.length, upserted, unresolved };
}

/**
 * Step 1-3: fetch → normalize → stage. Returns ingest summary.
 * Also refreshes the bankfeed_balances cache (best-effort — a balances hiccup
 * must not fail transaction staging; the previous snapshot stays serviceable).
 */
/**
 * Best-effort: ask the bank-feed to pull fresh upstream data before we read,
 * so staging/reconciliation isn't run on morning-stale balances (the
 * feed_balances-freeze lesson). NEVER throws — a bank-feed outage must not break
 * the ingest/reconcile path; we fall back to the last cached data and log it.
 * The service skips the pull if it synced within `maxAgeMin` (coalesced).
 */
async function syncUpstream({ maxAgeMin = SYNC_MAX_AGE_MIN, force = false } = {}) {
  try {
    const r = await bankFeedClient.sync({ maxAgeMin, force });
    if (r && r.skipped) {
      console.log(`[refreshBankFeedV2] upstream sync skipped (fresh, age ${r.age_minutes}m ≤ ${r.max_age_minutes}m)`);
    } else {
      console.log('[refreshBankFeedV2] upstream sync triggered');
    }
    return r;
  } catch (err) {
    console.warn(`[refreshBankFeedV2] upstream sync failed (non-fatal, using cached): ${err.message}`);
    return { error: err.message };
  }
}

async function ingest({ sinceDays = 14, since, syncMaxAgeMin } = {}) {
  const sinceDate = since || isoDaysAgo(sinceDays);
  // Pull fresh upstream data first (best-effort) so this stage isn't on stale data.
  await syncUpstream({ maxAgeMin: syncMaxAgeMin });
  const accountExternalIdById = await buildAccountIdToUuid();

  const resp = await bankFeedClient.transactions({ since: sinceDate, limit: 500 });
  const txs = (resp && resp.transactions) || [];

  const normalized = normalizeBatch(txs, { accountExternalIdById });
  const insertResult = await staging.insertMany(normalized.rows);

  let balances = null;
  try {
    balances = await ingestBalances({ accountExternalIdById });
  } catch (err) {
    console.warn('[refreshBankFeedV2] balances ingest failed (non-fatal):', err.message);
    balances = { error: err.message };
  }

  return {
    since: sinceDate,
    fetched: txs.length,
    staged: normalized.rows.length,
    filteredPending: normalized.filteredPending,
    skipped: normalized.skipped,
    duplicatesCollapsed: normalized.duplicatesCollapsed,
    unresolvedAccounts: normalized.unresolvedAccounts,
    insertedCount: insertResult.insertedCount,
    updatedCount: insertResult.updatedCount,
    skippedCount: insertResult.skippedCount,
    balances,
  };
}

/**
 * Step 4: promote unpromoted staging rows into transactions.
 * Returns a summary that is a superset of the PS syncStagingToTransactions shape
 * so the existing review UI reads its known fields unchanged.
 */
// USD base_amount conversion now lives in ./fx (shared with the reconcile engines).

async function promote() {
  // Load unpromoted, non-pending staging rows with resolved fin account + ignore flag.
  // ::text on dates keeps findPsMatch on 'YYYY-MM-DD' strings (TZ-safe).
  const rows = (await db.query(`
    SELECT s.id, s.external_id, s.feed_account_external_id,
           s.transaction_date::text AS transaction_date,
           s.amount, s.currency, s.base_amount, s.base_currency,
           s.description, s.merchant, s.activity_type,
           m.account_id AS fin_account_id, m.ignored, m.trade_treatment, m.feed_negate_tx
    FROM bankfeed_staging s
    LEFT JOIN account_source_mappings m
      ON m.source = '${SOURCE}' AND m.external_name = s.feed_account_external_id
    WHERE s.promoted_transaction_id IS NULL
      AND s.pending = FALSE
      AND s.suppressed = FALSE
      -- CR024 cutover gate: a mapping with promote_from_date set holds rows dated
      -- before the cutoff (that period belongs to PS). NULL = promote all (PKO).
      AND (m.promote_from_date IS NULL OR s.transaction_date >= m.promote_from_date)
    ORDER BY s.transaction_date, s.id
  `)).rows;

  const ignoredAccounts = new Set();
  const unmappedAccounts = new Set();
  const promotable = [];
  const toSuppress = [];   // staging ids of net-zero plumbing (LOAN/JOURNALED/OPTIONEXPIRATION)
  for (const r of rows) {
    // Order matters: an ignore-only row has ignored=TRUE with fin_account_id=NULL
    // (migration 024). Check ignored FIRST so it reports as ignored, not unmapped,
    // and so an explicitly-ignored mapped account is also suppressed.
    if (r.ignored === true) { ignoredAccounts.add(r.feed_account_external_id); continue; }
    if (r.fin_account_id == null) { unmappedAccounts.add(r.feed_account_external_id); continue; }
    // CR028 (migration 030): some upstreams report this account's transactions
    // with the opposite sign to fin's convention (e.g. Chase cards: purchase +).
    // Negate amount + base_amount in-place so matching and the insert both use
    // fin's convention.
    if (r.feed_negate_tx) {
      if (r.amount != null) r.amount = -Number(r.amount);
      if (r.base_amount != null) r.base_amount = -Number(r.base_amount);
    }
    // CR024 Phase 2: route by SnapTrade activity_type. Suppress net-zero plumbing
    // so it never promotes; income/transfer carry a COA category; review = null
    // category (PKO rows + unknown types → existing review-queue behavior).
    const cat = categorizeFidelityActivity(r.activity_type, r.trade_treatment, r.description);
    if (cat.action === 'suppress') { toSuppress.push(r.id); continue; }
    r._category = cat;
    promotable.push(r);
  }

  // Resolve the categorizer's COA leaf names → ids (DB-agnostic; fail loud if a
  // mapped name is missing so a renamed/absent category can't silently mis-book).
  const neededNames = [...new Set(promotable.map((r) => r._category.category).filter(Boolean))];
  const catIdByName = {};
  if (neededNames.length) {
    const cres = await db.query(`SELECT id, name FROM accounts WHERE name = ANY($1)`, [neededNames]);
    for (const row of cres.rows) catIdByName[row.name] = row.id;
    for (const n of neededNames) {
      if (catIdByName[n] == null) throw new Error(`promote: categorizer COA leaf not found: "${n}"`);
    }
  }

  let inserted = 0;
  let linked = 0;
  let suppressed = 0;
  let mirrored = 0;          // CR032: auto-offset legs created for core-cash sweeps
  const mergedWithPsCount = {};
  const dedup = dedupEnabled();

  await db.transaction(async (client) => {
    // Mark net-zero plumbing rows suppressed so they never promote and aren't
    // re-evaluated on the next run.
    if (toSuppress.length) {
      await client.query(`UPDATE bankfeed_staging SET suppressed = TRUE WHERE id = ANY($1)`, [toSuppress]);
      suppressed = toSuppress.length;
    }

    for (const r of promotable) {
      let matchedTxId = null;

      // CR032: core-sweep mirrors are synthetic net-zero plumbing — never link
      // them to a PS row; always insert so the offsetting mirror can be attached.
      if (dedup && r._category.action !== 'transfer-mirror') {
        const candidates = (await client.query(`
          SELECT id, account_id, amount, currency,
                 transaction_date::text AS transaction_date,
                 description1 AS description
          FROM transactions
          WHERE source = 'pocketsmith'
            AND account_id = $1
            AND currency = $2
            AND bank_feed_external_id IS NULL
            AND transaction_date BETWEEN $3::date - 1 AND $3::date + 1
        `, [r.fin_account_id, r.currency, r.transaction_date])).rows;

        const match = findPsMatch(
          { account_id: r.fin_account_id, amount: r.amount, currency: r.currency, transaction_date: r.transaction_date, description: r.description },
          candidates
        );
        if (match) matchedTxId = match.id;
      }

      if (matchedTxId) {
        // LINK: stamp the bank-feed external id onto the existing PS row.
        // NOTE: all writes use `client` (the transaction connection), never the
        // pool (staging.markPromoted), or the uncommitted INSERT below isn't
        // visible and the staging FK to transactions(id) fails.
        await client.query(
          `UPDATE transactions SET bank_feed_external_id = $2, updated_at = NOW() WHERE id = $1`,
          [matchedTxId, r.external_id]
        );
        await client.query(
          `UPDATE bankfeed_staging SET promoted_transaction_id = $2 WHERE id = $1`,
          [r.id, matchedTxId]
        );
        linked++;
        mergedWithPsCount[r.feed_account_external_id] = (mergedWithPsCount[r.feed_account_external_id] || 0) + 1;
      } else {
        // INSERT a new canonical bank-feed row (accepted=FALSE → review queue).
        // Prefer a staging-provided base_amount; otherwise convert to USD via FX
        // so the USD column + USD balance sheet reflect this row (CR022).
        const baseAmt = r.base_amount != null
          ? Number(r.base_amount)
          : await usdBaseAmount(client, r.amount, r.currency, r.transaction_date);
        // CR024 Phase 2: assign the categorizer's COA category at insert (income/
        // transfer). 'review' (PKO + unknown types) → NULL category = existing
        // review-queue behavior. All rows still land accepted=FALSE.
        const categoryId = r._category && r._category.category ? catIdByName[r._category.category] : null;
        // CR032: a core-cash sweep is deterministic net-zero plumbing — accept it
        // straight away (no review) and pair it with a mirror below. Everything
        // else still lands in the review queue (accepted=FALSE) as before.
        const isSweep = r._category.action === 'transfer-mirror';
        const ins = await client.query(`
          INSERT INTO transactions
            (transaction_date, description1, amount, currency, base_amount, base_currency,
             account_id, category_id, source, bank_feed_external_id, accepted)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '${SOURCE}', $9, $10)
          ON CONFLICT (bank_feed_external_id) WHERE bank_feed_external_id IS NOT NULL
          DO NOTHING
          RETURNING id
        `, [
          r.transaction_date,
          r.description || r.merchant || null,
          r.amount,
          r.currency,
          baseAmt,
          'USD',
          r.fin_account_id,
          categoryId,
          r.external_id,
          isSweep,
        ]);
        if (ins.rows[0]) {
          await client.query(
            `UPDATE bankfeed_staging SET promoted_transaction_id = $2 WHERE id = $1`,
            [r.id, ins.rows[0].id]
          );
          inserted++;

          // CR032: inject the missing core-position counter-leg so the sweep
          // self-nets and never drifts the reconciled balance. source='auto-offset'
          // (no external_id) mirrors the manual-neutralize shape; accepted=TRUE.
          if (isSweep) {
            await client.query(`
              INSERT INTO transactions
                (transaction_date, description1, amount, currency, base_amount, base_currency,
                 account_id, category_id, source, accepted)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'auto-offset', TRUE)
            `, [
              r.transaction_date,
              r.description || r.merchant || null,
              -Number(r.amount),
              r.currency,
              -Number(baseAmt),
              'USD',
              r.fin_account_id,
              categoryId,
            ]);
            mirrored++;
          }
        }
        // ON CONFLICT DO NOTHING → row already exists for this external_id; leave
        // staging unpromoted so a later reconcile can pick it up. (Shouldn't happen
        // in normal flow since staging marks promoted, but the partial-unique index
        // is a safety net against double-insert.)
      }
    }
  });

  const mergedTotal = Object.values(mergedWithPsCount).reduce((a, b) => a + b, 0);

  return {
    inserted,
    updated: 0,            // promote never re-touches an already-promoted row
    linked,
    suppressed,            // CR024 Phase 2: net-zero plumbing rows held back
    mirrored,              // CR032: auto-offset legs created for core-cash sweeps
    skipped: 0,
    protectedCount: 0,
    mergedWithPsCount,
    mergedTotal,
    ignoredAccounts: Array.from(ignoredAccounts),
    unmappedAccounts: Array.from(unmappedAccounts),
    unmappedCategories: [],          // shape parity with PS summary
    total: inserted + linked,
  };
}

/** Stamp sync_metadata so the UI can show when fin last pulled bank-feed. */
async function recordSync(status, count) {
  await db.query(
    `UPDATE sync_metadata
       SET last_sync_at = NOW(), last_sync_status = $1, last_sync_count = $2
     WHERE sync_type = 'bank_feed_transactions'`,
    [status, count]
  );
}

/** Full pipeline: ingest then promote. Mirrors the PS {ingest, sync} response. */
async function refresh({ sinceDays = 14, since } = {}) {
  try {
    const ingestResult = await ingest({ sinceDays, since });
    const sync = await promote();
    await recordSync('success', (sync.inserted || 0) + (sync.linked || 0));
    return { ingest: ingestResult, sync };
  } catch (err) {
    // best-effort status stamp; don't mask the original error
    try { await recordSync('error', 0); } catch { /* ignore */ }
    throw err;
  }
}

module.exports = {
  refresh,
  ingest,
  ingestBalances,
  syncUpstream,
  promote,
  buildAccountIdToUuid,
  dedupEnabled,
  _isoDaysAgo: isoDaysAgo,
};
