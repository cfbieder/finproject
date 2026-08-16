'use strict';
/**
 * fbarMaxValue.js — CR082 §5. The maximum value a balance-sheet account reached
 * during a calendar year, in its own currency.
 *
 * FinCEN Form 114 asks exactly one number per account: the MAXIMUM value during
 * the calendar year. Not the year-end balance (the form has no such field), and
 * not a USD figure derived at the rate on the day of the maximum — the maximum
 * is taken in the account's own currency and converted ONCE, at the Treasury
 * December-31 rate (see `tax_fx_rates`; that conversion is deliberately not this
 * module's job).
 *
 * Three ways to get this wrong, all three of which the CR's own first draft got
 * wrong, and all three of which produce a plausible number:
 *
 * 1. A ROW-ORDERED RUNNING SUM. Transactions carry a `date`, not a timestamp, so
 *    intra-day order is not information this database holds. Prod, account `PKO`
 *    (18), 2025 — the same ledger under three readings:
 *
 *        end-of-day (correct)                 631,678.72
 *        running sum ORDER BY (date, id)      793,547.72   <- what
 *                                                            findLedgerWithRunningBalance
 *                                                            does today
 *        running sum ORDER BY (date, amount)  4,393,629.03
 *
 *    2025-06-23 saw 4,294,000.00 PLN in and out, net 0.00. The naive answer is
 *    not one wrong number, it is a RANGE selected by an arbitrary tie-break.
 *    FinCEN directs filers to periodic account statement values, which are
 *    end-of-day figures — so end-of-day is both the defensible reading and the
 *    only one this data supports.
 *
 * 2. IGNORING THE JANUARY 1 CARRY-IN. A maximum taken only over days that have a
 *    transaction in the year is wrong for every account that was drained during
 *    it. On prod for 2025 that is TWELVE accounts, including `Wise - USD` (8) —
 *    in-year max 1,552.20 against a carry-in of 1,718.27 — and eight accounts
 *    with no in-year rows at all, for which an in-year max is NULL.
 *
 * 3. DROPPING THE `opening_balance_date` FLOOR. Every balance in fin is read as
 *    `opening_balance + SUM(amount) WHERE transaction_date >= opening_balance_date`.
 *    `openingBalanceWindow.js` exists because that sum had been copied three
 *    times unbounded; this module reuses its floor rather than writing a fourth.
 *
 * A NULL maximum is never a zero. An account this module refuses is reported as
 * "needs a figure" and the owner types one — a silent 0 on a reportable account
 * is the worst output this feature can produce, because it looks like an answer.
 */

const { BALANCE_WINDOW_FLOOR_SQL } = require('./openingBalanceWindow');

/**
 * `date` columns come back from node-postgres as a Date on some paths and as a
 * plain 'YYYY-MM-DD' string on others, depending on the type parsers registered
 * by whatever loaded the pool first. Both are handled here so a refusal message
 * cannot throw while formatting the very rows it exists to report.
 */
