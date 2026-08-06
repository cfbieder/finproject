/**
 * FC Lines Routes
 *
 * REST API for managing FC Lines (forecast income/expense mapping layer).
 * Mounted at /api/v2/fc-lines
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories/fcLines');

// GET /api/v2/fc-lines
// List all FC Lines with assigned categories
router.get('/', async (req, res, next) => {
  try {
    const { budgetYear } = req.query;
    const lines = await repo.findAll(budgetYear ? Number(budgetYear) : null);
    res.json({ data: lines });
  } catch (error) {
    console.error('[fc-lines] GET / failed:', error);
    next(error);
  }
});

// POST /api/v2/fc-lines
// Create a new FC Line
router.post('/', async (req, res, next) => {
  try {
    const { name, line_type, display_order } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const existing = await repo.findByName(name.trim());
    if (existing) {
      return res.status(409).json({ error: `FC Line "${name}" already exists` });
    }

    const line = await repo.create({
      name: name.trim(),
      line_type: line_type || 'unassigned',
      display_order: display_order || 0,
    });

    res.status(201).json({ data: line });
  } catch (error) {
    console.error('[fc-lines] POST / failed:', error);
    next(error);
  }
});

// GET /api/v2/fc-lines/suggestions
// Preview: returns P&L account names not yet created as FC Lines
router.get('/suggestions', async (req, res, next) => {
  try {
    const suggestions = await repo.getSuggestions();
    res.json({ data: suggestions });
  } catch (error) {
    console.error('[fc-lines] GET /suggestions failed:', error);
    next(error);
  }
});

// POST /api/v2/fc-lines/create-from-suggestions
// Create FC Lines from selected names
// Body: { names: ["Living Expenses", "Travel", ...] }
router.post('/create-from-suggestions', async (req, res, next) => {
  try {
    const { names } = req.body;
    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: 'names array is required' });
    }
    const created = await repo.createBatch(names);
    res.json({ data: created, created_count: created.length });
  } catch (error) {
    console.error('[fc-lines] POST /create-from-suggestions failed:', error);
    next(error);
  }
});

// PUT /api/v2/fc-lines/:id
// Update an FC Line (name, type, display_order)
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, line_type, display_order } = req.body;

    // Check name uniqueness if changing
    if (name) {
      const existing = await repo.findByName(name.trim());
      if (existing && existing.id !== Number(id)) {
        return res.status(409).json({ error: `FC Line "${name}" already exists` });
      }
    }

    const updated = await repo.update(Number(id), {
      name: name?.trim(),
      line_type,
      display_order,
    });

    if (!updated) {
      return res.status(404).json({ error: 'FC Line not found' });
    }

    res.json({ data: updated });
  } catch (error) {
    console.error('[fc-lines] PUT /:id failed:', error);
    next(error);
  }
});

// DELETE /api/v2/fc-lines/:id
// Delete an FC Line. Blocked if referenced by forecast_income_expense.
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await repo.remove(Number(id));

    if (!result.deleted && result.references.length > 0) {
      return res.status(409).json({
        error: 'Cannot delete: FC Line is referenced by forecast items',
        references: result.references,
      });
    }

    if (!result.deleted) {
      return res.status(404).json({ error: 'FC Line not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[fc-lines] DELETE /:id failed:', error);
    next(error);
  }
});

// POST /api/v2/fc-lines/:id/categories
// Assign categories to an FC Line
// Body: { category_ids: [1, 2, 3] }
router.post('/:id/categories', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { category_ids } = req.body;

    if (!Array.isArray(category_ids) || category_ids.length === 0) {
      return res.status(400).json({ error: 'category_ids array is required' });
    }

    // Verify line exists
    const line = await repo.findById(Number(id));
    if (!line) {
      return res.status(404).json({ error: 'FC Line not found' });
    }

    const results = await repo.assignCategories(Number(id), category_ids);
    res.json({ data: results });
  } catch (error) {
    console.error('[fc-lines] POST /:id/categories failed:', error);
    next(error);
  }
});

// DELETE /api/v2/fc-lines/:id/categories/:categoryId
// Unassign a category from an FC Line
router.delete('/:id/categories/:categoryId', async (req, res, next) => {
  try {
    const { id, categoryId } = req.params;
    const removed = await repo.unassignCategory(Number(id), Number(categoryId));

    if (!removed) {
      return res.status(404).json({ error: 'Category assignment not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[fc-lines] DELETE /:id/categories/:categoryId failed:', error);
    next(error);
  }
});

// GET /api/v2/fc-lines/unassigned-categories
// List categories not assigned to any FC Line, with budget totals
router.get('/unassigned-categories', async (req, res, next) => {
  try {
    const { budgetYear } = req.query;
    const categories = await repo.findUnassignedCategories(budgetYear ? Number(budgetYear) : null);
    res.json({ data: categories, count: categories.length });
  } catch (error) {
    console.error('[fc-lines] GET /unassigned-categories failed:', error);
    next(error);
  }
});

// GET /api/v2/fc-lines/review-structure
// Returns FC Lines grouped as Income/Expense for the Review page P&L section
router.get('/review-structure', async (req, res, next) => {
  try {
    const lines = await repo.findAll(null);
    const income = [];
    const expense = [];
    for (const line of lines) {
      const categoryNames = (line.categories || []).map(c => c.category_name);
      const entry = { name: line.name, id: line.id, type: line.line_type, categories: categoryNames };
      if (line.line_type === 'bs_module_income' || line.line_type === 'forecast_income') {
        income.push(entry);
      } else if (line.line_type === 'bs_module_expense' || line.line_type === 'forecast_expense') {
        expense.push(entry);
      }
    }
    res.json({ income, expense });
  } catch (error) {
    console.error('[fc-lines] GET /review-structure failed:', error);
    next(error);
  }
});

// GET /api/v2/fc-lines/budget-totals
// Budget totals per FC Line for a given year
// CR070 P6 — GET /api/v2/fc-lines/actual-totals?year=YYYY
// Actual spend per FC line, the comparison a FLOW module needs. Its old prior-year lookup went to
// the balance-sheet report by the module's single account_id, and every account feeding an expense
// line is profit_loss — so it could never return anything, and the account named one of four.
router.get('/actual-totals', async (req, res, next) => {
  try {
    const year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return res.status(400).json({ error: 'year query param is required (a four-digit year)' });
    }
    res.json({ data: await repo.getActualTotals(year), year });
  } catch (error) {
    console.error('[fc-lines] GET /actual-totals failed:', error);
    next(error);
  }
});

// CR072 QA — which P&L accounts make up one line's actual for a year. The drill-down behind the
// stream card's reference figure: a line is often several chart-of-accounts leaves, and a single
// number cannot say which.
router.get('/actual-breakdown', async (req, res, next) => {
  try {
    const year = Number(req.query.year);
    const fcLineId = Number(req.query.fcLineId);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return res.status(400).json({ error: 'year must be a 4-digit year' });
    }
    if (!Number.isInteger(fcLineId) || fcLineId <= 0) {
      return res.status(400).json({ error: 'fcLineId must be a positive integer' });
    }
    res.json({ data: await repo.getActualBreakdown(year, fcLineId), year, fcLineId });
  } catch (error) {
    console.error('[fc-lines] GET /actual-breakdown failed:', error);
    next(error);
  }
});

router.get('/budget-totals', async (req, res, next) => {
  try {
    const { budgetYear } = req.query;
    if (!budgetYear) {
      return res.status(400).json({ error: 'budgetYear query param is required' });
    }

    const totals = await repo.getBudgetTotals(Number(budgetYear));
    res.json({ data: totals, budgetYear: Number(budgetYear) });
  } catch (error) {
    console.error('[fc-lines] GET /budget-totals failed:', error);
    next(error);
  }
});

module.exports = router;
