const dfd = require("danfojs-node");
const fs = require("fs");
const path = require("path");
const { PATHS } = require("./constants");

const auditTrailDir = PATHS.AUDIT_TRAIL_DIR;
let auditTrailDirEnsured = false;

const ensureAuditTrailDir = () => {
  if (auditTrailDirEnsured) return;
  fs.mkdirSync(auditTrailDir, { recursive: true });
  auditTrailDirEnsured = true;
};

const sanitizeName = (value, fallback) => (value && String(value)) || fallback;

const getIndexValues = (df) => {
  if (Array.isArray(df.index)) return df.index;
  if (Array.isArray(df.index?.values)) return df.index.values;
  if (Array.isArray(df.index?.index)) return df.index.index;
  return [];
};

const writeValuesToCategoryRow = (rowIndex, dfCategories, valuesToWrite, startYear) => {
  if (rowIndex < 0) return false;
  let startColumnIndex = dfCategories.columns.indexOf(startYear);
  let valueOffset = 0;

  // If startYear is before the first column, offset into the values array
  if (startColumnIndex === -1) {
    const firstCol = dfCategories.columns[0];
    if (startYear < firstCol) {
      valueOffset = firstCol - startYear;
      startColumnIndex = 0;
    } else {
      return false;
    }
  }

  const rowValues = dfCategories.values[rowIndex];
  const columnsLength = dfCategories.columns.length;
  const valuesLength = valuesToWrite.length;

  for (let i = valueOffset; i < valuesLength; i++) {
    const columnIndex = startColumnIndex + (i - valueOffset);
    if (columnIndex >= columnsLength) break;
    rowValues[columnIndex] = valuesToWrite[i];
  }
  return true;
};

const writeAuditTrail = (dfModuleLC, dfModuleUSD, dfCategories, scenario, module) => {
  ensureAuditTrailDir();
  const scenarioName = sanitizeName(scenario?.Name, "scenario").replace(/[^a-z0-9]/gi, "_");
  const moduleName = sanitizeName(module?.Name, "module").replace(/[^a-z0-9]/gi, "_");

  const writeCsvWithHeaders = (df, suffix) => {
    const filePath = path.join(auditTrailDir, `${scenarioName}_${moduleName}_${suffix}.csv`);
    const columns = df.columns || [];
    const rows = df.values || [];
    const indexValues = getIndexValues(df);
    const lines = new Array(rows.length + 1);

    lines[0] = ["index", ...columns].join(",") + "\n";
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowParts = new Array(columns.length + 1);
      rowParts[0] = indexValues[i] ?? "";
      for (let j = 0; j < columns.length; j++) {
        rowParts[j + 1] = row?.[j] == null ? "" : row[j];
      }
      lines[i + 1] = rowParts.join(",") + "\n";
    }
    fs.writeFileSync(filePath, lines.join(""), "utf8");
  };

  writeCsvWithHeaders(dfModuleLC, "LC");
  writeCsvWithHeaders(dfCategories, "entries");
  writeCsvWithHeaders(dfModuleUSD, "USD");
};

/**
 * Builds array of entry objects from categories dataframe
 */
const buildFcEntriesPayload = (dfCategories, scenarioId, moduleName, moduleComment) => {
  const columns = dfCategories?.columns || [];
  const rows = dfCategories?.values || [];
  const indexValues = getIndexValues(dfCategories);
  const entries = [];

  for (let i = 0; i < rows.length; i++) {
    const account = indexValues[i];
    if (!account) continue;

    const row = rows[i];
    for (let j = 0; j < columns.length; j++) {
      const amount = row[j];
      if (amount == null || amount === 0) continue;
      const year = columns[j];
      if (year == null) continue;

      entries.push({
        scenario_id: scenarioId,
        forecast_year: year,
        amount: amount,
        account: account,
        module: moduleName || "",
        comment: moduleComment || null,
      });
    }
  }
  return entries;
};

/**
 * Inserts entries into PostgreSQL forecast_entries table
 */
