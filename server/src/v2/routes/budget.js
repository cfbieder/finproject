/**
 * V2 Budget Routes
 *
 * HTTP glue only. Business logic (report-shaping SQL, entry create/update
 * orchestration, COA tree helpers) lives in services/budget.js (CR043 Phase
 * 2.1). Thin repo-delegating endpoints call the repository directly.
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').budget;
const budgetFxRatesRepo = require('../repositories').budgetFxRates;
const budgetService = require('../../services/budget');

// ============================================================================
// Budget Versions
// ============================================================================

// GET /api/v2/budget/versions
router.get('/versions', async (req, res, next) => {
  try {
    const { year, activeOnly = 'true' } = req.query;
    const versions = await repo.findAllVersions({
      year: year ? parseInt(year) : undefined,
      activeOnly: activeOnly === 'true'
    });
    res.json({ data: versions });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/budget/versions/:id
router.get('/versions/:id', async (req, res, next) => {
  try {
    const version = await repo.findVersionById(parseInt(req.params.id));
    if (!version) {
      return res.status(404).json({ error: 'Budget version not found' });
    }
    res.json({ data: version });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/budget/versions
router.post('/versions', async (req, res, next) => {
  try {
    const version = await repo.createVersion(req.body);
    res.status(201).json({ data: version });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/budget/versions/:id/copy
router.post('/versions/:id/copy', async (req, res, next) => {
  try {
    const { budget_year, version_name, description } = req.body;
    const newVersion = await repo.copyVersion(parseInt(req.params.id), {
      budget_year,
      version_name,
      description
    });
    res.status(201).json({ data: newVersion });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v2/budget/versions/:id
router.patch('/versions/:id', async (req, res, next) => {
  try {
    const version = await repo.updateVersion(parseInt(req.params.id), req.body);
    if (!version) {
      return res.status(404).json({ error: 'Budget version not found' });
    }
    res.json({ data: version });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Budget FX Rates
// ============================================================================

// GET /api/v2/budget/fx-rates?year=2026
router.get('/fx-rates', async (req, res, next) => {
  try {
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const rates = await budgetFxRatesRepo.findByYear(year);
    res.json({ data: rates });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/budget/fx-rates/rate-map?year=2026&month=3
router.get('/fx-rates/rate-map', async (req, res, next) => {
  try {
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month) : (new Date().getMonth() + 1);
    const rateMap = await budgetFxRatesRepo.getRateMap(year, month);
    res.json({ data: rateMap });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/budget/fx-rates/preview?year=2026&month=3
router.get('/fx-rates/preview', async (req, res, next) => {
  try {
    const year = req.query.year ? parseInt(req.query.year) : null;
    const month = req.query.month ? parseInt(req.query.month) : null;
    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required' });
    }
    const previews = await budgetFxRatesRepo.getRecalcPreview(year, month);
    res.json({ data: previews });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v2/budget/fx-rates
router.put('/fx-rates', async (req, res, next) => {
  try {
    const { currency, year, month, rate } = req.body;
    if (!currency || !year || !month || rate == null) {
      return res.status(400).json({ error: 'currency, year, month, and rate are required' });
    }
    const parsedRate = parseFloat(rate);
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      return res.status(400).json({ error: 'rate must be a positive number' });
    }
    const result = await budgetFxRatesRepo.upsertRate(currency, year, month, parsedRate);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/budget/fx-rates/recalculate
router.post('/fx-rates/recalculate', async (req, res, next) => {
  try {
    const { currency, year, month } = req.body;
    if (!currency || !year || !month) {
      return res.status(400).json({ error: 'currency, year, and month are required' });
    }

    // Get current rate
    const currentRateResult = await budgetFxRatesRepo.findRate(currency, year, month);

    // Get average actual rate
    const { budgetRate: newRate, dataPoints } = await budgetFxRatesRepo.getAvgActualRate(currency, year, month);
    if (!newRate) {
      return res.status(400).json({
        error: `No actual exchange rate data found for ${currency} in ${year}-${String(month).padStart(2, '0')}`
      });
    }

    // Update the rate
    await budgetFxRatesRepo.upsertRate(currency, year, month, newRate);

    // Recalculate budget entries
    const entriesUpdated = await budgetFxRatesRepo.recalculateBudgetEntries(currency, year, month, newRate);

    res.json({
      data: {
        currency,
        year,
        month,
        oldRate: currentRateResult,
        newRate,
        dataPoints,
        entriesUpdated,
      }
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Budget Entries
// ============================================================================

// GET /api/v2/budget/entries
// Supports extended filtering for v1 API compatibility
router.get('/entries', async (req, res, next) => {
  try {
    const {
      versionId, year, month, categoryId, accountId,
      category, account, // Name-based filtering
      fromDate, toDate, currency,
      limit = 1000, offset = 0
    } = req.query;

    // Build date range from fromDate/toDate
    let startDate = fromDate;
    let endDate = toDate;

    // Handle name-based filters as arrays
    const categoryNames = Array.isArray(category) ? category : (category ? [category] : undefined);
    const accountNames = Array.isArray(account) ? account : (account ? [account] : undefined);

    const entries = await repo.findAllExtended({
      versionId: versionId ? parseInt(versionId) : undefined,
      year: year ? parseInt(year) : undefined,
      month: month ? parseInt(month) : undefined,
      categoryId: categoryId ? parseInt(categoryId) : undefined,
      accountId: accountId ? parseInt(accountId) : undefined,
      startDate,
      endDate,
      categoryNames,
      accountNames,
      currency,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    res.json({ data: entries });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/budget/entries/summary/by-category
router.get('/entries/summary/by-category', async (req, res, next) => {
  try {
    const { versionId, year } = req.query;
    const summary = await repo.sumByCategory({
      versionId: versionId ? parseInt(versionId) : undefined,
      year: year ? parseInt(year) : undefined
    });
    res.json({ data: summary });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/budget/entries/summary/by-month
router.get('/entries/summary/by-month', async (req, res, next) => {
  try {
    const { versionId, year } = req.query;
    const summary = await repo.sumByMonth({
      versionId: versionId ? parseInt(versionId) : undefined,
      year: year ? parseInt(year) : undefined
    });
    res.json({ data: summary });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/budget/compare - Budget vs Actual
router.get('/compare', async (req, res, next) => {
  try {
    const { versionId, year } = req.query;
    if (!versionId || !year) {
      return res.status(400).json({ error: 'versionId and year are required' });
    }
    const comparison = await repo.compareToActual({
      versionId: parseInt(versionId),
      year: parseInt(year)
    });
    res.json({ data: comparison });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/budget/entries/:id
router.get('/entries/:id', async (req, res, next) => {
  try {
    const entry = await repo.findById(parseInt(req.params.id));
    if (!entry) {
      return res.status(404).json({ error: 'Budget entry not found' });
    }
    res.json({ data: entry });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/budget/entries
// Supports both single entry and array of entries (for batch creation)
// Accepts both v1 (PascalCase) and v2 (snake_case) field names
router.post('/entries', async (req, res, next) => {
  try {
    const { isArray, created } = await budgetService.createEntries(req.body);
    res.status(201).json({ data: isArray ? created : created[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v2/budget/entries/:id
// Accepts both v1 (PascalCase) and v2 (snake_case) field names
router.patch('/entries/:id', async (req, res, next) => {
  try {
    const entryId = parseInt(req.params.id);
    if (!Number.isInteger(entryId)) {
      return res.status(400).json({ error: 'invalid budget entry id' });
    }
    const entry = await budgetService.updateEntry(entryId, req.body);
    if (!entry) {
      return res.status(404).json({ error: 'Budget entry not found' });
    }
    res.json({ data: entry });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/budget/entries/:id
router.delete('/entries/:id', async (req, res, next) => {
  try {
    const deleted = await repo.remove(parseInt(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: 'Budget entry not found' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Budget Summary (for BudgetInput page)
// ============================================================================

/**
 * GET /api/v2/budget/summary
 * Returns budget vs actual aggregated by month
 * Compatible with v1 API response format
 */
