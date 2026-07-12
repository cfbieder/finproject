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

const fs = require("fs");
const path = require("path");
const db = require("../../v2/db");
const { loadScenarioConfig } = require("./fcbuilder-setup");
const { LabelFrame } = require("./frame");
const { computeModule: computeBSModule, writeAuditTrail } = require("./fcbuilder-module");
const { computeModule: computeIncExpModule, writeEntriesAuditTrail } = require("./fcbuilder-incexp");
const { insertModuleEntries } = require("./fcbuilder-common");
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

    const df_assumptions = LabelFrame.fromColumns(
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

    // Step 3: Preload FC Line name map (id → name)
    // (The clear-out of existing entries moved to the PERSIST phase, Step 6c —
    // nothing between here and there reads forecast_entries, and same tx.)
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
    if (!incexpCategories.includes(CATEGORIES.BANK_ACCOUNTS)) {
      // Deduped (CR043 2.3): an inc/exp item mapped to the literal 'Bank
      // Accounts' account used to produce a duplicate row label here and crash
      // the (danfo) frame with an opaque IndexError mid-generate.
      incexpCategories.push(CATEGORIES.BANK_ACCOUNTS);
    }

    const columns = buildColumns(years);

    // Step 6a: COMPUTE (pure) — every module's series + entries payload, in
    // deterministic array order (BS modules then inc/exp items). No I/O: each
    // computeModule fills a fresh category × year frame and returns the
    // flattened forecast_entries payload.
    console.log(`[FORECAST-GENERATE] Processing ${bsModules.length + incexpModules.length} modules...`);

    const computed = [
      ...bsModules.map((module) => ({
        kind: 'bs',
        module,
        result: computeBSModule(
          module, scenario, df_assumptions,
          LabelFrame.zeros(scenarioCategories, columns),
          categories, years, scenarioId
        ),
      })),
      ...incexpModules.map((module) => ({
        kind: 'incexp',
        module,
        result: computeIncExpModule(
          module, scenario, df_assumptions,
          LabelFrame.zeros(incexpCategories, columns),
          categories, years, scenarioId
        ),
      })),
    ];

    // Step 6b: audit-trail CSVs (fs side effect, kept out of the numbers path)
    for (const c of computed) {
      if (c.kind === 'bs') {
        writeAuditTrail(c.result.audit.dfModuleLC, c.result.audit.dfModuleUSD, c.result.audit.dfCategories, scenario, c.module);
      } else {
        writeEntriesAuditTrail(c.result.audit.dfCategories, scenario?.Name, c.module?.Account);
      }
    }

    // Step 6c: PERSIST — clear the previous build, then per-module inserts in
    // the same order and with the same statements as ever (the ON CONFLICT
    // last-write-wins between same-account inc/exp items is load-bearing).
    const deleteResult = await dbc.query('DELETE FROM forecast_entries WHERE scenario_id = $1', [scenarioId]);
    const deletedCount = deleteResult.rowCount;
    console.log(`[FORECAST-GENERATE] Deleted ${deletedCount} existing entries`);

    const results = [];
    for (const c of computed) {
      const inserted = await insertModuleEntries(dbc, c.result.entries);
      results.push({
        moduleName: c.result.moduleName,
        account: c.result.account,
        entriesCount: inserted.length,
      });
    }

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

      // N9 guard (CR043): the starting-cash query below walks the COA subtree
      // named 'Bank Accounts'. If that account is renamed or deleted the query
      // silently returns no rows and the sweep starts from $0 — wrong numbers,
      // no error. Fail loud instead.
      const bankRootCheck = await dbc.query('SELECT 1 FROM accounts WHERE name = $1 LIMIT 1', [CATEGORIES.BANK_ACCOUNTS]);
      if (bankRootCheck.rows.length === 0) {
        throw new Error(
          `Cash sweep requires a COA account named "${CATEGORIES.BANK_ACCOUNTS}" (engine anchor, CR043 N9) — not found. ` +
          `Restore the account name or clear the scenario's sweep band.`
        );
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

      // Fold the BaseYear into the sweep's opening cash (CR045 Phase 1b).
      //
      // The sweep iterates `years` = PeriodStart…PeriodEnd, so the BaseYear
      // (PeriodStart - 1) is never visited: correcting cashDeltaByYear[baseYear]
      // — as this block used to do — left the value unread, and the sweep opened
      // PeriodStart on the LastActualYear ledger balance, ignoring a whole year of
      // cash flow. It then held the band against that inflated figure, so the bank
      // line the Review displays sat a full BaseYear NCF *below* the low band in
      // every swept year. Seeding startingCash instead applies the same corrected
      // delta on the only path the sweep actually reads, and keeps the BaseYear
      // free of sweep transfers (which the Review's budget-based BaseYear assumes).
      //
      // The delta is budget-based, not engine-based: the Review shows BaseYear as
      // budget P&L + engine transfers, not the engine's own Bank Accounts entries.
      const baseYear = scenario.PeriodStart - 1;
      {
        // Get budget NCF for BaseYear (same query as base-year-values endpoint)
        // Must mirror crud.getBaseYearValues EXACTLY — this is the same base-year P&L the
        // Review displays, and the two silently disagreeing is how a $35K rent that does not
        // start until 2028 ended up in the sweep's opening cash (CR046 window, fixed
        // v3.0.88): a stream only counts in the base year if its window is open that year.
        const budgetResult = await dbc.query(`
          SELECT COALESCE(SUM(val.amount), 0)::numeric as budget_ncf FROM (
            SELECT SUM(CASE WHEN a.account_type = 'liability'
                             THEN -m.expense_amount * (CASE WHEN EXTRACT(YEAR FROM m.expense_start_date) = $2
                                                              OR EXTRACT(YEAR FROM m.expense_end_date)   = $2
                                                            THEN 0.5 ELSE 1 END)
                             ELSE 0 END) as amount
            FROM forecast_modules m LEFT JOIN accounts a ON m.account_id = a.id LEFT JOIN fc_lines exp_line ON m.expense_fc_line_id = exp_line.id
            WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude') AND m.expense_fc_line_id IS NOT NULL
              AND (m.expense_start_date IS NULL OR EXTRACT(YEAR FROM m.expense_start_date) <= $2)
              AND (m.expense_end_date   IS NULL OR EXTRACT(YEAR FROM m.expense_end_date)   >= $2)
            UNION ALL
            SELECT SUM(COALESCE(m.income_amount, 0) * (CASE WHEN EXTRACT(YEAR FROM m.income_start_date) = $2
                                                                 OR EXTRACT(YEAR FROM m.income_end_date)   = $2
                                                               THEN 0.5 ELSE 1 END))
            FROM forecast_modules m LEFT JOIN fc_lines inc_line ON m.income_fc_line_id = inc_line.id
            WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude') AND m.income_fc_line_id IS NOT NULL
              AND (m.income_start_date IS NULL OR EXTRACT(YEAR FROM m.income_start_date) <= $2)
              AND (m.income_end_date   IS NULL OR EXTRACT(YEAR FROM m.income_end_date)   >= $2)
            UNION ALL
            SELECT ie.base_value FROM forecast_income_expense ie LEFT JOIN fc_lines fl ON ie.fc_line_id = fl.id
            WHERE ie.scenario_id = $1 AND COALESCE(ie.setup_status, 'new') NOT IN ('new', 'exclude')
          ) val
        `, [scenarioId, baseYear]);
        const budgetNCF = parseFloat(budgetResult.rows[0]?.budget_ncf) || 0;

        // Get engine transfers for BaseYear (Transfer - Bank entries)
        const transferResult = await dbc.query(`
          SELECT COALESCE(SUM(amount), 0)::numeric as transfers
          FROM forecast_entries
          WHERE scenario_id = $1 AND forecast_year = $2 AND account = 'Transfer - Bank'
        `, [scenarioId, baseYear]);
        const baseYearTransfers = parseFloat(transferResult.rows[0]?.transfers) || 0;

        const correctedBaseYearDelta = budgetNCF + baseYearTransfers;
        startingCash += correctedBaseYearDelta;
        delete cashDeltaByYear[baseYear]; // folded into the seed — never double-count it
        console.log(`[FORECAST-GENERATE] BaseYear ${baseYear} delta ${correctedBaseYearDelta.toFixed(0)} folded into opening cash → ${startingCash.toFixed(0)} (budget NCF: ${budgetNCF.toFixed(0)}, transfers: ${baseYearTransfers.toFixed(0)})`);
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

      // CR045 P2: the sweep needs each ranked module's cost basis (to realize a gain
      // on a forced liquidation) and its effective growth (so the funds it sells stop
      // compounding). Both were already computed by the builder in Step 6a — read them
      // off the staged frames rather than re-deriving the builder's math a third time.
      const sweepSeriesFor = (moduleName) => {
        const c = computed.find((x) => x.kind === 'bs' && x.module?.Name === moduleName);
        const usd = c?.result?.audit?.dfModuleUSD;
        const basisByYear = {};
        const growthByYear = {};
        if (usd && Array.isArray(usd.index)) {
          const basis = usd.columns?.includes('BaseValueUSD') ? usd.column('BaseValueUSD').values : [];
          const growth = usd.columns?.includes('GrowthPct') ? usd.column('GrowthPct').values : [];
          usd.index.forEach((yr, i) => {
            basisByYear[Number(yr)] = Number(basis[i]) || 0;
            growthByYear[Number(yr)] = Number(growth[i]) || 0;
          });
        }
        return { basisByYear, growthByYear };
      };
      const taxRateFor = (mod) => Number(
        mod?.tax_rate_override != null ? mod.tax_rate_override : (scenario?.TaxRate ?? 0)
      ) || 0;

      const primarySeries = sweepModule ? sweepSeriesFor(sweepModule.name) : { basisByYear: {}, growthByYear: {} };
      for (const bm of backupModules) {
        const s = sweepSeriesFor(bm.name);
        bm.basisByYear = s.basisByYear;
        bm.growthByYear = s.growthByYear;
        bm.taxRate = taxRateFor(backupModuleRows.find((r) => r.name === bm.name));
      }

      const sweepArgs = {
        years,
        cashSweepLow: effectiveLow,
        cashSweepHigh: effectiveHigh,
        cashDeltaByYear,
        startingCash,
        sweepModule,
        moduleBalanceByYear,
        moduleBasisByYear: primarySeries.basisByYear,
        moduleGrowthByYear: primarySeries.growthByYear,
        moduleTaxRate: taxRateFor(sweepModule),
        backupModules,
      };

      // Run iterative sweep (pure function — transfers + capital-gains tax, no yield)
      const { entries: sweepEntries, sweepLog } = computeCashSweepIterative(sweepArgs);

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

      // Step 7b: Iterative income↔sweep convergence — for EVERY ranked module with a
      // yield schedule, not just the primary (CR048 A1).
      //
      // Yield income is a % of market value, and the sweep changes market value; the sweep
      // in turn depends on cash, which includes that income. Until CR048 this fixed point
      // was only solved for the PRIMARY module: a backup the sweep drained kept paying
      // dividends on its full pre-sweep balance — ~2% on money that was gone, in exactly
      // the years the plan is short (Fidelity Stocks, fully liquidated by 2060 in "House
      // Purchase", kept yielding on $1.2M it no longer held).
      //
      // Also fixed while generalizing:
      //  - A3: recomputed income is re-taxed at the INCOME rate chain
      //    (income_tax_rate_override ?? tax_rate_override ?? scenario), matching the
      //    builder — it used the gains chain, silently overriding CR047 on rebuild.
      //  - units: sweep adjustments are USD entries; the module MV here is LC. They were
      //    added raw (harmless while every sweep module is USD, wrong the day one isn't) —
      //    the adjustment is now converted at the module's FX before mixing.
      //  - CR046 window: the recompute now applies the income window (zero outside,
      //    half at the boundary years) instead of resurrecting windowed-off income.
      //
      // Amount-based income (income_amount, no yield schedule) is deliberately NOT scaled
      // by sweep drains: it is contractual (a dividend policy, a rent), not a % of value.
      // Flagged in CR048 as a modelling choice, not an omission.
      if (sweepModule) {
        const inflationSeries = df_assumptions.column(categories[1]).values;
        const periodStartYr = years[0];
        const inflationLen = inflationSeries.length;

        const rankedRows = [sweepModule, ...backupModuleRows];
        const yieldContexts = [];

        for (const row of rankedRows) {
          const mod = bsModules.find((m) => m.id === row.id || m.Name === row.name);
          if (!mod || !Array.isArray(mod.IncomePct) || mod.IncomePct.length === 0) continue;

          const modStartYear = new Date(mod.BaseDate).getFullYear();
          const modEndYear = scenario.PeriodEnd;
          const modYearsCount = modEndYear - modStartYear + 1;
          const growthPct = mod.Growth ?? 0;

          // Yield schedule → per-year spread values (step function)
          const sortedIncomePct = [...mod.IncomePct]
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

          // Builder-only market values in LC (mirror of computeModule, income-free).
          // Fixed across iterations: convergence only rewrites income/tax/bank rows.
          const mvLC = (() => {
            const mv = new Array(modYearsCount).fill(mod.MarketValue ?? 0);
            const bv = new Array(modYearsCount).fill(mod.BaseValue ?? 0);
            const inv = new Array(modYearsCount).fill(0);
            const disp = new Array(modYearsCount).fill(0);

            if (Array.isArray(mod.Invest)) {
              for (const e of mod.Invest) {
                if (!e || !e.Date || e.Amount == null) continue;
                const idx = new Date(e.Date).getFullYear() - modStartYear;
                if (e.Flag === 'Periodic') {
                  const endYr = e.DateEnd ? new Date(e.DateEnd).getFullYear() : modEndYear;
                  const endIdx = Math.min(endYr - modStartYear, modYearsCount - 1);
                  for (let j = Math.max(0, idx); j <= endIdx; j++) inv[j] += e.Amount;
                } else if (idx >= 0 && idx < modYearsCount) {
                  inv[idx] = e.Amount;
                }
              }
            }
            if (Array.isArray(mod.Dispose)) {
              for (const e of mod.Dispose) {
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
          })();

          // FX per year (LC per USD); base year pinned to the module's own stored ratio
          const modFx = new Array(modYearsCount).fill(1);
          if (mod.Currency && mod.Currency !== 'USD') {
            const fxCol = mod.Currency === 'PLN' ? categories[2] : mod.Currency === 'EUR' ? categories[3] : null;
            if (fxCol && df_assumptions.columns.includes(fxCol)) {
              const fxSeries = df_assumptions.column(fxCol).values;
              const firstFx = fxSeries[0] || 1;
              for (let i = 0, yr = modStartYear; yr <= modEndYear; i++, yr++) {
                const idx = yr - periodStartYr;
                modFx[i] = (idx >= 0 && idx < fxSeries.length) ? fxSeries[idx] : firstFx;
              }
            }
          }
          modFx[0] = (mod.BaseValueUSD ?? 0) !== 0 ? (mod.BaseValue ?? 0) / (mod.BaseValueUSD ?? 1) : 1;

          // CR048 A3: income is taxed at the income chain, exactly as the builder does
          const taxRate = mod.income_tax_rate_override != null
            ? Number(mod.income_tax_rate_override)
            : (mod.tax_rate_override != null
              ? Number(mod.tax_rate_override)
              : Number(scenario?.TaxRate ?? 0));
          const rateFactor = Number.isFinite(taxRate) && taxRate !== 0 ? -taxRate / 100 : 0;

          // CR046 income window, as year indices from the module's start
          const winFrom = mod.income_start_date
            ? new Date(mod.income_start_date).getFullYear() - modStartYear : null;
          const winTo = mod.income_end_date
            ? new Date(mod.income_end_date).getFullYear() - modStartYear : null;

          yieldContexts.push({
            mod,
            account: row.account_name,
            incomeAccount: mod.IncomeCategory || 'Income',
            modStartYear, modEndYear, modYearsCount,
            incomePctValues, mvLC, modFx, rateFactor, winFrom, winTo,
            prevIncomeUSD: null,
            newIncome: null,
          });
        }

        if (yieldContexts.length > 0) {
          console.log(`[FORECAST-GENERATE] Starting income-sweep convergence for ${yieldContexts.map((c) => c.mod.Name).join(', ')}`);
          const MAX_ITERATIONS = 10;
          const TOLERANCE = 100; // $100 convergence threshold, across all modules

          for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
            // 1. Recompute every yield module's income off its sweep-adjusted balance
            let maxDelta = 0;
            let havePrev = true;

            for (const ctx of yieldContexts) {
              const sweepAdjResult = await dbc.query(`
                SELECT forecast_year, SUM(amount)::numeric as adj
                FROM forecast_entries
                WHERE scenario_id = $1 AND account = $2 AND module IN ('_cash_sweep', '_sweep_bal')
                GROUP BY forecast_year ORDER BY forecast_year
              `, [scenarioId, ctx.account]);
              const sweepAdjByYear = {};
              for (const row of sweepAdjResult.rows) {
                sweepAdjByYear[row.forecast_year] = parseFloat(row.adj) || 0;
              }

              // Sweep entries are USD; the module series is LC — convert before mixing.
              const adjustedMV = new Array(ctx.modYearsCount);
              for (let i = 0; i < ctx.modYearsCount; i++) {
                const yr = ctx.modStartYear + i;
                adjustedMV[i] = ctx.mvLC[i] + (sweepAdjByYear[yr] || 0) * (ctx.modFx[i] || 1);
              }

              const newIncome = new Array(ctx.modYearsCount).fill(0);
              for (let i = 0, yr = ctx.modStartYear; yr <= ctx.modEndYear; i++, yr++) {
                const idx = yr - periodStartYr;
                if (idx < 0 || idx >= inflationLen) continue;
                const eff = (inflationSeries[idx] || 0) + ctx.incomePctValues[i];
                const prevMV = i > 0 ? adjustedMV[i - 1] : adjustedMV[0];
                newIncome[i] = ((adjustedMV[i] + prevMV) / 2) * eff / 100;
              }

              // Full disposal: half income in the sale year, none after
              if (Array.isArray(ctx.mod.Dispose)) {
                for (const e of ctx.mod.Dispose) {
                  if (e.Flag !== 'Full') continue;
                  const di = new Date(e.Date).getFullYear() - ctx.modStartYear;
                  if (di >= 0 && di < ctx.modYearsCount) {
                    if (di === 0) { for (let j = 1; j < ctx.modYearsCount; j++) newIncome[j] = 0; }
                    else {
                      newIncome[di] = newIncome[di] / 2;
                      for (let j = di + 1; j < ctx.modYearsCount; j++) newIncome[j] = 0;
                    }
                  }
                }
              }

              // CR046 income window: zero outside, half at the boundary years
              if (ctx.winFrom != null || ctx.winTo != null) {
                for (let i = 0; i < ctx.modYearsCount; i++) {
                  if ((ctx.winFrom != null && i < ctx.winFrom) || (ctx.winTo != null && i > ctx.winTo)) {
                    newIncome[i] = 0;
                  } else if (i === ctx.winFrom || i === ctx.winTo) {
                    newIncome[i] /= 2;
                  }
                }
              }

              const newIncomeUSD = newIncome.map((v, i) => v / (ctx.modFx[i] || 1));
              if (ctx.prevIncomeUSD) {
                for (let i = 0; i < ctx.modYearsCount; i++) {
                  maxDelta = Math.max(maxDelta, Math.abs(newIncomeUSD[i] - ctx.prevIncomeUSD[i]));
                }
              } else {
                havePrev = false;
              }
              ctx.prevIncomeUSD = [...newIncomeUSD];
              ctx.newIncome = newIncome;
            }

            // 2. Converged when no module's income moved more than the tolerance
            if (havePrev && maxDelta < TOLERANCE) {
              console.log(`[FORECAST-GENERATE] Income-sweep converged after ${iteration + 1} iteration(s) (maxDelta: $${maxDelta.toFixed(2)})`);
              break;
            }
            if (havePrev) {
              console.log(`[FORECAST-GENERATE] Iteration ${iteration + 1}: maxDelta = $${maxDelta.toFixed(0)}`);
            }

            // 3. Apply income/tax/bank deltas per module (tax deferred one year, income rate)
            for (const ctx of yieldContexts) {
              const curIncResult = await dbc.query(`
                SELECT forecast_year, amount FROM forecast_entries
                WHERE scenario_id = $1 AND module = $2 AND account = $3
                ORDER BY forecast_year
              `, [scenarioId, ctx.mod.Name, ctx.incomeAccount]);
              const curIncByYear = {};
              for (const row of curIncResult.rows) curIncByYear[row.forecast_year] = parseFloat(row.amount) || 0;

              const incomeDeltaByYear = {};
              const taxDeltaByYear = {};
              for (let i = 0; i < ctx.modYearsCount; i++) {
                const yr = ctx.modStartYear + i;
                const fx = ctx.modFx[i] || 1;
                const curInc = curIncByYear[yr] || 0;
                const newIncUSD = ctx.newIncome[i] / fx;
                incomeDeltaByYear[yr] = newIncUSD - curInc;

                if (ctx.rateFactor !== 0) {
                  const curTax = curInc > 0 ? ctx.rateFactor * curInc : 0;
                  const newTax = newIncUSD > 0 ? ctx.rateFactor * newIncUSD : 0;
                  const delta = newTax - curTax;
                  if (Math.abs(delta) > 0.01) {
                    const targetYr = i + 1 < ctx.modYearsCount ? yr + 1 : yr;
                    taxDeltaByYear[targetYr] = (taxDeltaByYear[targetYr] || 0) + delta;
                  }
                }
              }

              for (let i = 0; i < ctx.modYearsCount; i++) {
                const yr = ctx.modStartYear + i;
                const incDelta = incomeDeltaByYear[yr] || 0;
                const taxDelta = taxDeltaByYear[yr] || 0;
                const bankDelta = incDelta + taxDelta; // income and tax both affect cash

                if (Math.abs(incDelta) > 0.01) {
                  await dbc.query(`
                    UPDATE forecast_entries SET amount = amount + $1
                    WHERE scenario_id = $2 AND forecast_year = $3 AND module = $4 AND account = $5
                  `, [incDelta, scenarioId, yr, ctx.mod.Name, ctx.incomeAccount]);
                }
                if (Math.abs(taxDelta) > 0.01) {
                  await dbc.query(`
                    UPDATE forecast_entries SET amount = amount + $1
                    WHERE scenario_id = $2 AND forecast_year = $3 AND module = $4 AND account = 'Taxes'
                  `, [taxDelta, scenarioId, yr, ctx.mod.Name]);
                }
                if (Math.abs(bankDelta) > 0.01) {
                  await dbc.query(`
                    UPDATE forecast_entries SET amount = amount + $1
                    WHERE scenario_id = $2 AND forecast_year = $3 AND module = $4 AND account = 'Bank Accounts'
                  `, [bankDelta, scenarioId, yr, ctx.mod.Name]);
                }
              }
            }

            // 4. Recompute cash deltas and re-run the sweep against the new income
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

            // The BaseYear is not a swept year: its cash flow is already folded into
            // `startingCash` (Step 7), so drop the key rather than re-deriving it.
            delete newCashDelta[scenario.PeriodStart - 1];

            // Reload the primary's builder-only balance (its own entries, sweep excluded).
            // Backup balances are fixed across iterations for the same reason.
            const newMvResult = await dbc.query(`
              SELECT forecast_year, SUM(amount)::numeric as mv
              FROM forecast_entries
              WHERE scenario_id = $1 AND account = $2 AND module = $3
              GROUP BY forecast_year ORDER BY forecast_year
            `, [scenarioId, sweepModule.account_name, sweepModule.name]);
            const newModBal = {};
            for (const row of newMvResult.rows) newModBal[row.forecast_year] = parseFloat(row.mv) || 0;

            // Same sweep, re-run against the re-derived cash/balance for this iteration.
            // The CR045 P2 series (basis, growth, tax rate) are properties of the module,
            // not of the iteration, so they carry over from sweepArgs — omitting them here
            // would silently drop the capital-gains tax on every rebuild.
            const { entries: newSweepEntries } = computeCashSweepIterative({
              ...sweepArgs,
              cashSweepLow: cashSweepLow ?? cashSweepHigh ?? 0,
              cashSweepHigh: cashSweepHigh ?? cashSweepLow ?? 0,
              cashDeltaByYear: newCashDelta,
              moduleBalanceByYear: newModBal,
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
