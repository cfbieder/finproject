/**
 * Bank-feed ↔ PocketSmith reconciliation (CR022 §G trust signal).
 *
 * The promote-time `merged_with_ps_count` proves bank-feed rows aren't inventing
 * duplicates — but it is BLIND to the dangerous failure mode: transactions PS
 * has that bank-feed MISSED. Those PS rows just promote normally and nothing
 * flags them. This query surfaces that gap per account so the ≥1-month parallel
 * run has a real "no data-quality regressions" gate before PS removal.
 *
 * Per mapped + un-ignored bank-feed account, over a window, three buckets:
 *   matched         — PS rows covered by bank-feed (linked via bank_feed_external_id
 *                     OR having a distinct bank-feed twin on the match key)
 *   ps_only         — PS rows with NO bank-feed coverage  ← the regression signal
 *   bank_feed_only  — bank-feed rows with no PS twin (usually bank-feed being
 *                     more complete; informational)
 *
 * Match key mirrors findPsMatch: (account_id, ABS(amount), currency) within ±1 day.
 * A clean parallel run trends ps_only → 0 for every account.
 */

const db = require('../db');

/**
 * @param {object} opts
 * @param {number} [opts.sinceDays=30] window size in days (by transaction_date)
 * @returns {Promise<{since: string, accounts: Array}>}
 */
async function reconcile({ sinceDays = 30 } = {}) {
  // Window lower bound as a YYYY-MM-DD string (computed in SQL to stay TZ-stable).
  const sql = `
    WITH win AS (
      SELECT (CURRENT_DATE - ($1::int))::date AS since
    ),
    -- mapped, un-ignored bank-feed accounts (the only ones that promote)
    mapped AS (
      SELECT m.external_name AS feed_uuid, m.account_id
      FROM account_source_mappings m
      WHERE m.source = 'bank-feed' AND m.ignored IS NOT TRUE AND m.account_id IS NOT NULL
    ),
    ps AS (
      SELECT t.id, t.account_id, t.amount, t.currency, t.transaction_date, t.bank_feed_external_id
      FROM transactions t, win
      WHERE t.source = 'pocketsmith'
        AND t.transaction_date >= win.since
        AND t.account_id IN (SELECT account_id FROM mapped)
    ),
    bf AS (
      SELECT t.id, t.account_id, t.amount, t.currency, t.transaction_date
      FROM transactions t, win
      WHERE t.source = 'bank-feed'
        AND t.transaction_date >= win.since
        AND t.account_id IN (SELECT account_id FROM mapped)
    ),
    -- a PS row is "covered" if it was linked, OR a distinct bank-feed row matches
    -- it on the dedup key within ±1 day.
    ps_classified AS (
      SELECT ps.account_id,
             CASE
               WHEN ps.bank_feed_external_id IS NOT NULL THEN 'matched'
               WHEN EXISTS (
                 SELECT 1 FROM bf
                 WHERE bf.account_id = ps.account_id
                   AND bf.currency = ps.currency
                   AND ROUND(ABS(bf.amount), 2) = ROUND(ABS(ps.amount), 2)
                   AND ABS(bf.transaction_date - ps.transaction_date) <= 1
               ) THEN 'matched'
               ELSE 'ps_only'
             END AS bucket
      FROM ps
    ),
    -- a bank-feed row is "bank_feed_only" if no PS row matches it on the key.
    bf_only AS (
      SELECT bf.account_id
      FROM bf
      WHERE NOT EXISTS (
        SELECT 1 FROM ps
        WHERE ps.account_id = bf.account_id
          AND ps.currency = bf.currency
          AND ROUND(ABS(ps.amount), 2) = ROUND(ABS(bf.amount), 2)
          AND ABS(ps.transaction_date - bf.transaction_date) <= 1
      )
    )
    SELECT
      m.feed_uuid,
      m.account_id,
      a.name AS account_name,
      COALESCE(SUM(CASE WHEN c.bucket = 'matched' THEN 1 ELSE 0 END), 0)::int AS matched,
      COALESCE(SUM(CASE WHEN c.bucket = 'ps_only' THEN 1 ELSE 0 END), 0)::int AS ps_only,
      (SELECT COUNT(*)::int FROM bf_only WHERE bf_only.account_id = m.account_id) AS bank_feed_only
    FROM mapped m
    JOIN accounts a ON a.id = m.account_id
    LEFT JOIN ps_classified c ON c.account_id = m.account_id
    GROUP BY m.feed_uuid, m.account_id, a.name
    ORDER BY ps_only DESC, a.name
  `;
  const { rows } = await db.query(sql, [sinceDays]);
  const sinceRow = await db.query(`SELECT (CURRENT_DATE - ($1::int))::date::text AS since`, [sinceDays]);

  return {
    since: sinceRow.rows[0].since,
    sinceDays,
    accounts: rows,
    // a clean parallel run has total_ps_only === 0
    total_ps_only: rows.reduce((s, r) => s + r.ps_only, 0),
  };
}

module.exports = { reconcile };
