/**
 * V2 Budget Routes
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').budget;
const accountsRepo = require('../repositories').accounts;
const categoriesRepo = require('../repositories').categories;

/**
 * Transform v1-style field names to v2 format for budget entries
 * Maps: Date → entry_date, Amount → amount, etc.
 */
function transformV1ToV2Fields(data) {
  const fieldMap = {
    Date: 'entry_date',
    Description1: 'description',
    Amount: 'amount',
    Currency: 'currency',
    BaseAmount: 'base_amount',
    BaseCurrency: 'base_currency',
    Account: 'account_name',  // Will be resolved to account_id
    Category: 'category_name', // Will be resolved to category_id
    Note: 'note',
    Labels: 'labels'
  };

  const transformed = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const mappedKey = fieldMap[key] || key;
    transformed[mappedKey] = value;
  }
  return transformed;
}

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
    const isArray = Array.isArray(req.body);
    const entries = isArray ? req.body : [req.body];

    const results = [];
    for (const rawEntry of entries) {
      // Transform v1 field names to v2
      const data = transformV1ToV2Fields(rawEntry);

      // Resolve account name to ID if provided
      if (data.account_name) {
        const account = await accountsRepo.findByName(data.account_name);
        if (account) {
          data.account_id = account.id;
        }
        delete data.account_name;
      }

      // Resolve category name to ID if provided
      if (data.category_name) {
        const category = await categoriesRepo.findByName(data.category_name);
        if (category) {
          data.category_id = category.id;
        }
        delete data.category_name;
      }

      const entry = await repo.create(data);
      results.push(entry);
    }

    if (isArray) {
      res.status(201).json({ data: results });
    } else {
      res.status(201).json({ data: results[0] });
    }
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v2/budget/entries/:id
// Accepts both v1 (PascalCase) and v2 (snake_case) field names
router.patch('/entries/:id', async (req, res, next) => {
  try {
    // Transform v1 field names to v2
    const data = transformV1ToV2Fields(req.body);

    // Resolve account name to ID if provided
    if (data.account_name) {
      const account = await accountsRepo.findByName(data.account_name);
      if (account) {
        data.account_id = account.id;
      }
      delete data.account_name;
    }

    // Resolve category name to ID if provided
    if (data.category_name) {
      const category = await categoriesRepo.findByName(data.category_name);
      if (category) {
        data.category_id = category.id;
      }
      delete data.category_name;
    }

    const entry = await repo.update(parseInt(req.params.id), data);
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
 * Helper: build month sequence array
 */
function buildMonthSequence(from, to) {
  const months = [];
  for (let m = from; m <= to; m++) {
    months.push(m);
  }
  return months;
}

/**
 * GET /api/v2/budget/summary
 * Returns budget vs actual aggregated by month
 * Compatible with v1 API response format
 */
router.get('/summary', async (req, res, next) => {
  try {
    const {
      fromMonth = 1,
      toMonth = 12,
      actualYear,
      budgetYear,
      category,
      categories,
      account,
      accounts
    } = req.query;

    const currentYear = new Date().getFullYear();
    const parsedActualYear = actualYear ? parseInt(actualYear) : currentYear;
    const parsedBudgetYear = budgetYear ? parseInt(budgetYear) : currentYear;
    const parsedFromMonth = parseInt(fromMonth) || 1;
    const parsedToMonth = parseInt(toMonth) || 12;

    // Handle category/categories as array
    const categoryList = categories
      ? (Array.isArray(categories) ? categories : [categories])
      : (category ? (Array.isArray(category) ? category : [category]) : []);

    // Handle account/accounts as array
    const accountList = accounts
      ? (Array.isArray(accounts) ? accounts : [accounts])
      : (account ? (Array.isArray(account) ? account : [account]) : []);

    // Build category filter condition
    let categoryFilter = '';
    const categoryParams = [];
    if (categoryList.length > 0) {
      const placeholders = categoryList.map((_, i) => `$${i + 1}`).join(', ');
      categoryFilter = `AND c.name IN (${placeholders})`;
      categoryParams.push(...categoryList);
    }

    // Build account filter condition
    let accountFilter = '';
    const accountParams = [];
    if (accountList.length > 0) {
      const startIdx = categoryParams.length + 1;
      const placeholders = accountList.map((_, i) => `$${startIdx + i}`).join(', ');
      accountFilter = `AND a.name IN (${placeholders})`;
      accountParams.push(...accountList);
    }

    const baseParams = [...categoryParams, ...accountParams];

    // Query actual transactions by month
    const actualSql = `
      SELECT
        EXTRACT(MONTH FROM t.transaction_date)::int as month,
        SUM(t.base_amount) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN accounts a ON t.account_id = a.id
      WHERE EXTRACT(YEAR FROM t.transaction_date) = $${baseParams.length + 1}
        AND EXTRACT(MONTH FROM t.transaction_date) >= $${baseParams.length + 2}
        AND EXTRACT(MONTH FROM t.transaction_date) <= $${baseParams.length + 3}
        ${categoryFilter}
        ${accountFilter}
      GROUP BY EXTRACT(MONTH FROM t.transaction_date)
    `;

    // Query budget entries by month
    const budgetSql = `
      SELECT
        EXTRACT(MONTH FROM e.entry_date)::int as month,
        SUM(e.base_amount) as total
      FROM budget_entries e
      LEFT JOIN categories c ON e.category_id = c.id
      LEFT JOIN accounts a ON e.account_id = a.id
      WHERE e.budget_year = $${baseParams.length + 1}
        AND EXTRACT(MONTH FROM e.entry_date) >= $${baseParams.length + 2}
        AND EXTRACT(MONTH FROM e.entry_date) <= $${baseParams.length + 3}
        ${categoryFilter}
        ${accountFilter}
      GROUP BY EXTRACT(MONTH FROM e.entry_date)
    `;

    const db = require('../db');
    const [actualResult, budgetResult] = await Promise.all([
      db.query(actualSql, [...baseParams, parsedActualYear, parsedFromMonth, parsedToMonth]),
      db.query(budgetSql, [...baseParams, parsedBudgetYear, parsedFromMonth, parsedToMonth])
    ]);

    // Build month -> total maps
    const actualByMonth = {};
    for (const row of actualResult.rows) {
      actualByMonth[row.month] = parseFloat(row.total) || 0;
    }

    const budgetByMonth = {};
    for (const row of budgetResult.rows) {
      budgetByMonth[row.month] = parseFloat(row.total) || 0;
    }

    res.json({
      months: buildMonthSequence(parsedFromMonth, parsedToMonth),
      fromMonth: parsedFromMonth,
      toMonth: parsedToMonth,
      actualYear: parsedActualYear,
      budgetYear: parsedBudgetYear,
      actualByMonth,
      budgetByMonth
    });
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
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    const coaPath = dataPaths.coa;
    const coaData = JSON.parse(fs.readFileSync(coaPath, 'utf8'));

    const groups = { Income: [], Expense: [] };

    if (!Array.isArray(coaData)) {
      return res.json(groups);
    }

    // Find Profit & Loss Accounts section
    const plEntry = coaData.find(
      item => item && typeof item === 'object' &&
      Object.prototype.hasOwnProperty.call(item, 'Profit & Loss Accounts')
    );

    if (!plEntry) {
      return res.json(groups);
    }

    const structure = plEntry['Profit & Loss Accounts'];
    if (!Array.isArray(structure)) {
      return res.json(groups);
    }

    // Extract categories from structure
    const extractCategories = (items, targetGroup) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (typeof item === 'string') {
          targetGroup.push(item);
        } else if (item && typeof item === 'object') {
          for (const [, value] of Object.entries(item)) {
            if (typeof value === 'string') {
              targetGroup.push(value);
            } else if (Array.isArray(value)) {
              extractCategories(value, targetGroup);
            }
          }
        }
      }
    };

    // Find Income and Expense sections
    for (const item of structure) {
      if (!item || typeof item !== 'object') continue;
      for (const [name, value] of Object.entries(item)) {
        const lowerName = name.toLowerCase();
        if (lowerName.includes('income') || lowerName.includes('revenue')) {
          if (Array.isArray(value)) {
            extractCategories(value, groups.Income);
          } else if (typeof value === 'string') {
            groups.Income.push(value);
          }
        } else if (lowerName.includes('expense') || lowerName.includes('cost')) {
          if (Array.isArray(value)) {
            extractCategories(value, groups.Expense);
          } else if (typeof value === 'string') {
            groups.Expense.push(value);
          }
        }
      }
    }

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
    const {
      year, month, category, account, categories, accounts,
      fromDate, toDate, currency, limit = 1000, offset = 0
    } = req.query;

    // Handle category/categories as array
    const categoryNames = categories
      ? (Array.isArray(categories) ? categories : [categories])
      : (category ? (Array.isArray(category) ? category : [category]) : undefined);

    // Handle account/accounts as array
    const accountNames = accounts
      ? (Array.isArray(accounts) ? accounts : [accounts])
      : (account ? (Array.isArray(account) ? account : [account]) : undefined);

    const entries = await repo.findAllExtended({
      year: year ? parseInt(year) : undefined,
      month: month ? parseInt(month) : undefined,
      startDate: fromDate,
      endDate: toDate,
      categoryNames,
      accountNames,
      currency,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Transform to v1 format if needed
    const v1Entries = entries.map(entry => ({
      ...entry,
      _id: entry.id,
      Date: entry.entry_date,
      Description1: entry.description,
      Amount: entry.amount,
      Currency: entry.currency,
      BaseAmount: entry.base_amount,
      BaseCurrency: entry.base_currency,
      Account: entry.account_name,
      Category: entry.category_name,
      Note: entry.note,
    }));

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
    const {
      actualYear, month, fromMonth, toMonth,
      category, categories, account, accounts,
      limit = 1000
    } = req.query;

    const db = require('../db');
    const currentYear = new Date().getFullYear();
    const year = actualYear ? parseInt(actualYear) : currentYear;

    // Handle category/categories as array
    const categoryList = categories
      ? (Array.isArray(categories) ? categories : [categories])
      : (category ? (Array.isArray(category) ? category : [category]) : []);

    // Handle account/accounts as array
    const accountList = accounts
      ? (Array.isArray(accounts) ? accounts : [accounts])
      : (account ? (Array.isArray(account) ? account : [account]) : []);

    let sql = `
      SELECT t.*, c.name as category_name, a.name as account_name
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN accounts a ON t.account_id = a.id
      WHERE EXTRACT(YEAR FROM t.transaction_date) = $1
    `;
    const params = [year];
    let paramIndex = 2;

    // Month filter
    if (month) {
      sql += ` AND EXTRACT(MONTH FROM t.transaction_date) = $${paramIndex++}`;
      params.push(parseInt(month));
    } else if (fromMonth && toMonth) {
      sql += ` AND EXTRACT(MONTH FROM t.transaction_date) >= $${paramIndex++}`;
      params.push(parseInt(fromMonth));
      sql += ` AND EXTRACT(MONTH FROM t.transaction_date) <= $${paramIndex++}`;
      params.push(parseInt(toMonth));
    }

    // Category filter
    if (categoryList.length > 0) {
      const placeholders = categoryList.map((_, i) => `$${paramIndex + i}`).join(', ');
      sql += ` AND c.name IN (${placeholders})`;
      params.push(...categoryList);
      paramIndex += categoryList.length;
    }

    // Account filter
    if (accountList.length > 0) {
      const placeholders = accountList.map((_, i) => `$${paramIndex + i}`).join(', ');
      sql += ` AND a.name IN (${placeholders})`;
      params.push(...accountList);
      paramIndex += accountList.length;
    }

    sql += ` ORDER BY t.transaction_date DESC`;

    if (limit) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(parseInt(limit));
    }

    const result = await db.query(sql, params);

    // Transform to v1 format
    const v1Entries = result.rows.map(row => ({
      _id: row.id,
      Date: row.transaction_date,
      Description1: row.description,
      Amount: parseFloat(row.amount),
      Currency: row.currency,
      BaseAmount: parseFloat(row.base_amount),
      BaseCurrency: row.base_currency,
      Account: row.account_name,
      Category: row.category_name,
      Note: row.note,
    }));

    res.json(v1Entries);
  } catch (error) {
    console.error('[v2/budget/actual-entries] Failed:', error);
    next(error);
  }
});

/**
 * GET /api/v2/budget/cash-flow (v1 compatibility)
 * Returns budget cash flow report - wraps v1 service
 */
router.get('/cash-flow', async (req, res, next) => {
  try {
    // Use existing v1 budget cash-flow service
    const { buildBudgetCashFlowReport } = require('../../services/budget');
    const report = await buildBudgetCashFlowReport(req.query);
    res.json(report);
  } catch (error) {
    // If v1 service not available, return empty
    console.error('[v2/budget/cash-flow] Failed:', error);
    res.json({ 'Profit & Loss Accounts': [] });
  }
});

module.exports = router;
