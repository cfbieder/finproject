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
// CR069 P2 — ONE builder. `fcbuilder-incexp.js` is deleted: an income/expense item is a
// module with `has_valuation = FALSE` and a single stream, and goes through the same path.
const { computeModule, writeAuditTrail } = require("./fcbuilder-module");
const { insertModuleEntries, growthPctForYear } = require("./fcbuilder-common");
const { deriveLoanSchedule } = require("./fcbuilder-loan");
const { CATEGORIES, PATHS } = require("./constants");
const { computeCashSweepIterative } = require("./cash-sweep");
const crud = require("./crud");
const variants = require("../../v2/services/forecastVariants"); // CR050 — variant materialization

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
async function loadModulesForScenario(scenarioId, fcLineNameMap, dbc = db, scenario = null) {
  // Get modules with account names
  const modulesResult = await dbc.query(`
    SELECT m.*, a.name as account_name, a.account_type
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
  `, [scenarioId]);

  const modules = modulesResult.rows;
  const loanWarnings = [];

  // Load nested data for all modules
  for (const mod of modules) {
    const [investments, disposals, amortization, streams] = await Promise.all([
      dbc.query('SELECT * FROM forecast_module_investments WHERE module_id = $1 ORDER BY investment_date', [mod.id]),
      dbc.query('SELECT * FROM forecast_module_disposals WHERE module_id = $1 ORDER BY disposal_date', [mod.id]),
      dbc.query('SELECT * FROM forecast_module_amortization WHERE module_id = $1 ORDER BY effective_date', [mod.id]),
      // CR069 — the module's P&L streams, each with its own change schedule.
      dbc.query('SELECT * FROM forecast_streams WHERE module_id = $1 ORDER BY direction, id', [mod.id]),
    ]);

    const streamIds = streams.rows.map((s) => s.id);
    const changesByStream = new Map();
    if (streamIds.length) {
      const changeRows = await dbc.query(
        'SELECT * FROM forecast_stream_changes WHERE stream_id = ANY($1) ORDER BY change_date',
        [streamIds]
      );
      for (const row of changeRows.rows) {
        if (!changesByStream.has(row.stream_id)) changesByStream.set(row.stream_id, []);
        changesByStream.get(row.stream_id).push(row);
      }
    }

    mod.HasValuation = mod.has_valuation !== false;

    // Where a stream POSTS. The fallback is not cosmetic and is not shared:
    //
    //   valuation  the FC line, or nowhere. `fcbuilder-module` resolved
    //              `fcLineNameMap.get(id) || ''` and `indexOf('')` is -1, so an expense with
    //              no line silently posts to no P&L row while its cash still moves. That is
    //              a live defect (roadmap: `Sarasota House`, −1,203,432 against no line) and
    //              it is PRESERVED here rather than fixed, because this CR's gate is "no
    //              number moves". Fixing it changes a scenario's Expenses metric.
    //   flow       the FC line, else the COA ACCOUNT name, else the module name — the
    //              `fc_line || account_name || name` chain fcbuilder-incexp used. Three live
    //              items (`Retirement Home`, `Car Purchase Chris`, `Social Security`) carry
    //              no line and post to their account's name; dropping the fallback would
    //              silently move them off their row.
    mod.Streams = streams.rows.map((s) => ({
      ...s,
      lineName: (s.fc_line_id && fcLineNameMap ? fcLineNameMap.get(s.fc_line_id) : null)
        || (mod.HasValuation ? '' : (mod.account_name || mod.name)),
      changes: changesByStream.get(s.id) || [],
    }));

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

    mod.Comment = mod.comment;
    mod.Matched = mod.is_matched;
    mod.AccountType = mod.account_type || '';

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

    // CR062 — a LOAN's principal schedule is DERIVED here, never stored. The five
    // assumptions determine it completely, so re-deriving on every build is what
    // keeps a rate change from leaving thirty stale rows that still look
    // authoritative (the CR049/CR050 rot pattern).
    //
    // `loan_interest_rate` is the switch, NOT `module_type`: that column is a
    // user-editable free-text list in Forecast Settings which the engine has never
    // read, and prod already carries a lowercase 'asset' in it. A scenario must not
    // stop charging interest because someone tidied a settings list.
    //
    // REPLACE, never merge: the derived array is the single source of the loan's
    // principal movements. Stored forecast_module_investments rows on a loan module
    // are ignored here and rejected by the route, so the two cannot disagree.
    mod.LoanRate = mod.loan_interest_rate != null ? parseFloat(mod.loan_interest_rate) : null;
    if (mod.LoanRate != null && scenario) {
      const { invest, warnings } = deriveLoanSchedule({
        principal: parseFloat(mod.loan_principal) || 0,
        drawYear: mod.loan_start_date,
        endYear: mod.loan_end_date,
        amortPct: amortization.rows.map(r => ({
          year: new Date(r.effective_date).getFullYear(),
          pct: parseFloat(r.pct) || 0,
        })),
        baseOutstanding: mod.MarketValue,
        // PeriodStart − 1, never the module's own base_date year. The categories
        // frame starts there and discards anything written earlier, so a draw
        // keyed off base_date would vanish on write for a module whose base_date
        // disagrees with the scenario's — and dev carries both 2025-12-31 and
        // 2026-12-31 in the same scenario.
        baseYear: scenario.PeriodStart - 1,
        horizonEnd: scenario.PeriodEnd,
      });
      mod.Invest = invest;
      mod.Dispose = [];
      for (const w of warnings) loanWarnings.push({ ...w, module: mod.name });
    }
  }

  return Object.assign(modules, { loanWarnings });
}

