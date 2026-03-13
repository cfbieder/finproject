/**
 * Budget FX Rates Repository
 *
 * Database operations for the budget_fx_rates table.
 * Rate convention: "X foreign currency per 1 USD"
 * (e.g., EUR = 0.8435 means 1 USD = 0.8435 EUR)
 * Formula: base_amount = amount / rate
 */

const db = require('../db');

// ============================================================================
// Queries
// ============================================================================

/**
 * Get all budget FX rates for a given year.
 * @param {number} year
 * @returns {Promise<Array<{id, currency, year, month, rate, created_at, updated_at}>>}
 */
async function findByYear(year) {
  const sql = `
    SELECT id, currency, year, month, rate, created_at, updated_at
    FROM budget_fx_rates
    WHERE year = $1
    ORDER BY currency, month
  `;
  const result = await db.query(sql, [year]);
  return result.rows.map(normalizeRow);
}

/**
 * Get rate for a specific currency/year/month.
 * Falls back to most recent prior month (same year first, then prior years).
 * @param {string} currency
 * @param {number} year
 * @param {number} month
 * @returns {Promise<number|null>}
 */
async function findRate(currency, year, month) {
  // Exact match first
  const exact = await db.query(
    `SELECT rate FROM budget_fx_rates WHERE currency = $1 AND year = $2 AND month = $3`,
    [currency, year, month]
  );
  if (exact.rows.length > 0) {
    return parseFloat(exact.rows[0].rate);
  }

  // Fallback: most recent month before the requested period
  const fallback = await db.query(`
    SELECT rate FROM budget_fx_rates
    WHERE currency = $1
      AND (year < $2 OR (year = $2 AND month < $3))
    ORDER BY year DESC, month DESC
    LIMIT 1
  `, [currency, year, month]);

  return fallback.rows.length > 0 ? parseFloat(fallback.rows[0].rate) : null;
}

/**
 * Insert or update a single rate.
 * @param {string} currency
 * @param {number} year
 * @param {number} month
 * @param {number} rate
 * @returns {Promise<Object>}
 */
async function upsertRate(currency, year, month, rate) {
  const sql = `
    INSERT INTO budget_fx_rates (currency, year, month, rate, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (currency, year, month)
    DO UPDATE SET rate = EXCLUDED.rate, updated_at = NOW()
    RETURNING *
  `;
  const result = await db.query(sql, [currency, year, month, rate]);
  return normalizeRow(result.rows[0]);
}

/**
 * Get average actual FX rate for a currency/month from the exchange_rates table.
 *
 * exchange_rates stores: from_currency → USD (e.g., 1 EUR = 1.155 USD).
 * Budget convention: X foreign per 1 USD (e.g., EUR = 0.8435).
 * Conversion: budget_rate = 1 / AVG(exchange_rate)
 *
 * @param {string} currency
 * @param {number} year
 * @param {number} month
 * @returns {Promise<{budgetRate: number|null, dataPoints: number}>}
 */
async function getAvgActualRate(currency, year, month) {
  const sql = `
    SELECT AVG(rate) AS avg_rate, COUNT(*)::int AS data_points
    FROM exchange_rates
    WHERE from_currency = $1
      AND to_currency = 'USD'
      AND EXTRACT(YEAR FROM rate_date) = $2
      AND EXTRACT(MONTH FROM rate_date) = $3
  `;
  const result = await db.query(sql, [currency, year, month]);
  const row = result.rows[0];
  const avgRate = row?.avg_rate ? parseFloat(row.avg_rate) : null;
  const dataPoints = row?.data_points || 0;

  if (!avgRate || avgRate === 0) {
    return { budgetRate: null, dataPoints: 0 };
  }

  // Invert: exchange_rates "1 EUR = X USD" → budget "1 USD = Y EUR"
  const budgetRate = Math.round((1 / avgRate) * 1000000) / 1000000;
  return { budgetRate, dataPoints };
}

/**
 * Get a recalculation preview for a specific month (all non-USD currencies).
 * @param {number} year
 * @param {number} month
 * @returns {Promise<Array<{currency, currentRate, newRate, dataPoints, entriesAffected}>>}
 */
async function getRecalcPreview(year, month) {
  // Get all currencies that have budget entries in this month
  const monthStr = String(month).padStart(2, '0');
  const startDate = `${year}-${monthStr}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  // Get distinct non-USD currencies from budget entries in this period
  const currenciesResult = await db.query(`
    SELECT DISTINCT currency
    FROM budget_entries
    WHERE currency != 'USD'
      AND entry_date >= $1::date
      AND entry_date < $2::date
    ORDER BY currency
  `, [startDate, endDate]);

  const previews = [];

  for (const row of currenciesResult.rows) {
    const currency = row.currency.trim();

    // Current budget rate
    const currentRateResult = await db.query(
      `SELECT rate FROM budget_fx_rates WHERE currency = $1 AND year = $2 AND month = $3`,
      [currency, year, month]
    );
    const currentRate = currentRateResult.rows.length > 0
      ? parseFloat(currentRateResult.rows[0].rate)
      : null;

    // Average actual rate
    const { budgetRate: newRate, dataPoints } = await getAvgActualRate(currency, year, month);

    // Count of affected entries
    const countResult = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM budget_entries
      WHERE currency = $1
        AND entry_date >= $2::date
        AND entry_date < $3::date
    `, [currency, startDate, endDate]);
    const entriesAffected = countResult.rows[0]?.count || 0;

    previews.push({
      currency,
      currentRate,
      newRate,
      dataPoints,
      entriesAffected,
    });
  }

  return previews;
}

/**
 * Recalculate base_amount on budget_entries for a given currency/year/month
 * using the provided new rate.
 * Formula: base_amount = amount / rate
 *
 * @param {string} currency
 * @param {number} year
 * @param {number} month
 * @param {number} newRate
 * @returns {Promise<number>} Number of entries updated
 */
async function recalculateBudgetEntries(currency, year, month, newRate) {
  const monthStr = String(month).padStart(2, '0');
  const startDate = `${year}-${monthStr}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const result = await db.query(`
    UPDATE budget_entries
    SET base_amount = ROUND(amount / $1, 2),
        updated_at = NOW()
    WHERE currency = $2
      AND entry_date >= $3::date
      AND entry_date < $4::date
    RETURNING id
  `, [newRate, currency, startDate, endDate]);

  return result.rowCount;
}

/**
 * Get a rate map {currency: rate} for a specific year/month.
 * Used during budget entry creation for FX conversion.
 * @param {number} year
 * @param {number} month
 * @returns {Promise<Object>} e.g. { USD: 1, EUR: 0.8435, PLN: 3.5517 }
 */
async function getRateMap(year, month) {
  const sql = `
    SELECT currency, rate
    FROM budget_fx_rates
    WHERE year = $1 AND month = $2
  `;
  const result = await db.query(sql, [year, month]);
  const map = { USD: 1 };
  for (const row of result.rows) {
    map[row.currency.trim()] = parseFloat(row.rate);
  }
  return map;
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeRow(row) {
  if (!row) return row;
  return {
    ...row,
    currency: row.currency ? row.currency.trim() : row.currency,
    rate: row.rate != null ? parseFloat(row.rate) : row.rate,
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  findByYear,
  findRate,
  upsertRate,
  getAvgActualRate,
  getRecalcPreview,
  recalculateBudgetEntries,
  getRateMap,
};
