/**
 * Transfer Match Groups Routes
 *
 * CRUD endpoints for manual transfer match groups.
 * Mounted at /api/v2/transfer-match-groups
 */

const express = require('express');
const router = express.Router();
const { transferMatchGroups: repo } = require('../repositories');

// POST /api/v2/transfer-match-groups
// Body: { transactionIds: number[], note?: string }
router.post('/', async (req, res, next) => {
  try {
    const { transactionIds, note } = req.body;

    if (!Array.isArray(transactionIds) || transactionIds.length < 2) {
      return res.status(400).json({ error: 'transactionIds must be an array with at least 2 IDs' });
    }

    const group = await repo.create(transactionIds, note || null);
    res.status(201).json(group);
  } catch (error) {
    if (error.message && error.message.includes('already in a match group')) {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
});

// GET /api/v2/transfer-match-groups?startDate=&endDate=
router.get('/', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const groups = await repo.findAll({ startDate, endDate });
    res.json(groups);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/transfer-match-groups/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await repo.remove(parseInt(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: 'Match group not found' });
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
