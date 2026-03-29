/**
 * Forecast Generation Service - PostgreSQL Version
 *
 * Generates financial forecasts by:
 * 1. Loading scenario configuration and assumptions from FCAssump.json
 * 2. Querying PostgreSQL for forecast modules and income/expense items
 * 3. Processing each module to generate forecast entries
 * 4. Persisting results to forecast_entries table
 */

const dfd = require("danfojs-node");
const db = require("../../v2/db");
const { loadScenarioConfig } = require("./fcbuilder-setup");
const { processModule: processBSModule } = require("./fcbuilder-module");
const { processModule: processIncExpModule } = require("./fcbuilder-incexp");
const { CATEGORIES } = require("./constants");

function buildScenarioCategories(accountNames, incomeCategories, expenseCategories) {
  const seen = new Set();
  const ordered = [];

  const pushUnique = (item) => {
    if (item && !seen.has(item)) {
      seen.add(item);
      ordered.push(item);
    }
  };

  pushUnique(CATEGORIES.BANK_ACCOUNTS);
  pushUnique(CATEGORIES.TRANSFER_BANK);
  accountNames.forEach(pushUnique);
  incomeCategories.forEach(pushUnique);
  expenseCategories.forEach(pushUnique);
  pushUnique(CATEGORIES.TAXES_US);

  return ordered;
}

function buildColumns(years) {
  const result = new Array(years.length + 1);
  result[0] = years[0] - 1;
  for (let i = 0; i < years.length; i++) {
    result[i + 1] = years[i];
  }
  return result;
}

function createZerosMatrix(rowCount, colCount) {
  const matrix = new Array(rowCount);
  for (let i = 0; i < rowCount; i++) {
    matrix[i] = new Array(colCount).fill(0);
  }
  return matrix;
}

/**
 * Loads modules from PostgreSQL and transforms to v1 format for processing
 */
async function loadModulesForScenario(scenarioId, fcLineNameMap) {
  // Get modules with account names
  const modulesResult = await db.query(`
    SELECT m.*, a.name as account_name, a.account_type
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') = 'complete'
  `, [scenarioId]);

  const modules = modulesResult.rows;

  // Load nested data for all modules
  for (const mod of modules) {
    const [incomePct, investments, disposals] = await Promise.all([
      db.query('SELECT * FROM forecast_module_income_pct WHERE module_id = $1 ORDER BY effective_date', [mod.id]),
      db.query('SELECT * FROM forecast_module_investments WHERE module_id = $1 ORDER BY investment_date', [mod.id]),
      db.query('SELECT * FROM forecast_module_disposals WHERE module_id = $1 ORDER BY disposal_date', [mod.id]),
    ]);

    // Transform to v1 format expected by processModule
    mod.Name = mod.name;
    mod.Account = mod.account_name;
    mod.BaseDate = mod.base_date;
    mod.BaseValue = parseFloat(mod.base_value) || 0;
    mod.BaseValueUSD = parseFloat(mod.base_value_usd) || 0;
    mod.MarketValue = parseFloat(mod.market_value) || 0;
    mod.MarketValueUSD = parseFloat(mod.market_value_usd) || 0;
    mod.Currency = (mod.currency || 'USD').trim();
    mod.Growth = parseFloat(mod.growth_rate) || 0;
    mod.ExpensePct = 0; // Legacy field — replaced by expense_growth_method
    mod.expense_fc_line_id = mod.expense_fc_line_id || null;
    mod.income_fc_line_id = mod.income_fc_line_id || null;
    mod.expense_growth_method = mod.expense_growth_method || 'inflation';

    // Resolve FC Line names for entry labels
    mod.ExpCategory = '';
    mod.IncomeCategory = '';
    if (mod.expense_fc_line_id && fcLineNameMap) {
      mod.ExpCategory = fcLineNameMap.get(mod.expense_fc_line_id) || '';
    }
    if (mod.income_fc_line_id && fcLineNameMap) {
      mod.IncomeCategory = fcLineNameMap.get(mod.income_fc_line_id) || '';
    }

    mod.Comment = mod.comment;
    mod.Matched = mod.is_matched;
    mod.AccountType = mod.account_type || '';

    // Transform nested arrays to v1 format
    mod.IncomePct = incomePct.rows.map(r => ({
      Date: r.effective_date,
      Value: parseFloat(r.value) || 0,
    }));

    mod.Invest = investments.rows.map(r => ({
      Date: r.investment_date,
      Amount: parseFloat(r.amount) || 0,
      Flag: r.flag || '',
    }));

    mod.Dispose = disposals.rows.map(r => ({
      Date: r.disposal_date,
      Amount: parseFloat(r.amount) || 0,
      Flag: r.flag || '',
    }));
  }

  return modules;
}

