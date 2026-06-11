'use strict';
/**
 * reconcileManual.js — CR033 manual (non-fed) reconciliation engine.
 *
 * The non-fed twin of reconcileToFeed.js (CR023). Reconciles ONE balance-sheet
 * account that has NO bank feed to a CURRENT balance the user typed in
 * (`manual_balances`), the way that account is configured
 * (`accounts.manual_reconcile_mode`):
 *
 *   'mtm' (brokerage) — post/refresh a month-end Unrealized-G/L (category 88,
 *     source='mtm') adjustment = entered(monthEnd) − computed(monthEnd). Same
 *     cat-88 audit trail and 15%-phantom-gain guard as the feed path.
 *
 *   'calibrate' (cash) — re-anchor opening_balance = entered − Σtx so the
 *     computed balance equals the entered figure.
 *
 * Deliberately a PARALLEL module to reconcileToFeed.js (not a shared refactor):
 * the live CR023 feed path stays untouched. The only material differences are
 * the balance source (manual_balances, not bankfeed_balances) and the sign
 * convention — the manual figure is already in fin's stored convention, so
 * `expected = entered` with no feed_sign normalization.
 *
 * Idempotent ('mtm' deletes this month's prior mtm row before recomputing) and
 * atomic (one db.transaction). The action is MANUAL (button) — never on a cron.
 */

const db = require('../db');

const UNREALIZED_GL_CATEGORY_ID = 88; // accounts.id "Unrealized G/L" (expense)
const MTM_SOURCE = 'mtm';
const MTM_DESCRIPTION = 'Unrealized G/L (manual MTM)';
const TOLERANCE = 0.01;
// Same guard as reconcileToFeed: an MTM this large a share of the entered value
// almost certainly means basis was never anchored — block apply unless forced.
const MTM_IMPLAUSIBLE_PCT = 0.15;

/**
 * Upsert the user-entered current balance for a non-fed account. Stored in fin's
 * signed convention (assets +, liabilities −). Last-write-per-date wins.
 * @param {number} accountId
 * @param {object} opts
 * @param {number} opts.balance signed current balance
 * @param {string|null} [opts.balanceDate] YYYY-MM-DD; defaults to today.
 * @param {string|null} [opts.note]
 * @returns {Promise<object>} the stored row
 */
async function setManualBalance(accountId, { balance, balanceDate = null, note = null } = {}) {
  if (balance == null || !Number.isFinite(Number(balance))) {
    throw new Error('balance must be a finite number');
  }
  const acct = (await db.query(
    `SELECT id, currency, section FROM accounts WHERE id = $1`, [accountId]
  )).rows[0];
  if (!acct) throw new Error(`account ${accountId} not found`);
  if (acct.section !== 'balance_sheet') {
    throw new Error(`account ${accountId} is not a balance-sheet account`);
  }
  const fed = (await db.query(
    `SELECT 1 FROM account_source_mappings
     WHERE source = 'bank-feed' AND account_id = $1 AND ignored IS NOT TRUE LIMIT 1`,
    [accountId]
  )).rows[0];
  if (fed) throw new Error(`account ${accountId} is on a bank feed — use Balance Calibration`);

  const r = await db.query(
    `INSERT INTO manual_balances (account_id, balance, balance_date, currency, note)
     VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5)
     ON CONFLICT (account_id, balance_date)
     DO UPDATE SET balance = EXCLUDED.balance, currency = EXCLUDED.currency,
                   note = EXCLUDED.note, entered_at = now()
     RETURNING account_id, balance, balance_date::text AS balance_date, currency, note`,
    [accountId, balance, balanceDate, acct.currency, note]
  );
  const row = r.rows[0];
  row.balance = Number(row.balance);
  return row;
}

/**
 * @param {number} accountId balance-sheet account with NO active bank-feed mapping
 * @param {object} [opts]
 * @param {string|null} [opts.asOf] YYYY-MM-DD; defaults to today.
 * @param {boolean} [opts.dryRun] compute only, write nothing.
 * @param {boolean} [opts.force] override the implausible-MTM guard.
 * @returns {Promise<object>} action summary
 */
async function reconcileManual(accountId, { asOf = null, dryRun = false, force = false } = {}) {
  const m = (await db.query(
    `SELECT a.name, a.account_type, a.currency, a.opening_balance,
            a.manual_reconcile_mode, a.section,
            EXISTS (
              SELECT 1 FROM account_source_mappings asm
              WHERE asm.source = 'bank-feed' AND asm.account_id = a.id
                AND asm.ignored IS NOT TRUE
            ) AS is_fed
     FROM accounts a WHERE a.id = $1`,
    [accountId]
  )).rows[0];
  if (!m) throw new Error(`account ${accountId} not found`);
  if (m.section !== 'balance_sheet') throw new Error(`account ${accountId} is not a balance-sheet account`);
  if (m.is_fed) throw new Error(`account ${accountId} is on a bank feed — use Balance Calibration`);

  const asOfDate = (await db.query(
    `SELECT COALESCE($1::date, CURRENT_DATE)::text AS d`, [asOf]
  )).rows[0].d;

  if (m.manual_reconcile_mode === 'mtm') {
    const monthEnd = await resolveMonthEnd(db, asOfDate);
    return db.transaction((client) => mtm(client, accountId, m, monthEnd, dryRun, force));
  }
  return db.transaction((client) => calibrate(client, accountId, m, asOfDate, dryRun));
}