/**
 * The unified category axis (CR069 P2).
 *
 * ONE frame now, where there were two: `scenarioCategories` for balance-sheet modules and
 * `incexpCategories` for items. Every module — valuation or flow — computes against the same
 * row set, which is what lets a converted Expenditure item go through the same builder.
 *
 * Rows: Bank Accounts · Transfer - Bank · every module account · every line any stream posts
 * to · Taxes. A stream with no line resolves through the same fallback the loader applied.
 */
async function loadCategoriesForScenario(scenarioId, fcLineNameMap, dbc = db) {
  const result = await dbc.query(`
    SELECT
      array_agg(DISTINCT a.name) FILTER (WHERE a.name IS NOT NULL) as account_names
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
  `, [scenarioId]);

  const lineRows = await dbc.query(`
    SELECT s.fc_line_id, s.direction, m.has_valuation, a.name AS account_name, m.name AS module_name
    FROM forecast_streams s
    JOIN forecast_modules m ON m.id = s.module_id
    LEFT JOIN accounts a ON m.account_id = a.id
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
  `, [scenarioId]);

  const expenseCategories = [];
  const incomeCategories = [];
  for (const row of lineRows.rows) {
    const name = (row.fc_line_id && fcLineNameMap ? fcLineNameMap.get(row.fc_line_id) : null)
      || (row.has_valuation !== false ? '' : (row.account_name || row.module_name));
    if (!name) continue;
    const bucket = row.direction === 'income' ? incomeCategories : expenseCategories;
    if (!bucket.includes(name)) bucket.push(name);
  }

  return {
    expenseCategories,
    incomeCategories,
    accountNames: result.rows[0]?.account_names || [],
  };
}