/**
 * Loads income/expense items from PostgreSQL and transforms to v1 format
 */
async function loadIncExpModulesForScenario(scenarioId) {
  const itemsResult = await db.query(`
    SELECT ie.*, a.name as account_name
    FROM forecast_income_expense ie
    LEFT JOIN accounts a ON ie.account_id = a.id
    WHERE ie.scenario_id = $1 AND COALESCE(ie.setup_status, 'new') = 'complete'
  `, [scenarioId]);

  const items = itemsResult.rows;

  // Load changes for all items
  if (items.length > 0) {
    const itemIds = items.map(item => item.id);
    const changesResult = await db.query(`
      SELECT * FROM forecast_incexp_changes
      WHERE incexp_id = ANY($1)
      ORDER BY change_date
    `, [itemIds]);

    const changesByItem = {};
    for (const change of changesResult.rows) {
      if (!changesByItem[change.incexp_id]) {
        changesByItem[change.incexp_id] = [];
      }
      changesByItem[change.incexp_id].push({
        Date: change.change_date,
        Amount: parseFloat(change.amount) || 0,
        Flag: change.flag || '',
      });
    }

    for (const item of items) {
      item.Changes = changesByItem[item.id] || [];
    }
  }

  // Transform to v1 format
  for (const item of items) {
    item.Name = item.name;
    item.Account = item.account_name;
    item.BaseValue = parseFloat(item.base_value) || 0;
    item.BaseValueUSD = parseFloat(item.base_value_usd) || 0;
    item.Currency = (item.currency || 'USD').trim();
    item.Growth = parseFloat(item.growth_rate) || 0;
    item.Comment = item.comment;
    item.Matched = item.is_matched;
    if (!item.Changes) item.Changes = [];
  }

  return items;
}

/**
 * Extracts unique categories from modules
 */
async function loadCategoriesForScenario(scenarioId, fcLineNameMap) {
  const result = await db.query(`
    SELECT
      array_agg(DISTINCT a.name) FILTER (WHERE a.name IS NOT NULL) as account_names,
      array_agg(DISTINCT m.expense_fc_line_id) FILTER (WHERE m.expense_fc_line_id IS NOT NULL) as expense_fc_line_ids,
      array_agg(DISTINCT m.income_fc_line_id) FILTER (WHERE m.income_fc_line_id IS NOT NULL) as income_fc_line_ids
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') = 'complete'
  `, [scenarioId]);

  const row = result.rows[0] || {};
  const expenseCategories = [];
  const incomeCategories = [];

  // Build category lists from FC Line names
  if (fcLineNameMap) {
    for (const id of (row.expense_fc_line_ids || [])) {
      const name = fcLineNameMap.get(id);
      if (name && !expenseCategories.includes(name)) expenseCategories.push(name);
    }
    for (const id of (row.income_fc_line_ids || [])) {
      const name = fcLineNameMap.get(id);
      if (name && !incomeCategories.includes(name)) incomeCategories.push(name);
    }
  }

  return {
    expenseCategories,
    incomeCategories,
    accountNames: row.account_names || [],
  };
}

/**
 * Extracts unique income/expense categories
 */
