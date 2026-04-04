/**
 * V2 Reports Routes
 *
 * Balance Sheet and Cash Flow reports using PostgreSQL data
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const accountsRepo = require('../repositories').accounts;
const frankfurterExchangeRates = require('../../utils/frankfurterExchangeRates');

// ============================================================================
// Date Helpers
// ============================================================================

/**
 * Validate a date string is in YYYY-MM-DD format and represents a real date.
 * Pass date strings directly to PostgreSQL instead of using JavaScript Date
 * objects, which are timezone-sensitive and can shift dates by ±1 day.
 */
function isValidDateString(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const date = new Date(str + 'T00:00:00Z');
  return !Number.isNaN(date.getTime());
}

// ============================================================================
// Balance Sheet Report
// ============================================================================

/**
 * GET /api/v2/reports/balance
 * Generate balance sheet report as of a specific date
 */
router.get('/balance', async (req, res, next) => {
  try {
    const { asOfDate: asOfDateString } = req.query;

    if (!asOfDateString) {
      return res.status(400).json({
        error: "Missing required query parameter 'asOfDate'"
      });
    }

    if (!isValidDateString(asOfDateString)) {
      return res.status(400).json({
        error: "Invalid 'asOfDate' query parameter; expected a valid date in YYYY-MM-DD format"
      });
    }

    const report = await buildBalanceSheetReport(asOfDateString);
    res.json(report);
  } catch (error) {
    console.error('[v2/reports/balance] Failed to build report:', error);
    next(error);
  }
});

/**
 * GET /api/v2/reports/cash-flow
 * Generate cash flow (P&L) report for a date range
 */
router.get('/cash-flow', async (req, res, next) => {
  try {
    const { fromDate, toDate, transfers = 'exclude', includeUnrealizedGL } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        error: "Missing required query parameters 'fromDate' and 'toDate'"
      });
    }

    if (!isValidDateString(fromDate) || !isValidDateString(toDate)) {
      return res.status(400).json({
        error: "Invalid 'fromDate' or 'toDate'; expected valid dates in YYYY-MM-DD format"
      });
    }

    const transferMode = transfers === 'include' || transfers === 'only' ? transfers : 'exclude';

    const report = await buildCashFlowReport({
      fromDate,
      toDate,
      transfers: transferMode,
      includeUnrealizedGL: includeUnrealizedGL === 'true'
    });
    res.json(report);
  } catch (error) {
    console.error('[v2/reports/cash-flow] Failed to build report:', error);
    next(error);
  }
});

// ============================================================================
// Balance Sheet Report Builder
// ============================================================================

/**
 * Build balance sheet report using PostgreSQL data
 */
async function buildBalanceSheetReport(asOfDate) {
  const tree = await accountsRepo.getNestedTree({ section: 'balance_sheet' });

  if (!tree || tree.length === 0) {
    return { 'Balance Sheet Accounts': [] };
  }

  // Unwrap the section root node (e.g. "Balance Sheet Accounts" → its children)
  const root = tree.find(n => n.name === 'Balance Sheet Accounts');
  const structure = root && root.children.length > 0 ? root.children : tree;

  const accountBalances = await fetchAccountBalances(asOfDate);

  const nodes = [];
  for (const item of structure) {
    const node = buildBalanceSheetNode(item, accountBalances);
    if (node) {
      nodes.push(node);
    }
  }

  return { 'Balance Sheet Accounts': nodes };
}

/**
 * Fetch account balances from PostgreSQL transactions
 */
