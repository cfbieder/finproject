/**
 * Manual balance reconciliation (CR033) — the non-fed analog of
 * bankFeedReconciliation.balanceReconcile (CR023 §4.C).
 *
 * Per balance-sheet account that has NO active bank feed: fin's COMPUTED balance
 * (`opening_balance + Σ(amount)`, all sources) vs a CURRENT balance the user has
 * typed in (`manual_balances`, latest ≤ asOf). This drives the same source-aware
 * calibrate / MTM "Reconcile" action the feed page uses, except the comparison
 * target is hand-entered rather than fed.
 *
 * Sign convention: unlike the feed (whose external format forces a per-mapping
 * `feed_sign`), the manual figure is the user's own — they type it in fin's
 * stored convention (assets +, liabilities −, i.e. the same number the Computed
 * column shows). So `expected = entered` directly, `drift = computed − expected`,
 * no sign normalization.
 *
 * "No active bank feed" = no account_source_mappings row with source='bank-feed',
 * ignored IS NOT TRUE, account_id IS NOT NULL (the exact complement of the feed
 * page's account set). Read-only.
 *
 * @param {object} opts
 * @param {string} [opts.asOf] YYYY-MM-DD; defaults to today (CURRENT_DATE).
 * @param {number} [opts.tolerance=0.01] |drift| below this counts as reconciled.
 * @returns {Promise<{asOf: string, tolerance: number, accounts: Array, total_unreconciled: number}>}
 */

const db = require('../db');

async function manualBalanceReconcile({ asOf = null, tolerance = 0.01 } = {}) {
  const sql = `
    WITH fed AS (
      -- accounts owned by a live bank feed — EXCLUDED from manual calibration.
      SELECT DISTINCT account_id
      FROM account_source_mappings
      WHERE source = 'bank-feed' AND ignored IS NOT TRUE AND account_id IS NOT NULL
    ),
    eligible AS (
      -- final leaves only: a parent/container account (one that has children) is
      -- an aggregation node, not something you calibrate directly. Active only.
      SELECT a.id AS account_id, a.name, a.account_type, a.currency,
             a.opening_balance, a.manual_reconcile_mode
      FROM accounts a
      WHERE a.section = 'balance_sheet'
        AND a.is_active = TRUE
        AND NOT EXISTS (SELECT 1 FROM accounts ch WHERE ch.parent_id = a.id)
        AND a.id NOT IN (SELECT account_id FROM fed)
    ),
    computed AS (
      SELECT e.account_id,
             ROUND(e.opening_balance + COALESCE(SUM(t.amount), 0), 2) AS computed_balance
      FROM eligible e
      LEFT JOIN transactions t ON t.account_id = e.account_id
      GROUP BY e.account_id, e.opening_balance
    ),
    entered AS (
      SELECT e.account_id, mb.balance AS entered_balance,
             mb.balance_date AS entered_date, mb.currency AS entered_currency,
             mb.note
      FROM eligible e
      LEFT JOIN LATERAL (
        SELECT balance, balance_date, currency, note
        FROM manual_balances b
        WHERE b.account_id = e.account_id
          AND b.balance_date <= COALESCE($1::date, CURRENT_DATE)
        ORDER BY b.balance_date DESC
        LIMIT 1
      ) mb ON TRUE
    )
    SELECT
      e.account_id, e.name, e.account_type, e.currency,
      e.manual_reconcile_mode AS reconcile_mode,
      c.computed_balance,
      ROUND(en.entered_balance, 2) AS entered_balance,
      en.entered_date::text AS entered_date,
      en.note AS entered_note,
      -- expected = entered (fin convention, no sign normalization); drift only
      -- when a balance has been entered.
      ROUND(en.entered_balance, 2) AS expected_balance,
      CASE WHEN en.entered_balance IS NULL THEN NULL
           ELSE ROUND(c.computed_balance - en.entered_balance, 2)
      END AS drift
    FROM eligible e
    JOIN computed c ON c.account_id = e.account_id
    LEFT JOIN entered en ON en.account_id = e.account_id
  `;
  const { rows } = await db.query(sql, [asOf]);
  const asOfRow = await db.query(`SELECT COALESCE($1::date, CURRENT_DATE)::text AS as_of`, [asOf]);

  const accounts = rows
    .map((r) => ({
      ...r,
      computed_balance: r.computed_balance != null ? Number(r.computed_balance) : null,
      entered_balance: r.entered_balance != null ? Number(r.entered_balance) : null,
      expected_balance: r.expected_balance != null ? Number(r.expected_balance) : null,
      drift: r.drift != null ? Number(r.drift) : null,
      // reconciled is null when no current balance has been entered yet (pending)
      reconciled: r.drift == null ? null : Math.abs(Number(r.drift)) < tolerance,
    }))
    .sort((a, b) => {
      // pending (no entry) sinks to the bottom; otherwise largest |drift| first.
      const ap = a.drift == null ? 1 : 0;
      const bp = b.drift == null ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return Math.abs(b.drift || 0) - Math.abs(a.drift || 0);
    });

  return {
    asOf: asOfRow.rows[0].as_of,
    tolerance,
    accounts,
    total_unreconciled: accounts.filter((a) => a.reconciled === false).length,
  };
}

module.exports = { manualBalanceReconcile };