async function loadIncExpCategoriesForScenario(scenarioId) {
  const result = await db.query(`
    SELECT array_agg(DISTINCT a.name) FILTER (WHERE a.name IS NOT NULL) as incexp_categories
    FROM forecast_income_expense ie
    LEFT JOIN accounts a ON ie.account_id = a.id
    WHERE ie.scenario_id = $1 AND COALESCE(ie.setup_status, 'new') = 'complete'
  `, [scenarioId]);

  return {
    incexpCategories: result.rows[0]?.incexp_categories || [],
  };
}

/**
 * Main forecast generation function
 */
async function generateForecast(scenarioName) {
  const startTime = Date.now();

  console.log(`[FORECAST-GENERATE] Starting forecast generation for scenario: ${scenarioName}`);

  try {
    // Step 1: Load configuration
    const config = loadScenarioConfig(scenarioName);
    const { scenario, categories, inflationRates, fxratesPLN, fxratesEUR, years } = config;

    const df_assumptions = new dfd.DataFrame(
      {
        [categories[1]]: inflationRates,
        [categories[2]]: fxratesPLN,
        [categories[3]]: fxratesEUR,
      },
      { index: years }
    );

    // Step 2: Find scenario in PostgreSQL
    const scenarioResult = await db.query('SELECT id, target_cash FROM forecast_scenarios WHERE name = $1', [scenarioName]);
    if (scenarioResult.rows.length === 0) {
      throw new Error(`Scenario "${scenarioName}" not found in database`);
    }
    const scenarioId = scenarioResult.rows[0].id;
    const targetCash = parseFloat(scenarioResult.rows[0].target_cash) || null;

    // Step 3: Clear existing entries
    const deleteResult = await db.query('DELETE FROM forecast_entries WHERE scenario_id = $1', [scenarioId]);
    const deletedCount = deleteResult.rowCount;
    console.log(`[FORECAST-GENERATE] Deleted ${deletedCount} existing entries`);

    // Step 3b: Preload FC Line name map (id → name)
    const fcLinesResult = await db.query('SELECT id, name FROM fc_lines');
    const fcLineNameMap = new Map();
    for (const row of fcLinesResult.rows) {
      fcLineNameMap.set(row.id, row.name);
    }
    console.log(`[FORECAST-GENERATE] Loaded ${fcLineNameMap.size} FC Line names`);

    // Step 4: Load modules and categories in parallel
    const [bsModules, incexpModules, { expenseCategories, incomeCategories, accountNames }, { incexpCategories }] =
      await Promise.all([
        loadModulesForScenario(scenarioId, fcLineNameMap),
        loadIncExpModulesForScenario(scenarioId),
        loadCategoriesForScenario(scenarioId, fcLineNameMap),
        loadIncExpCategoriesForScenario(scenarioId),
      ]);

    console.log(`[FORECAST-GENERATE] Loaded ${bsModules.length} FCModule entries for scenario ${scenarioName}`);
    console.log(`[FORECAST-GENERATE] Loaded ${incexpModules.length} FCIncExp entries for scenario ${scenarioName}`);

    // Step 5: Build category structures
    const scenarioCategories = buildScenarioCategories(accountNames, incomeCategories, expenseCategories);

    if (!incexpCategories.includes(CATEGORIES.TAXES)) {
      incexpCategories.push(CATEGORIES.TAXES);
    }
    incexpCategories.push(CATEGORIES.BANK_ACCOUNTS);

    const columns = buildColumns(years);

    const df_categories = new dfd.DataFrame(
      createZerosMatrix(scenarioCategories.length, columns.length),
      { columns: columns, index: scenarioCategories }
    );
    df_categories.config.setMaxRow(1000);

    const df_categories2 = new dfd.DataFrame(
      createZerosMatrix(incexpCategories.length, columns.length),
      { columns: columns, index: incexpCategories }
    );
    df_categories2.config.setMaxRow(1000);

    // Step 6: Process all modules
    console.log(`[FORECAST-GENERATE] Processing ${bsModules.length + incexpModules.length} modules...`);

    const results = await Promise.all([
      ...bsModules.map((module) => {
        const df_module_categories = new dfd.DataFrame(
          createZerosMatrix(scenarioCategories.length, columns.length),
          { columns: columns, index: scenarioCategories }
        );
        df_module_categories.config.setMaxRow(1000);
        return processBSModule(module, scenario, df_assumptions, df_module_categories, categories, years, db, scenarioId, fcLineNameMap);
      }),
      ...incexpModules.map((module) => {
        const df_module_categories2 = new dfd.DataFrame(
          createZerosMatrix(incexpCategories.length, columns.length),
          { columns: columns, index: incexpCategories }
        );
        df_module_categories2.config.setMaxRow(1000);
        return processIncExpModule(module, scenario, df_assumptions, df_module_categories2, categories, years, db, scenarioId);
      }),
    ]);

    // Step 7: Cash Target Auto-Balance (post-processing)
    let rebalanceEntries = 0;
    if (targetCash !== null && Number.isFinite(targetCash)) {
      console.log(`[FORECAST-GENERATE] Running cash auto-balance (target: ${targetCash})`);

      // Sum Bank Accounts entries by year to get projected cash balance
      const cashResult = await db.query(`
        SELECT forecast_year, SUM(amount) as cash_total
        FROM forecast_entries
        WHERE scenario_id = $1 AND account = 'Bank Accounts'
        GROUP BY forecast_year
        ORDER BY forecast_year
      `, [scenarioId]);

      // Build cumulative cash balance (Bank Accounts entries are year-over-year changes)
      let cumulativeCash = 0;
      const cashByYear = {};
      for (const row of cashResult.rows) {
        cumulativeCash += parseFloat(row.cash_total) || 0;
        cashByYear[row.forecast_year] = cumulativeCash;
      }

      // For each year, compute excess/shortfall vs target
      const rebalanceValues = [];
      for (const year of years) {
        const projectedCash = cashByYear[year] || 0;
        const gap = projectedCash - targetCash;

        if (Math.abs(gap) > 0.01) {
          if (gap > 0) {
            // Excess: move to deposits (reduce Bank Accounts, increase Deposits)
            rebalanceValues.push(
              { year, account: 'Bank Accounts', amount: -gap, module: '_rebalance', comment: 'Cash target rebalance' },
              { year, account: 'Cash Rebalance - Deposits', amount: gap, module: '_rebalance', comment: 'Excess cash to deposits' }
            );
          } else {
            // Shortfall: flag it (don't auto-sell, just show the gap)
            rebalanceValues.push(
              { year, account: 'Cash Shortfall', amount: gap, module: '_rebalance', comment: 'Cash below target' }
            );
          }
        }
      }

      // Insert rebalance entries
      if (rebalanceValues.length > 0) {
        const values = [];
        const params = [];
        let paramIdx = 1;
        for (const entry of rebalanceValues) {
          values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
          params.push(scenarioId, entry.year, entry.amount, entry.account, entry.module, entry.comment);
        }
        await db.query(`
          INSERT INTO forecast_entries (scenario_id, forecast_year, amount, account, module, comment)
          VALUES ${values.join(", ")}
        `, params);
        rebalanceEntries = rebalanceValues.length;
        console.log(`[FORECAST-GENERATE] Created ${rebalanceEntries} rebalance entries`);
      }
    }

    // Step 8: Calculate statistics
    const totalEntries = results.reduce((sum, r) => sum + (r?.entriesCount || 0), 0) + rebalanceEntries;
    const durationMs = Date.now() - startTime;

    console.log(`[FORECAST-GENERATE] Forecast generation completed successfully`);
    console.log(`[FORECAST-GENERATE] Total entries created: ${totalEntries}`);
    console.log(`[FORECAST-GENERATE] Duration: ${durationMs}ms`);

    return {
      success: true,
      scenario: scenarioName,
      deletedCount,
      modulesProcessed: bsModules.length + incexpModules.length,
      entriesCreated: totalEntries,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[FORECAST-GENERATE] Failed to generate forecast for ${scenarioName}:`, error);

    return {
      success: false,
      scenario: scenarioName,
      error: error.message,
      durationMs,
    };
  }
}

module.exports = {
  generateForecast,
};