async function fetchAccountBalances(asOfDate) {
  console.log('[v2/reports/balance] Fetching account balances for date:', asOfDate);

  // Calculate balance as opening_balance + SUM(transaction amounts up to asOfDate)
  // This replaces the old closing_balance approach which was prone to stale PS data
  const sql = `
    SELECT
      a.name AS account_name,
      a.currency AS account_currency,
      a.opening_balance + COALESCE(SUM(t.amount), 0) AS closing_balance
    FROM accounts a
    LEFT JOIN transactions t
      ON t.account_id = a.id
      AND t.transaction_date >= a.opening_balance_date
      AND t.transaction_date <= $1
    WHERE a.is_active = TRUE
    GROUP BY a.id, a.name, a.currency, a.opening_balance, a.opening_balance_date
  `;

  const result = await db.query(sql, [asOfDate]);
  console.log('[v2/reports/balance] Found', result.rows.length, 'accounts');

  // Collect unique non-USD currencies
  const currencies = new Set();
  for (const row of result.rows) {
    const currency = row.account_currency || 'USD';
    if (currency !== 'USD') {
      currencies.add(currency);
    }
  }

  // Fetch exchange rates from local database (with API fallback)
  const exchangeRates = { USD: 1 };
  if (currencies.size > 0) {
    console.log('[v2/reports/balance] Fetching exchange rates for currencies:', Array.from(currencies));
    const currencyArr = Array.from(currencies);

    // Try local exchange_rates table first (closest date match)
    const localRates = await db.query(`
      SELECT DISTINCT ON (from_currency)
        from_currency, rate
      FROM exchange_rates
      WHERE from_currency = ANY($1) AND to_currency = 'USD'
      ORDER BY from_currency, ABS(rate_date - $2::date) ASC
    `, [currencyArr, asOfDate]);

    const foundLocal = new Set();
    for (const row of localRates.rows) {
      const localRate = parseFloat(row.rate);
      if (localRate > 0) {
        exchangeRates[row.from_currency] = 1 / localRate;
        foundLocal.add(row.from_currency);
      }
    }

    // Fallback to API for any missing currencies
    const missing = currencyArr.filter(c => !foundLocal.has(c));
    if (missing.length > 0) {
      console.log('[v2/reports/balance] Fetching from API for:', missing);
      const ratePromises = missing.map(async (currency) => {
        try {
          const rate = await frankfurterExchangeRates.getExchangeRate('USD', currency, asOfDate);
          return { currency, rate: (typeof rate === 'number' && rate > 0) ? rate : 1 };
        } catch (err) {
          console.warn('[v2/reports/balance] Failed to get rate for', currency, err.message);
          return { currency, rate: 1 };
        }
      });
      const rates = await Promise.all(ratePromises);
      for (const { currency, rate } of rates) {
        exchangeRates[currency] = rate;
      }
    }
  }

  // Build balances with pre-fetched exchange rates
  const balances = {};
  for (const row of result.rows) {
    const accountName = row.account_name;
    const currency = row.account_currency || 'USD';
    const balance = parseFloat(row.closing_balance) || 0;
    const exchangeRate = exchangeRates[currency] || 1;
    const balanceInUSD = balance / exchangeRate;
    balances[accountName] = [currency, balance, exchangeRate, balanceInUSD];
  }

  console.log('[v2/reports/balance] Balance calculation complete');
  return balances;
}

/**
 * Build a balance sheet node recursively from { name, children } tree
 */
function buildBalanceSheetNode(node, accountBalances) {
  if (!node || !node.name) return null;

  const { name, children } = node;
  const isLeaf = !children || children.length === 0;

  if (isLeaf) {
    const balanceEntry = getAccountBalanceEntry(name, accountBalances);
    const totalUSD = balanceEntry ? balanceEntry.balanceInUSD : 0;
    const result = { name, totalUSD };
    if (balanceEntry) {
      result.currency = balanceEntry.currency;
      result.total = balanceEntry.balance;
    }
    return result;
  }

  const childNodes = [];
  let totalUSD = 0;

  for (const child of children) {
    const childNode = buildBalanceSheetNode(child, accountBalances);
    if (childNode) {
      childNodes.push(childNode);
      totalUSD += childNode.totalUSD || 0;
    }
  }

  return { name, totalUSD, children: childNodes };
}

/**
 * Extract balance details for a specific account
 */
function getAccountBalanceEntry(accountName, accountBalances) {
  if (!accountName || !accountBalances) return null;

  const entry = accountBalances[accountName];
  if (!Array.isArray(entry)) return null;

  const [currency, balance, exchangeRate, balanceInUSD] = entry;
  const parsedBalance = Number(balance);
  const parsedUsd = Number(balanceInUSD);

  return {
    currency: typeof currency === 'string' ? currency : null,
    balance: Number.isFinite(parsedBalance) ? parsedBalance : 0,
    exchangeRate: Number.isFinite(Number(exchangeRate)) ? Number(exchangeRate) : null,
    balanceInUSD: Number.isFinite(parsedUsd) ? parsedUsd : 0
  };
}

// ============================================================================
// Cash Flow Report Builder
// ============================================================================

