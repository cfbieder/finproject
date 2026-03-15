/**
 * V2 Transactions Routes
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').transactions;
const accountsRepo = require('../repositories').accounts;
const categoriesRepo = require('../repositories').categories;

/**
 * Transform v1-style field names to v2 format
 * Maps: Date → transaction_date, Amount → amount, etc.
 */
function transformV1ToV2Fields(data) {
  const fieldMap = {
    Date: 'transaction_date',
    Description1: 'description1',
    Description2: 'description2',
    Amount: 'amount',
    Currency: 'currency',
    BaseAmount: 'base_amount',
    BaseCurrency: 'base_currency',
    Account: 'account_name',  // Will be resolved to account_id
    Category: 'category_name', // Will be resolved to category_id
    Memo: 'memo',
    Note: 'note',
    Labels: 'labels',
    Bank: 'bank'
  };

  const transformed = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const mappedKey = fieldMap[key] || key;
    transformed[mappedKey] = value;
  }
  return transformed;
}

// GET /api/v2/transactions - List transactions
router.get('/', async (req, res, next) => {
  try {
    const {
      startDate, endDate, categoryId, accountId,
      category, account,  // Support name-based filtering for compatibility
      year, month, currency, description, minAmount, maxAmount,
      limit = 100, offset = 0
    } = req.query;

    // Build date range from year/month if provided
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;

    if (year && !startDate && !endDate) {
      const y = parseInt(year);
      if (month) {
        const m = parseInt(month);
        effectiveStartDate = `${y}-${String(m).padStart(2, '0')}-01`;
        // Calculate last day of month
        const lastDay = new Date(y, m, 0).getDate();
        effectiveEndDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
      } else {
        effectiveStartDate = `${y}-01-01`;
        effectiveEndDate = `${y}-12-31`;
      }
    }

    // Handle array parameters (multiple values)
    const categoryNames = Array.isArray(category) ? category : (category ? [category] : undefined);
    const accountNames = Array.isArray(account) ? account : (account ? [account] : undefined);

    const transactions = await repo.findAllExtended({
      startDate: effectiveStartDate,
      endDate: effectiveEndDate,
      categoryId: categoryId ? parseInt(categoryId) : undefined,
      accountId: accountId ? parseInt(accountId) : undefined,
      categoryNames,
      accountNames,
      currency,
      description,
      minAmount: minAmount ? parseFloat(minAmount) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      data: transactions
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/transactions/summary/by-category
router.get('/summary/by-category', async (req, res, next) => {
  try {
    const { startDate, endDate, section } = req.query;
    const summary = await repo.sumByCategory({ startDate, endDate, section });
    res.json({ data: summary });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/transactions/summary/by-month
router.get('/summary/by-month', async (req, res, next) => {
  try {
    const { startDate, endDate, categoryId } = req.query;
    const summary = await repo.sumByMonth({
      startDate,
      endDate,
      categoryId: categoryId ? parseInt(categoryId) : undefined
    });
    res.json({ data: summary });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/transactions/:id
router.get('/:id', async (req, res, next) => {
  try {
    const transaction = await repo.findById(parseInt(req.params.id));
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ data: transaction });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/transactions
router.post('/', async (req, res, next) => {
  try {
    const transaction = await repo.create(req.body);
    res.status(201).json({ data: transaction });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v2/transactions/:id
// Accepts both v1 (PascalCase) and v2 (snake_case) field names
router.patch('/:id', async (req, res, next) => {
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

    const transaction = await repo.update(parseInt(req.params.id), data);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ data: transaction });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/transactions/:id/split
// Splits a transaction into 2-5 entries, distributing the original amount.
router.post('/:id/split', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { splits } = req.body;

    if (!Array.isArray(splits) || splits.length < 2 || splits.length > 5) {
      return res.status(400).json({ error: 'splits must be an array of 2-5 entries' });
    }

    for (const split of splits) {
      if (typeof split.amount !== 'number' || !Number.isFinite(split.amount)) {
        return res.status(400).json({ error: 'Each split must have a valid numeric amount' });
      }
    }

    // Resolve category names to IDs
    const resolvedSplits = [];
    for (const split of splits) {
      const resolved = { amount: split.amount };
      if (split.category_name) {
        const category = await categoriesRepo.findByName(split.category_name);
        if (category) {
          resolved.category_id = category.id;
        }
      } else if (split.category_id !== undefined) {
        resolved.category_id = split.category_id;
      }
      resolvedSplits.push(resolved);
    }

    const result = await repo.split(id, resolvedSplits);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/transactions/:id/neutralize
// Creates an offsetting entry for brokerage security trades.
// Both transactions are categorized as "Transfer - Security Trade" and marked accepted.
router.post('/:id/neutralize', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const categoryName = req.body.category_name || 'Transfer - Security Trade';

    // Resolve category name to ID
    const category = await categoriesRepo.findByName(categoryName);
    if (!category) {
      return res.status(400).json({
        error: `Category "${categoryName}" not found. Please create it in COA Management first.`
      });
    }

    const result = await repo.neutralize(id, category.id);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/transactions/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await repo.remove(parseInt(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
