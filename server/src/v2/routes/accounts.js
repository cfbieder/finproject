/**
 * V2 Accounts Routes
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').accounts;
const db = require('../db');
const pocketsmith = require('../../services/retrieval/pocketsmith');

const PS_USER_ID = process.env.PS_USER_ID || '330430';

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

// ============================================================================
// Balance Calibration Endpoints (must be before /:id to avoid route conflicts)
// ============================================================================

/**
 * POST /api/v2/accounts/map-ps-accounts
 * Map PocketSmith transaction account IDs to local accounts by name
 */
router.post('/map-ps-accounts', async (req, res, next) => {
  try {
    const { data: psAccounts } = await pocketsmith.getUsersIdTransaction_accounts({ id: PS_USER_ID });

    if (!Array.isArray(psAccounts) || psAccounts.length === 0) {
      return res.json({ matched: 0, unmatched: [], psAccountCount: 0 });
    }

    // Get all local accounts
    const localResult = await db.query(
      `SELECT id, name, ps_account_name FROM accounts WHERE is_active = TRUE`
    );
    const localAccounts = localResult.rows;

    // Build name -> local account lookup (case-insensitive)
    const localByName = new Map();
    for (const acct of localAccounts) {
      localByName.set((acct.ps_account_name || acct.name).toLowerCase(), acct);
    }

    const matched = [];
    const unmatched = [];

    for (const psAcct of psAccounts) {
      const psName = (psAcct.name || '').toLowerCase();
      const local = localByName.get(psName);
      if (local) {
        await db.query(
          `UPDATE accounts SET ps_transaction_account_id = $1 WHERE id = $2`,
          [psAcct.id, local.id]
        );
        matched.push({ localName: local.name, psName: psAcct.name, psId: psAcct.id });
      } else {
        unmatched.push({ psName: psAcct.name, psId: psAcct.id });
      }
    }

    res.json({
      matched: matched.length,
      unmatched: unmatched.length,
      matchedAccounts: matched,
      unmatchedAccounts: unmatched,
      psAccountCount: psAccounts.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v2/accounts/calibrate
 * Calculate opening balances by back-calculating from the most recent closing_balance
 * Optional query param: accountId - calibrate a single account
 */
router.post('/calibrate', async (req, res, next) => {
  try {
    const { accountId } = req.query;
    const accountFilter = accountId ? `AND a.id = $1` : '';
    const params = accountId ? [parseInt(accountId)] : [];

    const sql = `
      WITH anchor AS (
        SELECT DISTINCT ON (t.account_id)
          t.account_id,
          t.transaction_date AS anchor_date,
          t.closing_balance AS anchor_balance
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        WHERE t.closing_balance IS NOT NULL
          AND a.is_active = TRUE
          ${accountFilter}
        ORDER BY t.account_id, t.transaction_date DESC, t.id DESC
      ),
      txn_sums AS (
        SELECT
          t.account_id,
          SUM(t.amount) AS total_amount
        FROM transactions t
        JOIN anchor anc ON anc.account_id = t.account_id
        WHERE t.transaction_date >= '2000-01-01'
          AND t.transaction_date <= anc.anchor_date
        GROUP BY t.account_id
      )
      SELECT
        a.id,
        a.name,
        anc.anchor_date,
        anc.anchor_balance,
        COALESCE(ts.total_amount, 0) AS total_amount,
        anc.anchor_balance - COALESCE(ts.total_amount, 0) AS computed_opening_balance
      FROM accounts a
      JOIN anchor anc ON anc.account_id = a.id
      LEFT JOIN txn_sums ts ON ts.account_id = a.id
      WHERE a.is_active = TRUE
      ORDER BY a.name
    `;

    const result = await db.query(sql, params);
    const results = [];

    for (const row of result.rows) {
      await db.query(
        `UPDATE accounts
         SET opening_balance = $1,
             opening_balance_date = '2000-01-01',
             last_calibrated_at = NOW()
         WHERE id = $2`,
        [row.computed_opening_balance, row.id]
      );

      results.push({
        accountId: row.id,
        accountName: row.name,
        anchorDate: row.anchor_date,
        anchorClosingBalance: parseFloat(row.anchor_balance),
        totalTransactionAmount: parseFloat(row.total_amount),
        computedOpeningBalance: parseFloat(row.computed_opening_balance)
      });
    }

    res.json({
      calibrated: results.length,
      results
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v2/accounts/calibration-status
 * Show calculated balance vs PocketSmith balance for each account
 */
router.get('/calibration-status', async (req, res, next) => {
  try {
    const balanceResult = await db.query(`
      SELECT
        a.id,
        a.name,
        a.currency,
        a.opening_balance,
        a.opening_balance_date,
        a.last_calibrated_at,
        a.ps_transaction_account_id,
        a.opening_balance + COALESCE(SUM(t.amount), 0) AS calculated_balance
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.transaction_date >= a.opening_balance_date
      WHERE a.is_active = TRUE
      GROUP BY a.id, a.name, a.currency, a.opening_balance, a.opening_balance_date,
               a.last_calibrated_at, a.ps_transaction_account_id
      ORDER BY a.name
    `);

    const psIds = balanceResult.rows
      .filter(r => r.ps_transaction_account_id)
      .map(r => r.ps_transaction_account_id);

    const psBalances = new Map();
    if (psIds.length > 0) {
      try {
        const { data: psAccounts } = await pocketsmith.getUsersIdTransaction_accounts({ id: PS_USER_ID });
        if (Array.isArray(psAccounts)) {
          for (const psAcct of psAccounts) {
            if (psIds.includes(psAcct.id)) {
              psBalances.set(psAcct.id, parseFloat(psAcct.current_balance) || 0);
            }
          }
        }
      } catch (err) {
        console.warn('[accounts/calibration-status] Failed to fetch PS balances:', err.message);
      }
    }

    const accounts = balanceResult.rows.map(row => {
      const calculatedBalance = parseFloat(row.calculated_balance) || 0;
      const psBalance = row.ps_transaction_account_id
        ? psBalances.get(row.ps_transaction_account_id) ?? null
        : null;

      return {
        id: row.id,
        name: row.name,
        currency: row.currency,
        openingBalance: parseFloat(row.opening_balance) || 0,
        calculatedBalance,
        psBalance,
        difference: psBalance !== null ? Math.round((calculatedBalance - psBalance) * 100) / 100 : null,
        lastCalibratedAt: row.last_calibrated_at,
        psMapped: !!row.ps_transaction_account_id
      };
    });

    res.json({ data: accounts });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Standard CRUD Endpoints
// ============================================================================

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
