/**
 * V2 Categories Routes
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').categories;

// GET /api/v2/categories - List categories
router.get('/', async (req, res, next) => {
  try {
    const { activeOnly = 'true', includeTransfers = 'false' } = req.query;
    const categories = await repo.findAll({
      activeOnly: activeOnly === 'true',
      includeTransfers: includeTransfers === 'true'
    });
    res.json({ data: categories });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/categories/tree - Hierarchical tree
router.get('/tree', async (req, res, next) => {
  try {
    const { includeTransfers = 'false' } = req.query;
    const tree = await repo.getTree({ includeTransfers: includeTransfers === 'true' });
    res.json({ data: tree });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/categories/totals
router.get('/totals', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const totals = await repo.getTotals({ startDate, endDate });
    res.json({ data: totals });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/categories/:id
router.get('/:id', async (req, res, next) => {
  try {
    const category = await repo.findById(parseInt(req.params.id));
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ data: category });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/categories
router.post('/', async (req, res, next) => {
  try {
    const category = await repo.create(req.body);
    res.status(201).json({ data: category });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v2/categories/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const category = await repo.update(parseInt(req.params.id), req.body);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ data: category });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/categories/:id (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await repo.remove(parseInt(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