/** Month-end of asOf (asOf itself if it already IS a month-end, else previous month-end). */
async function resolveMonthEnd(conn, asOfDate) {
  return (await conn.query(
    `SELECT CASE
       WHEN $1::date = (date_trunc('month',$1::date) + interval '1 month - 1 day')::date
         THEN $1::date
       ELSE (date_trunc('month',$1::date) - interval '1 day')::date
     END::text AS d`,
    [asOfDate]
  )).rows[0].d;
}

/** Latest user-entered balance on/before a cutoff date. */
async function latestEntered(client, accountId, cutoff) {
  return (await client.query(
    `SELECT balance, balance_date::text AS balance_date FROM manual_balances
     WHERE account_id = $1 AND balance_date <= $2::date
     ORDER BY balance_date DESC LIMIT 1`,
    [accountId, cutoff]
  )).rows[0];
}

async function mtm(client, accountId, m, monthEnd, dryRun, force = false) {
  if (m.currency !== 'USD') {
    // Mirror reconcileToFeed: refuse to write a wrong USD base_amount.
    throw new Error(`MTM for non-USD account ${accountId} (${m.currency}) not supported`);
  }

  const entry = await latestEntered(client, accountId, monthEnd);
  if (!entry) throw new Error(`no manual balance for account ${accountId} on/before ${monthEnd}`);

  const comp = (await client.query(
    `SELECT $2::numeric + COALESCE(SUM(amount), 0) AS computed
     FROM transactions
     WHERE account_id = $1 AND transaction_date <= $3::date
       AND NOT (source = $4 AND transaction_date = $3::date)`,
    [accountId, m.opening_balance, monthEnd, MTM_SOURCE]
  )).rows[0];

  const expected = Number(entry.balance); // fin convention — no sign normalization
  const computed = Number(comp.computed);
  const amount = Math.round((expected - computed) * 100) / 100;

  const implausiblePct = expected !== 0 ? Math.abs(amount) / Math.abs(expected) : 0;
  const implausible = implausiblePct > MTM_IMPLAUSIBLE_PCT;

  const summary = {
    account_id: accountId, name: m.name, mode: 'mtm', month_end: monthEnd,
    entered_date: entry.balance_date, entered_balance: expected, computed_excl_mtm: computed,
    mtm_amount: amount, category_id: UNREALIZED_GL_CATEGORY_ID,
    implausible, implausible_pct: Math.round(implausiblePct * 1000) / 1000,
    applied: false,
  };

  if (implausible && !force) {
    summary.note = `MTM ${amount} is ${(implausiblePct * 100).toFixed(1)}% of the entered balance — ` +
      `implausible (basis likely unanchored). Anchor the account's basis first, or pass force to override.`;
    if (!dryRun) return summary;
  }

  if (!dryRun) {
    await client.query(
      `DELETE FROM transactions WHERE account_id = $1 AND source = $2 AND transaction_date = $3::date`,
      [accountId, MTM_SOURCE, monthEnd]
    );
    if (Math.abs(amount) >= TOLERANCE) {
      await client.query(
        `INSERT INTO transactions
           (transaction_date, description1, amount, currency, base_amount, base_currency,
            account_id, category_id, source, accepted)
         VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, TRUE)`,
        [monthEnd, MTM_DESCRIPTION, amount, m.currency, amount, accountId,
         UNREALIZED_GL_CATEGORY_ID, MTM_SOURCE]
      );
    } else {
      summary.note = 'no adjustment posted (< tolerance)';
    }
    summary.applied = true;
  } else if (Math.abs(amount) < TOLERANCE) {
    summary.note = 'no adjustment needed (< tolerance)';
  }
  return summary;
}

async function calibrate(client, accountId, m, asOfDate, dryRun) {
  const entry = await latestEntered(client, accountId, asOfDate);
  if (!entry) throw new Error(`no manual balance for account ${accountId} on/before ${asOfDate}`);

  const expected = Number(entry.balance); // fin convention — no sign normalization
  const sumTx = Number((await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE account_id = $1`,
    [accountId]
  )).rows[0].s);
  const newOpening = Math.round((expected - sumTx) * 100) / 100;

  const summary = {
    account_id: accountId, name: m.name, mode: 'calibrate', as_of: asOfDate,
    entered_date: entry.balance_date, entered_balance: expected, expected, sum_tx: sumTx,
    old_opening: Number(m.opening_balance), new_opening: newOpening, applied: false,
  };

  if (!dryRun) {
    await client.query(
      `UPDATE accounts SET opening_balance = $2, opening_balance_date = '2000-01-01' WHERE id = $1`,
      [accountId, newOpening]
    );
    summary.applied = true;
  }
  return summary;
}

module.exports = { reconcileManual, setManualBalance, UNREALIZED_GL_CATEGORY_ID, MTM_SOURCE };
