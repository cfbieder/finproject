'use strict';
/**
 * Account balances as of a date, for every account under named root accounts:
 * `opening_balance + Σ(amount)` from `opening_balance_date` through `asOfDate` (CR076 D2). Lifted
 * UNCHANGED out of `getOpeningBankCash` (CR104 §3.2) so the forecast's opening cash and the budget
 * builder's Cash Flow read one definition.
 *
 * Narrower than the balance sheet (`reports.js` `nativeBalanceRows`): no CR024 `balance_from_feed`
 * override, no `is_active` filter, and an account whose `opening_balance_date` is after `asOfDate`
 * still counts its opening balance. None of these applied to a Cash/Investments account on
 * 2026-11-15; changing any of them moves the forecast's opening cash, so it is a separate decision.
 *
 * Returns one row per account in each tree, the root included: `{ id, name, root, currency, balance }`.
 * `currency` is the account's own, NOT defaulted — each caller decides what a missing one means.
 */
async function treeBalancesAsOf(client, rootNames, asOfDate) {
  const { rows } = await client.query(`
    WITH RECURSIVE tree AS (
      SELECT id, name, name AS root, currency, opening_balance, opening_balance_date
        FROM accounts WHERE name = ANY($1::text[])
      UNION ALL
      SELECT a.id, a.name, tree.root, a.currency, a.opening_balance, a.opening_balance_date
        FROM accounts a JOIN tree ON a.parent_id = tree.id
    )
    SELECT tree.id, tree.name, tree.root, tree.currency,
           tree.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
      FROM tree
      LEFT JOIN transactions t
        ON t.account_id = tree.id
       AND t.transaction_date >= tree.opening_balance_date
       AND t.transaction_date <= $2
     GROUP BY tree.id, tree.name, tree.root, tree.currency, tree.opening_balance
  `, [rootNames, asOfDate]);
  return rows.map((r) => ({
    id: r.id, name: r.name, root: r.root,
    currency: r.currency == null ? null : String(r.currency).trim(),
    balance: r.balance == null ? null : Number(r.balance),
  }));
}

module.exports = { treeBalancesAsOf };
