/**
 * Forecast Routes
 *
 * Scenarios, modules, income/expense items, forecast generation,
 * and assumptions management.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const repo = require('../repositories').forecast;
const accountsRepo = require('../repositories').accounts;
const validate = require('../utils/validate');
const crud = require('../../services/forecast/crud');
const { generateForecast } = require('../../services/forecast');
const { PATHS } = require('../../services/forecast/constants');

// Fields PUT /scenarios/:id may set (mirrors updateScenario's own allow-list).
// The scenario editor sends only { cash_sweep_low, cash_sweep_high }; the rest
// are here because updateScenario accepts them. Unknown keys 400 instead of
// being silently dropped (CR043 N10). The richer module / income-expense write
// endpoints get the same treatment during the Phase 2.1 extraction, once each
// PascalCase form contract is enumerated against the frontend.
const SCENARIO_UPDATE_FIELDS = ['name', 'description', 'is_active', 'cash_sweep_low', 'cash_sweep_high'];

// CR043 N10 — the module / income-expense write contracts, enumerated at last.
//
// Both routes build their update object from an explicit PascalCase whitelist, so a key
// the caller sends but the route does not read is **silently dropped**: the user types a
// value, hits Save, gets a 200, and the field is empty when they come back. That is
// exactly how CR046's window dates and CR047's tax override were lost (v3.0.86) — and
// how three dead keys (`AccountNumber`, `Expense`, `Income`) went on being posted to a
// column that does not exist.
//
// These lists are a **superset of live traffic** (every key every caller actually sends,
// verified against the frontend), so nothing that works today can start 400ing. What they
// do catch is the next typo'd or newly-added-but-unwired field: it now fails loud instead
// of being accepted and ignored.
const MODULE_WRITE_FIELDS = [
  'Scenario', 'Account', 'Name', 'Type', 'Currency', 'Comment', 'Matched', 'SetupStatus',
  'BaseDate', 'BaseValue', 'MarketValue', 'BaseValueUSD', 'MarketValueUSD', 'Growth',
  'ExpenseAmount', 'ExpenseFcLineId', 'ExpenseGrowthMethod', 'ExpenseStartDate', 'ExpenseEndDate',
  'IncomeAmount', 'IncomeFcLineId', 'IncomeStartDate', 'IncomeEndDate',
  'TaxRateOverride', 'IncomeTaxRateOverride',
  'CashSweepPriority', 'CashSweepTarget',
  'Invest', 'Dispose', 'IncomePct',
];

const INCEXP_WRITE_FIELDS = [
  'Scenario', 'Account', 'Name', 'Type', 'Currency', 'Comment', 'Matched', 'SetupStatus',
  'BaseDate', 'BaseValue', 'BaseValueUSD', 'Growth',
  'FcLineId', 'BudgetSourceYear', 'Changes',
];

/** Shared shape check for a module write body (POST and PUT send the same contract). */
function assertModuleBody(body) {
  validate.assertPlainObject(body, 'module');
  validate.assertAllowedFields(body, MODULE_WRITE_FIELDS, 'module');
  for (const f of ['BaseValue', 'MarketValue', 'BaseValueUSD', 'MarketValueUSD', 'Growth',
    'ExpenseAmount', 'IncomeAmount', 'TaxRateOverride', 'IncomeTaxRateOverride']) {
    if (body[f] !== undefined && body[f] !== null) {
      validate.assertFiniteNumber(body[f], f, { optional: true });
    }
  }
  if (body.Matched !== undefined) validate.assertBoolean(body.Matched, 'Matched');
  for (const f of ['Invest', 'Dispose', 'IncomePct']) {
    if (body[f] !== undefined && !Array.isArray(body[f])) {
      throw validate.badRequest(`${f} must be an array`);
    }
  }
}

/** Shared shape check for an income/expense write body. */
function assertIncExpBody(body) {
  validate.assertPlainObject(body, 'income-expense item');
  validate.assertAllowedFields(body, INCEXP_WRITE_FIELDS, 'income-expense item');
  for (const f of ['BaseValue', 'BaseValueUSD', 'Growth']) {
    if (body[f] !== undefined && body[f] !== null) {
      validate.assertFiniteNumber(body[f], f, { optional: true });
    }
  }
  if (body.Matched !== undefined) validate.assertBoolean(body.Matched, 'Matched');
  if (body.Changes !== undefined && !Array.isArray(body.Changes)) {
    throw validate.badRequest('Changes must be an array');
  }
}

// ============================================================================
// Assumptions (PostgreSQL — scenarios table + forecast_assumptions document;
// CR039 retired the FCAssump.json file backing)
// ============================================================================

const assumpRepo = require('../repositories').forecastAssumptions;

