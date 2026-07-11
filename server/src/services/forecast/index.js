/**
 * Forecast Generation Service - PostgreSQL Version
 *
 * Generates financial forecasts by:
 * 1. Loading scenario configuration and assumptions (forecast_assumptions table, CR039)
 * 2. Querying PostgreSQL for forecast modules and income/expense items
 * 3. Processing each module to generate forecast entries
 * 4. Persisting results to forecast_entries table
 *
 * All writes (the clear-out, module entries, sweep entries, and the convergence
 * loop's read-modify-write cycles) run inside ONE transaction holding
 * pg_advisory_xact_lock on the scenario, so a failed build rolls back to the
 * previous entries and concurrent builds of the same scenario serialize
 * instead of interleaving (CR043 N2).
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

// Advisory-lock namespace for generate ("FCSG"); pairs with the scenario id.
const GENERATE_LOCK_NS = 1178489671;

/**
 * Loads modules from PostgreSQL and transforms to v1 format for processing
 */
async function loadModulesForScenario(scenarioId, fcLineNameMap, dbc = db) {
  // Get modules with account names
  const modulesResult = await dbc.query(`
    SELECT m.*, a.name as account_name, a.account_type
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
  `, [scenarioId]);

  const modules = modulesResult.rows;

  // Load nested data for all modules
  for (const mod of modules) {
    const [incomePct, investments, disposals] = await Promise.all([
      dbc.query('SELECT * FROM forecast_module_income_pct WHERE module_id = $1 ORDER BY effective_date', [mod.id]),
      dbc.query('SELECT * FROM forecast_module_investments WHERE module_id = $1 ORDER BY investment_date', [mod.id]),
      dbc.query('SELECT * FROM forecast_module_disposals WHERE module_id = $1 ORDER BY disposal_date', [mod.id]),
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
      DateEnd: r.date_end || null,
    }));

    mod.Dispose = disposals.rows.map(r => ({
      Date: r.disposal_date,
      Amount: parseFloat(r.amount) || 0,
      Flag: r.flag || '',
      DateEnd: r.date_end || null,
    }));
  }

  return modules;
}

/**
 * Loads income/expense items from PostgreSQL and transforms to v1 format
 */
