/**
 * Forecast Routes
 *
 * Scenarios, modules, income/expense items, forecast generation,
 * and assumptions management.
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').forecast;
const accountsRepo = require('../repositories').accounts;

// ============================================================================
// Helpers
// ============================================================================

async function lookupAccountByName(name) {
  if (!name) return null;
  const db = require('../db');
  const result = await db.query('SELECT id FROM accounts WHERE name = $1 LIMIT 1', [name]);
  return result.rows[0]?.id || null;
}

// ============================================================================
// Assumptions (PostgreSQL scenarios + file-based inflation/FX/tax)
// ============================================================================

// GET /api/v2/forecast/assumptions
router.get('/assumptions', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    // Get scenarios from PostgreSQL
    const scenarios = await repo.findAllScenarios({ activeOnly: false });

    // Read other assumptions (inflation, FX, tax rates) from file
    let fileAssumptions = {};
    try {
      const fcAssumpPath = dataPaths.fcAssump;
      if (fs.existsSync(fcAssumpPath)) {
        const content = fs.readFileSync(fcAssumpPath, 'utf8');
        fileAssumptions = JSON.parse(content);
      }
    } catch (readErr) {
      console.warn('[forecast/assumptions] Could not read FCAssump.json:', readErr.message);
    }

    // Build a lookup from file scenarios to merge PeriodStart/PeriodEnd into DB scenarios
    const fileScenarioMap = {};
    for (const fsc of (fileAssumptions.scenarios || [])) {
      if (fsc.Name) fileScenarioMap[fsc.Name] = fsc;
    }

    const scenariosFormatted = scenarios.map((s) => ({
      Name: s.name,
      Description: s.description,
      IsActive: s.is_active,
      id: s.id,
      ...(fileScenarioMap[s.name]?.PeriodStart != null && { PeriodStart: fileScenarioMap[s.name].PeriodStart }),
      ...(fileScenarioMap[s.name]?.PeriodEnd != null && { PeriodEnd: fileScenarioMap[s.name].PeriodEnd }),
    }));

    res.json({
      ...fileAssumptions,
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
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');
    const body = req.body || {};

    // Read existing file
    const fcAssumpPath = dataPaths.fcAssump;
    let existing = {};
    try {
      if (fs.existsSync(fcAssumpPath)) {
        existing = JSON.parse(fs.readFileSync(fcAssumpPath, 'utf8'));
      }
    } catch (readErr) {
      console.warn('[forecast/assumptions PUT] Could not read existing file:', readErr.message);
    }

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

    // Save to file — keep scenarios with PeriodStart/PeriodEnd (needed by forecast engine)
    // but sync name/description/active status to PostgreSQL above
    const merged = { ...existing, ...body };

    // Preserve scenarios in file — they carry PeriodStart/PeriodEnd which the engine needs
    // If body included scenarios, those are already saved; if not, keep existing
    if (Array.isArray(body.scenarios)) {
      merged.scenarios = body.scenarios;
    } else if (Array.isArray(existing.scenarios)) {
      merged.scenarios = existing.scenarios;
    }

    fs.writeFileSync(fcAssumpPath, JSON.stringify(merged, null, 2), 'utf8');

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
      const db = require('../db');
      const asOfDate = `${baseYear}-12-31`;

      // Get year-end balances for all accounts
      const balances = await db.query(`
        SELECT a.id as account_id, a.name,
          SUM(CASE WHEN t.currency = 'USD' THEN t.base_amount ELSE 0 END) as balance_usd,
          SUM(t.base_amount) as balance_lc
        FROM transactions t
        JOIN accounts a ON t.account_id = a.id
        WHERE t.transaction_date <= $1
        GROUP BY a.id, a.name
      `, [asOfDate]);

      const balMap = {};
      for (const b of balances.rows) {
        balMap[b.account_id] = {
          balance_usd: parseFloat(b.balance_usd) || 0,
          balance_lc: parseFloat(b.balance_lc) || 0,
        };
      }

      // Update each module in the new scenario
      const modules = await db.query(
        'SELECT id, account_id FROM forecast_modules WHERE scenario_id = $1',
        [newScenario.id]
      );

      let updated = 0;
      for (const mod of modules.rows) {
        const bal = balMap[mod.account_id];
        if (bal) {
          await db.query(`
            UPDATE forecast_modules
            SET base_value = $1, base_value_usd = $2, market_value = $1, market_value_usd = $2,
                base_date = $3, updated_at = NOW()
            WHERE id = $4
          `, [bal.balance_lc, bal.balance_usd, `${baseYear}-12-31`, mod.id]);
          updated++;
        }
      }
      console.log(`[copy] Updated ${updated}/${modules.rows.length} modules with ${baseYear} actuals`);
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
      const db = require('../db');
      const result = await db.query(`
        SELECT m.*, a.name as account_name, s.name as scenario_name
        FROM forecast_modules m
        LEFT JOIN accounts a ON m.account_id = a.id
        LEFT JOIN forecast_scenarios s ON m.scenario_id = s.id
        ORDER BY s.name, m.module_type, m.name
      `);
      modules = result.rows;
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
      IncomeAmount: m.income_amount,
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
        IncomeAmount: m.income_amount,
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
    const scenarioName = (body.Scenario || '').trim();

    if (!scenarioName) {
      return res.status(400).json({ error: 'Scenario is required' });
    }

    const scenario = await repo.findScenarioByName(scenarioName);
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    const accountId = await lookupAccountByName(body.Account);

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
    const db = require('../db');

    // Build update data from PascalCase fields
    const updateData = {};

    if (body.Account !== undefined) {
      updateData.account_id = await lookupAccountByName(body.Account);
    }
    if (body.Name !== undefined) updateData.name = body.Name;
    if (body.Type !== undefined) updateData.module_type = body.Type;
    if (body.Currency !== undefined) updateData.currency = body.Currency;
    if (body.ExpenseAmount !== undefined) updateData.expense_amount = body.ExpenseAmount;
    if (body.ExpenseFcLineId !== undefined) updateData.expense_fc_line_id = body.ExpenseFcLineId;
    if (body.IncomeFcLineId !== undefined) updateData.income_fc_line_id = body.IncomeFcLineId;
    if (body.ExpenseGrowthMethod !== undefined) updateData.expense_growth_method = body.ExpenseGrowthMethod;
    if (body.TaxRateOverride !== undefined) updateData.tax_rate_override = body.TaxRateOverride;
    if (body.SetupStatus !== undefined) updateData.setup_status = body.SetupStatus;
    if (body.IncomeAmount !== undefined) updateData.income_amount = body.IncomeAmount;
    if (body.BaseDate !== undefined) updateData.base_date = body.BaseDate;
    if (body.BaseValue !== undefined) updateData.base_value = body.BaseValue;
    if (body.MarketValue !== undefined) updateData.market_value = body.MarketValue;
    if (body.BaseValueUSD !== undefined) updateData.base_value_usd = body.BaseValueUSD;
    if (body.MarketValueUSD !== undefined) updateData.market_value_usd = body.MarketValueUSD;
    if (body.Growth !== undefined) updateData.growth_rate = body.Growth;
    if (body.Comment !== undefined) updateData.comment = body.Comment;
    if (body.Matched !== undefined) updateData.is_matched = Boolean(body.Matched);
    if (body.CashSweepTarget !== undefined) updateData.cash_sweep_target = Boolean(body.CashSweepTarget);

    // If setting cash_sweep_target = true, clear it from other modules in the same scenario first
    if (updateData.cash_sweep_target === true) {
      const existing = await repo.findModuleById(id);
      if (existing) {
        await db.query(
          'UPDATE forecast_modules SET cash_sweep_target = FALSE WHERE scenario_id = $1 AND id != $2 AND cash_sweep_target = TRUE',
          [existing.scenario_id, id]
        );
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

    // Handle embedded arrays — replace all if provided
    if (Array.isArray(body.Invest)) {
      await db.query('DELETE FROM forecast_module_investments WHERE module_id = $1', [id]);
      for (const inv of body.Invest) {
        if (inv.Date || inv.Amount !== undefined) {
          await repo.addInvestment(id, {
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
      await db.query('DELETE FROM forecast_module_disposals WHERE module_id = $1', [id]);
      for (const disp of body.Dispose) {
        if (disp.Date || disp.Amount !== undefined) {
          await repo.addDisposal(id, {
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
      await db.query('DELETE FROM forecast_module_income_pct WHERE module_id = $1', [id]);
      for (const pct of body.IncomePct) {
        if (pct.Date) {
          await repo.setIncomePct(id, {
            effective_date: pct.Date,
            value: pct.Amount ?? pct.Value ?? 0,
          });
        }
      }
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
    const db = require('../db');
    const { scenario, baseYear } = req.query;
    if (!scenario || !baseYear) {
      return res.status(400).json({ error: 'Missing required query params: scenario, baseYear' });
    }

    const asOfDate = `${baseYear}-12-31`;

    const scenarioRow = await repo.findScenarioByName(scenario);
    if (!scenarioRow) {
      return res.status(404).json({ error: `Scenario "${scenario}" not found` });
    }

    // Get account IDs already used as modules in this scenario
    const existingResult = await db.query(
      `SELECT account_id FROM forecast_modules WHERE scenario_id = $1 AND account_id IS NOT NULL`,
      [scenarioRow.id]
    );
    const existingAccountIds = new Set(existingResult.rows.map(r => r.account_id));

    // Get full BS account tree, excluding Bank Accounts subtree
    const treeResult = await db.query(`
      WITH RECURSIVE tree AS (
        SELECT id, name, parent_id, currency, account_type, is_active,
               ARRAY[id] as path, 0 as depth
        FROM accounts
        WHERE section = 'balance_sheet' AND parent_id IS NULL
        UNION ALL
        SELECT a.id, a.name, a.parent_id, a.currency, a.account_type, a.is_active,
               t.path || a.id, t.depth + 1
        FROM accounts a
        JOIN tree t ON a.parent_id = t.id
        WHERE a.name != 'Bank Accounts'
      )
      SELECT id, name, parent_id, currency, account_type, depth
      FROM tree
      WHERE is_active = TRUE AND name != 'Bank Accounts'
      ORDER BY path
    `);

    const accounts = treeResult.rows;
    const accountIds = accounts.map(a => a.id);

    // Get closing balances for all BS accounts as of the base year
    const balancesResult = await db.query(`
      SELECT DISTINCT ON (account_id)
        account_id, closing_balance, currency
      FROM transactions
      WHERE transaction_date <= $1
        AND closing_balance IS NOT NULL
        AND account_id = ANY($2)
      ORDER BY account_id, transaction_date DESC, id DESC
    `, [asOfDate, accountIds]);

    // Get FX rates for conversion
    const currencies = new Set();
    for (const row of balancesResult.rows) {
      if (row.currency && row.currency !== 'USD') currencies.add(row.currency);
    }
    for (const acc of accounts) {
      if (acc.currency && acc.currency !== 'USD') currencies.add(acc.currency);
    }

    const fxRates = { USD: 1 };
    if (currencies.size > 0) {
      const ratesResult = await db.query(`
        SELECT DISTINCT ON (from_currency)
          from_currency, rate
        FROM exchange_rates
        WHERE from_currency = ANY($1) AND to_currency = 'USD'
        ORDER BY from_currency, ABS(rate_date - $2::date) ASC
      `, [Array.from(currencies), asOfDate]);
      for (const row of ratesResult.rows) {
        const rate = parseFloat(row.rate);
        if (rate > 0) fxRates[row.from_currency] = 1 / rate;
      }
    }

    // Build leaf balance map
    const leafBalanceMap = {};
    for (const row of balancesResult.rows) {
      leafBalanceMap[row.account_id] = {
        balance_lc: parseFloat(row.closing_balance) || 0,
        currency: row.currency || 'USD',
      };
    }

    // Build parent → children map for aggregation
    const childrenMap = {};
    for (const acc of accounts) {
      if (acc.parent_id) {
        if (!childrenMap[acc.parent_id]) childrenMap[acc.parent_id] = [];
        childrenMap[acc.parent_id].push(acc.id);
      }
    }

    // Recursive function to compute aggregated balance (sum of all descendants)
    const aggregatedCache = {};
    function getAggregatedBalance(accountId) {
      if (aggregatedCache[accountId] !== undefined) return aggregatedCache[accountId];

      let totalLc = 0;
      let totalUsd = 0;
      const children = childrenMap[accountId] || [];

      if (children.length === 0) {
        // Leaf node — use its own balance
        const lb = leafBalanceMap[accountId];
        if (lb) {
          totalLc = lb.balance_lc;
          const fxRate = fxRates[lb.currency] || 1;
          totalUsd = lb.balance_lc / fxRate;
        }
      } else {
        // Parent node — sum children
        for (const childId of children) {
          const childBal = getAggregatedBalance(childId);
          totalUsd += childBal.balance_usd;
          // For parent nodes, LC is mixed currencies so we only track USD
          totalLc += childBal.balance_lc;
        }
      }

      aggregatedCache[accountId] = { balance_lc: totalLc, balance_usd: totalUsd };
      return aggregatedCache[accountId];
    }

    // Build tree response
    const accountMap = {};
    for (const acc of accounts) {
      const bal = getAggregatedBalance(acc.id);
      const leafBal = leafBalanceMap[acc.id];
      const isLeaf = !childrenMap[acc.id] || childrenMap[acc.id].length === 0;
      const hasBalance = Math.abs(bal.balance_usd) > 0.01;

      accountMap[acc.id] = {
        account_id: acc.id,
        account_name: acc.name,
        parent_id: acc.parent_id,
        currency: acc.currency,
        account_type: acc.account_type,
        depth: acc.depth,
        is_leaf: isLeaf,
        balance_lc: isLeaf && leafBal ? leafBal.balance_lc : bal.balance_lc,
        balance_usd: bal.balance_usd,
        has_balance: hasBalance,
        already_added: existingAccountIds.has(acc.id),
        children: [],
      };
    }

    // Nest children under parents
    const roots = [];
    for (const acc of accounts) {
      const node = accountMap[acc.id];
      if (acc.parent_id && accountMap[acc.parent_id]) {
        accountMap[acc.parent_id].children.push(node);
      } else {
        roots.push(node);
      }
    }

    res.json({
      data: roots,
      baseYear: Number(baseYear),
      asOfDate,
      fxRates,
      summary: {
        total_accounts: accounts.length,
        with_balance: accounts.filter(a => Math.abs(getAggregatedBalance(a.id).balance_usd) > 0.01).length,
        already_added: existingAccountIds.size,
      },
    });
  } catch (error) {
    console.error('[forecast/modules/add-from-actuals] Failed:', error);
    next(error);
  }
});

// PATCH /api/v2/forecast/modules/bulk-update
// Accepts array of module updates: [{ id, base_value, base_value_usd, market_value, market_value_usd, base_date }]
router.patch('/modules/bulk-update', async (req, res, next) => {
  try {
    const db = require('../db');
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
      accountId = await lookupAccountByName(body.Account);
    }

    // If created from FC Line and no account specified, resolve from line's categories
    // Find common parent P&L account for all categories in the line
    if (!accountId && body.FcLineId) {
      const db = require('../db');
      // Try to find an account whose name matches the FC Line name (most common case)
      const fcLineResult = await db.query('SELECT name FROM fc_lines WHERE id = $1', [body.FcLineId]);
      if (fcLineResult.rows.length > 0) {
        const matchingAccount = await db.query(
          'SELECT id FROM accounts WHERE name = $1 AND section = $2 LIMIT 1',
          [fcLineResult.rows[0].name, 'profit_loss']
        );
        if (matchingAccount.rows.length > 0) {
          accountId = matchingAccount.rows[0].id;
        }
      }
      // Fallback: use first category's mapped_account_id
      if (!accountId) {
        const lineAccount = await db.query(`
          SELECT DISTINCT c.mapped_account_id
          FROM fc_line_categories flc
          JOIN categories c ON flc.category_id = c.id
          WHERE flc.fc_line_id = $1 AND c.mapped_account_id IS NOT NULL
          LIMIT 1
        `, [body.FcLineId]);
        if (lineAccount.rows.length > 0) {
          accountId = lineAccount.rows[0].mapped_account_id;
        }
      }
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

    let accountId = undefined;
    if (body.Account !== undefined) {
      accountId = body.Account ? await lookupAccountByName(body.Account) : null;
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
      const db = require('../db');
      await db.query('DELETE FROM forecast_incexp_changes WHERE incexp_id = $1', [id]);
      for (const change of body.Changes) {
        if (change.Date || change.Amount !== undefined) {
          await repo.addIncExpChange(id, {
            change_date: change.Date,
            amount: change.Amount,
            flag: change.Flag || '',
          });
        }
      }
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

    const db = require('../db');

    // Get income/expense amounts from BS modules (by FC Line name)
    const bsResult = await db.query(`
      SELECT
        COALESCE(exp_line.name, 'Unassigned Expense') as label,
        'expense' as type,
        SUM(CASE WHEN m.expense_amount IS NOT NULL AND m.expense_amount != 0
            THEN -m.expense_amount ELSE 0 END) as amount
      FROM forecast_modules m
      LEFT JOIN fc_lines exp_line ON m.expense_fc_line_id = exp_line.id
      WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
        AND m.expense_fc_line_id IS NOT NULL
      GROUP BY exp_line.name
      UNION ALL
      SELECT
        COALESCE(inc_line.name, 'Unassigned Income') as label,
        'income' as type,
        SUM(COALESCE(m.income_amount, 0)) as amount
      FROM forecast_modules m
      LEFT JOIN fc_lines inc_line ON m.income_fc_line_id = inc_line.id
      WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
        AND m.income_fc_line_id IS NOT NULL
      GROUP BY inc_line.name
    `, [scenario.id]);

    // Get base values from IncExp items (by FC Line name or item name)
    const incexpResult = await db.query(`
      SELECT
        COALESCE(fl.name, ie.name) as label,
        ie.base_value as amount
      FROM forecast_income_expense ie
      LEFT JOIN fc_lines fl ON ie.fc_line_id = fl.id
      WHERE ie.scenario_id = $1 AND COALESCE(ie.setup_status, 'new') NOT IN ('new', 'exclude')
    `, [scenario.id]);

    const values = {};
    for (const row of bsResult.rows) {
      const amt = parseFloat(row.amount) || 0;
      if (amt !== 0) values[row.label] = (values[row.label] || 0) + amt;
    }
    for (const row of incexpResult.rows) {
      const amt = parseFloat(row.amount) || 0;
      if (amt !== 0) values[row.label] = (values[row.label] || 0) + amt;
    }

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

    const { generateForecast } = require('../../services/forecast');
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
    const fs = require('fs');
    const path = require('path');
    const { PATHS } = require('../../services/forecast/constants');
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
    const fs = require('fs');
    const path = require('path');
    const { dataPaths } = require('../../utils/dataPaths');
    const scenario = req.params.scenario?.trim();
    const moduleName = req.params.module?.trim();

    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }
    if (!moduleName) {
      return res.status(400).json({ error: 'Module name is required' });
    }

    const normalize = (value = '') =>
      value.toString().trim().replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').toLowerCase();

    const normalizedScenario = normalize(scenario);
    const normalizedModule = normalize(moduleName);
    const fileName = `${normalizedScenario}_${normalizedModule}_entries.csv`;
    const auditDir = dataPaths.fcAuditTrail || path.join(dataPaths.baseDir, 'reports', 'fc_audit_trail');
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
    const fs = require('fs');
    const path = require('path');
    const { PATHS } = require('../../services/forecast/constants');
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
    const fs = require('fs');
    const path = require('path');
    const { dataPaths } = require('../../utils/dataPaths');
    const scenario = req.params.scenario?.trim();

    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    const normalize = (value = '') =>
      value.toString().trim().replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').toLowerCase();

    const normalizedScenario = normalize(scenario);
    const auditDir = dataPaths.fcAuditTrail || path.join(dataPaths.baseDir, 'reports', 'fc_audit_trail');

    if (!fs.existsSync(auditDir)) {
      return res.json({ success: true, deletedCount: 0 });
    }

    const files = fs.readdirSync(auditDir);
    let deletedCount = 0;

    for (const file of files) {
      if (file.toLowerCase().startsWith(normalizedScenario + '_')) {
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