// GET /api/v2/forecast/assumptions
router.get('/assumptions', async (req, res, next) => {
  try {
    // Get scenarios from PostgreSQL
    const scenarios = await repo.findAllScenarios({ activeOnly: false });

    // Other assumptions (inflation, FX, tax rates, category list) from the
    // forecast_assumptions document (formerly FCAssump.json)
    const docAssumptions = await assumpRepo.getDoc();

    // Merge PeriodStart/PeriodEnd from the document's scenarios into DB scenarios
    const docScenarioMap = {};
    for (const dsc of (docAssumptions.scenarios || [])) {
      if (dsc.Name) docScenarioMap[dsc.Name] = dsc;
    }

    const scenariosFormatted = scenarios.map((s) => ({
      Name: s.name,
      Description: s.description,
      IsActive: s.is_active,
      id: s.id,
      ...(docScenarioMap[s.name]?.PeriodStart != null && { PeriodStart: docScenarioMap[s.name].PeriodStart }),
      ...(docScenarioMap[s.name]?.PeriodEnd != null && { PeriodEnd: docScenarioMap[s.name].PeriodEnd }),
    }));

    res.json({
      ...docAssumptions,
      scenarios: scenariosFormatted,
    });
  } catch (error) {
    console.error('[forecast/assumptions] Failed to load assumptions:', error);
    next(error);
  }
});

