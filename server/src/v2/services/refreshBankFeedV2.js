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
const { normalizeBatch, findPsMatch } = require('../converters/bankFeedToCanonical');
const staging = require('../repositories/bankfeedStaging');
const db = require('../db');

const SOURCE = 'bank-feed';

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
 * Step 1-3: fetch → normalize → stage. Returns ingest summary.
 */
async function ingest({ sinceDays = 14, since } = {}) {
  const sinceDate = since || isoDaysAgo(sinceDays);
  const accountExternalIdById = await buildAccountIdToUuid();

  const resp = await bankFeedClient.transactions({ since: sinceDate, limit: 500 });
  const txs = (resp && resp.transactions) || [];

  const normalized = normalizeBatch(txs, { accountExternalIdById });
  const insertResult = await staging.insertMany(normalized.rows);

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
  };
}

/**
 * Step 4: promote unpromoted staging rows into transactions.
 * Returns a summary that is a superset of the PS syncStagingToTransactions shape
 * so the existing review UI reads its known fields unchanged.
 */
async function promote() {
  // Load unpromoted, non-pending staging rows with resolved fin account + ignore flag.
  // ::text on dates keeps findPsMatch on 'YYYY-MM-DD' strings (TZ-safe).
  const rows = (await db.query(`
    SELECT s.id, s.external_id, s.feed_account_external_id,
           s.transaction_date::text AS transaction_date,
           s.amount, s.currency, s.base_amount, s.base_currency,
           s.description, s.merchant,
           m.account_id AS fin_account_id, m.ignored
    FROM bankfeed_staging s
    LEFT JOIN account_source_mappings m
      ON m.source = '${SOURCE}' AND m.external_name = s.feed_account_external_id
    WHERE s.promoted_transaction_id IS NULL
      AND s.pending = FALSE
    ORDER BY s.transaction_date, s.id
  `)).rows;

  const ignoredAccounts = new Set();
  const unmappedAccounts = new Set();
  const promotable = [];
  for (const r of rows) {
    // Order matters: an ignore-only row has ignored=TRUE with fin_account_id=NULL
    // (migration 024). Check ignored FIRST so it reports as ignored, not unmapped,
    // and so an explicitly-ignored mapped account is also suppressed.
    if (r.ignored === true) { ignoredAccounts.add(r.feed_account_external_id); continue; }
    if (r.fin_account_id == null) { unmappedAccounts.add(r.feed_account_external_id); continue; }
    promotable.push(r);
  }

  let inserted = 0;
  let linked = 0;
  const mergedWithPsCount = {};
  const dedup = dedupEnabled();

  await db.transaction(async (client) => {
    for (const r of promotable) {
      let matchedTxId = null;

      if (dedup) {
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
        const ins = await client.query(`
          INSERT INTO transactions
            (transaction_date, description1, amount, currency, base_amount, base_currency,
             account_id, source, bank_feed_external_id, accepted)
          VALUES ($1, $2, $3, $4, $5, $6, $7, '${SOURCE}', $8, FALSE)
          ON CONFLICT (bank_feed_external_id) WHERE bank_feed_external_id IS NOT NULL
          DO NOTHING
          RETURNING id
        `, [
          r.transaction_date,
          r.description || r.merchant || null,
          r.amount,
          r.currency,
          r.base_amount != null ? r.base_amount : null,
          r.base_currency || 'USD',
          r.fin_account_id,
          r.external_id,
        ]);
        if (ins.rows[0]) {
          await client.query(
            `UPDATE bankfeed_staging SET promoted_transaction_id = $2 WHERE id = $1`,
            [r.id, ins.rows[0].id]
          );
          inserted++;
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

/** Full pipeline: ingest then promote. Mirrors the PS {ingest, sync} response. */
async function refresh({ sinceDays = 14, since } = {}) {
  const ingestResult = await ingest({ sinceDays, since });
  const sync = await promote();
  return { ingest: ingestResult, sync };
}

module.exports = {
  refresh,
  ingest,
  promote,
  buildAccountIdToUuid,
  dedupEnabled,
  _isoDaysAgo: isoDaysAgo,
};
