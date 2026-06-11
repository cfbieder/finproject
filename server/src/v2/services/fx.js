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
 * @param {{query: Function}} querier  a db client or the db module
 * @param {number} amount              amount in `currency`
 * @param {string} currency            ISO code (e.g. 'EUR'); 'USD' is a 1:1 no-op
 * @param {string} dateText            YYYY-MM-DD — the as-of date for the rate
 * @returns {Promise<number|null>}     USD base amount, or null if no rate exists
 */
async function usdBaseAmount(querier, amount, currency, dateText) {
  const amt = Number(amount);
  if (!Number.isFinite(amt)) return null;
  if (currency === 'USD') return Math.round(amt * 100) / 100;
  const res = await querier.query(
    `SELECT rate FROM exchange_rates
       WHERE from_currency = $1 AND to_currency = 'USD'
       ORDER BY (rate_date <= $2::date) DESC, ABS(rate_date - $2::date) ASC
       LIMIT 1`,
    [currency, dateText]
  );
  if (!res.rows.length) return null;
  const rate = Number(res.rows[0].rate);
  if (!Number.isFinite(rate)) return null;
  return Math.round(amt * rate * 100) / 100;
}

module.exports = { usdBaseAmount };
