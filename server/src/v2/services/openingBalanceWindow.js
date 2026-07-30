'use strict';
/**
 * openingBalanceWindow.js — the one place that sums a balance-sheet account's
 * transactions the way every read will later sum them.
 *
 * Every balance in fin is displayed as
 *
 *     opening_balance + SUM(amount) WHERE transaction_date >= opening_balance_date
 *
 * so `opening_balance_date` is a floor and rows below it are invisible. Any code
 * that CALCULATES an opening_balance — calibrate, mtm, reset — must sum over the
 * same window, or it pins a number the app cannot display.
 *
 * This existed as three separate `SELECT COALESCE(SUM(amount),0) FROM
 * transactions WHERE account_id = $1` copies (reconcileToFeed.calibrate,
 * reconcileToFeed.mtm, reconcileManual.calibrate), none of them bounded. On prod
 * that was live, if small: Chase Checking holds one row dated 1999-12-31 worth
 * 1,950.61 sitting BELOW its 2000-01-01 sentinel, so a Reconcile click pinned
 * opening_balance 1,950.61 too low and the account then displayed 1,950.61 UNDER
 * the feed it had just reconciled to — a discrepancy no feed check could see,
 * because the feed side was right.
 *
 * Three copies is also why the bug survived: `f14a37f` fixed the related defect
 * of these paths *moving* the sentinel, and the sums were left behind. One
 * function means the next fix cannot miss two of them.
 */

/**
 * SQL fragment for the sentinel floor, for the two `mtm` queries that cannot use
 * `sumWithinBalanceWindow` because they carry their own month-end ceiling and an
 * exclusion for the row being recomputed. Exported so the clause has exactly one
 * definition even where the surrounding query differs.
 *
 * `$1` must be the account id in the calling query.
 */
const BALANCE_WINDOW_FLOOR_SQL =
  `AND transaction_date >= (SELECT opening_balance_date FROM accounts WHERE id = $1)`;

/**
 * Sum an account's transactions over exactly the window its balance is read
 * through: at or after `opening_balance_date`, and not after `asOf`.
 *
 * The upper bound matters independently of the sentinel — a future-dated row
 * would otherwise be counted here and excluded from the displayed balance,
 * producing the same class of mismatch from the other end.
 *
 * @param {object} client     pg client or pool
 * @param {number} accountId
 * @param {string} [asOf]     ISO date; defaults to today
 * @returns {Promise<number>}
 */
async function sumWithinBalanceWindow(client, accountId, asOf = null) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(t.amount), 0) AS s
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.account_id = $1
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= COALESCE($2::date, CURRENT_DATE)`,
    [accountId, asOf]
  );
  return Number(rows[0].s);
}

module.exports = { sumWithinBalanceWindow, BALANCE_WINDOW_FLOOR_SQL };
