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
    -- mapped, un-ignored bank-feed accounts STILL in PS↔bank-feed parallel run.
    -- An account with a cutoff (promote_from_date) is already cut over — the feed
    -- owns it from the cutoff on — so PS↔bank-feed row-matching is meaningless for
    -- it (its PS rows are pre-cutoff history, not "missed" by the feed). Excluding
    -- cutoff accounts scopes this gate (and total_ps_only) to genuinely-parallel
    -- accounts (CR023); the panel depopulates as accounts are cut over.
    mapped AS (
      SELECT m.external_name AS feed_uuid, m.account_id
      FROM account_source_mappings m
      WHERE m.source = 'bank-feed' AND m.ignored IS NOT TRUE AND m.account_id IS NOT NULL
        AND m.promote_from_date IS NULL
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

/**
 * Bank-balance reconciliation (CR023 §4.C — the live cutover gate now PS is off).
 *
 * Per mapped + un-ignored bank-feed account: fin's COMPUTED balance
 * (`opening_balance + Σ(amount)`, all sources) vs the bank's reported balance
 * (latest `bankfeed_balances` ≤ asOf). This is a DIFFERENT comparison from
 * `reconcile()` above (which counts PS-vs-bank-feed row coverage) — it is the
 * money-level "does fin agree with the bank?" signal that drives the
 * source-aware calibrate / MTM action.
 *
 * Sign convention: fin stores liabilities negative; the feed reports the
 * positive amount owed. So the reconciled target is `expected = -feed` for
 * liabilities, `feed` for assets. `drift = computed - expected`.
 *
 * Read-only. Brokerage accounts flagged `balance_from_feed` will show a large
 * drift by design — that is the un-booked market move the MTM entry recognizes;
 * the read-override hides it on the balance sheet, this surfaces it here.
 *
 * @param {object} opts
 * @param {string} [opts.asOf] YYYY-MM-DD; defaults to today (CURRENT_DATE).
 * @param {number} [opts.tolerance=0.01] |drift| below this counts as reconciled.
 * @returns {Promise<{asOf: string, accounts: Array, total_unreconciled: number}>}
 */
async function balanceReconcile({ asOf = null, tolerance = 0.01 } = {}) {
  const sql = `
    WITH mapped AS (
      SELECT m.external_name AS feed_uuid, m.account_id,
             m.balance_from_feed, m.promote_from_date, m.trade_treatment, m.reconcile_mode,
             m.feed_sign, m.feed_negate_tx
      FROM account_source_mappings m
      WHERE m.source = 'bank-feed' AND m.ignored IS NOT TRUE AND m.account_id IS NOT NULL
    ),
    computed AS (
      SELECT a.id AS account_id, a.name, a.account_type,
             ROUND(a.opening_balance + COALESCE(SUM(t.amount), 0), 2) AS computed_balance
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
      WHERE a.id IN (SELECT account_id FROM mapped)
      GROUP BY a.id, a.name, a.account_type, a.opening_balance
    ),
    feed AS (
      SELECT m.account_id, bb.balance AS feed_balance, bb.balance_date AS feed_date, bb.currency
      FROM mapped m
      LEFT JOIN LATERAL (
        SELECT balance, balance_date, currency
        FROM bankfeed_balances b
        WHERE b.feed_account_external_id = m.feed_uuid
          AND b.balance_date <= COALESCE($1::date, CURRENT_DATE)
        ORDER BY b.balance_date DESC
        LIMIT 1
      ) bb ON TRUE
    )
    SELECT
      c.account_id, c.name, c.account_type, c.computed_balance,
      m.feed_uuid AS feed_external_id,
      ROUND(f.feed_balance, 2) AS feed_balance,
      f.feed_date::text AS feed_date,
      f.currency,
      m.balance_from_feed, m.promote_from_date::text AS promote_from_date, m.trade_treatment, m.reconcile_mode,
      m.feed_sign, m.feed_negate_tx,
      -- feed_sign converts the feed's reported balance into fin's stored sign.
      -- NULL → account_type heuristic (liability -1, asset +1) = pre-029 behavior.
      ROUND(f.feed_balance * COALESCE(m.feed_sign, CASE WHEN c.account_type = 'liability' THEN -1 ELSE 1 END), 2) AS expected_balance,
      CASE WHEN f.feed_balance IS NULL THEN NULL
           ELSE ROUND(c.computed_balance
                - f.feed_balance * COALESCE(m.feed_sign, CASE WHEN c.account_type = 'liability' THEN -1 ELSE 1 END), 2)
      END AS drift
    FROM computed c
    JOIN mapped m ON m.account_id = c.account_id
    LEFT JOIN feed f ON f.account_id = c.account_id
  `;
  const { rows } = await db.query(sql, [asOf]);
  const asOfRow = await db.query(`SELECT COALESCE($1::date, CURRENT_DATE)::text AS as_of`, [asOf]);

  const accounts = rows
    .map((r) => ({
      ...r,
      computed_balance: r.computed_balance != null ? Number(r.computed_balance) : null,
      feed_balance: r.feed_balance != null ? Number(r.feed_balance) : null,
      expected_balance: r.expected_balance != null ? Number(r.expected_balance) : null,
      drift: r.drift != null ? Number(r.drift) : null,
      balance_from_feed: r.balance_from_feed === true,
      // reconciled is undefined when there is no feed balance to compare against
      reconciled: r.drift == null ? null : Math.abs(Number(r.drift)) < tolerance,
    }))
    .sort((a, b) => Math.abs(b.drift || 0) - Math.abs(a.drift || 0));

  return {
    asOf: asOfRow.rows[0].as_of,
    tolerance,
    accounts,
    total_unreconciled: accounts.filter((a) => a.reconciled === false).length,
  };
}

module.exports = { reconcile, balanceReconcile };
