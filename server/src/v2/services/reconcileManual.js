'use strict';

const { sumWithinBalanceWindow, BALANCE_WINDOW_FLOOR_SQL } = require('./openingBalanceWindow');
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
const { usdBaseAmount } = require('./fx');

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
 * @param {string|null} [opts.bookDate] YYYY-MM-DD; explicit MTM booking date used
 *   VERBATIM (entry date + entered-balance as-of), e.g. a quarter/year-end. When
 *   absent, snap asOf to its month-end (legacy default). Ignored for calibrate.
 * @param {boolean} [opts.dryRun] compute only, write nothing.
 * @param {boolean} [opts.force] override the implausible-MTM guard.
 * @returns {Promise<object>} action summary
 */
async function reconcileManual(accountId, { asOf = null, dryRun = false, force = false, bookDate = null } = {}) {
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
    // Explicit bookDate is used verbatim (quarter/year-end alignment); else snap
    // asOf to its month-end (legacy default). Drives entry date + balance as-of.
    const monthEnd = bookDate ? await normalizeDate(db, bookDate) : await resolveMonthEnd(db, asOfDate);
    return db.transaction((client) => mtm(client, accountId, m, monthEnd, dryRun, force));
  }
  return db.transaction((client) => calibrate(client, accountId, m, asOfDate, dryRun));
}

/** Validate + normalize a YYYY-MM-DD string to a real date (throws on garbage). */
async function normalizeDate(conn, s) {
  return (await conn.query(`SELECT $1::date::text AS d`, [s])).rows[0].d;
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
  const entry = await latestEntered(client, accountId, monthEnd);
  if (!entry) throw new Error(`no manual balance for account ${accountId} on/before ${monthEnd}`);

  const comp = (await client.query(
    `SELECT $2::numeric + COALESCE(SUM(amount), 0) AS computed
     FROM transactions
     WHERE account_id = $1 AND transaction_date <= $3::date
       ${BALANCE_WINDOW_FLOOR_SQL}
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

  // USD base_amount for the (account-currency) MTM amount — only when posting.
  // Non-USD converts via the FX table; a missing rate is a hard blocker.
  let baseAmount = null;
  if (Math.abs(amount) >= TOLERANCE) {
    baseAmount = await usdBaseAmount(client, amount, m.currency, monthEnd);
    if (baseAmount == null) {
      throw new Error(`no USD exchange rate for ${m.currency} on/before ${monthEnd} — cannot book MTM for account ${accountId} (${m.name})`);
    }
    summary.base_amount = baseAmount;
  }

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
        [monthEnd, MTM_DESCRIPTION, amount, m.currency, baseAmount, accountId,
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

/**
 * Zero an account's opening_balance ("Reset opening").
 *
 * `opening_balance` is a plug: every ledger balance is `opening_balance + Σ tx`,
 * so an account whose real history starts at its first transaction should carry
 * 0 there. Resetting shifts the WHOLE balance column — today's included — down by
 * the old value. That is both the point (a pre-history plug stops inflating every
 * date) and the risk (net worth moves, and the account then shows drift / an MTM
 * gap against its entered balance).
 *
 * Deliberately does NOT compensate. Clearing the resulting gap is the existing
 * Reconcile action's job, which posts a dated, visible Unrealized-G/L row rather
 * than hiding the amount back in an account field.
 *
 * Blocked (unless forced) on Quicken-promoted accounts: there opening_balance is
 * a computed anchor (CR019 §22 calibration, CR058 valuation anchors), not a plug,
 * and zeroing it moves every anchored valuation date.
 *
 * @param {number} accountId balance-sheet account with NO active bank-feed mapping
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] compute only, write nothing.
 * @param {boolean} [opts.force] override the Quicken-calibrated guard.
 * @returns {Promise<object>} action summary
 */
async function resetOpeningBalance(accountId, { dryRun = false, force = false } = {}) {
  const m = (await db.query(
    `SELECT a.name, a.currency, a.section, a.opening_balance,
            EXISTS (
              SELECT 1 FROM account_source_mappings asm
              WHERE asm.source = 'bank-feed' AND asm.account_id = a.id
                AND asm.ignored IS NOT TRUE
            ) AS is_fed,
            EXISTS (
              SELECT 1 FROM transactions t
              WHERE t.account_id = a.id AND t.source LIKE 'quicken%'
            ) AS quicken_calibrated
     FROM accounts a WHERE a.id = $1`,
    [accountId]
  )).rows[0];
  if (!m) throw new Error(`account ${accountId} not found`);
  if (m.section !== 'balance_sheet') throw new Error(`account ${accountId} is not a balance-sheet account`);
  if (m.is_fed) throw new Error(`account ${accountId} is on a bank feed — use Balance Calibration`);

  const sumTx = await sumWithinBalanceWindow(db, accountId);
  const oldOpening = Number(m.opening_balance);

  const summary = {
    account_id: accountId, name: m.name, currency: m.currency,
    old_opening: oldOpening, new_opening: 0, sum_tx: Math.round(sumTx * 100) / 100,
    computed_before: Math.round((oldOpening + sumTx) * 100) / 100,
    computed_after: Math.round(sumTx * 100) / 100,
    shift: Math.round(-oldOpening * 100) / 100,
    quicken_calibrated: m.quicken_calibrated === true,
    blocked: false, applied: false,
  };

  if (Math.abs(oldOpening) < TOLERANCE) {
    summary.note = 'opening_balance is already 0 — nothing to reset';
    return summary;
  }
  if (summary.quicken_calibrated && !force) {
    summary.blocked = true;
    summary.note =
      `"${m.name}" carries Quicken-promoted rows, so its opening_balance is a computed ` +
      `anchor rather than a plug — zeroing it moves every anchored valuation date. ` +
      `Pass force to override.`;
    return summary;
  }

  if (!dryRun) {
    // opening_balance_date is left alone for the same reason calibrate() leaves
    // it alone (see the comment there) — moving it to the sentinel would pin a
    // balance the app then does not show for pre-2000 rows.
    await db.query(`UPDATE accounts SET opening_balance = 0 WHERE id = $1`, [accountId]);
    summary.applied = true;
  }
  return summary;
}

async function calibrate(client, accountId, m, asOfDate, dryRun) {
  const entry = await latestEntered(client, accountId, asOfDate);
  if (!entry) throw new Error(`no manual balance for account ${accountId} on/before ${asOfDate}`);

  const expected = Number(entry.balance); // fin convention — no sign normalization
  const sumTx = await sumWithinBalanceWindow(client, accountId);
  const newOpening = Math.round((expected - sumTx) * 100) / 100;

  const summary = {
    account_id: accountId, name: m.name, mode: 'calibrate', as_of: asOfDate,
    entered_date: entry.balance_date, entered_balance: expected, expected, sum_tx: sumTx,
    old_opening: Number(m.opening_balance), new_opening: newOpening, applied: false,
  };

  if (!dryRun) {
    // Do NOT touch opening_balance_date — see the matching comment in
    // reconcileToFeed.calibrate. `sumTx` is unfiltered while every read filters
    // on the sentinel, so moving it to '2000-01-01' pins a balance the app then
    // does not show, for any account holding pre-2000 rows.
    await client.query(
      `UPDATE accounts SET opening_balance = $2 WHERE id = $1`,
      [accountId, newOpening]
    );
    summary.applied = true;
  }
  return summary;
}

module.exports = {
  reconcileManual, setManualBalance, resetOpeningBalance,
  UNREALIZED_GL_CATEGORY_ID, MTM_SOURCE,
};
