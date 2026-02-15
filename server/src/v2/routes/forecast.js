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

    const scenariosFormatted = scenarios.map((s) => ({
      Name: s.name,
      Description: s.description,
      IsActive: s.is_active,
      id: s.id,
    }));

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

    // Save non-scenario data (inflation, FX, tax rates) to file
    const merged = { ...existing, ...body };
    delete merged.scenarios;

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
      Type: m.module_type,
      Currency: m.currency,
      ExpenseCategory: m.expense_category,
      ExpenseAmount: m.expense_amount,
      ExpensePct: m.expense_pct,
      IncomeCategory: m.income_category,
      IncomeAmount: m.income_amount,
      BaseDate: m.base_date,
      BaseValue: m.base_value,
      MarketValue: m.market_value,
      BaseValueUSD: m.base_value_usd,
      MarketValueUSD: m.market_value_usd,
      GrowthRate: m.growth_rate,
      Comment: m.comment,
      IsMatched: m.is_matched,
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

    // Extract all leaf accounts with their parent category
    const allAccounts = [];
    const collectLeaves = (nodes, category) => {
      for (const node of nodes) {
        if (!node || !node.name) continue;
        if (!node.children || node.children.length === 0) {
          const isBankAccount = typeof category === 'string' &&
            category.toLowerCase().includes('bank account');
          allAccounts.push({ name: node.name, category, isBankAccount });
        } else {
          collectLeaves(node.children, node.name);
        }
      }
    };
    collectLeaves(structure, null);

    // Get matched names for the scenario
    let matchedNames = new Set();
    if (scenarioName) {
      const scenario = await repo.findScenarioByName(scenarioName);
      if (scenario) {
        matchedNames = await repo.findMatchedModuleNames(scenario.id);
      }
    }

    const unmatched = allAccounts.filter(account =>
      !account.isBankAccount && !matchedNames.has(account.name)
    );

    res.json(unmatched);
  } catch (error) {
    console.error('[forecast/modules/unmatched] Failed:', error);
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
      expense_category: body.ExpCategory || null,
      expense_amount: body.ExpenseAmount || 0,
      expense_pct: body.ExpensePct || 0,
      income_category: body.IncomeCategory || null,
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
    if (body.ExpCategory !== undefined) updateData.expense_category = body.ExpCategory;
    if (body.ExpenseAmount !== undefined) updateData.expense_amount = body.ExpenseAmount;
    if (body.ExpensePct !== undefined) updateData.expense_pct = body.ExpensePct;
    if (body.IncomeCategory !== undefined) updateData.income_category = body.IncomeCategory;
    if (body.IncomeAmount !== undefined) updateData.income_amount = body.IncomeAmount;
    if (body.BaseDate !== undefined) updateData.base_date = body.BaseDate;
    if (body.BaseValue !== undefined) updateData.base_value = body.BaseValue;
    if (body.MarketValue !== undefined) updateData.market_value = body.MarketValue;
    if (body.BaseValueUSD !== undefined) updateData.base_value_usd = body.BaseValueUSD;
    if (body.MarketValueUSD !== undefined) updateData.market_value_usd = body.MarketValueUSD;
    if (body.Growth !== undefined) updateData.growth_rate = body.Growth;
    if (body.Comment !== undefined) updateData.comment = body.Comment;
    if (body.Matched !== undefined) updateData.is_matched = Boolean(body.Matched);

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
      Type: item.item_type,
      Currency: item.currency,
      BaseDate: item.base_date,
      BaseValue: item.base_value,
      BaseValueUSD: item.base_value_usd,
      Growth: item.growth_rate,
      Comment: item.comment,
      Matched: item.is_matched,
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

    const item = await repo.updateIncExp(id, updateData);
    if (!item) {
      return res.status(404).json({ error: 'Income/Expense item not found' });
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