async function loadIncExpModulesForScenario(scenarioId, fcLineNameMap, dbc = db) {
  const itemsResult = await dbc.query(`
    SELECT ie.*, a.name as account_name
    FROM forecast_income_expense ie
    LEFT JOIN accounts a ON ie.account_id = a.id
    WHERE ie.scenario_id = $1 AND COALESCE(ie.setup_status, 'new') NOT IN ('new', 'exclude')
  `, [scenarioId]);

  const items = itemsResult.rows;

  // Load changes for all items
  if (items.length > 0) {
    const itemIds = items.map(item => item.id);
    const changesResult = await dbc.query(`
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
async function loadCategoriesForScenario(scenarioId, fcLineNameMap, dbc = db) {
  const result = await dbc.query(`
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
async function loadIncExpCategoriesForScenario(scenarioId, fcLineNameMap, dbc = db) {
  const result = await dbc.query(`
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
    const config = await loadScenarioConfig(scenarioName);
    const { scenario, categories, inflationRates, fxratesPLN, fxratesEUR, years } = config;

    const df_assumptions = new dfd.DataFrame(
      {
        [categories[1]]: inflationRates,
        [categories[2]]: fxratesPLN,
        [categories[3]]: fxratesEUR,
      },
      { index: years }
    );

    // Steps 2–8 run in ONE transaction (CR043 N2): any failure rolls the scenario
    // back to its previous entries, and pg_advisory_xact_lock (acquired right after
    // the id lookup, auto-released at COMMIT/ROLLBACK) serializes concurrent builds
    // of the same scenario. Every read/write below must go through `dbc` (the tx
    // client), never the pool, or it escapes both the rollback and the lock.
    const stats = await db.transaction(async (dbc) => {

    // Step 2: Find scenario in PostgreSQL
    const scenarioResult = await dbc.query('SELECT id, cash_sweep_low, cash_sweep_high FROM forecast_scenarios WHERE name = $1', [scenarioName]);
    if (scenarioResult.rows.length === 0) {
      throw new Error(`Scenario "${scenarioName}" not found in database`);
    }
    const scenarioId = scenarioResult.rows[0].id;
    const cashSweepLow = parseFloat(scenarioResult.rows[0].cash_sweep_low) || null;
    const cashSweepHigh = parseFloat(scenarioResult.rows[0].cash_sweep_high) || null;

    await dbc.query('SELECT pg_advisory_xact_lock($1, $2)', [GENERATE_LOCK_NS, scenarioId]);

    // Step 3: Clear existing entries
    const deleteResult = await dbc.query('DELETE FROM forecast_entries WHERE scenario_id = $1', [scenarioId]);
    const deletedCount = deleteResult.rowCount;
    console.log(`[FORECAST-GENERATE] Deleted ${deletedCount} existing entries`);

    // Step 3b: Preload FC Line name map (id → name)
    const fcLinesResult = await dbc.query('SELECT id, name FROM fc_lines');
    const fcLineNameMap = new Map();
    for (const row of fcLinesResult.rows) {
      fcLineNameMap.set(row.id, row.name);
    }
    console.log(`[FORECAST-GENERATE] Loaded ${fcLineNameMap.size} FC Line names`);

    // Step 4: Load modules and categories in parallel
    const [bsModules, incexpModules, { expenseCategories, incomeCategories, accountNames }, { incexpCategories }] =
      await Promise.all([
        loadModulesForScenario(scenarioId, fcLineNameMap, dbc),
        loadIncExpModulesForScenario(scenarioId, fcLineNameMap, dbc),
        loadCategoriesForScenario(scenarioId, fcLineNameMap, dbc),
        loadIncExpCategoriesForScenario(scenarioId, fcLineNameMap, dbc),
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
        return processBSModule(module, scenario, df_assumptions, df_module_categories, categories, years, dbc, scenarioId, fcLineNameMap);
      }),
      ...incexpModules.map((module) => {
        const df_module_categories2 = new dfd.DataFrame(
          createZerosMatrix(incexpCategories.length, columns.length),
          { columns: columns, index: incexpCategories }
        );
        df_module_categories2.config.setMaxRow(1000);
        return processIncExpModule(module, scenario, df_assumptions, df_module_categories2, categories, years, dbc, scenarioId);
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

      // Find the designated cash sweep modules in priority order (CR017).
      // Priority 1 = primary (deposit target + first drained); 2,3,… = backups.
      // Falls back to the legacy cash_sweep_target flag for any unmigrated rows.
      const sweepModuleResult = await dbc.query(`
        SELECT m.*, a.name as account_name
        FROM forecast_modules m
        LEFT JOIN accounts a ON m.account_id = a.id
        WHERE m.scenario_id = $1 AND (m.cash_sweep_priority IS NOT NULL OR m.cash_sweep_target = TRUE)
        ORDER BY COALESCE(m.cash_sweep_priority, CASE WHEN m.cash_sweep_target THEN 1 ELSE 999 END) ASC, m.id ASC
      `, [scenarioId]);
      const sweepModules = sweepModuleResult.rows;
      const sweepModule = sweepModules[0] || null;
      const backupModuleRows = sweepModules.slice(1);
      if (sweepModule) {
        console.log(`[FORECAST-GENERATE] Cash sweep primary module: ${sweepModule.name}` +
          (backupModuleRows.length ? ` (+${backupModuleRows.length} backup${backupModuleRows.length > 1 ? 's' : ''}: ${backupModuleRows.map(m => m.name).join(', ')})` : ''));
      }

      // Get actual bank balance from ledger (LastActualYear = PeriodStart - 2)
      const lastActualYear = scenario.PeriodStart - 2;
      const lastActualDate = `${lastActualYear}-12-31`;
      const bankBalResult = await dbc.query(`
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
      const cashResult = await dbc.query(`
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
        const budgetResult = await dbc.query(`
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
        const transferResult = await dbc.query(`
          SELECT COALESCE(SUM(amount), 0)::numeric as transfers
          FROM forecast_entries
          WHERE scenario_id = $1 AND forecast_year = $2 AND account = 'Transfer - Bank'
        `, [scenarioId, baseYear]);
        const baseYearTransfers = parseFloat(transferResult.rows[0]?.transfers) || 0;

        const correctedBaseYearDelta = budgetNCF + baseYearTransfers;
        console.log(`[FORECAST-GENERATE] BaseYear ${baseYear} delta corrected: ${cashDeltaByYear[baseYear].toFixed(0)} → ${correctedBaseYearDelta.toFixed(0)} (budget NCF: ${budgetNCF.toFixed(0)}, transfers: ${baseYearTransfers.toFixed(0)})`);
        cashDeltaByYear[baseYear] = correctedBaseYearDelta;
      }

      // Load each sweep module's own market value by year (for withdrawal limits).
      // Helper: builder-only balance (excludes the _cash_sweep/_sweep_bal transfer tags).
      const loadModuleBalanceByYear = async (accountName, moduleName) => {
        const mvResult = await dbc.query(`
          SELECT forecast_year, SUM(amount)::numeric as mv
          FROM forecast_entries
          WHERE scenario_id = $1 AND account = $2 AND module = $3
          GROUP BY forecast_year ORDER BY forecast_year
        `, [scenarioId, accountName, moduleName]);
        const out = {};
        for (const row of mvResult.rows) out[row.forecast_year] = parseFloat(row.mv) || 0;
        return out;
      };

      const moduleBalanceByYear = sweepModule
        ? await loadModuleBalanceByYear(sweepModule.account_name, sweepModule.name)
        : {};

      // Backup modules (priority 2…N): builder balances are fixed across convergence
      // iterations (only their _cash_sweep withdrawals change, which the query excludes).
      const backupModules = [];
      for (const bm of backupModuleRows) {
        backupModules.push({
          name: bm.name,
          account_name: bm.account_name,
          balanceByYear: await loadModuleBalanceByYear(bm.account_name, bm.name),
        });
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
        backupModules,
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
        await dbc.query(`
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
          const headers = ['Year', 'Action', 'Amount', 'CashBefore', 'CashAfter', 'NetModuleEffect', 'Modules'];
          const lines = [headers.join(',')];
          for (const row of sweepLog) {
            const netEffect = (row.sweepBalance || 0) - (row.moduleWithdrawal || 0);
            lines.push([
              row.year, row.action, (row.amount || 0).toFixed(2),
              (row.cashBefore || 0).toFixed(2), (row.cashAfter || 0).toFixed(2),
              netEffect.toFixed(2),
              row.modules || '',
            ].join(','));
          }
          fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
          console.log(`[FORECAST-GENERATE] Cash sweep audit trail written`);
        } catch (auditErr) {
          console.error('[FORECAST-GENERATE] Failed to write cash sweep audit:', auditErr.message);
        }
      }

      // Step 7b: Iterative income-sweep convergence for sweep target module
      // Income depends on market value (post-sweep), but sweep depends on cash (which includes income).
      // We iterate until income stabilises (typically 2-3 loops).
      if (sweepModule) {
      // Find the sweep target's original module data (already loaded at Step 3)
      const sweepMod = bsModules.find(
        (m) => m.id === sweepModule.id || m.Name === sweepModule.name
      );
      const hasYield =
        sweepMod &&
        Array.isArray(sweepMod.IncomePct) &&
        sweepMod.IncomePct.length > 0;

      if (sweepMod && hasYield) {
        console.log(`[FORECAST-GENERATE] Starting income-sweep convergence for ${sweepMod.Name}`);
        const MAX_ITERATIONS = 10;
        const TOLERANCE = 100; // $100 convergence threshold

        const modStartYear = new Date(sweepMod.BaseDate).getFullYear();
        const modEndYear = scenario.PeriodEnd;
        const modYearsCount = modEndYear - modStartYear + 1;
        const inflationSeries = df_assumptions.column(categories[1]).values;
        const periodStartYr = years[0];
        const inflationLen = inflationSeries.length;

        // Precompute static module values (same as processModule)
        const isLiability = sweepMod.AccountType === 'liability';
        const growthPct = sweepMod.Growth ?? 0;

        // Parse IncomePct schedule
        const sortedIncomePct = [...sweepMod.IncomePct]
          .filter((e) => e && e.Date && e.Value != null)
          .map((e) => ({ year: new Date(e.Date).getFullYear(), value: e.Value }))
          .sort((a, b) => a.year - b.year);

        const incomePctValues = new Array(modYearsCount).fill(0);
        {
          let cur = 0, ni = 0;
          for (let i = 0, yr = modStartYear; yr <= modEndYear; i++, yr++) {
            while (ni < sortedIncomePct.length && sortedIncomePct[ni].year <= yr) {
              cur = sortedIncomePct[ni].value;
              ni++;
            }
            incomePctValues[i] = cur;
          }
        }

        // Compute market values array (same as processModule lines 168-303, without income)
        const computeMarketValues = () => {
          const mv = new Array(modYearsCount).fill(sweepMod.MarketValue ?? 0);
          const bv = new Array(modYearsCount).fill(sweepMod.BaseValue ?? 0);
          const inv = new Array(modYearsCount).fill(0);
          const disp = new Array(modYearsCount).fill(0);

          if (Array.isArray(sweepMod.Invest)) {
            for (const e of sweepMod.Invest) {
              if (!e || !e.Date || e.Amount == null) continue;
              const idx = new Date(e.Date).getFullYear() - modStartYear;
              if (idx >= 0 && idx < modYearsCount) inv[idx] = e.Amount;
            }
          }
          if (Array.isArray(sweepMod.Dispose)) {
            for (const e of sweepMod.Dispose) {
              if (!e || !e.Date || e.Amount == null) continue;
              const startIdx = new Date(e.Date).getFullYear() - modStartYear;
              if (e.Flag === 'Periodic') {
                const endYr = e.DateEnd ? new Date(e.DateEnd).getFullYear() : modEndYear;
                const endIdx = Math.min(endYr - modStartYear, modYearsCount - 1);
                for (let j = Math.max(0, startIdx); j <= endIdx; j++) disp[j] += -e.Amount;
              } else if (e.Flag !== 'Full') {
                if (startIdx >= 0 && startIdx < modYearsCount) disp[startIdx] = -e.Amount;
              }
            }
          }

          // Base year adjust
          if (inv[0] !== 0 || disp[0] !== 0) {
            const origM = mv[0], origB = bv[0];
            const avail = origM + inv[0];
            if (disp[0] < -avail && avail > 0) disp[0] = -avail;
            else if (avail <= 0) disp[0] = 0;
            const adj = origM === 0 ? 0 : (disp[0] * origB) / origM;
            bv[0] = origB + inv[0] + adj;
            mv[0] = origM + inv[0] + disp[0];
          }

          for (let i = 1; i < modYearsCount; i++) {
            const idx = (modStartYear + i) - periodStartYr;
            const g = idx >= 0 && idx < inflationLen ? growthPct * inflationSeries[idx] : 0;
            const ug = mv[i - 1] * (g / 100);
            const avail = mv[i - 1] + ug + inv[i];
            if (disp[i] < -avail && avail > 0) disp[i] = -avail;
            else if (avail <= 0) disp[i] = 0;
            const adj = mv[i - 1] === 0 ? 0 : (disp[i] * bv[i - 1]) / mv[i - 1];
            bv[i] = bv[i - 1] + inv[i] + adj;
            mv[i] = mv[i - 1] + ug + inv[i] + disp[i];
          }
          return mv;
        };

        const moduleMarketValues = computeMarketValues();

        // FX rates for the module
        const modFx = new Array(modYearsCount).fill(1);
        if (sweepMod.Currency && sweepMod.Currency !== 'USD') {
          const fxCol = sweepMod.Currency === 'PLN' ? categories[2] : sweepMod.Currency === 'EUR' ? categories[3] : null;
          if (fxCol && df_assumptions.columns.includes(fxCol)) {
            const fxSeries = df_assumptions.column(fxCol).values;
            const firstFx = fxSeries[0] || 1;
            for (let i = 0, yr = modStartYear; yr <= modEndYear; i++, yr++) {
              const idx = yr - periodStartYr;
              modFx[i] = (idx >= 0 && idx < fxSeries.length) ? fxSeries[idx] : firstFx;
            }
          }
        }
        modFx[0] = (sweepMod.BaseValueUSD ?? 0) !== 0 ? (sweepMod.BaseValue ?? 0) / (sweepMod.BaseValueUSD ?? 1) : 1;

        // Tax rate
        const taxRate = sweepMod.tax_rate_override != null
          ? Number(sweepMod.tax_rate_override)
          : Number(scenario?.TaxRate ?? 0);
        const rateFactor = Number.isFinite(taxRate) && taxRate !== 0 ? -taxRate / 100 : 0;
        const absIncomeAmount = parseFloat(sweepMod.income_amount) || 0;
        const incomeAccount = sweepMod.IncomeCategory || 'Income';

        let prevIncomeUSD = null;

        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
          // 1. Get current sweep adjustments per year for this module
          const sweepAdjResult = await dbc.query(`
            SELECT forecast_year,
                   SUM(amount)::numeric as adj
            FROM forecast_entries
            WHERE scenario_id = $1 AND account = $2 AND module IN ('_cash_sweep', '_sweep_bal')
            GROUP BY forecast_year ORDER BY forecast_year
          `, [scenarioId, sweepModule.account_name]);

          const sweepAdjByYear = {};
          for (const row of sweepAdjResult.rows) {
            sweepAdjByYear[row.forecast_year] = parseFloat(row.adj) || 0;
          }

          // 2. Compute adjusted market values (module own MV + cumulative sweep adj)
          const adjustedMV = new Array(modYearsCount);
          for (let i = 0; i < modYearsCount; i++) {
            const yr = modStartYear + i;
            // Cumulative sweep: _sweep_bal carries forward, _cash_sweep is current year
            adjustedMV[i] = moduleMarketValues[i] + (sweepAdjByYear[yr] || 0);
          }

          // 3. Recalculate income using adjusted MV
          const newIncome = new Array(modYearsCount).fill(0);
          for (let i = 0, yr = modStartYear; yr <= modEndYear; i++, yr++) {
            const idx = yr - periodStartYr;
            if (idx < 0 || idx >= inflationLen) continue;
            const eff = (inflationSeries[idx] || 0) + incomePctValues[i];
            const prevMV = i > 0 ? adjustedMV[i - 1] : adjustedMV[0];
            newIncome[i] = ((adjustedMV[i] + prevMV) / 2) * eff / 100;
          }

          // Apply Full disposal adjustments to income
          if (Array.isArray(sweepMod.Dispose)) {
            for (const e of sweepMod.Dispose) {
              if (e.Flag !== 'Full') continue;
              const di = new Date(e.Date).getFullYear() - modStartYear;
              if (di >= 0 && di < modYearsCount) {
                if (di === 0) { for (let j = 1; j < modYearsCount; j++) newIncome[j] = 0; }
                else {
                  newIncome[di] = newIncome[di] / 2;
                  for (let j = di + 1; j < modYearsCount; j++) newIncome[j] = 0;
                }
              }
            }
          }

          // Convert to USD
          const newIncomeUSD = newIncome.map((v, i) => v / (modFx[i] || 1));

          // 4. Check convergence
          if (prevIncomeUSD) {
            let maxDelta = 0;
            for (let i = 0; i < modYearsCount; i++) {
              maxDelta = Math.max(maxDelta, Math.abs(newIncomeUSD[i] - prevIncomeUSD[i]));
            }
            if (maxDelta < TOLERANCE) {
              console.log(`[FORECAST-GENERATE] Income-sweep converged after ${iteration + 1} iteration(s) (maxDelta: $${maxDelta.toFixed(2)})`);
              break;
            }
            console.log(`[FORECAST-GENERATE] Iteration ${iteration + 1}: maxDelta = $${maxDelta.toFixed(0)}`);
          }
          prevIncomeUSD = [...newIncomeUSD];

          // 5. Compute income delta and adjust tax accordingly
          // Load current income entries for this module
          const curIncResult = await dbc.query(`
            SELECT forecast_year, amount FROM forecast_entries
            WHERE scenario_id = $1 AND module = $2 AND account = $3
            ORDER BY forecast_year
          `, [scenarioId, sweepMod.Name, incomeAccount]);
          const curIncByYear = {};
          for (const row of curIncResult.rows) curIncByYear[row.forecast_year] = parseFloat(row.amount) || 0;

          // Compute income delta per year (new - current), then compute tax delta (deferred by 1 year)
          const incomeDeltaByYear = {};
          const taxDeltaByYear = {};
          for (let i = 0; i < modYearsCount; i++) {
            const yr = modStartYear + i;
            const fx = modFx[i] || 1;
            const curInc = curIncByYear[yr] || 0;
            const newIncUSD = newIncome[i] / fx;
            incomeDeltaByYear[yr] = newIncUSD - curInc;
          }

          // Tax delta: deferred by 1 year, only on positive income
          if (rateFactor !== 0) {
            for (let i = 0; i < modYearsCount; i++) {
              const yr = modStartYear + i;
              const fx = modFx[i] || 1;
              const curInc = curIncByYear[yr] || 0;
              const newIncUSD = newIncome[i] / fx;
              // Tax on current income vs new income
              const curTax = curInc > 0 ? rateFactor * curInc : 0;
              const newTax = newIncUSD > 0 ? rateFactor * newIncUSD : 0;
              const delta = newTax - curTax;
              if (Math.abs(delta) > 0.01) {
                const targetYr = i + 1 < modYearsCount ? modStartYear + i + 1 : yr;
                taxDeltaByYear[targetYr] = (taxDeltaByYear[targetYr] || 0) + delta;
              }
            }
          }

          // 6. Apply deltas: UPDATE income entries, UPDATE tax entries, UPDATE bank entries
          for (let i = 0; i < modYearsCount; i++) {
            const yr = modStartYear + i;
            const incDelta = incomeDeltaByYear[yr] || 0;
            const taxDelta = taxDeltaByYear[yr] || 0;
            const bankDelta = incDelta + taxDelta; // income and tax both affect cash

            if (Math.abs(incDelta) > 0.01) {
              await dbc.query(`
                UPDATE forecast_entries SET amount = amount + $1
                WHERE scenario_id = $2 AND forecast_year = $3 AND module = $4 AND account = $5
              `, [incDelta, scenarioId, yr, sweepMod.Name, incomeAccount]);
            }
            if (Math.abs(taxDelta) > 0.01) {
              await dbc.query(`
                UPDATE forecast_entries SET amount = amount + $1
                WHERE scenario_id = $2 AND forecast_year = $3 AND module = $4 AND account = 'Taxes'
              `, [taxDelta, scenarioId, yr, sweepMod.Name]);
            }
            if (Math.abs(bankDelta) > 0.01) {
              await dbc.query(`
                UPDATE forecast_entries SET amount = amount + $1
                WHERE scenario_id = $2 AND forecast_year = $3 AND module = $4 AND account = 'Bank Accounts'
              `, [bankDelta, scenarioId, yr, sweepMod.Name]);
            }
          }

          // 7. Recompute cash deltas and re-run sweep
          await dbc.query(`
            DELETE FROM forecast_entries
            WHERE scenario_id = $1 AND module IN ('_cash_sweep', '_sweep_bal', '_rebalance')
          `, [scenarioId]);

          const newCashResult = await dbc.query(`
            SELECT forecast_year, SUM(amount) as cash_total
            FROM forecast_entries
            WHERE scenario_id = $1 AND account = 'Bank Accounts'
            GROUP BY forecast_year ORDER BY forecast_year
          `, [scenarioId]);
          const newCashDelta = {};
          for (const row of newCashResult.rows) newCashDelta[row.forecast_year] = parseFloat(row.cash_total) || 0;

          // Apply BaseYear correction (same as Step 7)
          const baseYear = scenario.PeriodStart - 1;
          if (newCashDelta[baseYear] !== undefined) {
            newCashDelta[baseYear] = cashDeltaByYear[baseYear]; // Use the corrected value from Step 7
          }

          // Reload module balance (module's own entries only, excluding sweep)
          const newMvResult = await dbc.query(`
            SELECT forecast_year, SUM(amount)::numeric as mv
            FROM forecast_entries
            WHERE scenario_id = $1 AND account = $2 AND module = $3
            GROUP BY forecast_year ORDER BY forecast_year
          `, [scenarioId, sweepModule.account_name, sweepMod.Name]);
          const newModBal = {};
          for (const row of newMvResult.rows) newModBal[row.forecast_year] = parseFloat(row.mv) || 0;

          const { entries: newSweepEntries } = computeCashSweepIterative({
            years,
            cashSweepLow: cashSweepLow ?? cashSweepHigh ?? 0,
            cashSweepHigh: cashSweepHigh ?? cashSweepLow ?? 0,
            cashDeltaByYear: newCashDelta,
            startingCash,
            sweepModule,
            moduleBalanceByYear: newModBal,
            backupModules, // builder balances unchanged across iterations
          });

          if (newSweepEntries.length > 0) {
            const sv = [], sp = [];
            let si = 1;
            for (const e of newSweepEntries) {
              sv.push(`($${si++}, $${si++}, $${si++}, $${si++}, $${si++}, $${si++})`);
              sp.push(scenarioId, e.year, e.amount, e.account, e.module, e.comment);
            }
            await dbc.query(`
              INSERT INTO forecast_entries (scenario_id, forecast_year, amount, account, module, comment)
              VALUES ${sv.join(', ')}
            `, sp);
          }
        } // end convergence loop
      }
      } // end if (sweepModule)
    } // end if (hasSweepBand)

    // Step 8: Calculate statistics
    const totalEntries = results.reduce((sum, r) => sum + (r?.entriesCount || 0), 0) + rebalanceEntries;

    return {
      deletedCount,
      modulesProcessed: bsModules.length + incexpModules.length,
      entriesCreated: totalEntries,
    };

    }); // end db.transaction — COMMIT here, advisory lock released

    const durationMs = Date.now() - startTime;

    console.log(`[FORECAST-GENERATE] Forecast generation completed successfully`);
    console.log(`[FORECAST-GENERATE] Total entries created: ${stats.entriesCreated}`);
    console.log(`[FORECAST-GENERATE] Duration: ${durationMs}ms`);

    return {
      success: true,
      scenario: scenarioName,
      ...stats,
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
