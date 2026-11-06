'use strict';
/**
 * CR101 — accounts inactive from a date.
 *
 * `accounts.inactive_from` is an account's OWN date (first of a month, NULL = active). The date that
 * counts is the inherited one, `account_inactive_effective.inactive_from_eff` (migration 089): the
 * earliest on the path to the root, so a parent's date covers its children (D6, parent wins).
 *
 * D2: a balance-sheet account — or a balance-sheet parent, for each of its leaves — must read zero in
 * its own currency on the day before the date, or the date is refused, naming each balance. Uses the
 * balance sheet's own query (`reports.nativeBalanceRows`), so the two cannot disagree; no FX, no network.
 */

const db = require('../v2/db');
const { nativeBalanceRows } = require('./reports');

const err = (status, message) => Object.assign(new Error(message), { status });

/** Every account's own and inherited date, and its last posting (as account or category). */
async function listInactive() {
  const rows = (await db.query(
    `WITH last AS (
       SELECT id, MAX(d) AS d FROM (
         SELECT category_id AS id, MAX(transaction_date) AS d FROM transactions WHERE category_id IS NOT NULL GROUP BY 1
         UNION ALL
         SELECT account_id, MAX(transaction_date) FROM transactions WHERE account_id IS NOT NULL GROUP BY 1
       ) x GROUP BY id
     )
     SELECT a.id, a.name, a.inactive_from::text AS own, e.inactive_from_eff::text AS eff, last.d::text AS last_activity
       FROM accounts a
       JOIN account_inactive_effective e ON e.id = a.id
       LEFT JOIN last ON last.id = a.id
      WHERE a.is_active`
  )).rows;
  return rows.map((r) => ({
    id: r.id, name: r.name, inactiveFrom: r.own, inactiveFromEffective: r.eff, lastActivity: r.last_activity,
  }));
}

/**
 * Validate a requested own date for `accountId`. Returns the value to store (a 'YYYY-MM-01' string or
 * null) or throws a 400 naming the reason. `raw` null/'' clears it.
 */
async function checkInactiveFrom(accountId, raw) {
  if (raw === null || raw === '') return null;
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(v)) throw err(400, 'Inactive from must be the first of a month (YYYY-MM-01)');

  const acct = (await db.query('SELECT id, section FROM accounts WHERE id = $1', [accountId])).rows[0];
  if (!acct) throw err(404, 'Account not found');
  if (acct.section !== 'balance_sheet') return v;

  // D2 — the account and every leaf under it must read zero, in its own currency, the day before.
  const leaves = (await db.query(
    `WITH RECURSIVE sub AS (
       SELECT id FROM accounts WHERE id = $1
       UNION ALL
       SELECT a.id FROM accounts a JOIN sub ON a.parent_id = sub.id WHERE a.is_active
     )
     SELECT s.id FROM sub s WHERE NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = s.id AND c.is_active)`,
    [accountId]
  )).rows.map((r) => r.id);
  const dayBefore = (await db.query('SELECT ($1::date - 1)::text AS d', [v])).rows[0].d;
  const nonZero = (await nativeBalanceRows(dayBefore, { accountIds: leaves }))
    .filter((r) => Math.abs(Number(r.closing_balance)) >= 0.005);
  if (nonZero.length) {
    const list = nonZero.map((r) => `${r.account_name} holds ${Number(r.closing_balance).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${r.account_currency || ''}`.trim()).join('; ');
    throw err(400, `Not zero on ${dayBefore}: ${list} — book the sale or transfer first`);
  }
  return v;
}

module.exports = { listInactive, checkInactiveFrom };
