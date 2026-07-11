/**
 * V2 Reports Routes
 *
 * Balance Sheet and Cash Flow reports using PostgreSQL data. HTTP glue only —
 * the report builders live in services/reports.js (CR043 Phase 2.2).
 */

const express = require('express');
const router = express.Router();
const reportsService = require('../../services/reports');

const { isValidDateString } = reportsService;

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

    const report = await reportsService.buildBalanceSheetReport(asOfDateString);
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

    const report = await reportsService.buildCashFlowReport({
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

    const v1Transactions = await reportsService.getCashFlowTransactions({
      categoryList, fromDate, toDate, limit
    });

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

    const result = await reportsService.getCategoryTrend({ startDate, endDate, categoryList });
    res.json(result);
  } catch (error) {
    console.error('[v2/reports/category-trend] Failed:', error);
    next(error);
  }
});

// Exposed for tests (CR024 read-override integration). Not part of the route API.
router._fetchAccountBalances = reportsService.fetchAccountBalances;

module.exports = router;
