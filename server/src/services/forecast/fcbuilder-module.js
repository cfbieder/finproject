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
  const startColumnIndex = dfCategories.columns.indexOf(startYear);
  if (startColumnIndex === -1) return false;

  const rowValues = dfCategories.values[rowIndex];
  const columnsLength = dfCategories.columns.length;
  const valuesLength = valuesToWrite.length;

  for (let i = 0; i < valuesLength; i++) {
    const columnIndex = startColumnIndex + i;
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
async function processModule(module, scenario, df_assumptions, df_categories, categories, years, db, scenarioId) {
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
      for (let i = 0, year = startyear; year <= endyear; i++, year++) {
        const idx = year - periodStart;
        if (idx >= 0 && idx < fxSeries.length) {
          fxrates[i] = fxSeries[idx];
        }
      }
    }
  }

  const growthPct = module.Growth ?? 0;
  const expPct = module.ExpensePct ?? 0;
  const incomePctValues = new Array(yearsCount).fill(0);
  const growthValues = new Array(yearsCount);
  const expPctValues = new Array(yearsCount);
  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    growthValues[i] = idx >= 0 && idx < inflationLen ? growthPct * inflationSeries[idx] : 0;
    expPctValues[i] = idx >= 0 && idx < inflationLen ? -expPct : 0;
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
        unrealizedGainValues[idx] = (marketValues[idx] - marketValues[idx - 1]) / 2;
        disposeValues[idx] = -marketValues[idx - 1] - unrealizedGainValues[idx];
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

  // Calculate income and expense values
  const expenseValues = new Array(yearsCount).fill(0);
  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    expenseValues[i] = idx >= 0 && idx < inflationLen
      ? (((marketValues[i] + (marketValues[i - 1] ?? 0)) / 2) * expPctValues[i]) / 100
      : 0;
  }

  const incomeValues = new Array(yearsCount).fill(0);
  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    incomeValues[i] = idx >= 0 && idx < inflationLen
      ? (((marketValues[i] + (marketValues[i - 1] ?? 0)) / 2) * incomePctValues[i]) / 100
      : 0;
  }

  // Calculate tax values
  const taxValues = new Array(yearsCount).fill(0);
  const taxRate = Number(scenario?.TaxRate ?? 0);
  if (Number.isFinite(taxRate) && taxRate !== 0) {
    const rateFactor = -taxRate / 100;
    for (let i = 0; i < yearsCount; i++) {
      if (realizedGainValues[i] > 0) taxValues[i] = rateFactor * realizedGainValues[i];
      if (incomeValues[i] > 0) taxValues[i] += rateFactor * incomeValues[i];
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
    baseValuesUSD[i] = baseValues[i] / fxrates[i];
    marketValuesUSD[i] = marketValues[i] / fxrates[i];
    investValuesUSD[i] = investValues[i] / fxrates[i];
    disposeValuesUSD[i] = disposeValues[i] / fxrates[i];
    unrealizedGainValuesUSD[i] = unrealizedGainValues[i] / fxrates[i];
    realizedGainValuesUSD[i] = realizedGainValues[i] / fxrates[i];
    incomeValuesUSD[i] = incomeValues[i] / fxrates[i];
    expenseValuesUSD[i] = expenseValues[i] / fxrates[i];
    taxValuesUSD[i] = taxValues[i] / fxrates[i];
  }

  baseValuesUSD[0] = module.BaseValueUSD ?? 0;
  marketValuesUSD[0] = module.MarketValueUSD ?? 0;
  fxrates[0] = baseValuesUSD[0] !== 0 ? baseValues[0] / baseValuesUSD[0] : 1;

  // Create dataframes for audit trail
  const df_module_LC = new dfd.DataFrame({
    FX: fxrates, GrowthPct: growthValues, IncomePct: incomePctValues, ExpensePct: expPctValues,
    BaseValue: baseValues, MarketValue: marketValues, UnrealizedGain: unrealizedGainValues,
    RealizedGain: realizedGainValues, Invest: investValues, Dispose: disposeValues,
    [module.IncomeCategory]: incomeValues, [module.ExpCategory]: expenseValues, Tax: taxValues,
  }, { index: yearsArr });

  const df_module_USD = new dfd.DataFrame({
    FX: fxrates, GrowthPct: growthValues, IncomePct: incomePctValues, ExpensePct: expPctValues,
    BaseValueUSD: baseValuesUSD, marketValuesUSD: marketValuesUSD, UnrealizedGain: unrealizedGainValuesUSD,
    RealizedGain: realizedGainValuesUSD, Invest: investValuesUSD, Dispose: disposeValuesUSD,
    [module.IncomeCategory]: incomeValuesUSD, [module.ExpCategory]: expenseValuesUSD, Tax: taxValuesUSD,
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

  categoryRowIndex = df_categories.index.indexOf("Taxes US");
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