const insertCategoryEntries = async (db, dfCategories, scenarioId, moduleName, moduleComment) => {
  const entries = buildFcEntriesPayload(dfCategories, scenarioId, moduleName, moduleComment);
  if (entries.length === 0) return [];

  // Build bulk insert
  const values = [];
  const params = [];
  let paramIdx = 1;

  for (const entry of entries) {
    values.push(`($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`);
    params.push(entry.scenario_id, entry.forecast_year, entry.amount, entry.account, entry.module, entry.comment);
  }

  const sql = `
    INSERT INTO forecast_entries (scenario_id, forecast_year, amount, account, module, comment)
    VALUES ${values.join(", ")}
    ON CONFLICT (scenario_id, forecast_year, account, module, entry_type)
    DO UPDATE SET amount = EXCLUDED.amount, comment = EXCLUDED.comment
  `;

  const result = await db.query(sql, params);
  return entries;
};

/**
 * Process a single balance sheet forecast module
 *
 * @param {Object} module - Module data from PostgreSQL (snake_case fields)
 * @param {Object} scenario - Scenario config from FCAssump
 * @param {DataFrame} df_assumptions - Assumptions dataframe
 * @param {DataFrame} df_categories - Categories dataframe to populate
 * @param {Array} categories - Category names from FCAssump
 * @param {Array} years - Years array
 * @param {Object} db - PostgreSQL db module
 * @param {number} scenarioId - PostgreSQL scenario ID
 */
