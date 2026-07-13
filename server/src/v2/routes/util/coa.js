'use strict';
/**
 * util/coa.js — the Chart of Accounts read/write endpoints. Split out of routes/util.js;
 * paths unchanged (/api/v2/util/coa*, /api/v2/util/coa-traits).
 *
 * These handlers hold NO SQL — they go through the accounts repository — which is why
 * CR043's "extract a COA service" turned out to be moot. What they lacked was any test at
 * all, including the writes the Chart of Accounts page depends on. Writing those tests
 * (util.routes.test.js) is what surfaced the type-drop bug now fixed in /coa/update.
 */

const express = require('express');
const router = express.Router();
const accountsRepo = require('../../repositories').accounts;
const accountSourceMappingsRepo = require('../../repositories').accountSourceMappings;

// accounts.account_type is a Postgres enum; these are its five values.
const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];

/**
 * GET /api/v2/util/coa-traits
 * Get Chart of Accounts traits from PostgreSQL
 */
router.get('/coa-traits', async (req, res, next) => {
  try {
    const traits = await accountsRepo.getTraitsMap();
    res.json(traits);
  } catch (error) {
    console.error('[v2/util/coa-traits] Failed to fetch coa-traits:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/coa/BalanceSheet
 * Get Balance Sheet section as nested tree from PostgreSQL
 */
router.get('/coa/BalanceSheet', async (req, res, next) => {
  try {
    const tree = await accountsRepo.getNestedTree({ section: 'balance_sheet' });
    // Return the children of the root "Balance Sheet Accounts" node
    const root = tree.find(n => n.name === 'Balance Sheet Accounts');
    res.json(root ? root.children : tree);
  } catch (error) {
    console.error('[v2/util/coa/BalanceSheet] Failed:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/coa/CashFlow
 * Get Profit & Loss (Cash Flow) section as nested tree from PostgreSQL
 */
router.get('/coa/CashFlow', async (req, res, next) => {
  try {
    const tree = await accountsRepo.getNestedTree({ section: 'profit_loss' });
    // Return the children of the root "Profit & Loss Accounts" node
    const root = tree.find(n => n.name === 'Profit & Loss Accounts');
    res.json(root ? root.children : tree);
  } catch (error) {
    console.error('[v2/util/coa/CashFlow] Failed:', error);
    next(error);
  }
});

/**
 * POST /api/v2/util/coa/add
 * Add a new account to the COA via PostgreSQL
 */
router.post('/coa/add', async (req, res, next) => {
  try {
    const { path: pathParts, name, type, currency, accountNumber } = req.body || {};
    if (!Array.isArray(pathParts) || pathParts.length === 0) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Missing account name' });
    }

    // Resolve parent from path — last element in path is the direct parent
    const parentName = pathParts[pathParts.length - 1];
    const parent = await accountsRepo.findByName(parentName);
    if (!parent) {
      return res.status(404).json({ error: 'COA entry not found for the provided path.' });
    }

    // Check if name already exists
    const existing = await accountsRepo.findByName(trimmedName);
    if (existing) {
      // If already under the same parent and active, it's a genuine duplicate
      if (existing.parent_id === parent.id && existing.is_active) {
        return res.status(409).json({ error: 'COA entry already exists.' });
      }
      // Otherwise re-parent / reactivate the existing entry
      const updated = await accountsRepo.update(existing.id, {
        parent_id: parent.id,
        account_type: parent.account_type,
        section: parent.section,
        currency: currency || existing.currency || parent.currency || 'USD',
        account_number: accountNumber || existing.account_number || null,
        is_active: true,
      });
      // Recompute is_transfer based on new placement
      const isTransfer = await accountsRepo.computeIsTransfer(updated.id);
      if (isTransfer !== updated.is_transfer) {
        await accountsRepo.update(updated.id, { is_transfer: isTransfer });
      }
      await accountSourceMappingsRepo.upsert(updated.id, 'pocketsmith', trimmedName);
      return res.json({ success: true, added: true, moved: true, name: trimmedName, id: updated.id });
    }

    const account = await accountsRepo.create({
      name: trimmedName,
      parent_id: parent.id,
      account_type: parent.account_type,
      section: parent.section,
      currency: currency || parent.currency || 'USD',
      account_number: accountNumber || null,
    });

    // Set is_transfer based on whether any ancestor in the path is "Transfers"
    const isTransfer = await accountsRepo.computeIsTransfer(account.id);
    if (isTransfer) {
      await accountsRepo.update(account.id, { is_transfer: true });
    }

    await accountSourceMappingsRepo.upsert(account.id, 'pocketsmith', trimmedName);

    res.json({ success: true, added: true, name: trimmedName, id: account.id });
  } catch (error) {
    console.error('[v2/util/coa/add] Failed:', error);
    next(error);
  }
});

/**
 * POST /api/v2/util/coa/update
 * Rename / update an account in the COA via PostgreSQL
 */
router.post('/coa/update', async (req, res, next) => {
  try {
    const { oldName, name, type, currency, accountNumber } = req.body || {};
    if (!oldName || !name) {
      return res.status(400).json({ error: 'Missing account name' });
    }

    const account = await accountsRepo.findByName(String(oldName));
    if (!account) {
      return res.status(404).json({ error: 'COA entry not found for the provided path/name.' });
    }

    const updates = { name: String(name) };
    if (currency) updates.currency = currency;
    if (accountNumber !== undefined) updates.account_number = accountNumber;

    // `type` was destructured and then NEVER USED. The COA editor sends it on every save
    // (COAManagement.jsx), the repo's update() has always accepted `account_type`, and the
    // response echoed the row back — so changing an account's type returned 200 with the
    // OLD type and changed nothing. Silent drop, exactly the class that cost CR046 its
    // window dates and CR047 its tax override. Proven on dev before fixing: currency went
    // USD→EUR in the same request while type stayed `expense`.
    //
    // "Category" is not an account_type — it is what the UI shows for a tree node with no
    // traits row — so it means "no type change", not a bad value. Anything else that is
    // neither blank nor a real type is a caller bug and now 400s instead of being ignored.
    const rawType = typeof type === 'string' ? type.trim() : '';
    if (rawType && rawType !== 'Category') {
      const normalized = rawType.toLowerCase();
      if (!ACCOUNT_TYPES.includes(normalized)) {
        return res.status(400).json({
          error: `Invalid type '${rawType}'. Expected one of: ${ACCOUNT_TYPES.join(', ')}.`,
        });
      }
      updates.account_type = normalized;
    }

    const updated = await accountsRepo.update(account.id, updates);

    res.json({
      success: true,
      updated: {
        name: updated.name,
        type: updated.account_type,
        currency: updated.currency,
        accountNumber: updated.account_number || '',
      },
    });
  } catch (error) {
    console.error('[v2/util/coa/update] Failed:', error);
    next(error);
  }
});

/**
 * POST /api/v2/util/coa/delete
 * Soft-delete an account from the COA via PostgreSQL
 */
router.post('/coa/delete', async (req, res, next) => {
  try {
    const { path: pathParts, name } = req.body || {};
    const targetName = String(name || (Array.isArray(pathParts) ? pathParts[pathParts.length - 1] : '') || '');
    if (!targetName) {
      return res.status(400).json({ error: 'Missing account name' });
    }

    const account = await accountsRepo.findByName(targetName);
    if (!account) {
      return res.status(404).json({ error: 'COA entry not found for the provided path/name.' });
    }

    await accountsRepo.remove(account.id);
    res.json({ success: true, deleted: true, name: targetName });
  } catch (error) {
    console.error('[v2/util/coa/delete] Failed:', error);
    next(error);
  }
});

module.exports = router;