async function generateForecast(scenarioName, { writeAudit = true } = {}) {
  const startTime = Date.now();

  console.log(`[FORECAST-GENERATE] Starting forecast generation for scenario: ${scenarioName}`);

  try {
    // Step 0 (CR050): a VARIANT is materialized from base ⊕ overrides before it is built. This is
    // the safety net — even if every other sync call point were missed, a rebuild is still
    // correct, and the engine below goes on reading an ordinary, fully-populated scenario.
    // It runs BEFORE loadScenarioConfig because sync writes the variant's slice of the
    // assumptions document (period / inflation / FX / tax) that the config reader consumes.
    const lineage = await db.query(
      'SELECT id, parent_scenario_id FROM forecast_scenarios WHERE name = $1', [scenarioName]
    );
    if (lineage.rows[0] && lineage.rows[0].parent_scenario_id) {
      const synced = await variants.syncVariant(lineage.rows[0].id, { force: true });
      console.log(`[FORECAST-GENERATE] Variant synced from base: ${JSON.stringify(synced)}`);
    }

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
    const [bsModules, { expenseCategories, incomeCategories, accountNames }] =
      await Promise.all([
        loadModulesForScenario(scenarioId, fcLineNameMap, dbc, scenario),
        loadCategoriesForScenario(scenarioId, fcLineNameMap, dbc),
      ]);

    const flowCount = bsModules.filter((m) => m.HasValuation === false).length;
    console.log(`[FORECAST-GENERATE] Loaded ${bsModules.length} modules for scenario ${scenarioName}` +
      ` (${bsModules.length - flowCount} with a valuation, ${flowCount} flow)`);

    // CR062 — a loan whose schedule is incoherent still builds; it just builds
    // something the owner should see. Surfaced in the generate result (and the
    // log) rather than thrown, because a balloon or a capped repayment is a
    // modelling fact, not an error.
    const loanWarnings = bsModules.loanWarnings || [];
    for (const w of loanWarnings) {
      console.warn(`[FORECAST-GENERATE] Loan "${w.module}": ${w.message}`);
    }

    // Step 5: Build the ONE category axis every module computes against (CR069 P2).
    // `buildScenarioCategories` already dedupes and already pushes Bank Accounts,
    // Transfer - Bank and Taxes, which is what the retired inc/exp axis had to add by hand.
    const scenarioCategories = buildScenarioCategories(accountNames, incomeCategories, expenseCategories);

    const columns = buildColumns(years);

    // Step 6a: COMPUTE (pure) — every module's series + entries payload, in
    // deterministic array order — ONE module list since CR069 P2. No I/O: each
    // computeModule fills a fresh category × year frame and returns the
    // flattened forecast_entries payload.
    console.log(`[FORECAST-GENERATE] Processing ${bsModules.length} modules...`);

    // CR076 D4 — the base year's income is the BUDGET (CR075), so the tax on it must be too.
    //
    // `fcbuilder-module`'s base-year income-tax block taxes the stream's TYPED amount, which
    // CR075 stopped using for the base year's income. `UB Income` carries 500,000 PLN typed
    // (128,205 USD at 3.9) against a 2026 budget of 192,266 USD — so the income and the tax on
    // it came from different sources, which is the very divergence CR075 §1 named and only half
    // closed. At 23% that is 14,734 of tax the plan was not charging.
    //
    // Loaded HERE rather than at its old site below, because the module loop needs it. The same
    // map is reused for the opening-cash fold, so there is one read and one source.
    //
    // Apportioned by claimant count: the budget is per FC LINE and this tax is per STREAM, so a
    // line shared by two income streams would otherwise be claimed twice over. Both live
    // claimants are exclusive (verified: `Barkeria Income` and `UB Income`, one stream each), so
    // the division is a no-op today and a defensible split rather than a double count tomorrow.
    const baseYearForBudget = scenario.PeriodStart - 1;
    const baseYearValuesForTax = await crud.getBaseYearValues(scenarioId, baseYearForBudget, dbc);
    const baseYearIncomeClaimants = {};
    for (const m of bsModules) {
      if (m.HasValuation === false) continue;
      for (const st of (m.Streams || [])) {
        if (st.direction !== 'income') continue;
        if (!(Math.abs(parseFloat(st.amount) || 0) > 0)) continue;
        const line = st.lineName;
        if (!line) continue;
        baseYearIncomeClaimants[line] = (baseYearIncomeClaimants[line] || 0) + 1;
      }
    }
    scenario.BaseYearBudgetByLine = baseYearValuesForTax;
    scenario.BaseYearIncomeClaimants = baseYearIncomeClaimants;

    const computed = bsModules.map((module) => ({
      module,
      result: computeModule(
        module, scenario, df_assumptions,
        LabelFrame.zeros(scenarioCategories, columns),
        categories, years, scenarioId
      ),
    }));

    // Step 6b: audit-trail CSVs (fs side effect, kept out of the numbers path).
    // CR053: the auto-adjust solver rebuilds a throwaway scratch scenario ~10× per solve;
    // writeAudit=false skips this so it neither wastes I/O nor litters the audit trail
    // (which must reflect only real builds). Numbers path is byte-identical either way.
    if (writeAudit) {
      for (const c of computed) {
        writeAuditTrail(c.result.audit.dfModuleLC, c.result.audit.dfModuleUSD, c.result.audit.dfCategories, scenario, c.module);
      }
    }

    // Step 6c: PERSIST — clear the previous build, then per-module inserts in
    // the same order and with the same statements as ever. (The ON CONFLICT clause is NOT
    // load-bearing, whatever this comment used to claim: `entry_type` is never written and
    // NULLs are distinct in a Postgres unique index, so it has never fired — CR069 P0. The
    // inc/exp items it referred to are modules now.)
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
      // CR076 D2 — the sweep's OPENING CASH is the canonical balance, not `closing_balance`.
      // ONE implementation, in `crud.getOpeningBankCash`, so it can be tested against seeded rows
      // instead of asserted — and so this cannot drift from the query the way the growth formula
      // did (D1). The reasoning, the prod measurement and the CR024 note live on that function.
      // `let`, not `const`: CR075 folds the base-year delta into this below (line ~471).
      let startingCash = await crud.getOpeningBankCash(dbc, lastActualDate);
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
        // The BaseYear P&L the Review displays, read from the ONE query that produces it
        // (CR049). The engine used to keep a hand-copied second version here, under a
        // comment promising it mirrored crud.getBaseYearValues exactly. It did not: its
        // expense branch was gated on `account_type = 'liability'` with an ELSE 0, so every
        // non-liability module expense — the real-estate modules' Property Costs, $64.7K in
        // 2026 — was silently worth nothing in the opening cash, while the engine went on
        // paying those same costs out of Bank Accounts in all 36 forecast years. The sweep
        // therefore opened ~$65K richer than the plan, and since it pins cash to the band
        // every year, the error rode the whole horizon instead of washing out.
        // CR076 D4 — read ONCE, before Step 6a, because the module loop needs the same map for
        // the base-year income tax. Re-reading here would be a second source of one number.
        const baseYearValues = baseYearValuesForTax;
        const budgetNCF = Object.values(baseYearValues).reduce((sum, v) => sum + (Number(v) || 0), 0);

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
        const c = computed.find((x) => x.module?.Name === moduleName);
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

      // CR076 §3 — the audit CSV must describe the sweep that was COMMITTED.
      //
      // It used to be written right here, from this FIRST pass. Step 7b then deletes every
      // `_cash_sweep`/`_sweep_bal`/`_rebalance` row, re-runs the sweep to convergence and inserts
      // different entries — and never rewrote the file. `FCCashSweepModal.jsx` serves it, so the
      // owner's only window into the sweep described a forecast that had been thrown away.
      //
      // On prod SRQ the file claimed every year landed at exactly 200,000.00 with no shortfall,
      // while the committed entries carried `Cash Shortfall −1,017,119.05` — the explanation
      // screen contradicting the warning panel beside it. On Base it claimed `Fidelity Stocks`
      // was liquidated in 2061-62; the entries never touched it.
      //
      // So: hold the log, let the convergence loop replace it, and write once at the end.
      let finalSweepLog = sweepLog;
      const writeSweepAudit = () => {
        // CR053: skipped for solver scratch builds — see Step 6b.
        if (!writeAudit || !finalSweepLog || finalSweepLog.length === 0) return;
        try {
          const auditDir = PATHS.AUDIT_TRAIL_DIR;
          fs.mkdirSync(auditDir, { recursive: true });
          const scenarioSafe = (scenarioName || '').replace(/[^a-z0-9]/gi, '_');
          const csvPath = path.join(auditDir, `${scenarioSafe}_cash_sweep.csv`);
          // `Shortfall` is new: `sweepLog` has always carried the field and the header never had
          // a column for it, so the one number that says the plan ran out of money could not
          // appear in the file at all.
          const headers = ['Year', 'Action', 'Amount', 'CashBefore', 'CashAfter', 'Shortfall', 'NetModuleEffect', 'Modules'];
          const lines = [headers.join(',')];
          for (const row of finalSweepLog) {
            const netEffect = (row.sweepBalance || 0) - (row.moduleWithdrawal || 0);
            lines.push([
              row.year, row.action, (row.amount || 0).toFixed(2),
              (row.cashBefore || 0).toFixed(2), (row.cashAfter || 0).toFixed(2),
              (row.shortfall || 0).toFixed(2),
              netEffect.toFixed(2),
              row.modules || '',
            ].join(','));
          }
          fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
          console.log(`[FORECAST-GENERATE] Cash sweep audit trail written`);
        } catch (auditErr) {
          console.error('[FORECAST-GENERATE] Failed to write cash sweep audit:', auditErr.message);
        }
      };

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
          // CR069 P2 — the yield context is the module's ONE yield stream (migration 057
          // enforces at most one per module with a partial unique index, precisely because
          // this loop assumes it). Was `mod.IncomePct`, the schedule rows themselves.
          const yieldStream = !mod ? null : (mod.Streams || []).find((s) => s.mode === 'yield');
          if (!yieldStream) continue;

          const modStartYear = new Date(mod.BaseDate).getFullYear();
          const modEndYear = scenario.PeriodEnd;
          const modYearsCount = modEndYear - modStartYear + 1;
          const growthPct = mod.Growth ?? 0;

          // Yield schedule → per-year spread values (step function)
          const sortedIncomePct = (yieldStream.changes || [])
            .filter((e) => e && e.flag === 'Spread %' && e.change_date && e.amount != null)
            .map((e) => ({ year: new Date(e.change_date).getFullYear(), value: parseFloat(e.amount) || 0 }))
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
              // CR076 D1 — this loop UPDATEs the rows `fcbuilder-module.js` wrote, so its growth
              // series MUST be the builder's. It was a second copy, and it drifted: CR072 §8 added
              // the pre-PeriodStart clamp to the builder and left this one behind, so the mirror
              // (which writes last) struck every MV-driven stream on the PREVIOUS year's balance
              // pair — `Fidelity Stocks` 2027 dividend read 27,723.71, the average of its 2025 and
              // 2026 values, beside a 2027 balance of 1,438,381. −39,715 on Base.
              // Now one implementation, called from both. Do not inline it back.
              const g = growthPctForYear(
                modStartYear + i, periodStartYr, growthPct, inflationSeries,
                scenario?.BaseYearRates?.inflation
              );
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
              // CR076 D8 — must match `fcbuilder-module.js`'s pre-period rate exactly; this loop
              // overwrites the rows the builder wrote, so a difference here is the D1 defect all
              // over again in the FX column.
              const declaredBaseFx = Number(scenario?.BaseYearRates?.[mod.Currency]);
              const preFx = Number.isFinite(declaredBaseFx) && declaredBaseFx > 0
                ? declaredBaseFx
                : (fxSeries[0] || 1);
              for (let i = 0, yr = modStartYear; yr <= modEndYear; i++, yr++) {
                const idx = yr - periodStartYr;
                modFx[i] = (idx >= 0 && idx < fxSeries.length) ? fxSeries[idx] : preFx;
              }
            }
          }
          modFx[0] = (mod.BaseValueUSD ?? 0) !== 0 ? (mod.BaseValue ?? 0) / (mod.BaseValueUSD ?? 1) : 1;

          // CR048 A3: income is taxed at the income chain, exactly as the builder does
          // CR069 P2 — the income tax override and the CR046 window are STREAM properties, and
          // the write path stopped maintaining the module columns. Reading the columns here
          // was harmless only while the PUT dual-wrote both; now they diverge on the first
          // save, and this loop UPDATEs the builder's rows — so a window set on a
          // sweep-ranked yield module would be applied by the builder and silently written
          // back by convergence. `yieldStream` is already in hand.
          const taxRate = yieldStream.tax_rate_override != null
            ? Number(yieldStream.tax_rate_override)
            : (mod.tax_rate_override != null
              ? Number(mod.tax_rate_override)
              : Number(scenario?.TaxRate ?? 0));
          const rateFactor = Number.isFinite(taxRate) && taxRate !== 0 ? -taxRate / 100 : 0;

          // CR046 income window, as year indices from the module's start
          const winFrom = yieldStream.start_date
            ? new Date(yieldStream.start_date).getFullYear() - modStartYear : null;
          const winTo = yieldStream.end_date
            ? new Date(yieldStream.end_date).getFullYear() - modStartYear : null;

          yieldContexts.push({
            mod,
            account: row.account_name,
            incomeAccount: yieldStream.lineName || 'Income',
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
            const { entries: newSweepEntries, sweepLog: newSweepLog } = computeCashSweepIterative({
              ...sweepArgs,
              cashSweepLow: cashSweepLow ?? cashSweepHigh ?? 0,
              cashSweepHigh: cashSweepHigh ?? cashSweepLow ?? 0,
              cashDeltaByYear: newCashDelta,
              moduleBalanceByYear: newModBal,
            });

            // CR076 §3 — this run is the one that gets committed, so it is the one the audit
            // CSV must describe. Its log used to be discarded at the destructure.
            finalSweepLog = newSweepLog;
            // CR076 F8 — `rebalanceEntries` was captured from the first pass and never updated,
            // so the reported `entriesCreated` disagreed with the rows that actually landed
            // (Base said 1578 against 1574). Cosmetic, but it makes a real row-count change
            // indistinguishable from noise.
            rebalanceEntries = newSweepEntries.length;

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

        // CR076 §3 — written LAST, from the sweep that was actually committed.
        writeSweepAudit();
      } // end if (sweepModule)
    } // end if (hasSweepBand)

    // Step 8: Calculate statistics
    const totalEntries = results.reduce((sum, r) => sum + (r?.entriesCount || 0), 0) + rebalanceEntries;

    return {
      deletedCount,
      modulesProcessed: bsModules.length,
      entriesCreated: totalEntries,
      loanWarnings,
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
