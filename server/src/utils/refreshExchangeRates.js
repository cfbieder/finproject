/**
 * Refresh exchange rates from Frankfurter API
 *
 * Fetches latest rates for all non-USD currencies in the accounts table
 * and upserts them into exchange_rates. Returns the number of rates updated.
 */

const db = require('../v2/db');
const frankfurter = require('./frankfurterExchangeRates');

const STALE_DAYS = 3;

/**
 * Get the age (in days) of the most recent exchange rate for a currency
 */
async function getRateAgeDays(currency, asOfDate) {
  const result = await db.query(`
    SELECT rate_date FROM exchange_rates
    WHERE from_currency = $1 AND to_currency = 'USD'
    ORDER BY ABS(rate_date - $2::date) ASC
    LIMIT 1
  `, [currency, asOfDate]);

  if (result.rows.length === 0) return Infinity;

  const rateDate = new Date(result.rows[0].rate_date);
  const target = new Date(asOfDate);
  return Math.abs(Math.round((target - rateDate) / (1000 * 60 * 60 * 24)));
}

/**
 * Fetch and store today's rate for a single currency
 * Frankfurter returns USD->X rate; we invert and store as X->USD
 */
async function refreshRate(currency, date) {
  const dateStr = date || new Date().toISOString().slice(0, 10);
  const rate = await frankfurter.getExchangeRate('USD', currency, dateStr);
  if (typeof rate !== 'number' || rate <= 0) return null;

  const toUsdRate = 1 / rate;
  await db.query(`
    INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_date, source)
    VALUES ($1, 'USD', $2, $3, 'frankfurter')
    ON CONFLICT (from_currency, to_currency, rate_date) DO UPDATE SET
      rate = EXCLUDED.rate,
      created_at = NOW()
  `, [currency, toUsdRate.toFixed(6), dateStr]);

  return { currency, rate: toUsdRate, date: dateStr };
}

/**
 * Refresh rates for all non-USD currencies used in active accounts.
 * Called during PS sync.
 */
async function refreshAllRates() {
  const result = await db.query(`
    SELECT DISTINCT currency FROM accounts
    WHERE is_active = TRUE AND currency != 'USD'
  `);
  const currencies = result.rows.map(r => r.currency);

  if (currencies.length === 0) return { updated: 0, rates: [] };

  const today = new Date().toISOString().slice(0, 10);
  const rates = [];

  for (const currency of currencies) {
    try {
      const r = await refreshRate(currency, today);
      if (r) rates.push(r);
    } catch (err) {
      console.warn(`[refreshExchangeRates] Failed for ${currency}:`, err.message);
    }
  }

  console.log(`[refreshExchangeRates] Updated ${rates.length} rates for ${today}`);
  return { updated: rates.length, rates };
}

/**
 * Check if rates are stale for given currencies/date, and refresh if needed.
 * Called by balance sheet report as self-healing fallback.
 * Returns the currencies that were refreshed.
 */
async function refreshStaleRates(currencies, asOfDate) {
  const refreshed = [];

  for (const currency of currencies) {
    const ageDays = await getRateAgeDays(currency, asOfDate);
    if (ageDays > STALE_DAYS) {
      try {
        // For historical dates, fetch rate for that date; for recent dates, fetch latest
        const target = new Date(asOfDate);
        const now = new Date();
        const dateStr = target < now ? asOfDate : now.toISOString().slice(0, 10);
        const r = await refreshRate(currency, dateStr);
        if (r) refreshed.push(r);
      } catch (err) {
        console.warn(`[refreshExchangeRates] Stale refresh failed for ${currency}:`, err.message);
      }
    }
  }

  if (refreshed.length > 0) {
    console.log(`[refreshExchangeRates] Auto-refreshed ${refreshed.length} stale rate(s) for ${asOfDate}`);
  }

  return refreshed;
}

module.exports = {
  refreshAllRates,
  refreshStaleRates,
  refreshRate,
  getRateAgeDays,
  STALE_DAYS,
};
