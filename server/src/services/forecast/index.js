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
const fs = require("fs");
const path = require("path");
const db = require("../../v2/db");
const { loadScenarioConfig } = require("./fcbuilder-setup");
const { processModule: processBSModule } = require("./fcbuilder-module");
const { processModule: processIncExpModule } = require("./fcbuilder-incexp");
const { CATEGORIES, PATHS } = require("./constants");
const { computeCashSweepIterative } = require("./cash-sweep");

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
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
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
async function loadIncExpModulesForScenario(scenarioId, fcLineNameMap) {
  const itemsResult = await db.query(`
    SELECT ie.*, a.name as account_name
    FROM forecast_income_expense ie
    LEFT JOIN accounts a ON ie.account_id = a.id
    WHERE ie.scenario_id = $1 AND COALESCE(ie.setup_status, 'new') NOT IN ('new', 'exclude')
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
    // Resolve FC Line name for account label (instead of COA account name)
    if (item.fc_line_id && fcLineNameMap) {
      item.Account = fcLineNameMap.get(item.fc_line_id) || item.account_name || item.name;
    } else {
      item.Account = item.account_name || item.name;
    }
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
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
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
 * Extracts unique income/expense categories — uses FC Line names when available
 */
async function loadIncExpCategoriesForScenario(scenarioId, fcLineNameMap) {
  const result = await db.query(`
    SELECT ie.fc_line_id, a.name as account_name
    FROM forecast_income_expense ie
    LEFT JOIN accounts a ON ie.account_id = a.id
    WHERE ie.scenario_id = $1 AND COALESCE(ie.setup_status, 'new') NOT IN ('new', 'exclude')
  `, [scenarioId]);

  const categories = new Set();
  for (const row of result.rows) {
    if (row.fc_line_id && fcLineNameMap) {
      const name = fcLineNameMap.get(row.fc_line_id);
      if (name) { categories.add(name); continue; }
    }
    if (row.account_name) categories.add(row.account_name);
  }

  return {
    incexpCategories: Array.from(categories),
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
    const scenarioResult = await db.query('SELECT id, cash_sweep_low, cash_sweep_high FROM forecast_scenarios WHERE name = $1', [scenarioName]);
    if (scenarioResult.rows.length === 0) {
      throw new Error(`Scenario "${scenarioName}" not found in database`);
    }
    const scenarioId = scenarioResult.rows[0].id;
    const cashSweepLow = parseFloat(scenarioResult.rows[0].cash_sweep_low) || null;
    const cashSweepHigh = parseFloat(scenarioResult.rows[0].cash_sweep_high) || null;

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
        loadIncExpModulesForScenario(scenarioId, fcLineNameMap),
        loadCategoriesForScenario(scenarioId, fcLineNameMap),
        loadIncExpCategoriesForScenario(scenarioId, fcLineNameMap),
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

    // Step 7: Cash Sweep & Auto-Balance (iterative year-by-year)
    let rebalanceEntries = 0;
    const hasSweepBand = (cashSweepLow !== null && Number.isFinite(cashSweepLow))
      || (cashSweepHigh !== null && Number.isFinite(cashSweepHigh));

    if (hasSweepBand) {
      const effectiveLow = cashSweepLow ?? cashSweepHigh ?? 0;
      const effectiveHigh = cashSweepHigh ?? cashSweepLow ?? 0;
      console.log(`[FORECAST-GENERATE] Running cash sweep (band: ${effectiveLow} – ${effectiveHigh})`);

      // Find the designated cash sweep target module
      const sweepModuleResult = await db.query(`
        SELECT m.*, a.name as account_name
        FROM forecast_modules m
        LEFT JOIN accounts a ON m.account_id = a.id
        WHERE m.scenario_id = $1 AND m.cash_sweep_target = TRUE
      `, [scenarioId]);
      const sweepModule = sweepModuleResult.rows[0] || null;
      if (sweepModule) {
        console.log(`[FORECAST-GENERATE] Cash sweep target module: ${sweepModule.name}`);
      }

      // Get actual bank balance from ledger (LastActualYear = PeriodStart - 2)
      const lastActualYear = scenario.PeriodStart - 2;
      const lastActualDate = `${lastActualYear}-12-31`;
      const bankBalResult = await db.query(`
        WITH RECURSIVE bank_tree AS (
          SELECT id, currency FROM accounts WHERE name = 'Bank Accounts'
          UNION ALL
          SELECT a.id, a.currency FROM accounts a JOIN bank_tree bt ON a.parent_id = bt.id
        ),
        latest_balances AS (
          SELECT DISTINCT ON (t.account_id)
            t.account_id, t.closing_balance,
            COALESCE(t.currency, bt.currency, 'USD') as currency
          FROM transactions t
          JOIN bank_tree bt ON t.account_id = bt.id
          WHERE t.transaction_date <= $1 AND t.closing_balance IS NOT NULL
          ORDER BY t.account_id, t.transaction_date DESC, t.id DESC
        )
        SELECT lb.closing_balance, lb.currency,
          COALESCE(
            (SELECT er.rate FROM exchange_rates er
             WHERE er.from_currency = lb.currency AND er.to_currency = 'USD'
             ORDER BY ABS(er.rate_date - $1::date) ASC LIMIT 1),
            1.0
          ) as fx_rate
        FROM latest_balances lb
      `, [lastActualDate]);

      let startingCash = 0;
      for (const row of bankBalResult.rows) {
        startingCash += (parseFloat(row.closing_balance) || 0) * (parseFloat(row.fx_rate) || 1);
      }
      console.log(`[FORECAST-GENERATE] Starting cash balance (${lastActualYear}): ${startingCash.toFixed(0)}`);

      // Get year-over-year cash deltas from Bank Accounts entries
      const cashResult = await db.query(`
        SELECT forecast_year, SUM(amount) as cash_total
        FROM forecast_entries
        WHERE scenario_id = $1 AND account = 'Bank Accounts'
        GROUP BY forecast_year
        ORDER BY forecast_year
      `, [scenarioId]);
      const cashDeltaByYear = {};
      for (const row of cashResult.rows) {
        cashDeltaByYear[row.forecast_year] = parseFloat(row.cash_total) || 0;
      }

      // Fix BaseYear delta: Review uses budget P&L + engine transfers (not engine Bank Accounts)
      // This ensures sweep's cash matches what the Review displays
      const baseYear = scenario.PeriodStart - 1;
      if (cashDeltaByYear[baseYear] !== undefined) {
        // Get budget NCF for BaseYear (same query as base-year-values endpoint)
        const budgetResult = await db.query(`
          SELECT COALESCE(SUM(val.amount), 0)::numeric as budget_ncf FROM (
            SELECT SUM(CASE WHEN a.account_type = 'liability' THEN -m.expense_amount ELSE 0 END) as amount
            FROM forecast_modules m LEFT JOIN accounts a ON m.account_id = a.id LEFT JOIN fc_lines exp_line ON m.expense_fc_line_id = exp_line.id
            WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude') AND m.expense_fc_line_id IS NOT NULL
            UNION ALL
            SELECT SUM(COALESCE(m.income_amount, 0)) FROM forecast_modules m LEFT JOIN fc_lines inc_line ON m.income_fc_line_id = inc_line.id
            WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude') AND m.income_fc_line_id IS NOT NULL
            UNION ALL
            SELECT ie.base_value FROM forecast_income_expense ie LEFT JOIN fc_lines fl ON ie.fc_line_id = fl.id
            WHERE ie.scenario_id = $1 AND COALESCE(ie.setup_status, 'new') NOT IN ('new', 'exclude')
          ) val
        `, [scenarioId]);
        const budgetNCF = parseFloat(budgetResult.rows[0]?.budget_ncf) || 0;

        // Get engine transfers for BaseYear (Transfer - Bank entries)
        const transferResult = await db.query(`
          SELECT COALESCE(SUM(amount), 0)::numeric as transfers
          FROM forecast_entries
          WHERE scenario_id = $1 AND forecast_year = $2 AND account = 'Transfer - Bank'
        `, [scenarioId, baseYear]);
        const baseYearTransfers = parseFloat(transferResult.rows[0]?.transfers) || 0;

        const correctedBaseYearDelta = budgetNCF + baseYearTransfers;
        console.log(`[FORECAST-GENERATE] BaseYear ${baseYear} delta corrected: ${cashDeltaByYear[baseYear].toFixed(0)} → ${correctedBaseYearDelta.toFixed(0)} (budget NCF: ${budgetNCF.toFixed(0)}, transfers: ${baseYearTransfers.toFixed(0)})`);
        cashDeltaByYear[baseYear] = correctedBaseYearDelta;
      }

      // Load sweep module's market value by year (for emergency withdrawal limits)
      const moduleBalanceByYear = {};
      if (sweepModule) {
        const mvResult = await db.query(`
          SELECT forecast_year, SUM(amount)::numeric as mv
          FROM forecast_entries
          WHERE scenario_id = $1 AND account = $2 AND module = $3
          GROUP BY forecast_year ORDER BY forecast_year
        `, [scenarioId, sweepModule.account_name, sweepModule.name]);
        for (const row of mvResult.rows) {
          moduleBalanceByYear[row.forecast_year] = parseFloat(row.mv) || 0;
        }
      }

      // Run iterative sweep (pure function — transfers only, no yield)
      const { entries: sweepEntries, sweepLog } = computeCashSweepIterative({
        years,
        cashSweepLow: effectiveLow,
        cashSweepHigh: effectiveHigh,
        cashDeltaByYear,
        startingCash,
        sweepModule,
        moduleBalanceByYear,
      });

      // Insert sweep entries
      if (sweepEntries.length > 0) {
        const values = [];
        const params = [];
        let paramIdx = 1;
        for (const entry of sweepEntries) {
          values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
          params.push(scenarioId, entry.year, entry.amount, entry.account, entry.module, entry.comment);
        }
        await db.query(`
          INSERT INTO forecast_entries (scenario_id, forecast_year, amount, account, module, comment)
          VALUES ${values.join(", ")}
        `, params);
        rebalanceEntries = sweepEntries.length;
        console.log(`[FORECAST-GENERATE] Cash sweep: Created ${rebalanceEntries} entries`);
      }

      // Write audit trail
      if (sweepLog.length > 0) {
        try {
          const auditDir = PATHS.AUDIT_TRAIL_DIR;
          fs.mkdirSync(auditDir, { recursive: true });
          const scenarioSafe = (scenarioName || '').replace(/[^a-z0-9]/gi, '_');
          const csvPath = path.join(auditDir, `${scenarioSafe}_cash_sweep.csv`);
          const headers = ['Year', 'Action', 'Amount', 'Shortfall', 'YieldIncome', 'CashBefore', 'CashAfter', 'SweepModuleBalance'];
          const lines = [headers.join(',')];
          for (const row of sweepLog) {
            lines.push([
              row.year, row.action, (row.amount || 0).toFixed(2),
              (row.shortfall || 0).toFixed(2), (row.yieldIncome || 0).toFixed(2),
              (row.cashBefore || 0).toFixed(2), (row.cashAfter || 0).toFixed(2),
              (row.sweepBalance || 0).toFixed(2),
            ].join(','));
          }
          fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
          console.log(`[FORECAST-GENERATE] Cash sweep audit trail written`);
        } catch (auditErr) {
          console.error('[FORECAST-GENERATE] Failed to write cash sweep audit:', auditErr.message);
        }
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
