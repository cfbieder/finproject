/**
 * V2 Accounts Routes
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').accounts;

// GET /api/v2/accounts - List accounts
router.get('/', async (req, res, next) => {
  try {
    const { section, accountType, activeOnly = 'true' } = req.query;
    const accounts = await repo.findAll({
      section,
      accountType,
      activeOnly: activeOnly === 'true'
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

// GET /api/v2/accounts/categories - Categories mapped to accounts
router.get('/categories', async (req, res, next) => {
  try {
    const sql = `
      SELECT
        a.id as account_id,
        a.name as account_name,
        a.section,
        a.account_type,
        c.id as category_id,
        c.name as category_name,
        c.is_transfer
      FROM accounts a
      INNER JOIN categories c ON c.mapped_account_id = a.id
      WHERE a.is_active = TRUE
      ORDER BY a.name, c.name
    `;
    const db = require('../db');
    const result = await db.query(sql);
    res.json({ data: result.rows });
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