function isoDate(v) {
  if (v == null) return null;
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

/** Refusal reasons. Each means "this account needs a typed figure", never 0. */
const REFUSE_CROSS_CURRENCY = 'cross_currency_rows';
const REFUSE_NO_ACCOUNT = 'account_not_found';

/**
 * Rows whose `currency` differs from the account's own. `SUM(amount)` would add
 * them straight into a native total. Verified live on prod: `CVC Fund IX` (34,
 * EUR) holds a USD row (id 2709883, 41,564.86, 2026-07-31). This is the CR037
 * amount/base_amount class, and the only safe response is to refuse the account
 * and name the rows — converting them here would invent an FX policy the form
 * does not ask for.
 */
async function crossCurrencyRows(client, accountId, taxYear) {
  const { rows } = await client.query(
    `SELECT t.id, t.transaction_date, t.amount, t.currency
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.account_id = $1
        AND t.currency IS DISTINCT FROM a.currency
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= make_date($2::int, 12, 31)
      ORDER BY t.transaction_date
      LIMIT 50`,
    [accountId, taxYear]
  );
  return rows;
}

/**
 * Compute one account's figures for one calendar year.
 *
 * @returns {Promise<object>} {
 *   account_id, name, currency,
 *   carry_in_native,          balance at Dec-31 of taxYear-1
 *   max_native,               TRUE maximum, may be negative
 *   max_on,                   'carry-in' | ISO date of the end-of-day peak
 *   reportable_max_native,    max_native floored at 0 (FBAR reports no negative)
 *   year_end_native,
 *   in_year_tx_days,
 *   carry_in_only,            the maximum is the carry-in AND the year is empty
 *   refused, refusal_reason, refusal_detail
 * }
 */
async function accountYearFigures(client, accountId, taxYear) {
  const { rows: acct } = await client.query(
    `SELECT id, name, currency, COALESCE(opening_balance, 0) AS opening_balance,
            opening_balance_date
       FROM accounts WHERE id = $1`,
    [accountId]
  );
  if (!acct.length) {
    return { account_id: accountId, refused: true, refusal_reason: REFUSE_NO_ACCOUNT };
  }
  const a = acct[0];

  const bad = await crossCurrencyRows(client, accountId, taxYear);
  if (bad.length) {
    return {
      account_id: a.id, name: a.name, currency: a.currency,
      refused: true,
      refusal_reason: REFUSE_CROSS_CURRENCY,
      refusal_detail:
        `${bad.length} row(s) not in ${a.currency}: ` +
        bad.slice(0, 5).map((r) => `#${r.id} ${isoDate(r.transaction_date)} ${r.amount} ${r.currency}`).join('; '),
    };
  }

  // One statement so the carry-in and the in-year series cannot disagree about
  // the floor. `SUM(SUM(amount)) OVER (ORDER BY date)` aggregates to one row per
  // DAY first, then accumulates — that inner aggregation is the end-of-day rule,
  // and it is the whole difference between 631,678.72 and 4,393,629.03.
  const { rows } = await client.query(
    `WITH a AS (
       SELECT id, COALESCE(opening_balance,0) AS ob, opening_balance_date AS floor
         FROM accounts WHERE id = $1
     ),
     carry AS (
       SELECT a.ob + COALESCE(SUM(t.amount), 0) AS v
         FROM a
         LEFT JOIN transactions t
                ON t.account_id = a.id
               AND t.transaction_date >= a.floor
               AND t.transaction_date <= make_date($2::int - 1, 12, 31)
        GROUP BY a.ob
     ),
     eod AS (
       SELECT t.transaction_date AS d,
              (SELECT v FROM carry)
                + SUM(SUM(t.amount)) OVER (ORDER BY t.transaction_date) AS bal
         FROM a
         JOIN transactions t
           ON t.account_id = a.id
          AND t.transaction_date >= a.floor
        WHERE t.transaction_date >= make_date($2::int, 1, 1)
          AND t.transaction_date <= make_date($2::int, 12, 31)
        GROUP BY t.transaction_date
     )
     SELECT (SELECT v FROM carry)                                   AS carry_in,
            (SELECT count(*) FROM eod)                              AS day_count,
            (SELECT max(bal) FROM eod)                              AS in_year_max,
            (SELECT bal FROM eod ORDER BY d DESC LIMIT 1)           AS year_end,
            (SELECT d FROM eod WHERE bal = (SELECT max(bal) FROM eod)
              ORDER BY d LIMIT 1)                                   AS max_on`,
    [accountId, taxYear]
  );
  const r = rows[0];

  const carryIn = Number(r.carry_in);
  const dayCount = Number(r.day_count);
  const inYearMax = r.in_year_max === null ? null : Number(r.in_year_max);

  // The maximum ranges over the WHOLE year, and Jan 1 opens at the carry-in.
  // An account with no in-year rows held its carry-in every day of the year;
  // that is a figure, not a NULL.
  const maxNative = inYearMax === null ? carryIn : Math.max(carryIn, inYearMax);
  const maxOn = inYearMax !== null && inYearMax > carryIn && r.max_on
    ? isoDate(r.max_on)
    : 'carry-in';
  const yearEnd = r.year_end === null ? carryIn : Number(r.year_end);

  // ── The carry-in cannot distinguish "held this on 1 January" from "this
  // account did not exist yet" (CR082 §12b.14) ──
  //
  // `carry` is computed from `opening_balance` plus every row up to Dec-31 of
  // the prior year. On an account fin has held for a decade that is a real
  // balance. On an account CREATED later, whose `opening_balance` carries the
  // house 1990-01-01 sentinel (the CR012 convention, on all 26 recent
  // accounts), the same expression projects a 2026 calibration plug back 36
  // years and reports it as a 2025 balance.
  //
  // Found live: `PKO TFI` was created 2026-03-01, its first transaction is
  // 2026-02-09, and it sat on the TY2025 report at 6,000 PLN. `Revolut-PLN` has
  // the identical signature. Both were caught by the owner, by hand.
  //
  // Nothing here can tell the two apart — the ledger does not record when an
  // account was opened in the real world, and inferring it from the first
  // transaction would be a guess the form would then carry. So the engine
  // reports the CONDITION, not a verdict: the maximum came entirely from before
  // the year, and the year itself is empty. That is a figure to confirm against
  // a statement, not a figure to file. §12.2 fixed the opposite error (a maximum
  // that MISSED the carry-in); this is the same seam from the other side.
  const carryInOnly = maxOn === 'carry-in' && dayCount === 0;

  return {
    account_id: a.id,
    name: a.name,
    currency: a.currency,
    carry_in_native: round2(carryIn),
    max_native: round2(maxNative),
    max_on: maxOn,
    carry_in_only: carryInOnly,
    // FBAR reports no negative maximum. Kept beside the true figure rather than
    // replacing it: a credit card whose true maximum is -949.60 reports 0, and
    // silently storing 0 would lose the fact that it was never in credit.
    reportable_max_native: round2(Math.max(0, maxNative)),
    year_end_native: round2(yearEnd),
    in_year_tx_days: dayCount,
    refused: false,
  };
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

/**
 * Convert a native maximum to the USD figure the form carries.
 *
 * `rateToUsd` is USD per ONE unit of the foreign currency — the direction
 * `exchange_rates` stores. TREASURY PUBLISHES THE RECIPROCAL (foreign per USD),
 * and for EUR and GBP both directions are plausible numbers of the same order,
 * so a rate pasted the wrong way round moves the answer ~38% toward
 * under-reporting with nothing to flag it. The caller is responsible for the
 * direction check; this function states the contract and nothing more.
 *
 * FBAR maximum values round UP to the next whole dollar.
 */
function toUsdRoundedUp(nativeAmount, rateToUsd) {
  if (nativeAmount === null || nativeAmount === undefined) return null;
  if (!(Number(rateToUsd) > 0)) throw new Error('rateToUsd must be a positive number');
  return Math.ceil(Number(nativeAmount) * Number(rateToUsd));
}

module.exports = {
  accountYearFigures,
  isoDate,
  crossCurrencyRows,
  toUsdRoundedUp,
  REFUSE_CROSS_CURRENCY,
  REFUSE_NO_ACCOUNT,
  BALANCE_WINDOW_FLOOR_SQL,
};
