/**
 * V2 Transactions Routes
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').transactions;
const accountsRepo = require('../repositories').accounts;
// "Categories" are P&L leaves on the accounts table after migration 021.
// Look up by name with `accountsRepo.findByName`; results have id/name/section.
const transferMatchGroupsRepo = require('../repositories').transferMatchGroups;

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
      startDate, endDate, fromDate, toDate, categoryId, accountId,
      category, account,  // Support name-based filtering for compatibility
      year, month, currency, description, minAmount, maxAmount,
      transferMatched,
      limit = 100, offset = 0
    } = req.query;

    // Build date range — accept startDate/endDate or fromDate/toDate
    let effectiveStartDate = startDate || fromDate;
    let effectiveEndDate = endDate || toDate;

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
      transferMatched,
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

// GET /api/v2/transactions/transfer-analysis
// Matches transfer transactions (debit/credit pairs) within a period.
// Standard categories: exact base_amount match, configurable date tolerance (default 5 days).
// FX category: 1% base_amount tolerance, 1-day date tolerance (FX spreads cause
// ~0.5-0.7% differences in converted base amounts).
router.get('/transfer-analysis', async (req, res, next) => {
  try {
    const { year, month, dateTolerance: dtParam } = req.query;
    const dateTolerance = dtParam ? parseInt(dtParam) : 5; // days

    if (!year) {
      return res.status(400).json({ error: 'year is required' });
    }

    const y = parseInt(year);
    let startDate, endDate;
    if (month) {
      const m = parseInt(month);
      startDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      endDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
    } else {
      startDate = `${y}-01-01`;
      endDate = `${y}-12-31`;
    }

    // Fetch transfers and manual match groups in parallel
    const [transfers, manualMatchedIds, manualGroups] = await Promise.all([
      repo.findTransfers({ startDate, endDate }),
      transferMatchGroupsRepo.findMatchedTransactionIds({ startDate, endDate }),
      transferMatchGroupsRepo.findAll({ startDate, endDate }),
    ]);

    // Exclude manually matched transactions from auto-matching
    const autoTransfers = transfers.filter(t => !manualMatchedIds.has(t.id));

    // Group by category
    const byCategory = {};
    for (const txn of autoTransfers) {
      const cat = txn.category_name || 'Uncategorized';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(txn);
    }

    // Determine if a category uses fuzzy (FX) matching
    const isFxCategory = (name) => name === 'Transfer - FX' || name === 'FX';

    // Match within each category
    const result = {};
    for (const [category, txns] of Object.entries(byCategory)) {
      const matched = [];
      const used = new Set();
      const isFx = isFxCategory(category);

      // FX: 1% amount tolerance, 1-day date window (FX spreads cause ~0.5-0.7% differences)
      // Others: exact amount (within $0.01), configurable date window
      const maxDateDays = isFx ? 1 : dateTolerance;

      // Sort: negatives first to drive matching
      const sorted = [...txns].sort((a, b) => parseFloat(a.base_amount) - parseFloat(b.base_amount));

      for (let i = 0; i < sorted.length; i++) {
        if (used.has(sorted[i].id)) continue;
        const amt = parseFloat(sorted[i].base_amount);
        if (amt >= 0) continue; // only start from negatives

        const dateI = new Date(sorted[i].transaction_date);
        const absAmt = Math.abs(amt);

        // Find a matching positive
        for (let j = 0; j < sorted.length; j++) {
          if (i === j || used.has(sorted[j].id)) continue;
          const amtJ = parseFloat(sorted[j].base_amount);
          if (amtJ <= 0) continue; // need a positive counterpart

          // Amount check
          if (isFx) {
            // FX: allow 1% difference between absolute values
            const pctDiff = Math.abs(absAmt - amtJ) / Math.max(absAmt, amtJ);
            if (pctDiff > 0.01) continue;
          } else {
            // Standard: exact match (within rounding)
            if (Math.abs(amt + amtJ) > 0.01) continue;
          }

          // Date check
          const dateJ = new Date(sorted[j].transaction_date);
          const daysDiff = Math.abs(dateI - dateJ) / (1000 * 60 * 60 * 24);
          if (daysDiff > maxDateDays) continue;

          matched.push({ debit: sorted[i], credit: sorted[j] });
          used.add(sorted[i].id);
          used.add(sorted[j].id);
          break;
        }
      }

      const unmatched = txns.filter(t => !used.has(t.id));

      result[category] = {
        matched,
        unmatched,
        matchedCount: matched.length,
        unmatchedCount: unmatched.length,
        matchedTotal: matched.reduce((s, p) => s + Math.abs(parseFloat(p.debit.base_amount)), 0),
        unmatchedTotal: unmatched.reduce((s, t) => s + parseFloat(t.base_amount), 0),
      };
    }

    // Persist transfer_matched flags
    const allMatchedIds = [];
    const allUnmatchedIds = [];
    for (const catData of Object.values(result)) {
      for (const pair of catData.matched) {
        allMatchedIds.push(pair.debit.id, pair.credit.id);
      }
      for (const txn of catData.unmatched) {
        allUnmatchedIds.push(txn.id);
      }
    }
    // Manual group members are also matched
    for (const group of manualGroups) {
      for (const txn of group.transactions) {
        allMatchedIds.push(txn.id);
      }
    }
    await repo.updateTransferMatchedFlags({
      matchedIds: allMatchedIds,
      unmatchedIds: allUnmatchedIds,
      startDate,
      endDate,
    });

    res.json({
      data: result,
      manualGroups,
      period: { year: y, month: month ? parseInt(month) : null, startDate, endDate }
    });
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
// When transaction_date changes and currency != base_currency, recalculates
// base_amount using the implied FX rate from a nearby transaction.
router.patch('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
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
      const category = await accountsRepo.findByName(data.category_name);
      if (category) {
        data.category_id = category.id;
      }
      delete data.category_name;
    }

    // If the date is changing, recalculate base_amount using implied FX rate
    let rateInfo = null;
    if (data.transaction_date && data.base_amount === undefined) {
      const existing = await repo.findById(id);
      if (existing && existing.currency && existing.base_currency
          && existing.currency !== existing.base_currency) {
        const implied = await repo.findImpliedRate(
          existing.currency,
          data.transaction_date,
          id
        );
        if (implied && Number.isFinite(implied.rate) && implied.rate !== 0) {
          const amount = parseFloat(existing.amount);
          if (Number.isFinite(amount)) {
            data.base_amount = parseFloat((amount / implied.rate).toFixed(2));
            rateInfo = {
              implied_rate: implied.rate,
              source_date: implied.source_date,
              source_id: implied.source_id,
              old_base_amount: parseFloat(existing.base_amount),
              new_base_amount: data.base_amount,
            };
          }
        }
      }
    }

    const transaction = await repo.update(id, data);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ data: transaction, rateInfo });
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
        const category = await accountsRepo.findByName(split.category_name);
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
// Both transactions are categorized as "Transfer - Securities Trades" and marked accepted.
router.post('/:id/neutralize', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const categoryName = req.body.category_name || 'Transfer - Securities Trades';

    // Resolve category name to ID
    const category = await accountsRepo.findByName(categoryName);
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

// POST /api/v2/transactions/:id/transfer
// CR022: mark a transaction as a transfer to another tracked account and create
// the offsetting entry there (net-worth-neutral). Body: { targetAccountId }.
router.post('/:id/transfer', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const targetAccountId = parseInt(req.body.targetAccountId);
    if (!Number.isFinite(targetAccountId)) {
      return res.status(400).json({ error: 'targetAccountId is required' });
    }
    const result = await repo.transferToAccount(id, targetAccountId);
    res.json({ data: result });
  } catch (error) {
    if (/must differ|not found/i.test(error.message)) {
      return res.status(400).json({ error: error.message });
    }
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
