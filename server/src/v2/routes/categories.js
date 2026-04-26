/**
 * V2 Categories Routes
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').categories;
const mappingsRepo = require('../repositories').categorySourceMappings;

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

// GET /api/v2/categories/lookup?name=X - Find category by name with mappings
router.get('/lookup', async (req, res, next) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'name query parameter is required' });
    }
    const category = await repo.findByName(name);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const mappings = await mappingsRepo.findByCategoryId(category.id);
    res.json({ data: { ...category, mappings } });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/categories/:id/mappings - List source mappings for a category
router.get('/:id/mappings', async (req, res, next) => {
  try {
    const mappings = await mappingsRepo.findByCategoryId(parseInt(req.params.id));
    res.json({ data: mappings });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v2/categories/:id/mappings - Upsert a source mapping
router.put('/:id/mappings', async (req, res, next) => {
  try {
    const categoryId = parseInt(req.params.id);
    const { source, external_name } = req.body;
    if (!source || !external_name) {
      return res.status(400).json({ error: 'source and external_name are required' });
    }
    const mapping = await mappingsRepo.upsert(categoryId, source, external_name);
    res.json({ data: mapping });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/categories/:id/mappings/:mappingId - Remove a source mapping
router.delete('/:id/mappings/:mappingId', async (req, res, next) => {
  try {
    const deleted = await mappingsRepo.remove(parseInt(req.params.mappingId));
    if (!deleted) {
      return res.status(404).json({ error: 'Mapping not found' });
    }
    res.status(204).send();
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
    // Auto-create pocketsmith source mapping for new categories
    await mappingsRepo.upsert(category.id, 'pocketsmith', category.name);
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