async function processModule(module, scenario, df_assumptions, df_categories, categories, years, db, scenarioId, fcLineNameMap) {
  console.log(`Processing module: ${module.Name}`);
  console.log(`Processing account: ${module.Account}`);

  const startyear = new Date(module.BaseDate).getFullYear();
  const endyear = scenario.PeriodEnd;
  const yearsCount = endyear - startyear + 1;
  const yearsArr = new Array(yearsCount);

  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    yearsArr[i] = year;
  }

  const baseValues = new Array(yearsCount).fill(module.BaseValue ?? 0);
  const marketValues = new Array(yearsCount).fill(module.MarketValue ?? 0);
  const fxrates = new Array(yearsCount).fill(1);
  const investValues = new Array(yearsCount).fill(0);
  const disposeValues = new Array(yearsCount).fill(0);

  const inflationSeries = df_assumptions.column(categories[1]).values;
  const periodStart = years[0];
  const inflationLen = inflationSeries.length;

  if (module.Currency && module.Currency !== "USD") {
    const fxColumn =
      module.Currency === "PLN" ? categories[2] :
      module.Currency === "EUR" ? categories[3] : null;
    if (fxColumn && df_assumptions.columns.includes(fxColumn)) {
      const fxSeries = df_assumptions.column(fxColumn).values;
      const firstFxRate = fxSeries[0] || 1;
      for (let i = 0, year = startyear; year <= endyear; i++, year++) {
        const idx = year - periodStart;
        if (idx >= 0 && idx < fxSeries.length) {
          fxrates[i] = fxSeries[idx];
        } else if (idx < 0) {
          // Pre-period years: use first available FX rate
          fxrates[i] = firstFxRate;
        }
      }
    }
  }

  const growthPct = module.Growth ?? 0;
  const expPct = module.ExpensePct ?? 0;
  const isLiability = module.AccountType === 'liability';
  const incomePctValues = new Array(yearsCount).fill(0);
  const growthValues = new Array(yearsCount);
  const expPctValues = new Array(yearsCount);
  // For assets, negate expPct so expenses reduce value.
  // For liabilities, keep expPct as-is so users can enter positive values.
  const effectiveExpPct = isLiability ? expPct : -expPct;
  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    growthValues[i] = idx >= 0 && idx < inflationLen ? growthPct * inflationSeries[idx] : 0;
    expPctValues[i] = idx >= 0 && idx < inflationLen ? effectiveExpPct : 0;
  }

  // Process IncomePct array
  if (Array.isArray(module.IncomePct) && module.IncomePct.length > 0) {
    const sortedIncomePct = [...module.IncomePct]
      .filter((entry) => entry && entry.Date && entry.Value != null)
      .map((entry) => ({
        year: new Date(entry.Date).getFullYear(),
        value: entry.Value,
      }))
      .sort((a, b) => a.year - b.year);

    let currentValue = 0;
    let nextEntryIndex = 0;

    for (let i = 0, year = startyear; year <= endyear; i++, year++) {
      while (nextEntryIndex < sortedIncomePct.length && sortedIncomePct[nextEntryIndex].year <= year) {
        currentValue = sortedIncomePct[nextEntryIndex].value;
        nextEntryIndex++;
      }
      incomePctValues[i] = currentValue;
    }
  }

  // Process investment transactions
  if (Array.isArray(module.Invest)) {
    for (const entry of module.Invest) {
      if (!entry || !entry.Date || entry.Amount == null) continue;
      const year = new Date(entry.Date).getFullYear();
      const idx = year - startyear;
      if (idx >= 0 && idx < yearsCount) investValues[idx] = entry.Amount;
    }
  }

  // Process disposal transactions
  if (Array.isArray(module.Dispose)) {
    for (const entry of module.Dispose) {
      if (!entry || !entry.Date || entry.Amount == null) continue;
      const idx = new Date(entry.Date).getFullYear() - startyear;
      if (idx >= 0 && idx < yearsCount) disposeValues[idx] = -entry.Amount;
    }
  }

  // Calculate yearly realized and unrealized gains/losses
  const unrealizedGainValues = new Array(yearsCount).fill(0);
  const realizedGainValues = new Array(yearsCount).fill(0);

  // Apply base year (idx 0) invest/dispose to starting values
  if (investValues[0] !== 0 || disposeValues[0] !== 0) {
    const origMarket = marketValues[0];
    const origBase = baseValues[0];
    const safeDisposeAdj = origMarket === 0 ? 0 : (disposeValues[0] * origBase) / origMarket;
    baseValues[0] = origBase + investValues[0] + safeDisposeAdj;
    marketValues[0] = origMarket + investValues[0] + disposeValues[0];
    realizedGainValues[0] = -disposeValues[0] + (origMarket === 0 ? 0 : (disposeValues[0] * origBase) / origMarket);
  }

  for (let i = 1; i < yearsCount; i++) {
    unrealizedGainValues[i] = marketValues[i - 1] * (growthValues[i] / 100);

    const prevMarket = marketValues[i - 1];
    const prevBase = baseValues[i - 1];
    const safeDisposeAdjustment = prevMarket === 0 ? 0 : (disposeValues[i] * prevBase) / prevMarket;

    baseValues[i] = prevBase + investValues[i] + safeDisposeAdjustment;
    marketValues[i] = prevMarket + unrealizedGainValues[i] + investValues[i] + disposeValues[i];
    realizedGainValues[i] = -disposeValues[i] + (prevMarket === 0 ? 0 : (disposeValues[i] * prevBase) / prevMarket);
  }

  // Handle "Full" disposals
  if (Array.isArray(module.Dispose)) {
    for (const entry of module.Dispose) {
      if (entry.Flag != "Full") continue;
      const idx = new Date(entry.Date).getFullYear() - startyear;
      if (idx >= 0 && idx < yearsCount) {
        // For base year (idx 0), use original module values as "previous"
        const prevMV = idx === 0 ? (module.MarketValue ?? 0) : marketValues[idx - 1];
        unrealizedGainValues[idx] = idx === 0 ? 0 : (marketValues[idx] - prevMV) / 2;
        disposeValues[idx] = -prevMV - unrealizedGainValues[idx];
        realizedGainValues[idx] = -disposeValues[idx] - baseValues[idx];
        baseValues[idx] = 0;
        marketValues[idx] = 0;
        for (let j = idx + 1; j < yearsCount; j++) {
          baseValues[j] = 0;
          marketValues[j] = 0;
          unrealizedGainValues[j] = 0;
          incomePctValues[j] = 0;
          expPctValues[j] = 0;
          growthValues[j] = 0;
        }
      }
    }
  }

  // Calculate expense values using expense_growth_method
  // - 'inflation' (default): absolute expense_amount compounded at inflation
  // - 'pct_of_value': derive % from expense_amount/market_value_base, apply to avg MV each year
  // - Legacy fallback: if no expense_amount but expense_pct exists, use old pct logic
  const expenseValues = new Array(yearsCount).fill(0);
  const absExpenseAmount = parseFloat(module.expense_amount) || 0;
  const growthMethod = module.expense_growth_method || 'inflation';

  // Determine if expenses should be generated
  // If fc_line_id system is in use (expense_fc_line_id field exists on module),
  // skip expenses when expense_fc_line_id is NULL — "None" means no expense line
  const hasExpenseFcLineField = module.expense_fc_line_id !== undefined;
  const skipExpense = hasExpenseFcLineField && !module.expense_fc_line_id && absExpenseAmount === 0;

  if (!skipExpense && absExpenseAmount > 0 && growthMethod === 'pct_of_value') {
    // Pct of value: derive % from base expense / base MV, apply to avg MV each period
    const marketValueBase = module.MarketValue || 0;
    const derivedPct = marketValueBase !== 0 ? absExpenseAmount / marketValueBase : 0;

    for (let i = 0, year = startyear; year <= endyear; i++, year++) {
      const idx = year - periodStart;
      if (idx < 0 || idx >= inflationLen) continue;

      if (derivedPct !== 0) {
        const avgMV = (marketValues[i] + (marketValues[i - 1] ?? 0)) / 2;
        const val = derivedPct * avgMV;
        expenseValues[i] = isLiability ? val : -val;
      } else {
        // Zero MV fallback: grow base at inflation
        const periodNum = year - periodStart + 1;
        let compounded = absExpenseAmount;
        for (let j = 0; j < periodNum; j++) {
          if (j >= 0 && j < inflationLen) compounded *= (1 + inflationSeries[j] / 100);
        }
        expenseValues[i] = isLiability ? compounded : -compounded;
      }
    }
  } else if (!skipExpense && absExpenseAmount > 0) {
    // Inflation mode: grow base year amount at inflation for each period
    for (let i = 0, year = startyear; year <= endyear; i++, year++) {
      const idx = year - periodStart;
      if (idx < 0 || idx >= inflationLen) continue;
      const periodNum = year - periodStart + 1;

      let compounded = absExpenseAmount;
      for (let j = 0; j < periodNum; j++) {
        if (j >= 0 && j < inflationLen) compounded *= (1 + inflationSeries[j] / 100);
      }
      expenseValues[i] = isLiability ? compounded : -compounded;
    }
  } else if (!skipExpense) {
    // Legacy fallback: expense_pct as percentage of average market value
    for (let i = 0, year = startyear; year <= endyear; i++, year++) {
      const idx = year - periodStart;
      expenseValues[i] = idx >= 0 && idx < inflationLen
        ? (((marketValues[i] + (marketValues[i - 1] ?? 0)) / 2) * expPctValues[i]) / 100
        : 0;
    }
  }

  // Calculate income values
  // - income_amount (Base Yr): base year income amount — grown at inflation for Period 1+
  // - IncomePct (yield %): percentage of avg market value — overrides income_amount from Period 2+
  // Period 1 = income_amount × (1 + inflation), Period 2+ = yield if set, else keep compounding
  const incomeValues = new Array(yearsCount).fill(0);
  const absIncomeAmount = parseFloat(module.income_amount) || 0;
  const hasIncomePct = incomePctValues.some(v => v !== 0);

  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    if (idx < 0 || idx >= inflationLen) continue;

    const yieldIncome = (((marketValues[i] + (marketValues[i - 1] ?? 0)) / 2) * incomePctValues[i]) / 100;

    if (hasIncomePct) {
      // Module has yield schedule → use yield for all periods (0% means no income)
      incomeValues[i] = yieldIncome;
    } else if (absIncomeAmount > 0) {
      // No yield schedule at all → grow income_amount at inflation from base year
      const periodNum = year - periodStart + 1;
      let compounded = absIncomeAmount;
      for (let j = 0; j < periodNum; j++) {
        if (j >= 0 && j < inflationLen) {
          compounded *= (1 + inflationSeries[j] / 100);
        }
      }
      incomeValues[i] = compounded;
    }
  }

  // Apply Full disposal adjustments: 50% expense/income in disposal year, 0 after
  if (Array.isArray(module.Dispose)) {
    for (const entry of module.Dispose) {
      if (entry.Flag !== "Full") continue;
      const dispIdx = new Date(entry.Date).getFullYear() - startyear;
      if (dispIdx >= 0 && dispIdx < yearsCount) {
        if (dispIdx === 0) {
          // Base year disposal: base year stays as budget, zero all forecast years
          for (let j = 1; j < yearsCount; j++) {
            expenseValues[j] = 0;
            incomeValues[j] = 0;
          }
        } else {
          // Disposal year: 50% of calculated expense/income (asset only owned part of year)
          expenseValues[dispIdx] = expenseValues[dispIdx] / 2;
          incomeValues[dispIdx] = incomeValues[dispIdx] / 2;
          // Zero out all years after disposal
          for (let j = dispIdx + 1; j < yearsCount; j++) {
            expenseValues[j] = 0;
            incomeValues[j] = 0;
          }
        }
      }
    }
  }

  // Calculate tax values (deferred by one year — US tax is paid the year after the gain)
  // Per-module tax rate override: if set, uses module-specific rate instead of scenario default
  const taxValues = new Array(yearsCount).fill(0);
  const taxRate = module.tax_rate_override != null
    ? Number(module.tax_rate_override)
    : Number(scenario?.TaxRate ?? 0);
  if (Number.isFinite(taxRate) && taxRate !== 0) {
    const rateFactor = -taxRate / 100;

    // Tax on base year income (income_amount) deferred to Period 1
    if (absIncomeAmount > 0) {
      const period1Idx = periodStart - startyear;
      if (period1Idx >= 0 && period1Idx < yearsCount) {
        taxValues[period1Idx] += rateFactor * absIncomeAmount;
      }
    }

    for (let i = 0; i < yearsCount; i++) {
      let currentYearTax = 0;
      if (realizedGainValues[i] > 0) currentYearTax = rateFactor * realizedGainValues[i];
      if (incomeValues[i] > 0) currentYearTax += rateFactor * incomeValues[i];
      // Defer tax to next year; if this is the last year, tax stays in that year
      if (currentYearTax !== 0) {
        const targetIdx = i + 1 < yearsCount ? i + 1 : i;
        taxValues[targetIdx] += currentYearTax;
      }
    }
  }

  // Convert LC to USD
  const baseValuesUSD = new Array(yearsCount).fill(module.BaseValue ?? 0);
  const marketValuesUSD = new Array(yearsCount).fill(module.MarketValue ?? 0);
  const investValuesUSD = new Array(yearsCount).fill(0);
  const disposeValuesUSD = new Array(yearsCount).fill(0);
  const unrealizedGainValuesUSD = new Array(yearsCount).fill(0);
  const realizedGainValuesUSD = new Array(yearsCount).fill(0);
  const incomeValuesUSD = new Array(yearsCount).fill(0);
  const expenseValuesUSD = new Array(yearsCount).fill(0);
  const taxValuesUSD = new Array(yearsCount).fill(0);

  for (let i = 0; i < yearsCount; i++) {
    const fx = fxrates[i] || 1; // Guard against zero FX rate
    baseValuesUSD[i] = baseValues[i] / fx;
    marketValuesUSD[i] = marketValues[i] / fx;
    investValuesUSD[i] = investValues[i] / fx;
    disposeValuesUSD[i] = disposeValues[i] / fx;
    unrealizedGainValuesUSD[i] = unrealizedGainValues[i] / fx;
    realizedGainValuesUSD[i] = realizedGainValues[i] / fx;
    incomeValuesUSD[i] = incomeValues[i] / fx;
    expenseValuesUSD[i] = expenseValues[i] / fx;
    taxValuesUSD[i] = taxValues[i] / fx;
  }

  baseValuesUSD[0] = module.BaseValueUSD ?? 0;
  marketValuesUSD[0] = module.MarketValueUSD ?? 0;
  fxrates[0] = baseValuesUSD[0] !== 0 ? baseValues[0] / baseValuesUSD[0] : 1;

  // Create dataframes for audit trail
  const incomeLabel = module.IncomeCategory || 'Income';
  const expenseLabel = module.ExpCategory || 'Expense';
  // Avoid duplicate column keys if both resolve to the same name
  const safeExpenseLabel = expenseLabel === incomeLabel ? expenseLabel + '_Exp' : expenseLabel;

  const df_module_LC = new dfd.DataFrame({
    FX: fxrates, GrowthPct: growthValues, IncomePct: incomePctValues, ExpensePct: expPctValues,
    BaseValue: baseValues, MarketValue: marketValues, UnrealizedGain: unrealizedGainValues,
    RealizedGain: realizedGainValues, Invest: investValues, Dispose: disposeValues,
    [incomeLabel]: incomeValues, [safeExpenseLabel]: expenseValues, Tax: taxValues,
  }, { index: yearsArr });

  const df_module_USD = new dfd.DataFrame({
    FX: fxrates, GrowthPct: growthValues, IncomePct: incomePctValues, ExpensePct: expPctValues,
    BaseValueUSD: baseValuesUSD, marketValuesUSD: marketValuesUSD, UnrealizedGain: unrealizedGainValuesUSD,
    RealizedGain: realizedGainValuesUSD, Invest: investValuesUSD, Dispose: disposeValuesUSD,
    [incomeLabel]: incomeValuesUSD, [safeExpenseLabel]: expenseValuesUSD, Tax: taxValuesUSD,
  }, { index: yearsArr });

  // Clear and populate df_categories
  const dfCategoryValues = df_categories.values;
  for (let i = 0; i < dfCategoryValues.length; i++) {
    dfCategoryValues[i].fill(0);
  }

  let categoryRowIndex = df_categories.index.indexOf(module.Account);
  writeValuesToCategoryRow(categoryRowIndex, df_categories, marketValuesUSD, startyear);

  categoryRowIndex = df_categories.index.indexOf("Transfer - Bank");
  const transferValues = disposeValuesUSD.map((dispose, idx) => -dispose - investValuesUSD[idx]);
  writeValuesToCategoryRow(categoryRowIndex, df_categories, transferValues, startyear);

  categoryRowIndex = df_categories.index.indexOf(module.IncomeCategory);
  writeValuesToCategoryRow(categoryRowIndex, df_categories, incomeValuesUSD, startyear);

  categoryRowIndex = df_categories.index.indexOf(module.ExpCategory);
  writeValuesToCategoryRow(categoryRowIndex, df_categories, expenseValuesUSD, startyear);

  categoryRowIndex = df_categories.index.indexOf("Taxes");
  writeValuesToCategoryRow(categoryRowIndex, df_categories, taxValuesUSD, startyear);

  const cashChange = new Array(yearsCount);
  for (let i = 0; i < yearsCount; i++) {
    cashChange[i] = incomeValuesUSD[i] + expenseValuesUSD[i] + taxValuesUSD[i] + transferValues[i];
  }

  categoryRowIndex = df_categories.index.indexOf("Bank Accounts");
  writeValuesToCategoryRow(categoryRowIndex, df_categories, cashChange, startyear);

  // Write audit trail
  writeAuditTrail(df_module_LC, df_module_USD, df_categories, scenario, module);

  // Insert entries into PostgreSQL
  const inserted = await insertCategoryEntries(db, df_categories, scenarioId, module?.Name, module?.Comment);

  return {
    moduleName: module?.Name,
    account: module?.Account,
    entriesCount: inserted.length,
  };
}

module.exports = { processModule };