/**
 * Build cash flow (P&L) report using PostgreSQL data
 */
async function buildCashFlowReport({ fromDate, toDate, transfers = 'exclude', includeUnrealizedGL = false }) {
  const tree = await accountsRepo.getNestedTree({ section: 'profit_loss' });

  if (!tree || tree.length === 0) {
    return { 'Profit & Loss Accounts': [] };
  }

  // Unwrap the section root node (e.g. "Profit & Loss Accounts" → its children)
  const root = tree.find(n => n.name === 'Profit & Loss Accounts');
  const structure = root && root.children.length > 0 ? root.children : tree;

  // Extract transfer categories from structure
  const transferCategories = extractTransferCategories(structure);
  const transferCategorySet = transferCategories.length
    ? new Set(transferCategories.map(c => c.toLowerCase()))
    : new Set();

  // Fetch category totals from PostgreSQL
  const categoryTotals = await fetchCategoryTotals(fromDate, toDate, transfers, transferCategorySet);

  const nodes = [];
  for (const item of structure) {
    const node = buildCashFlowNode(item, categoryTotals, transfers, transferCategorySet, includeUnrealizedGL);
    if (node) {
      nodes.push(node);
    }
  }

  return { 'Profit & Loss Accounts': nodes };
}

/**
 * Fetch category totals from PostgreSQL transactions
 */
async function fetchCategoryTotals(fromDate, toDate, transfers, transferCategorySet) {
  const sql = `
    SELECT
      c.name as category_name,
      SUM(t.base_amount) as total_amount,
      COUNT(*) as transaction_count
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.transaction_date >= $1
      AND t.transaction_date <= $2
    GROUP BY c.name
  `;

  const result = await db.query(sql, [fromDate, toDate]);
  const totals = {};

  for (const row of result.rows) {
    const categoryName = row.category_name;
    const isTransfer = transferCategorySet.has(categoryName.toLowerCase());

    // Apply transfer filtering
    if (transfers === 'exclude' && isTransfer) continue;
    if (transfers === 'only' && !isTransfer) continue;

    totals[categoryName] = parseFloat(row.total_amount) || 0;
  }

  return totals;
}

/**
 * Extract transfer category leaf names from { name, children } tree
 */
