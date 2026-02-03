/**
 * V2 Utility Routes
 *
 * Miscellaneous utility endpoints using PostgreSQL data
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

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

    const frankfurterExchangeRates = require('../../utils/frankfurterExchangeRates');
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

/**
 * GET /api/v2/util/appdata
 * Get application data (budget exchange rates, etc.)
 */
router.get('/appdata', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    // Try to read appData from JSON file if it exists
    const appDataPath = dataPaths.appData;
    let appData = {};

    try {
      if (fs.existsSync(appDataPath)) {
        const content = fs.readFileSync(appDataPath, 'utf8');
        const parsed = JSON.parse(content);
        appData = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed;
      }
    } catch (readError) {
      console.warn('[v2/util/appdata] Could not read appData file:', readError.message);
    }

    res.json([appData]);
  } catch (error) {
    console.error('[v2/util/appdata] Failed to fetch appdata:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/coa-traits
 * Get Chart of Accounts traits
 */
router.get('/coa-traits', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    const coaTraitsPath = dataPaths.coaTraits;
    let traits = {};

    try {
      if (fs.existsSync(coaTraitsPath)) {
        const content = fs.readFileSync(coaTraitsPath, 'utf8');
        traits = JSON.parse(content);
      }
    } catch (readError) {
      console.warn('[v2/util/coa-traits] Could not read coa_traits file:', readError.message);
    }

    res.json(traits);
  } catch (error) {
    console.error('[v2/util/coa-traits] Failed to fetch coa-traits:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/coa/BalanceSheet
 * Get Balance Sheet section of Chart of Accounts
 */
router.get('/coa/BalanceSheet', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    const coaPath = dataPaths.coa;
    const coaData = JSON.parse(fs.readFileSync(coaPath, 'utf8'));

    if (!Array.isArray(coaData)) {
      return res.json([]);
    }

    // Find Balance Sheet Accounts section
    const bsEntry = coaData.find(
      item => item && typeof item === 'object' &&
      Object.prototype.hasOwnProperty.call(item, 'Balance Sheet Accounts')
    );

    if (!bsEntry) {
      return res.json([]);
    }

    res.json(bsEntry['Balance Sheet Accounts'] || []);
  } catch (error) {
    console.error('[v2/util/coa/BalanceSheet] Failed:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/coa/CashFlow
 * Get Profit & Loss (Cash Flow) section of Chart of Accounts
 */
router.get('/coa/CashFlow', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    const coaPath = dataPaths.coa;
    const coaData = JSON.parse(fs.readFileSync(coaPath, 'utf8'));

    if (!Array.isArray(coaData)) {
      return res.json([]);
    }

    // Find Profit & Loss Accounts section
    const plEntry = coaData.find(
      item => item && typeof item === 'object' &&
      Object.prototype.hasOwnProperty.call(item, 'Profit & Loss Accounts')
    );

    if (!plEntry) {
      return res.json([]);
    }

    res.json(plEntry['Profit & Loss Accounts'] || []);
  } catch (error) {
    console.error('[v2/util/coa/CashFlow] Failed:', error);
    next(error);
  }
});

module.exports = router;
