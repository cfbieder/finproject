'use strict';
/**
 * fx.js — shared FX → USD base-amount conversion.
 *
 * Single source of truth for turning an amount in some currency into fin's USD
 * `base_amount`, used by the bank-feed promote and both reconcile engines. Uses
 * the `exchange_rates` table (from_currency → USD), picking the most recent rate
 * on/before the given date, falling back to the nearest rate if none precedes it.
 */

/**
 * The raw currency → USD rate as of a date: the most recent rate on/before
 * `dateText`, falling back to the nearest rate if none precedes it (early
 * history — EUR/PLN/GBP coverage starts 1999-12-30).
 *
 * Extracted from `usdBaseAmount` for CR056, which needs the unrounded rate for a
 * bulk market-value multiply rather than a per-call cents-rounded amount. Both
 * callers must share this rule or the report's boundary FX would drift from the
 * `base_amount` the ledger was booked at.
 *
 * @param {{query: Function}} querier  a db client or the db module
 * @param {string} currency            ISO code; 'USD' is a 1:1 no-op
 * @param {string} dateText            YYYY-MM-DD — the as-of date for the rate
 * @returns {Promise<number|null>}     rate, or null if the currency has no rows
 */
async function rateAsOf(querier, currency, dateText) {
  const row = await rateRowAsOf(querier, currency, dateText);
  return row ? row.rate : null;
}

/**
 * rateAsOf, plus the date of the rate it chose. The lookup falls back to the
 * NEAREST rate at any distance, so a caller that must not silently value on a
 * stale rate (CR097) needs to see how far that was.
 *
 * @returns {Promise<{rate:number, rate_date:string}|null>} USD → { 1, dateText }
 */
async function rateRowAsOf(querier, currency, dateText) {
  if (currency === 'USD') return { rate: 1, rate_date: dateText };
  const res = await querier.query(
    `SELECT rate, rate_date::text AS rate_date FROM exchange_rates
       WHERE from_currency = $1 AND to_currency = 'USD'
       ORDER BY (rate_date <= $2::date) DESC, ABS(rate_date - $2::date) ASC
       LIMIT 1`,
    [currency, dateText]
  );
  if (!res.rows.length) return null;
  const rate = Number(res.rows[0].rate);
  return Number.isFinite(rate) ? { rate, rate_date: res.rows[0].rate_date } : null;
}

/**
 * @param {{query: Function}} querier  a db client or the db module
 * @param {number} amount              amount in `currency`
 * @param {string} currency            ISO code (e.g. 'EUR'); 'USD' is a 1:1 no-op
 * @param {string} dateText            YYYY-MM-DD — the as-of date for the rate
 * @returns {Promise<number|null>}     USD base amount, or null if no rate exists
 */
async function usdBaseAmount(querier, amount, currency, dateText) {
  const amt = Number(amount);
  if (!Number.isFinite(amt)) return null;
  const rate = await rateAsOf(querier, currency, dateText);
  if (rate === null) return null;
  return Math.round(amt * rate * 100) / 100;
}

module.exports = { usdBaseAmount, rateAsOf, rateRowAsOf };