function extractTransferCategories(nodes) {
  const categories = [];

  const collectLeaves = (items) => {
    for (const node of items) {
      if (!node.children || node.children.length === 0) {
        categories.push(node.name);
      } else {
        collectLeaves(node.children);
      }
    }
  };

  const walk = (items) => {
    for (const node of items) {
      if (!node || !node.name) continue;
      if (node.name.toLowerCase().includes('transfer')) {
        if (!node.children || node.children.length === 0) {
          categories.push(node.name);
        } else {
          collectLeaves(node.children);
        }
      } else if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return categories;
}

/**
 * Build a cash flow node recursively from { name, children } tree
 */
function buildCashFlowNode(node, categoryTotals, transfers, transferCategorySet, includeUnrealizedGL = false) {
  if (!node || !node.name) return null;

  const { name, children } = node;
  const isUnrealized = name.toLowerCase() === 'unrealized g/l';

  // Filter out Unrealized G/L when not included
  if (isUnrealized && !includeUnrealizedGL) return null;

  const isLeaf = !children || children.length === 0;

  if (isLeaf) {
    const isTransfer = transferCategorySet.has(name.toLowerCase());
    if (transfers === 'exclude' && isTransfer) return null;
    if (transfers === 'only' && !isTransfer) return null;

    const total = categoryTotals[name] || 0;
    return { name, total };
  }

  const childNodes = [];
  let total = 0;

  for (const child of children) {
    const childNode = buildCashFlowNode(child, categoryTotals, transfers, transferCategorySet, includeUnrealizedGL);
    if (childNode) {
      childNodes.push(childNode);
      total += childNode.total || 0;
    }
  }

  return { name, total, children: childNodes };
}

// ============================================================================
// Cash Flow Transactions (v1 compatibility)
// ============================================================================

/**
 * GET /api/v2/reports/cash-flow/transactions
 * Returns transactions for specific categories within a date range
 */
router.get('/cash-flow/transactions', async (req, res, next) => {
  try {
    const { category, fromDate, toDate, limit = 100 } = req.query;

    // Handle category as array
    const categoryList = Array.isArray(category)
      ? category
      : (category ? [category] : []);

    if (categoryList.length === 0) {
      return res.json([]);
    }

    let sql = `
      SELECT t.*, c.name as category_name, a.name as account_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN accounts a ON t.account_id = a.id
      WHERE c.name = ANY($1)
    `;
    const params = [categoryList];
    let paramIndex = 2;

    if (fromDate) {
      sql += ` AND t.transaction_date >= $${paramIndex++}`;
      params.push(fromDate);
    }
    if (toDate) {
      sql += ` AND t.transaction_date <= $${paramIndex++}`;
      params.push(toDate);
    }

    sql += ` ORDER BY t.transaction_date DESC`;

    if (limit) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(parseInt(limit));
    }

    const result = await db.query(sql, params);

    // Transform to v1 format
    const v1Transactions = result.rows.map(row => ({
      _id: row.id,
      Date: row.transaction_date,
      Description1: row.description1,
      Description2: row.description2,
      Memo: row.memo,
      Note: row.note,
      Amount: parseFloat(row.amount),
      Currency: row.currency,
      BaseAmount: parseFloat(row.base_amount),
      BaseCurrency: row.base_currency,
      Account: row.account_name,
      Category: row.category_name,
    }));

    res.json(v1Transactions);
  } catch (error) {
    console.error('[v2/reports/cash-flow/transactions] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Category Trend Report
// ============================================================================

/**
 * GET /api/v2/reports/category-trend
 * Returns monthly actual and budget totals for selected categories over a date range.
 *
 * Query params:
 *   startDate  - YYYY-MM-DD (required)
 *   endDate    - YYYY-MM-DD (required)
 *   category   - category name(s), repeat for multiple (required, at least one)
 *
 * Response: {
 *   months: ["2025-01", "2025-02", ...],
 *   actual: { "2025-01": number, ... },
 *   budget: { "2025-01": number, ... }
 * }
 */
router.get('/category-trend', async (req, res, next) => {
  try {
    const { startDate, endDate, category } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const categoryList = Array.isArray(category) ? category : (category ? [category] : []);
    if (categoryList.length === 0) {
      return res.status(400).json({ error: 'At least one category is required' });
    }

    // Build category placeholders
    const categoryPlaceholders = categoryList.map((_, i) => `$${i + 1}`).join(', ');
    const baseParams = [...categoryList];
    const dateStartIdx = baseParams.length + 1;

    // Query actual transactions by month
    const actualSql = `
      SELECT
        TO_CHAR(DATE_TRUNC('month', t.transaction_date), 'YYYY-MM') as month,
        SUM(t.base_amount) as total
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE c.name IN (${categoryPlaceholders})
        AND t.transaction_date >= $${dateStartIdx}
        AND t.transaction_date <= $${dateStartIdx + 1}
      GROUP BY DATE_TRUNC('month', t.transaction_date)
      ORDER BY month
    `;

    // Query budget entries by month
    const budgetSql = `
      SELECT
        TO_CHAR(DATE_TRUNC('month', e.entry_date), 'YYYY-MM') as month,
        SUM(e.base_amount) as total
      FROM budget_entries e
      JOIN categories c ON e.category_id = c.id
      WHERE c.name IN (${categoryPlaceholders})
        AND e.entry_date >= $${dateStartIdx}
        AND e.entry_date <= $${dateStartIdx + 1}
      GROUP BY DATE_TRUNC('month', e.entry_date)
      ORDER BY month
    `;

    const allParams = [...baseParams, startDate, endDate];

    const [actualResult, budgetResult] = await Promise.all([
      db.query(actualSql, allParams),
      db.query(budgetSql, allParams),
    ]);

    // Build month sequence between startDate and endDate
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    const months = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const lastMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (cursor <= lastMonth) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
      months.push(`${y}-${m}`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    // Build month -> total maps
    const actual = {};
    for (const row of actualResult.rows) {
      actual[row.month] = parseFloat(row.total) || 0;
    }

    const budget = {};
    for (const row of budgetResult.rows) {
      budget[row.month] = parseFloat(row.total) || 0;
    }

    res.json({ months, actual, budget });
  } catch (error) {
    console.error('[v2/reports/category-trend] Failed:', error);
    next(error);
  }
});

module.exports = router;
