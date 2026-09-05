/**
 * V2 Reports Routes
 *
 * Balance Sheet and Cash Flow reports using PostgreSQL data. HTTP glue only —
 * the report builders live in services/reports.js (CR043 Phase 2.2).
 */

const express = require('express');
const router = express.Router();
const reportsService = require('../../services/reports');
const investmentReturnsService = require('../../services/investmentReturns');
const netWorthBridgeService = require('../../services/netWorthBridge');
const netWorthNarrationService = require('../../services/netWorthNarration');

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
    const { fromDate, toDate, transfers = 'exclude', includeUnrealizedGL, category, accounts, currency } = req.query;

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

    // CR054 "By Account": optional category/account name filters (repeatable
    // params) and an original-vs-USD currency toggle. Absent ⇒ unchanged output.
    const categoryList = Array.isArray(category) ? category : (category ? [category] : []);
    const accountList = Array.isArray(accounts) ? accounts : (accounts ? [accounts] : []);
    const currencyMode = currency === 'original' ? 'original' : 'usd';

    const report = await reportsService.buildCashFlowReport({
      fromDate,
      toDate,
      transfers: transferMode,
      includeUnrealizedGL: includeUnrealizedGL === 'true',
      categories: categoryList,
      accounts: accountList,
      currency: currencyMode
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
    const { category, accounts, fromDate, toDate, limit = 100 } = req.query;

    // Handle category as array
    const categoryList = Array.isArray(category)
      ? category
      : (category ? [category] : []);

    if (categoryList.length === 0) {
      return res.json([]);
    }

    // CR054: optional account filter (repeatable) — mirrors the report filter.
    const accountList = Array.isArray(accounts)
      ? accounts
      : (accounts ? [accounts] : []);

    const v1Transactions = await reportsService.getCashFlowTransactions({
      categoryList, accountList, fromDate, toDate, limit
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

// ============================================================================
// Investment Returns Report (CR056 P1)
// ============================================================================

/**
 * GET /api/v2/reports/investment-returns
 *   ?account=<id>&fromDate=&toDate=&interval=month|quarter|year|marks&currency=usd|lc
 *
 * `interval=marks` lays the columns out between consecutive `Unrealized G/L`
 * postings instead of on the calendar — the only honest layout for a holding
 * valued on its own schedule (United Beverages is marked once a year on 31
 * March, so every calendar boundary misses a valuation).
 *
 * Realized income and price return per interval for one account (a parent rolls
 * up its descendants), absolute and as a Modified Dietz %. Responds with the
 * CR043 N8 `{ data, meta }` envelope — `meta` carries the coverage / cadence /
 * chain-break banners, so a consumer that discards it renders a report with all
 * its caveats silently removed.
 */
router.get('/investment-returns', async (req, res, next) => {
  try {
    const { account, fromDate, toDate, interval = 'month', currency = 'usd' } = req.query;

    const accountId = Number(account);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ error: "Missing or invalid 'account' query parameter" });
    }
    if (!fromDate || !toDate) {
      return res.status(400).json({
        error: "Missing required query parameters 'fromDate' and 'toDate'"
      });
    }
    if (!isValidDateString(fromDate) || !isValidDateString(toDate)) {
      return res.status(400).json({
        error: "Invalid date query parameter; expected YYYY-MM-DD"
      });
    }
    if (!['month', 'quarter', 'year', 'marks'].includes(interval)) {
      return res.status(400).json({
        error: "Invalid 'interval'; expected month, quarter, year or marks"
      });
    }
    if (!['usd', 'lc'].includes(currency)) {
      return res.status(400).json({ error: "Invalid 'currency'; expected usd or lc" });
    }

    const { data, meta } = await investmentReturnsService.buildInvestmentReturns({
      accountId, fromDate, toDate, interval, currency
    });
    res.json({ data, meta });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[v2/reports/investment-returns] Failed:', error);
    next(error);
  }
});

/**
 * GET /api/v2/reports/net-worth-bridge
 *   ?fromDate=&toDate=&granularity=month|quarter|year|none&movers=<n>
 *
 * Why net worth changed between two dates, split into drivers a person
 * recognises. Powers the Home hero's "What changed?" modal, so the window it is
 * asked for is the window the hero draws — and `data.from/to.netWorth` are the
 * hero's own endpoints, not a second opinion about them.
 *
 * `movers` (CR092 P2) caps `data.movers`. The modal wants the top handful; the
 * `/net-worth-drivers` report wants every account, and a cap it cannot lift
 * would silently truncate the grid that report exists to show. Bounded at 500
 * by the service — an unbounded caller-supplied limit is a payload-size hole,
 * not a feature.
 *
 * `{ data, meta }` envelope (CR043 N8). `meta` carries the FX basis, the
 * caveats, and `tie` / `tieOk` — the decomposition is exact, so a consumer that
 * discards `meta` is hiding the one field that says whether it added up.
 */
// Shared by the bridge and its narration (CR092 P1): the narration is prose
// over the SAME window, so a parameter either route accepted alone would
// narrate a different bridge than the one on screen. Returns `{ error }` with
// the message to send, or the validated arguments for the builder.
function parseBridgeQuery({ fromDate, toDate, granularity = 'month', movers }) {
  if (!fromDate || !toDate) {
    return { error: "Missing required query parameters 'fromDate' and 'toDate'" };
  }
  if (!isValidDateString(fromDate) || !isValidDateString(toDate)) {
    return { error: "Invalid date query parameter; expected YYYY-MM-DD" };
  }
  if (!['month', 'quarter', 'year', 'none'].includes(granularity)) {
    return { error: "Invalid 'granularity'; expected month, quarter, year or none" };
  }

  // Rejected rather than silently coerced: a typo'd `movers=all` quietly
  // falling back to the modal's 12 would truncate the report's grid with
  // nothing to say it had.
  let moverLimit;
  if (movers !== undefined) {
    moverLimit = Number(movers);
    if (!Number.isInteger(moverLimit) || moverLimit < 1) {
      return { error: "Invalid 'movers'; expected a positive integer" };
    }
  }

  return { args: { fromDate, toDate, granularity, ...(moverLimit ? { moverLimit } : {}) } };
}

router.get('/net-worth-bridge', async (req, res, next) => {
  try {
    const { error, args } = parseBridgeQuery(req.query);
    if (error) return res.status(400).json({ error });

    const { data, meta } = await netWorthBridgeService.buildNetWorthBridge(args);
    res.json({ data, meta });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[v2/reports/net-worth-bridge] Failed:', error);
    next(error);
  }
});

/**
 * POST /net-worth-bridge/narration — CR092 P1. The same bridge, in prose.
 *
 * A SEPARATE call on purpose, and POST on purpose.
 *
 * Separate, because the table must not wait for it. The bridge answers in
 * milliseconds and the gateway takes ~8 s (measured); folding the narration
 * into `GET /net-worth-bridge` would put an LLM in front of the arithmetic that
 * is the point of this feature. The page renders the deterministic
 * `data.summary` immediately and swaps the prose in when it lands.
 *
 * POST, because a GET that costs eight seconds of somebody else's GPU is a
 * thing browsers and caches feel free to issue on their own. Nothing is
 * written; the verb is about the cost, not the state.
 *
 * The window is REBUILT here from the query rather than accepted from the
 * client. The narration's only claim is that every figure in it was computed by
 * this server — narrating a payload the caller handed back would surrender
 * exactly that.
 *
 * Never 5xx for a gateway failure: `{ data: null, meta: { available: false,
 * reason } }` is the honest answer, and the caller already holds the
 * deterministic summary. A 502 here would page someone about prose.
 */
router.post('/net-worth-bridge/narration', async (req, res, next) => {
  try {
    const { error, args } = parseBridgeQuery(req.query);
    if (error) return res.status(400).json({ error });

    const { data, meta } = await netWorthBridgeService.buildNetWorthBridge(args);
    const { narration, meta: narrationMeta } =
      await netWorthNarrationService.narrateNetWorthBridge(data, { meta });
    res.json({ data: narration, meta: narrationMeta });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error('[v2/reports/net-worth-bridge/narration] Failed:', error);
    next(error);
  }
});

// Exposed for tests (CR024 read-override integration). Not part of the route API.
router._fetchAccountBalances = reportsService.fetchAccountBalances;

module.exports = router;