// PUT /api/v2/forecast/assumptions
router.put('/assumptions', async (req, res, next) => {
  try {
    const body = req.body || {};

    // Sync scenarios to PostgreSQL
    if (Array.isArray(body.scenarios)) {
      for (const scenario of body.scenarios) {
        if (!scenario.Name) continue;

        const found = await repo.findScenarioByName(scenario.Name);
        if (found) {
          await repo.updateScenario(found.id, {
            description: scenario.Description,
            is_active: scenario.IsActive !== false,
          });
        } else {
          await repo.createScenario({
            name: scenario.Name,
            description: scenario.Description,
            is_active: scenario.IsActive !== false,
          });
        }
      }
    }

    // Upsert the document keys (partial merge — untouched keys keep their
    // rows, same semantics as the old {...existing, ...body} file merge).
    // The 'scenarios' key keeps PeriodStart/PeriodEnd, which the engine needs.
    await assumpRepo.putDoc(body);

    res.json({ success: true });
  } catch (error) {
    console.error('[forecast/assumptions PUT] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Scenarios
// ============================================================================

// GET /api/v2/forecast/scenarios
router.get('/scenarios', async (req, res, next) => {
  try {
    const { activeOnly = 'true' } = req.query;
    const scenarios = await repo.findAllScenarios({ activeOnly: activeOnly === 'true' });
    res.json({ data: scenarios });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/forecast/scenarios/years/:scenario
// NOTE: Must be defined BEFORE /scenarios/:id to avoid route conflict
router.get('/scenarios/years/:scenario', async (req, res, next) => {
  try {
    const scenarioName = req.params.scenario?.trim();
    if (!scenarioName) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    const scenario = await repo.findScenarioByName(scenarioName);
    if (!scenario) {
      return res.json({ years: [] });
    }

    const years = await repo.findYearsByScenario(scenario.id);
    res.json({ years });
  } catch (error) {
    console.error('[forecast/scenarios/years] Failed:', error);
    next(error);
  }
});

// DELETE /api/v2/forecast/scenarios/byname/:name
router.delete('/scenarios/byname/:name', async (req, res, next) => {
  try {
    const name = req.params.name?.trim();
    if (!name) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    const scenario = await repo.findScenarioByName(name);
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    await repo.deleteScenario(scenario.id);
    res.json({ success: true });
  } catch (error) {
    console.error('[forecast/scenarios/byname DELETE] Failed:', error);
    next(error);
  }
});

// POST /api/v2/forecast/scenarios/byname/:name/copy
// PUT /api/v2/forecast/scenarios/:id
router.put('/scenarios/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    // CR043 N10: fail loud on a typo'd/unknown field instead of silently
    // dropping it (updateScenario reads only its known keys, so a misspelled
    // one used to be accepted-and-ignored with a 200).
    validate.assertPlainObject(req.body, 'scenario');
    validate.assertAllowedFields(req.body, SCENARIO_UPDATE_FIELDS, 'scenario');
    validate.assertFiniteNumber(req.body.cash_sweep_low, 'cash_sweep_low', { optional: true });
    validate.assertFiniteNumber(req.body.cash_sweep_high, 'cash_sweep_high', { optional: true });
    if (req.body.is_active !== undefined) {
      validate.assertBoolean(req.body.is_active, 'is_active');
    }
    const updated = await repo.updateScenario(Number(id), req.body);
    if (!updated) {
      return res.status(404).json({ error: 'Scenario not found' });
    }
    res.json({ data: updated });
  } catch (error) {
    console.error('[forecast/scenarios/:id] PUT failed:', error);
    next(error);
  }
});

router.post('/scenarios/byname/:name/copy', async (req, res, next) => {
  try {
    const sourceName = req.params.name?.trim();
    const newName = (req.body.newScenarioName || '').trim();

    if (!sourceName) {
      return res.status(400).json({ error: 'Source scenario name is required' });
    }
    if (!newName) {
      return res.status(400).json({ error: 'New scenario name is required' });
    }

    const sourceScenario = await repo.findScenarioByName(sourceName);
    if (!sourceScenario) {
      return res.status(404).json({ error: 'Source scenario not found' });
    }

    const newScenario = await repo.copyScenario(sourceScenario.id, newName);

    // If refreshFromActuals is set, update module base values from latest actuals
    const baseYear = req.body.baseYear || null;
    if (baseYear) {
      const asOfDate = `${baseYear}-12-31`;
      const rowCount = await crud.refreshModulesFromActuals(newScenario.id, asOfDate);
      console.log(`[copy] Updated ${rowCount} modules with ${baseYear} actuals`);
    }

    res.status(201).json({ success: true, data: newScenario });
  } catch (error) {
    console.error('[forecast/scenarios/byname/copy] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Modules
// ============================================================================

// GET /api/v2/forecast/modules
router.get('/modules', async (req, res, next) => {
  try {
    const { scenario } = req.query;
    let modules = [];

    if (scenario) {
      const scenarioObj = await repo.findScenarioByName(scenario);
      if (scenarioObj) {
        modules = await repo.findModulesByScenario(scenarioObj.id);
      }
    } else {
      modules = await crud.listAllModulesRaw();
    }

    // Transform to PascalCase for frontend
    const transformed = modules.map((m) => ({
      ...m,
      id: m.id,
      Scenario: m.scenario_name || scenario,
      Name: m.name,
      Account: m.account_name,
      Type: m.module_type ? m.module_type.charAt(0).toUpperCase() + m.module_type.slice(1) : '',
      Currency: m.currency,
      ExpenseAmount: m.expense_amount,
      ExpenseFcLineId: m.expense_fc_line_id,
      IncomeFcLineId: m.income_fc_line_id,
      ExpenseGrowthMethod: m.expense_growth_method || 'inflation',
      TaxRateOverride: m.tax_rate_override != null ? parseFloat(m.tax_rate_override) : null,
      IncomeTaxRateOverride: m.income_tax_rate_override != null ? parseFloat(m.income_tax_rate_override) : null,
      IncomeAmount: m.income_amount,
      IncomeStartDate: m.income_start_date,
      IncomeEndDate: m.income_end_date,
      ExpenseStartDate: m.expense_start_date,
      ExpenseEndDate: m.expense_end_date,
      BaseDate: m.base_date,
      BaseValue: m.base_value,
      MarketValue: m.market_value,
      BaseValueUSD: m.base_value_usd,
      MarketValueUSD: m.market_value_usd,
      GrowthRate: m.growth_rate,
      Comment: m.comment,
      IsMatched: m.is_matched,
      Matched: m.is_matched,
      SetupStatus: m.setup_status || 'new',
      CashSweepTarget: m.cash_sweep_target || false,
      CashSweepPriority: m.cash_sweep_priority ?? null,
    }));

    res.json(transformed);
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/forecast/modules/unmatched
// NOTE: Must be defined BEFORE /modules/:id to avoid route conflict
router.get('/modules/unmatched', async (req, res, next) => {
  try {
    const scenarioName = req.query.scenario?.trim();

    const tree = await accountsRepo.getNestedTree({ section: 'balance_sheet' });
    if (!tree || tree.length === 0) {
      return res.json([]);
    }

    const root = tree.find(n => n.name === 'Balance Sheet Accounts');
    const structure = root && root.children.length > 0 ? root.children : tree;

    // Get matched names for the scenario
    let matchedNames = new Set();
    if (scenarioName) {
      const scenario = await repo.findScenarioByName(scenarioName);
      if (scenario) {
        matchedNames = await repo.findMatchedModuleNames(scenario.id);
      }
    }

    // Extract leaf accounts, excluding children of matched parent accounts
    const allAccounts = [];
    const collectLeaves = (nodes, category, ancestorMatched) => {
      for (const node of nodes) {
        if (!node || !node.name) continue;
        const thisMatched = ancestorMatched || matchedNames.has(node.name);
        if (!node.children || node.children.length === 0) {
          const isBankAccount = typeof category === 'string' &&
            category.toLowerCase().includes('bank account');
          // Skip if this leaf or any ancestor is matched
          if (!thisMatched) {
            allAccounts.push({ name: node.name, category, isBankAccount });
          }
        } else {
          collectLeaves(node.children, node.name, thisMatched);
        }
      }
    };
    collectLeaves(structure, null, false);

    const unmatched = allAccounts.filter(account =>
      !account.isBankAccount
    );

    res.json(unmatched);
  } catch (error) {
    console.error('[forecast/modules/unmatched] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/modules/:id
// Returns a single module with nested arrays (IncomePct, Invest, Dispose)
router.get('/modules/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const module = await repo.findModuleById(Number(id));
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    // Transform to PascalCase with nested arrays
    const m = module;
    res.json({
      data: {
        ...m,
        id: m.id,
        Name: m.name,
        Account: m.account_name,
        Type: m.module_type,
        Currency: m.currency,
        ExpenseAmount: m.expense_amount,
        ExpenseFcLineId: m.expense_fc_line_id,
        IncomeFcLineId: m.income_fc_line_id,
        ExpenseGrowthMethod: m.expense_growth_method || 'inflation',
        TaxRateOverride: m.tax_rate_override != null ? parseFloat(m.tax_rate_override) : null,
        IncomeTaxRateOverride: m.income_tax_rate_override != null ? parseFloat(m.income_tax_rate_override) : null,
        IncomeAmount: m.income_amount,
        IncomeStartDate: m.income_start_date,
        IncomeEndDate: m.income_end_date,
        ExpenseStartDate: m.expense_start_date,
        ExpenseEndDate: m.expense_end_date,
        BaseDate: m.base_date,
        BaseValue: m.base_value,
        MarketValue: m.market_value,
        BaseValueUSD: m.base_value_usd,
        MarketValueUSD: m.market_value_usd,
        GrowthRate: m.growth_rate,
        Growth: m.growth_rate,
        Comment: m.comment,
        IsMatched: m.is_matched,
        Matched: m.is_matched,
        SetupStatus: m.setup_status || 'new',
        IncomePct: (m.income_pct || []).map(r => ({
          Date: r.effective_date,
          Value: parseFloat(r.value) || 0,
        })),
        Invest: (m.investments || []).map(r => ({
          Date: r.investment_date,
          Amount: parseFloat(r.amount) || 0,
          Flag: r.flag || '',
          DateEnd: r.date_end || null,
        })),
        Dispose: (m.disposals || []).map(r => ({
          Date: r.disposal_date,
          Amount: parseFloat(r.amount) || 0,
          Flag: r.flag || '',
          DateEnd: r.date_end || null,
        })),
      },
    });
  } catch (error) {
    console.error('[forecast/modules/:id] Failed:', error);
    next(error);
  }
});

// POST /api/v2/forecast/modules
// Accepts PascalCase fields with embedded arrays (Invest, Dispose, IncomePct)
router.post('/modules', async (req, res, next) => {
  try {
    const body = req.body || {};
    assertModuleBody(body);
    const scenarioName = (body.Scenario || '').trim();

    if (!scenarioName) {
      return res.status(400).json({ error: 'Scenario is required' });
    }

    const scenario = await repo.findScenarioByName(scenarioName);
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    const accountId = await crud.lookupAccountByName(body.Account);

    const moduleData = {
      scenario_id: scenario.id,
      account_id: accountId,
      name: body.Name || '',
      module_type: body.Type || null,
      currency: body.Currency || 'USD',
      expense_amount: body.ExpenseAmount || 0,
      expense_fc_line_id: body.ExpenseFcLineId || null,
      income_fc_line_id: body.IncomeFcLineId || null,
      expense_growth_method: body.ExpenseGrowthMethod || 'inflation',
      income_amount: body.IncomeAmount || 0,
      income_tax_rate_override: body.IncomeTaxRateOverride ?? null,
      income_start_date: body.IncomeStartDate || null,
      income_end_date: body.IncomeEndDate || null,
      expense_start_date: body.ExpenseStartDate || null,
      expense_end_date: body.ExpenseEndDate || null,
      base_date: body.BaseDate || null,
      base_value: body.BaseValue ?? 0,
      market_value: body.MarketValue ?? 0,
      base_value_usd: body.BaseValueUSD ?? 0,
      market_value_usd: body.MarketValueUSD ?? 0,
      growth_rate: body.Growth ?? 0,
      comment: body.Comment || null,
      is_matched: Boolean(body.Matched),
    };

    const module = await repo.createModule(moduleData);

    // Handle embedded arrays
    if (Array.isArray(body.Invest)) {
      for (const inv of body.Invest) {
        if (inv.Date || inv.Amount !== undefined) {
          await repo.addInvestment(module.id, {
            investment_date: inv.Date,
            amount: inv.Amount,
            flag: inv.Flag || '',
            note: inv.Note || '',
            date_end: inv.DateEnd || null,
          });
        }
      }
    }

    if (Array.isArray(body.Dispose)) {
      for (const disp of body.Dispose) {
        if (disp.Date || disp.Amount !== undefined) {
          await repo.addDisposal(module.id, {
            disposal_date: disp.Date,
            amount: disp.Amount,
            flag: disp.Flag || '',
            note: disp.Note || '',
            date_end: disp.DateEnd || null,
          });
        }
      }
    }

    if (Array.isArray(body.IncomePct)) {
      for (const pct of body.IncomePct) {
        if (pct.Date) {
          await repo.setIncomePct(module.id, {
            effective_date: pct.Date,
            value: pct.Amount ?? pct.Value ?? 0,
          });
        }
      }
    }

    res.status(201).json({ data: module });
  } catch (error) {
    console.error('[forecast/modules POST] Failed:', error);
    next(error);
  }
});

// PUT /api/v2/forecast/modules/:id
// Accepts PascalCase fields with embedded arrays (Invest, Dispose, IncomePct)
router.put('/modules/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const body = req.body || {};
    assertModuleBody(body);

    // Build update data from PascalCase fields
    const updateData = {};

    if (body.Account !== undefined) {
      updateData.account_id = await crud.lookupAccountByName(body.Account);
    }
    if (body.Name !== undefined) updateData.name = body.Name;
    if (body.Type !== undefined) updateData.module_type = body.Type;
    if (body.Currency !== undefined) updateData.currency = body.Currency;
    if (body.ExpenseAmount !== undefined) updateData.expense_amount = body.ExpenseAmount;
    if (body.ExpenseFcLineId !== undefined) updateData.expense_fc_line_id = body.ExpenseFcLineId;
    if (body.IncomeFcLineId !== undefined) updateData.income_fc_line_id = body.IncomeFcLineId;
    if (body.ExpenseGrowthMethod !== undefined) updateData.expense_growth_method = body.ExpenseGrowthMethod;
    if (body.TaxRateOverride !== undefined) updateData.tax_rate_override = body.TaxRateOverride;
    if (body.IncomeTaxRateOverride !== undefined) updateData.income_tax_rate_override = body.IncomeTaxRateOverride;
    if (body.SetupStatus !== undefined) updateData.setup_status = body.SetupStatus;
    if (body.IncomeAmount !== undefined) updateData.income_amount = body.IncomeAmount;
    if (body.IncomeStartDate !== undefined) updateData.income_start_date = body.IncomeStartDate || null;
    if (body.IncomeEndDate !== undefined) updateData.income_end_date = body.IncomeEndDate || null;
    if (body.ExpenseStartDate !== undefined) updateData.expense_start_date = body.ExpenseStartDate || null;
    if (body.ExpenseEndDate !== undefined) updateData.expense_end_date = body.ExpenseEndDate || null;
    if (body.BaseDate !== undefined) updateData.base_date = body.BaseDate;
    if (body.BaseValue !== undefined) updateData.base_value = body.BaseValue;
    if (body.MarketValue !== undefined) updateData.market_value = body.MarketValue;
    if (body.BaseValueUSD !== undefined) updateData.base_value_usd = body.BaseValueUSD;
    if (body.MarketValueUSD !== undefined) updateData.market_value_usd = body.MarketValueUSD;
    if (body.Growth !== undefined) updateData.growth_rate = body.Growth;
    if (body.Comment !== undefined) updateData.comment = body.Comment;
    if (body.Matched !== undefined) updateData.is_matched = Boolean(body.Matched);
    // CR017: cash sweep is now a priority-ordered set (cash_sweep_priority); the legacy
    // cash_sweep_target boolean is kept in sync as "priority == 1" for back-compat.
    if (body.CashSweepPriority !== undefined) {
      const raw = body.CashSweepPriority;
      const pri = (raw === null || raw === '' || !(Number(raw) > 0)) ? null : parseInt(raw, 10);
      updateData.cash_sweep_priority = pri;
      updateData.cash_sweep_target = pri === 1;
    } else if (body.CashSweepTarget !== undefined) {
      // Bare target toggle (older callers) maps onto the priority model: on → 1, off → null
      const on = Boolean(body.CashSweepTarget);
      updateData.cash_sweep_target = on;
      updateData.cash_sweep_priority = on ? 1 : null;
    }

    // Keep priorities unique within a scenario: REJECT a rank already held by another
    // module (no silent eviction) and keep the legacy single-target flag unique to priority 1.
    if (updateData.cash_sweep_priority != null) {
      const existing = await repo.findModuleById(id);
      if (existing) {
        const clash = await crud.findCashSweepPriorityClash(existing.scenario_id, id, updateData.cash_sweep_priority);
        if (clash) {
          return res.status(409).json({
            error: `Cash sweep priority ${updateData.cash_sweep_priority} is already used by "${clash.name}". Pick a different rank, or clear that module's priority first.`,
          });
        }
        if (updateData.cash_sweep_priority === 1) {
          // Legacy flag stays unique to the primary (no DB-level eviction of a real priority)
          await crud.clearOtherCashSweepTargets(existing.scenario_id, id);
        }
      }
    }

    // Update module fields if any provided
    let module = null;
    if (Object.keys(updateData).length > 0) {
      module = await repo.updateModule(id, updateData);
      if (!module) {
        return res.status(404).json({ error: 'Module not found' });
      }
    } else {
      module = await repo.findModuleById(id);
      if (!module) {
        return res.status(404).json({ error: 'Module not found' });
      }
    }

    // Handle embedded arrays — replace all if provided. One transaction for
    // the whole replace: a failure mid-reinsert must not leave the module's
    // schedule wiped by the leading DELETEs (CR037 P5).
    if (Array.isArray(body.Invest) || Array.isArray(body.Dispose) || Array.isArray(body.IncomePct)) {
      await crud.replaceModuleSchedules(id, body);
    }

    const updated = await repo.findModuleById(id);
    res.json({ data: updated });
  } catch (error) {
    console.error('[forecast/modules PUT] Failed:', error);
    next(error);
  }
});

// DELETE /api/v2/forecast/modules/:id
router.delete('/modules/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const deleted = await repo.deleteModule(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Module not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[forecast/modules DELETE] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Seed from Actuals / Budget
// ============================================================================

// POST /api/v2/forecast/modules/add-from-actuals
// Returns BS account tree with year-end balances for creating new modules.
// Excludes Bank Accounts subtree and accounts already used as modules in the scenario.
router.post('/modules/add-from-actuals', async (req, res, next) => {
  try {
    const { scenario, baseYear } = req.query;
    if (!scenario || !baseYear) {
      return res.status(400).json({ error: 'Missing required query params: scenario, baseYear' });
    }

    const scenarioRow = await repo.findScenarioByName(scenario);
    if (!scenarioRow) {
      return res.status(404).json({ error: `Scenario "${scenario}" not found` });
    }

    const payload = await crud.buildAddFromActualsTree(scenarioRow.id, baseYear);
    res.json(payload);
  } catch (error) {
    console.error('[forecast/modules/add-from-actuals] Failed:', error);
    next(error);
  }
});

// PATCH /api/v2/forecast/modules/bulk-update
// Accepts array of module updates: [{ id, base_value, base_value_usd, market_value, market_value_usd, base_date }]
router.patch('/modules/bulk-update', async (req, res, next) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Missing or empty updates array' });
    }

    const results = [];
    for (const update of updates) {
      if (!update.id) continue;
      const fields = {};
      if (update.base_value !== undefined) fields.base_value = update.base_value;
      if (update.base_value_usd !== undefined) fields.base_value_usd = update.base_value_usd;
      if (update.market_value !== undefined) fields.market_value = update.market_value;
      if (update.market_value_usd !== undefined) fields.market_value_usd = update.market_value_usd;
      if (update.base_date !== undefined) fields.base_date = update.base_date;

      if (Object.keys(fields).length > 0) {
        const updated = await repo.updateModule(update.id, fields);
        results.push({ id: update.id, success: !!updated });
      }
    }

    res.json({ data: results, updated: results.filter(r => r.success).length });
  } catch (error) {
    console.error('[forecast/modules/bulk-update] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Income/Expense Items
// ============================================================================

// GET /api/v2/forecast/incomeexpense
router.get('/incomeexpense', async (req, res, next) => {
  try {
    const scenarioName = req.query.scenario?.trim();
    if (!scenarioName) {
      return res.json({ entries: [] });
    }

    const scenario = await repo.findScenarioByName(scenarioName);
    if (!scenario) {
      return res.json({ entries: [] });
    }

    const items = await repo.findIncExpByScenario(scenario.id);

    // Transform to PascalCase for frontend
    const transformed = items.map((item) => ({
      ...item,
      id: item.id,
      Scenario: scenarioName,
      Name: item.name,
      Account: item.account_name,
      Type: item.item_type ? item.item_type.charAt(0).toUpperCase() + item.item_type.slice(1) : '',
      Currency: item.currency,
      BaseDate: item.base_date,
      BaseValue: item.base_value,
      BaseValueUSD: item.base_value_usd,
      Growth: item.growth_rate,
      Comment: item.comment,
      Matched: item.is_matched,
      FcLineId: item.fc_line_id || null,
      FcLineName: item.fc_line_name || null,
      SetupStatus: item.setup_status || 'new',
      Changes: item.changes || [],
    }));

    res.json({ entries: transformed });
  } catch (error) {
    console.error('[forecast/incomeexpense] Failed:', error);
    next(error);
  }
});

// POST /api/v2/forecast/incomeexpense
router.post('/incomeexpense', async (req, res, next) => {
  try {
    const body = req.body || {};
    assertIncExpBody(body);
    const scenarioName = (body.Scenario || '').trim();

    if (!scenarioName) {
      return res.status(400).json({ error: 'Scenario is required' });
    }

    const scenario = await repo.findScenarioByName(scenarioName);
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    let accountId = null;
    if (body.Account) {
      accountId = await crud.lookupAccountByName(body.Account);
    }

    // If created from FC Line and no account specified, resolve from the line
    // (name-match first, then any account assigned to the line).
    if (!accountId && body.FcLineId) {
      accountId = await crud.resolveIncExpAccountFromFcLine(body.FcLineId);
    }

    const itemData = {
      scenario_id: scenario.id,
      account_id: accountId,
      name: body.Name || 'All',
      item_type: body.Type || '',
      currency: body.Currency || 'USD',
      base_date: body.BaseDate || null,
      base_value: body.BaseValue ?? 0,
      base_value_usd: body.BaseValueUSD ?? 0,
      growth_rate: body.Growth ?? 1,
      comment: body.Comment || '',
      is_matched: Boolean(body.Matched),
      fc_line_id: body.FcLineId || null,
      budget_source_year: body.BudgetSourceYear || null,
    };

    const item = await repo.createIncExp(itemData);

    // Add changes if provided
    if (Array.isArray(body.Changes) && body.Changes.length > 0) {
      for (const change of body.Changes) {
        if (change.Date || change.Amount !== undefined) {
          await repo.addIncExpChange(item.id, {
            change_date: change.Date,
            amount: change.Amount,
            flag: change.Flag || '',
          });
        }
      }
    }

    res.status(201).json({ data: item });
  } catch (error) {
    console.error('[forecast/incomeexpense POST] Failed:', error);
    next(error);
  }
});

// PUT /api/v2/forecast/incomeexpense/:id
router.put('/incomeexpense/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const body = req.body || {};
    assertIncExpBody(body);

    let accountId = undefined;
    if (body.Account !== undefined) {
      accountId = body.Account ? await crud.lookupAccountByName(body.Account) : null;
    }

    const updateData = {};
    if (accountId !== undefined) updateData.account_id = accountId;
    if (body.Name !== undefined) updateData.name = body.Name;
    if (body.Type !== undefined) updateData.item_type = body.Type;
    if (body.Currency !== undefined) updateData.currency = body.Currency;
    if (body.BaseDate !== undefined) updateData.base_date = body.BaseDate;
    if (body.BaseValue !== undefined) updateData.base_value = body.BaseValue;
    if (body.BaseValueUSD !== undefined) updateData.base_value_usd = body.BaseValueUSD;
    if (body.Growth !== undefined) updateData.growth_rate = body.Growth;
    if (body.Comment !== undefined) updateData.comment = body.Comment;
    if (body.Matched !== undefined) updateData.is_matched = Boolean(body.Matched);
    if (body.SetupStatus !== undefined) updateData.setup_status = body.SetupStatus;

    let item;
    if (Object.keys(updateData).length > 0) {
      item = await repo.updateIncExp(id, updateData);
      if (!item) {
        return res.status(404).json({ error: 'Income/Expense item not found' });
      }
    } else {
      // No main fields to update — verify the item exists
      item = await repo.findIncExpById(id);
      if (!item) {
        return res.status(404).json({ error: 'Income/Expense item not found' });
      }
    }

    // Handle changes — replace all if provided
    if (Array.isArray(body.Changes)) {
      await crud.replaceIncExpChanges(id, body.Changes);
    }

    res.json({ data: item });
  } catch (error) {
    console.error('[forecast/incomeexpense PUT] Failed:', error);
    next(error);
  }
});

// DELETE /api/v2/forecast/incomeexpense/:id
router.delete('/incomeexpense/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const deleted = await repo.deleteIncExp(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Income/Expense item not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[forecast/incomeexpense DELETE] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Forecast Entries & Generation
// ============================================================================

// GET /api/v2/forecast/entries
router.get('/entries', async (req, res, next) => {
  try {
    const scenarioName = req.query.scenario?.trim();
    const entries = await repo.findAllEntries(scenarioName);
    res.json({ entries });
  } catch (error) {
    console.error('[forecast/entries] Failed:', error);
    next(error);
  }
});

// POST /api/v2/forecast/generate/:scenario
// GET /api/v2/forecast/base-year-values
// Returns base year P&L values from completed modules and expenses, grouped by FC Line name
router.get('/base-year-values', async (req, res, next) => {
  try {
    const scenarioName = req.query.scenario?.trim();
    if (!scenarioName) return res.status(400).json({ error: 'scenario is required' });

    const scenario = await repo.findScenarioByName(scenarioName);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    // The base year is PeriodStart - 1, and PeriodStart lives in the assumptions doc, not
    // on the scenarios table. It is needed so a stream whose CR046 window has not opened
    // yet is left out of the base-year column (rent starting in 2028 is not 2026 income).
    let baseYear = null;
    try {
      const doc = await assumpRepo.getDoc();
      const entry = (doc?.scenarios || []).find((sc) => sc.Name === scenarioName);
      const periodStart = Number(entry?.PeriodStart);
      if (Number.isFinite(periodStart)) baseYear = periodStart - 1;
    } catch {
      // Fall back to no window filter rather than failing the whole request.
    }

    const values = await crud.getBaseYearValues(scenario.id, baseYear);
    res.json({ data: values });
  } catch (error) {
    console.error('[forecast/base-year-values] Failed:', error);
    next(error);
  }
});

router.post('/generate/:scenario', async (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();
    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    const result = await generateForecast(scenario);

    if (result.success) {
      res.json({
        message: 'Forecast generation completed',
        scenario: result.scenario,
        deletedCount: result.deletedCount,
        modulesProcessed: result.modulesProcessed,
        entriesCreated: result.entriesCreated,
        durationMs: result.durationMs,
      });
    } else {
      res.status(500).json({
        error: 'Forecast generation failed',
        details: result.error,
        scenario: result.scenario,
        durationMs: result.durationMs,
      });
    }
  } catch (error) {
    console.error('[forecast/generate] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Audit Trail (file-based)
// ============================================================================

// GET /api/v2/forecast/audittrail/:scenario/cash-sweep
// Returns the cash sweep audit trail CSV for a scenario
// NOTE: Must be before /:scenario/:module to avoid wildcard match
router.get('/audittrail/:scenario/cash-sweep', (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();

    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    const safeScenario = (scenario || '').replace(/[^a-z0-9]/gi, '_');
    const auditDir = PATHS.AUDIT_TRAIL_DIR;
    const filePath = path.join(auditDir, `${safeScenario}_cash_sweep.csv`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'No cash sweep audit trail found. Generate the forecast with a cash target and sweep module first.' });
    }

    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length === 0) {
      return res.json({ headers: [], rows: [], lastModified: stat.mtime });
    }
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => line.split(',').map(v => v.trim()));

    res.json({ headers, rows, lastModified: stat.mtime, scenario });
  } catch (error) {
    console.error('[forecast/audittrail/cash-sweep] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/audittrail/:scenario/:module
router.get('/audittrail/:scenario/:module', (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();
    const moduleName = req.params.module?.trim();

    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }
    if (!moduleName) {
      return res.status(400).json({ error: 'Module name is required' });
    }

    // Must match the writers exactly (fcbuilder-module/-incexp): non-alphanumerics
    // → '_', case preserved, repeats NOT collapsed. The old `normalize` here
    // lowercased and collapsed '_+', so it could never match a real file — and it
    // read from a `dataPaths.fcAuditTrail`/`.baseDir` that does not exist, so
    // path.join(undefined) threw "The 'path' argument must be of type string".
    const sanitize = (v) => (v || '').replace(/[^a-z0-9]/gi, '_');

    const safeScenario = sanitize(scenario);
    const safeModule = sanitize(moduleName);

    // `_cash_sweep` is a SYNTHETIC module: the engine attributes swept cash to it, so it
    // shows up as a clickable module in the Review breakdown — but its trail is written
    // by the sweep, to `<scenario>_cash_sweep.csv`, not `<scenario>_<module>_entries.csv`.
    // Clicking it therefore 404'd. Serve the sweep's file here (in this route's row-object
    // shape, which is what the audit-trail modal renders) rather than leaving the one
    // module in the breakdown that cannot be opened.
    const isCashSweep = /^_?cash_sweep$/i.test(safeModule);
    const fileName = isCashSweep
      ? `${safeScenario}_cash_sweep.csv`
      : `${safeScenario}_${safeModule}_entries.csv`;
    const auditDir = PATHS.AUDIT_TRAIL_DIR;
    const filePath = path.join(auditDir, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audit trail not found' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return res.json({ headers: [], rows: [] });
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const values = line.split(',');
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i]?.trim() || ''; });
      return row;
    });

    res.json({ headers, rows });
  } catch (error) {
    console.error('[forecast/audittrail] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/audittrail/:scenario/:module/detail
// Returns LC, USD, and entries audit trail CSVs for a BS module
router.get('/audittrail/:scenario/:module/detail', (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();
    const moduleName = req.params.module?.trim();

    if (!scenario || !moduleName) {
      return res.status(400).json({ error: 'Scenario and module name are required' });
    }

    const sanitize = (v) => (v || '').replace(/[^a-z0-9]/gi, '_');
    const safeScenario = sanitize(scenario);
    const safeModule = sanitize(moduleName);
    const auditDir = PATHS.AUDIT_TRAIL_DIR;

    const parseCsv = (filePath) => {
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length === 0) return { headers: [], rows: [], lastModified: stat.mtime };
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1).map(line => line.split(',').map(v => v.trim()));
      return { headers, rows, lastModified: stat.mtime };
    };

    const lc = parseCsv(path.join(auditDir, `${safeScenario}_${safeModule}_LC.csv`));
    const usd = parseCsv(path.join(auditDir, `${safeScenario}_${safeModule}_USD.csv`));
    const entries = parseCsv(path.join(auditDir, `${safeScenario}_${safeModule}_entries.csv`));

    if (!lc && !usd && !entries) {
      return res.status(404).json({ error: 'No audit trail found. Generate the forecast first.' });
    }

    res.json({ lc, usd, entries, scenario, module: moduleName });
  } catch (error) {
    console.error('[forecast/audittrail/detail] Failed:', error);
    next(error);
  }
});

// DELETE /api/v2/forecast/audittrail/:scenario
router.delete('/audittrail/:scenario', (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();

    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    // Same writer-consistent sanitize as the GET routes (see note above); the old
    // `normalize` + `dataPaths.baseDir` here had the identical two bugs.
    const sanitize = (v) => (v || '').replace(/[^a-z0-9]/gi, '_');

    const prefix = (sanitize(scenario) + '_').toLowerCase();
    const auditDir = PATHS.AUDIT_TRAIL_DIR;

    if (!fs.existsSync(auditDir)) {
      return res.json({ success: true, deletedCount: 0 });
    }

    const files = fs.readdirSync(auditDir);
    let deletedCount = 0;

    for (const file of files) {
      if (file.toLowerCase().startsWith(prefix)) {
        fs.unlinkSync(path.join(auditDir, file));
        deletedCount++;
      }
    }

    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('[forecast/audittrail DELETE] Failed:', error);
    next(error);
  }
});

module.exports = router;
