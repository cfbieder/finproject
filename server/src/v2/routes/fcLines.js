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
      const entry = { name: line.name, id: line.id, type: line.line_type };
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
