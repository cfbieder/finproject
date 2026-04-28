/**
 * V2 Categories Routes
 *
 * Backed by the accounts table after migration 021. The "categories" concept
 * is now P&L leaves in the COA. The URL is preserved for frontend compatibility.
 */

const express = require('express');
const router = express.Router();
const accountsRepo = require('../repositories').accounts;
const accountSourceMappingsRepo = require('../repositories').accountSourceMappings;

// GET /api/v2/categories - List P&L leaves (formerly categories)
router.get('/', async (req, res, next) => {
  try {
    const { activeOnly = 'true', includeTransfers = 'false' } = req.query;
    const leaves = await accountsRepo.findPLeaves({
      activeOnly: activeOnly === 'true',
      includeTransfers: includeTransfers === 'true'
    });
    res.json({ data: leaves });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/categories/lookup?name=X - Find a P&L leaf by name with mappings
router.get('/lookup', async (req, res, next) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'name query parameter is required' });
    }
    const account = await accountsRepo.findByName(name);
    if (!account || account.section !== 'profit_loss') {
      return res.status(404).json({ error: 'Category not found' });
    }
    const mappings = await accountSourceMappingsRepo.findByAccountId(account.id);
    res.json({ data: { ...account, mappings } });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/categories/:id/mappings - List source mappings
router.get('/:id/mappings', async (req, res, next) => {
  try {
    const mappings = await accountSourceMappingsRepo.findByAccountId(parseInt(req.params.id));
    res.json({ data: mappings });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v2/categories/:id/mappings - Upsert a source mapping
router.put('/:id/mappings', async (req, res, next) => {
  try {
    const accountId = parseInt(req.params.id);
    const { source, external_name } = req.body;
    if (!source || !external_name) {
      return res.status(400).json({ error: 'source and external_name are required' });
    }
    const mapping = await accountSourceMappingsRepo.upsert(accountId, source, external_name);
    res.json({ data: mapping });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/categories/:id/mappings/:mappingId
router.delete('/:id/mappings/:mappingId', async (req, res, next) => {
  try {
    const deleted = await accountSourceMappingsRepo.remove(parseInt(req.params.mappingId));
    if (!deleted) {
      return res.status(404).json({ error: 'Mapping not found' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/categories/:id (numeric only)
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const account = await accountsRepo.findById(id);
    if (!account || account.section !== 'profit_loss') {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ data: account });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
