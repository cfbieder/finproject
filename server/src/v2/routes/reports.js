/**
 * V2 Reports Routes
 *
 * Balance Sheet and Cash Flow reports using PostgreSQL data
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { dataPaths } = require('../../utils/dataPaths');
const frankfurterExchangeRates = require('../../utils/frankfurterExchangeRates');

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

    const asOfDate = new Date(asOfDateString);
    if (Number.isNaN(asOfDate.getTime())) {
      return res.status(400).json({
        error: "Invalid 'asOfDate' query parameter; expected a valid date"
      });
    }

    const report = await buildBalanceSheetReport(asOfDate);
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

    const start = new Date(fromDate);
    const end = new Date(toDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({
        error: "Invalid 'fromDate' or 'toDate'; expected valid dates"
      });
    }

    const transferMode = transfers === 'include' || transfers === 'only' ? transfers : 'exclude';

    const report = await buildCashFlowReport({
      fromDate: start,
      toDate: end,
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
  // Load COA structure from JSON file
  const coaPath = dataPaths.coa;
  const coaData = JSON.parse(fs.readFileSync(coaPath, 'utf8'));

  const balanceSheetEntry = Array.isArray(coaData) && coaData.find(
    entry => entry && typeof entry === 'object' &&
    Object.prototype.hasOwnProperty.call(entry, 'Balance Sheet Accounts')
  );

  if (!balanceSheetEntry) {
    return { 'Balance Sheet Accounts': [] };
  }

  // Fetch account balances from PostgreSQL
  const accountBalances = await fetchAccountBalances(asOfDate);

  const structure = balanceSheetEntry['Balance Sheet Accounts'];
  const nodes = [];

  for (const item of structure) {
    if (!item || typeof item !== 'object') continue;

    for (const [name, value] of Object.entries(item)) {
      const node = buildBalanceSheetNode(name, value, accountBalances);
      if (node) {
        nodes.push(node);
      }
    }
  }

  return { 'Balance Sheet Accounts': nodes };
}

/**
 * Fetch account balances from PostgreSQL transactions
 */