router.get('/summary', async (req, res, next) => {
  try {
    const summary = await budgetService.getSummary(req.query);
    res.json(summary);
  } catch (error) {
    console.error('[v2/budget/summary] Failed to build summary:', error);
    next(error);
  }
});

// ============================================================================
// Category Groups (for filter dropdowns)
// ============================================================================

/**
 * GET /api/v2/budget/category-groups
 * Returns Income and Expense category groups from COA
 */
router.get('/category-groups', async (req, res, next) => {
  try {
    const groups = await budgetService.getCategoryGroups();
    res.json(groups);
  } catch (error) {
    console.error('[v2/budget/category-groups] Failed to load category groups:', error);
    next(error);
  }
});

// ============================================================================
// V1 Compatibility Routes
// ============================================================================

/**
 * GET /api/v2/budget (v1 compatibility)
 * Fetches budget entries - proxies to /entries
 */
router.get('/', async (req, res, next) => {
  try {
    const v1Entries = await budgetService.listBudgetEntriesV1(req.query);
    res.json(v1Entries);
  } catch (error) {
    console.error('[v2/budget v1-compat] Failed:', error);
    next(error);
  }
});

/**
 * GET /api/v2/budget/actual-entries (v1 compatibility)
 * Fetches actual transaction entries for budget comparison
 */
router.get('/actual-entries', async (req, res, next) => {
  try {
    const entries = await budgetService.getActualEntries(req.query);
    res.json({ entries });
  } catch (error) {
    console.error('[v2/budget/actual-entries] Failed:', error);
    next(error);
  }
});

/**
 * GET /api/v2/budget/cash-flow
 * Returns budget cash flow report in hierarchical COA structure
 */
router.get('/cash-flow', async (req, res, next) => {
  try {
    const { fromDate, toDate, transfers = 'exclude' } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        error: "Missing required query parameters 'fromDate' and 'toDate'",
      });
    }

    if (!budgetService.isValidDateString(fromDate) || !budgetService.isValidDateString(toDate)) {
      return res.status(400).json({
        error: "Invalid 'fromDate' or 'toDate'; expected valid dates in YYYY-MM-DD format",
      });
    }

    const report = await budgetService.getCashFlow({ fromDate, toDate, transfers });
    res.json(report);
  } catch (error) {
    console.error('[v2/budget/cash-flow] Failed:', error);
    next(error);
  }
});

module.exports = router;
