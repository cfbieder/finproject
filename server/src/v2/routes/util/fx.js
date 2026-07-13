'use strict';
/**
 * util/fx.js — currencies and exchange rates.
 *
 * Split out of the 651-line routes/util.js, which held four unrelated concerns (FX, appdata,
 * Chart of Accounts, backup) behind one router. Paths are UNCHANGED — util.js mounts this,
 * so every URL stays /api/v2/util/*.
 */

const express = require('express');
const router = express.Router();
const db = require('../../db');
// Hoisted out of the handler (CR043 N13).
const frankfurterExchangeRates = require('../../../utils/frankfurterExchangeRates');

/**
 * GET /api/v2/util/currencies
 * Returns list of unique currencies from transactions
 */
router.get('/currencies', async (req, res, next) => {
  try {
    const sql = `
      SELECT DISTINCT currency FROM (
        SELECT currency FROM transactions WHERE currency IS NOT NULL
        UNION
        SELECT base_currency as currency FROM transactions WHERE base_currency IS NOT NULL
        UNION
        SELECT currency FROM budget_entries WHERE currency IS NOT NULL
        UNION
        SELECT base_currency as currency FROM budget_entries WHERE base_currency IS NOT NULL
      ) currencies
      ORDER BY currency
    `;

    const result = await db.query(sql);
    const currencies = result.rows
      .map(row => row.currency)
      .filter(c => c && typeof c === 'string')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean);

    // Ensure USD is always included
    if (!currencies.includes('USD')) {
      currencies.unshift('USD');
    }

    res.json({ currencies });
  } catch (error) {
    console.error('[v2/util/currencies] Failed to list currencies:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/exchange-rates
 * Get exchange rates from the local database (bulk/historical)
 * Query params: currencies (comma-separated), fromDate, toDate, latest (boolean)
 */
router.get('/exchange-rates', async (req, res, next) => {
  try {
    const { currencies, fromDate, toDate, latest } = req.query;

    const conditions = ['to_currency = \'USD\''];
    const params = [];
    let paramIndex = 1;

    if (currencies) {
      const currencyList = currencies.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
      if (currencyList.length > 0) {
        conditions.push(`from_currency = ANY($${paramIndex++})`);
        params.push(currencyList);
      }
    }

    if (fromDate) {
      conditions.push(`rate_date >= $${paramIndex++}`);
      params.push(fromDate);
    }

    if (toDate) {
      conditions.push(`rate_date <= $${paramIndex++}`);
      params.push(toDate);
    }

    let sql;
    if (latest === 'true') {
      sql = `
        SELECT DISTINCT ON (from_currency)
          from_currency, to_currency, rate, rate_date, source
        FROM exchange_rates
        WHERE ${conditions.join(' AND ')}
        ORDER BY from_currency, rate_date DESC
      `;
    } else {
      sql = `
        SELECT from_currency, to_currency, rate, rate_date, source
        FROM exchange_rates
        WHERE ${conditions.join(' AND ')}
        ORDER BY from_currency, rate_date DESC
      `;
    }

    const result = await db.query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('[v2/util/exchange-rates] Failed:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/exchange-rate
 * Get exchange rate for a currency pair
 */
router.get('/exchange-rate', async (req, res, next) => {
  try {
    const { currency, asOfDate } = req.query;

    if (!currency) {
      return res.status(400).json({ error: "Missing required 'currency' parameter" });
    }

    const quoteCurrency = currency.trim().toUpperCase();
    if (quoteCurrency === 'USD') {
      return res.json({
        baseCurrency: 'USD',
        quoteCurrency: 'USD',
        rate: 1
      });
    }

    const asOf = asOfDate ? new Date(asOfDate) : new Date();

    const rate = await frankfurterExchangeRates.getExchangeRate('USD', quoteCurrency, asOf);

    res.json({
      baseCurrency: 'USD',
      quoteCurrency,
      asOfDate: asOf,
      rate
    });
  } catch (error) {
    console.error('[v2/util/exchange-rate] Failed to fetch rate:', error);
    next(error);
  }
});

module.exports = router;