async function fetchAccountBalances(asOfDate) {
  console.log('[v2/reports/balance] Fetching account balances for date:', asOfDate);

  // Get the latest transaction record for each account up to asOfDate
  // This mirrors the v1 behavior of getting closing balances
  const sql = `
    WITH latest_transactions AS (
      SELECT DISTINCT ON (account_id)
        account_id,
        transaction_date,
        currency,
        closing_balance
      FROM transactions
      WHERE transaction_date <= $1
        AND closing_balance IS NOT NULL
      ORDER BY account_id, transaction_date DESC, id DESC
    )
    SELECT
      a.name as account_name,
      a.currency as account_currency,
      lt.currency as transaction_currency,
      lt.closing_balance
    FROM accounts a
    LEFT JOIN latest_transactions lt ON lt.account_id = a.id
    WHERE a.is_active = TRUE
  `;

  const result = await db.query(sql, [asOfDate]);
  console.log('[v2/reports/balance] Found', result.rows.length, 'accounts');

  // Collect unique non-USD currencies
  const currencies = new Set();
  for (const row of result.rows) {
    const currency = row.transaction_currency || row.account_currency || 'USD';
    if (currency !== 'USD') {
      currencies.add(currency);
    }
  }

  // Fetch all exchange rates in parallel
  const exchangeRates = { USD: 1 };
  if (currencies.size > 0) {
    console.log('[v2/reports/balance] Fetching exchange rates for currencies:', Array.from(currencies));
    const ratePromises = Array.from(currencies).map(async (currency) => {
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

  // Build balances with pre-fetched exchange rates
  const balances = {};
  for (const row of result.rows) {
    const accountName = row.account_name;
    const currency = row.transaction_currency || row.account_currency || 'USD';
    const balance = parseFloat(row.closing_balance) || 0;
    const exchangeRate = exchangeRates[currency] || 1;
    const balanceInUSD = balance / exchangeRate;
    balances[accountName] = [currency, balance, exchangeRate, balanceInUSD];
  }

  console.log('[v2/reports/balance] Balance calculation complete');
  return balances;
}

/**
 * Build a balance sheet node recursively
 */
function buildBalanceSheetNode(name, value, accountBalances) {
  if (!name) return null;

  if (!Array.isArray(value)) {
    const accountName = typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : name;
    const balanceEntry = getAccountBalanceEntry(accountName, accountBalances);
    const totalUSD = balanceEntry ? balanceEntry.balanceInUSD : 0;
    const node = { name, totalUSD };
    if (balanceEntry) {
      node.currency = balanceEntry.currency;
      node.total = balanceEntry.balance;
    }
    return node;
  }

  const children = [];
  let totalUSD = 0;

  for (const entry of value) {
    if (typeof entry === 'string') {
      const accountName = entry.trim();
      if (!accountName) continue;

      const balanceEntry = getAccountBalanceEntry(accountName, accountBalances);
      const childBalance = balanceEntry ? balanceEntry.balanceInUSD : 0;
      const childNode = { name: accountName, totalUSD: childBalance };
      if (balanceEntry) {
        childNode.currency = balanceEntry.currency;
        childNode.total = balanceEntry.balance;
      }
      children.push(childNode);
      totalUSD += childBalance;
      continue;
    }

    if (entry && typeof entry === 'object') {
      for (const [childName, childValue] of Object.entries(entry)) {
        const childNode = buildBalanceSheetNode(childName, childValue, accountBalances);
        if (childNode) {
          children.push(childNode);
          totalUSD += childNode.totalUSD || 0;
        }
      }
    }
  }

  return { name, totalUSD, children };
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
  // Load COA structure from JSON file
  const coaPath = dataPaths.coa;
  const coaData = JSON.parse(fs.readFileSync(coaPath, 'utf8'));

  const profitLossEntry = Array.isArray(coaData) && coaData.find(
    item => item && typeof item === 'object' &&
    Object.prototype.hasOwnProperty.call(item, 'Profit & Loss Accounts')
  );

  if (!profitLossEntry) {
    return { 'Profit & Loss Accounts': [] };
  }

  const structure = profitLossEntry['Profit & Loss Accounts'];

  // Extract transfer categories from structure
  const transferCategories = extractTransferCategories(structure);
  const transferCategorySet = transferCategories.length
    ? new Set(transferCategories.map(c => c.toLowerCase()))
    : new Set();

  // Fetch category totals from PostgreSQL
  const categoryTotals = await fetchCategoryTotals(fromDate, toDate, transfers, transferCategorySet);

  const nodes = [];
  for (const item of structure) {
    if (!item || typeof item !== 'object') continue;

    for (const [name, value] of Object.entries(item)) {
      const node = buildCashFlowNode(name, value, categoryTotals, transfers, transferCategorySet);
      if (node) {
        nodes.push(node);
      }
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
 * Extract transfer category names from COA structure
 */
function extractTransferCategories(structure) {
  const categories = [];

  const findTransfers = (items) => {
    if (!Array.isArray(items)) return;

    for (const item of items) {
      if (typeof item === 'string' && item.toLowerCase().includes('transfer')) {
        categories.push(item);
      } else if (item && typeof item === 'object') {
        for (const [name, value] of Object.entries(item)) {
          if (name.toLowerCase().includes('transfer')) {
            if (typeof value === 'string') {
              categories.push(value);
            } else if (Array.isArray(value)) {
              value.forEach(v => {
                if (typeof v === 'string') categories.push(v);
              });
            }
          }
          if (Array.isArray(value)) {
            findTransfers(value);
          }
        }
      }
    }
  };

  findTransfers(structure);
  return categories;
}

/**
 * Build a cash flow node recursively
 */
function buildCashFlowNode(name, value, categoryTotals, transfers, transferCategorySet) {
  if (!name) return null;

  if (!Array.isArray(value)) {
    const categoryName = typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : name;

    const isTransfer = transferCategorySet.has(categoryName.toLowerCase());
    if (transfers === 'exclude' && isTransfer) return null;
    if (transfers === 'only' && !isTransfer) return null;

    const total = categoryTotals[categoryName] || 0;
    return { name, total };
  }

  const children = [];
  let total = 0;

  for (const entry of value) {
    if (typeof entry === 'string') {
      const categoryName = entry.trim();
      if (!categoryName) continue;

      const isTransfer = transferCategorySet.has(categoryName.toLowerCase());
      if (transfers === 'exclude' && isTransfer) continue;
      if (transfers === 'only' && !isTransfer) continue;

      const categoryTotal = categoryTotals[categoryName] || 0;
      children.push({ name: categoryName, total: categoryTotal });
      total += categoryTotal;
      continue;
    }

    if (entry && typeof entry === 'object') {
      for (const [childName, childValue] of Object.entries(entry)) {
        const childNode = buildCashFlowNode(childName, childValue, categoryTotals, transfers, transferCategorySet);
        if (childNode) {
          children.push(childNode);
          total += childNode.total || 0;
        }
      }
    }
  }

  return { name, total, children };
}

module.exports = router;
