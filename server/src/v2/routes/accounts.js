/**
 * V2 Accounts Routes
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').accounts;
const mappingsRepo = require('../repositories').accountSourceMappings;
const db = require('../db');

// GET /api/v2/accounts - List accounts
router.get('/', async (req, res, next) => {
  try {
    const { section, accountType, activeOnly = 'true', leafOnly = 'false' } = req.query;
    const accounts = await repo.findAll({
      section,
      accountType,
      activeOnly: activeOnly === 'true',
      leafOnly: leafOnly === 'true',
    });
    res.json({ data: accounts });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/accounts/tree - Hierarchical tree
router.get('/tree', async (req, res, next) => {
  try {
    const { section, format } = req.query;
    if (format === 'nested') {
      const tree = await repo.getNestedTree({ section });
      return res.json({ data: tree });
    }
    const tree = await repo.getTree({ section });
    res.json({ data: tree });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/accounts/traits - Traits map (replaces coa_traits.json)
router.get('/traits', async (req, res, next) => {
  try {
    const traits = await repo.getTraitsMap();
    res.json(traits);
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/accounts/balances
router.get('/balances', async (req, res, next) => {
  try {
    const { asOfDate, section } = req.query;
    const balances = await repo.getBalances({ asOfDate, section });
    res.json({ data: balances });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/accounts/categories - P&L leaves treated as categories
router.get('/categories', async (req, res, next) => {
  try {
    const sql = `
      SELECT
        a.id as account_id,
        a.name as account_name,
        a.section,
        a.account_type,
        a.id as category_id,
        a.name as category_name,
        a.is_transfer
      FROM accounts a
      WHERE a.is_active = TRUE
        AND a.section = 'profit_loss'
        AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id AND c.is_active = TRUE)
      ORDER BY a.name
    `;
    const db = require('../db');
    const result = await db.query(sql);
    res.json({ data: result.rows });
  } catch (error) {
    next(error);
  }
});


// ============================================================================
// Standard CRUD Endpoints
// ============================================================================

// GET /api/v2/accounts/lookup?name=X - Find account by name with mappings
router.get('/lookup', async (req, res, next) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'name query parameter is required' });
    }
    const account = await repo.findByName(name);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    const mappings = await mappingsRepo.findByAccountId(account.id);
    res.json({ data: { ...account, mappings } });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/accounts/:id/mappings - List source mappings for an account
router.get('/:id/mappings', async (req, res, next) => {
  try {
    const mappings = await mappingsRepo.findByAccountId(parseInt(req.params.id));
    res.json({ data: mappings });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v2/accounts/:id/mappings - Upsert a source mapping
router.put('/:id/mappings', async (req, res, next) => {
  try {
    const accountId = parseInt(req.params.id);
    const { source, external_name } = req.body;
    if (!source || !external_name) {
      return res.status(400).json({ error: 'source and external_name are required' });
    }
    const mapping = await mappingsRepo.upsert(accountId, source, external_name);
    res.json({ data: mapping });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/accounts/:id/mappings/:mappingId - Remove a source mapping
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

// GET /api/v2/accounts/:id
router.get('/:id', async (req, res, next) => {
  try {
    const account = await repo.findById(parseInt(req.params.id));
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ data: account });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/accounts/:id/children
router.get('/:id/children', async (req, res, next) => {
  try {
    const children = await repo.getChildren(parseInt(req.params.id));
    res.json({ data: children });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/accounts/:id/descendants
router.get('/:id/descendants', async (req, res, next) => {
  try {
    const descendants = await repo.getDescendants(parseInt(req.params.id));
    res.json({ data: descendants });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/accounts
router.post('/', async (req, res, next) => {
  try {
    const account = await repo.create(req.body);
    // Auto-create pocketsmith source mapping for new accounts
    await mappingsRepo.upsert(account.id, 'pocketsmith', account.name);
    res.status(201).json({ data: account });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v2/accounts/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const account = await repo.update(parseInt(req.params.id), req.body);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json({ data: account });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/accounts/:id (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await repo.remove(parseInt(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
