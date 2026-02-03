/**
 * V2 Forecast Routes
 */

const express = require('express');
const router = express.Router();
const repo = require('../repositories').forecast;

// ============================================================================
// Assumptions (v1 API compatible - combines PostgreSQL scenarios with file-based assumptions)
// ============================================================================

// GET /api/v2/forecast/assumptions
// Returns assumptions in v1 format for backwards compatibility
router.get('/assumptions', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    // Get scenarios from PostgreSQL
    const scenarios = await repo.findAllScenarios({ activeOnly: false });

    // Transform to v1 format (PascalCase)
    const scenariosV1 = scenarios.map((s) => ({
      Name: s.name,
      Description: s.description,
      IsActive: s.is_active,
      id: s.id,
    }));

    // Try to read other assumptions from FCAssump.json file
    let fileAssumptions = {};
    try {
      const fcAssumpPath = dataPaths.fcAssump;
      if (fs.existsSync(fcAssumpPath)) {
        const content = fs.readFileSync(fcAssumpPath, 'utf8');
        fileAssumptions = JSON.parse(content);
      }
    } catch (readErr) {
      console.warn('[v2/forecast/assumptions] Could not read FCAssump.json:', readErr.message);
    }

    // Combine: use PostgreSQL scenarios, keep other assumptions from file
    const result = {
      ...fileAssumptions,
      scenarios: scenariosV1,
    };

    res.json(result);
  } catch (error) {
    console.error('[v2/forecast/assumptions] Failed to load assumptions:', error);
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
// Returns distinct years for a scenario (by name, for v1 compatibility)
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
    console.error('[v2/forecast/scenarios/years] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/scenarios/:id
router.get('/scenarios/:id', async (req, res, next) => {
  try {
    const scenario = await repo.findScenarioById(parseInt(req.params.id));
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }
    res.json({ data: scenario });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/forecast/scenarios
router.post('/scenarios', async (req, res, next) => {
  try {
    const scenario = await repo.createScenario(req.body);
    res.status(201).json({ data: scenario });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/forecast/scenarios/:id/copy
router.post('/scenarios/:id/copy', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const newScenario = await repo.copyScenario(parseInt(req.params.id), name);
    res.status(201).json({ data: newScenario });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v2/forecast/scenarios/:id
router.patch('/scenarios/:id', async (req, res, next) => {
  try {
    const scenario = await repo.updateScenario(parseInt(req.params.id), req.body);
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }
    res.json({ data: scenario });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/forecast/scenarios/:id
router.delete('/scenarios/:id', async (req, res, next) => {
  try {
    const deleted = await repo.deleteScenario(parseInt(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: 'Scenario not found' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Modules
// ============================================================================

// GET /api/v2/forecast/modules
// Returns all modules, optionally filtered by scenario name (v1 API compatible)
router.get('/modules', async (req, res, next) => {
  try {
    const { scenario } = req.query;
    let modules = [];

    if (scenario) {
      // Look up scenario by name
      const scenarioObj = await repo.findScenarioByName(scenario);
      if (scenarioObj) {
        modules = await repo.findModulesByScenario(scenarioObj.id);
      }
    } else {
      // Get all modules across all scenarios
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

    // Transform to v1 format (PascalCase) for compatibility
    const transformed = modules.map((m) => ({
      ...m,
      id: m.id,
      _id: m.id, // MongoDB-style ID for compatibility
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

// GET /api/v2/forecast/scenarios/:scenarioId/modules
router.get('/scenarios/:scenarioId/modules', async (req, res, next) => {
  try {
    const modules = await repo.findModulesByScenario(parseInt(req.params.scenarioId));
    res.json({ data: modules });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/forecast/modules/unmatched
// Returns balance sheet accounts not yet matched to a module
// NOTE: Must be defined BEFORE /modules/:id to avoid route conflict
router.get('/modules/unmatched', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');
    const scenarioName = req.query.scenario?.trim();

    // Load all balance sheet accounts from COA file
    const coaPath = dataPaths.coa;
    const coaData = JSON.parse(fs.readFileSync(coaPath, 'utf8'));

    let balanceSheetSection = null;
    if (Array.isArray(coaData)) {
      for (const section of coaData) {
        if (section && typeof section === 'object' && section['Balance Sheet Accounts']) {
          balanceSheetSection = section['Balance Sheet Accounts'];
          break;
        }
      }
    } else if (coaData && typeof coaData === 'object') {
      balanceSheetSection = coaData['Balance Sheet Accounts'];
    }

    if (!balanceSheetSection) {
      return res.json([]);
    }

    // Extract all accounts from balance sheet
    const allAccounts = [];
    const stack = [{ node: balanceSheetSection, category: null }];

    while (stack.length) {
      const { node, category } = stack.pop();

      if (typeof node === 'string') {
        const isBankAccount = typeof category === 'string' &&
          category.toLowerCase().includes('bank account');
        allAccounts.push({ name: node, category, isBankAccount });
        continue;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          stack.push({ node: item, category });
        }
        continue;
      }

      if (node && typeof node === 'object') {
        for (const key in node) {
          stack.push({ node: node[key], category: key });
        }
      }
    }

    // Get matched names for the scenario
    let matchedNames = new Set();
    if (scenarioName) {
      const scenario = await repo.findScenarioByName(scenarioName);
      if (scenario) {
        matchedNames = await repo.findMatchedModuleNames(scenario.id);
      }
    }

    // Filter to unmatched, non-bank accounts
    const unmatched = allAccounts.filter(account =>
      !account.isBankAccount && !matchedNames.has(account.name)
    );

    res.json(unmatched);
  } catch (error) {
    console.error('[v2/forecast/modules/unmatched] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/modules/:id
router.get('/modules/:id', async (req, res, next) => {
  try {
    const module = await repo.findModuleById(parseInt(req.params.id));
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }
    res.json({ data: module });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/forecast/modules
router.post('/modules', async (req, res, next) => {
  try {
    const module = await repo.createModule(req.body);
    res.status(201).json({ data: module });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/v2/forecast/modules/:id
router.patch('/modules/:id', async (req, res, next) => {
  try {
    const module = await repo.updateModule(parseInt(req.params.id), req.body);
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }
    res.json({ data: module });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v2/forecast/modules/:id
router.delete('/modules/:id', async (req, res, next) => {
  try {
    const deleted = await repo.deleteModule(parseInt(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: 'Module not found' });
    }
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/forecast/modules/:id/investments
router.post('/modules/:id/investments', async (req, res, next) => {
  try {
    const investment = await repo.addInvestment(parseInt(req.params.id), req.body);
    res.status(201).json({ data: investment });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/forecast/modules/:id/disposals
router.post('/modules/:id/disposals', async (req, res, next) => {
  try {
    const disposal = await repo.addDisposal(parseInt(req.params.id), req.body);
    res.status(201).json({ data: disposal });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/forecast/modules/:id/income-pct
router.post('/modules/:id/income-pct', async (req, res, next) => {
  try {
    const incomePct = await repo.setIncomePct(parseInt(req.params.id), req.body);
    res.status(201).json({ data: incomePct });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Income/Expense Items
// ============================================================================

// GET /api/v2/forecast/scenarios/:scenarioId/incexp
router.get('/scenarios/:scenarioId/incexp', async (req, res, next) => {
  try {
    const items = await repo.findIncExpByScenario(parseInt(req.params.scenarioId));
    res.json({ data: items });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/forecast/incexp/:id
router.get('/incexp/:id', async (req, res, next) => {
  try {
    const item = await repo.findIncExpById(parseInt(req.params.id));
    if (!item) {
      return res.status(404).json({ error: 'Income/Expense item not found' });
    }
    res.json({ data: item });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/forecast/incexp
router.post('/incexp', async (req, res, next) => {
  try {
    const item = await repo.createIncExp(req.body);
    res.status(201).json({ data: item });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/forecast/incexp/:id/changes
router.post('/incexp/:id/changes', async (req, res, next) => {
  try {
    const change = await repo.addIncExpChange(parseInt(req.params.id), req.body);
    res.status(201).json({ data: change });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// Forecast Entries
// ============================================================================

// GET /api/v2/forecast/entries
// Returns forecast entries, optionally filtered by scenario name
router.get('/entries', async (req, res, next) => {
  try {
    const scenarioName = req.query.scenario?.trim();
    const entries = await repo.findAllEntries(scenarioName);
    res.json({ entries });
  } catch (error) {
    console.error('[v2/forecast/entries] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Forecast Generation
// ============================================================================

// POST /api/v2/forecast/generate/:scenario
// Generates forecast entries for a scenario (uses existing v1 generator)
router.post('/generate/:scenario', async (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();
    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    // Use existing forecast generator
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
    console.error('[v2/forecast/generate] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Audit Trail
// ============================================================================

// GET /api/v2/forecast/audittrail/:scenario/:module
// Returns audit trail CSV data for a scenario/module
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

    // Normalize names for filename matching
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
    console.error('[v2/forecast/audittrail] Failed:', error);
    next(error);
  }
});

module.exports = router;
