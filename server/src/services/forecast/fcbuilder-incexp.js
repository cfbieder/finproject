const dfd = require("danfojs-node");
const fs = require("fs");
const path = require("path");
const mongoose = require("../../../../components/node_modules/mongoose");
const FCEntries = require("../../../../components/models/FCEntries");
const { categories, years } = require("./fcbuilder-setup");

const auditTrailDir = path.resolve(
  __dirname,
  "../../../../components/data/auditTrail"
);
let auditTrailDirEnsured = false;
const pendingAuditTrails = new Set();
let exitScheduled = false;

const ensureAuditTrailDir = () => {
  if (auditTrailDirEnsured) return;
  fs.mkdirSync(auditTrailDir, { recursive: true });
  auditTrailDirEnsured = true;
};

const sanitizeName = (value, fallback) => (value && String(value)) || fallback;

const scheduleExitIfIdle = () => {
  if (exitScheduled || pendingAuditTrails.size !== 0) {
    return;
  }
  exitScheduled = true;
  setImmediate(() => process.exit(process.exitCode ?? 0));
};

const trackAuditTrail = (promise) => {
  pendingAuditTrails.add(promise);
  promise
    .catch((error) => {
      console.error("Failed to write audit trail:", error);
      process.exitCode = process.exitCode || 1;
    })
    .finally(() => {
      pendingAuditTrails.delete(promise);
      scheduleExitIfIdle();
    });
  return promise;
};

const getIndexValues = (df) => {
  if (Array.isArray(df.index)) return df.index;
  if (Array.isArray(df.index?.values)) return df.index.values;
  if (Array.isArray(df.index?.index)) return df.index.index;
  return [];
};

const writeEntriesAuditTrail = (dfCategories, scenarioName, accountName) => {
  ensureAuditTrailDir();
  const safeScenario = sanitizeName(scenarioName, "scenario").replace(
    /[^a-z0-9]/gi,
    "_"
  );
  const safeAccount = sanitizeName(accountName, "account").replace(
    /[^a-z0-9]/gi,
    "_"
  );
  const filePath = path.join(
    auditTrailDir,
    `${safeScenario}_${safeAccount}_entries.csv`
  );

  const columns = dfCategories.columns || [];
  const rows = dfCategories.values || [];
  const indexValues = getIndexValues(dfCategories);
  const lines = new Array(rows.length + 1);

  lines[0] = ["index", ...columns].join(",") + "\n";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowParts = new Array(columns.length + 1);
    rowParts[0] = indexValues[i] ?? "";
    for (let j = 0; j < columns.length; j++) {
      const value = row?.[j];
      rowParts[j + 1] = value == null ? "" : value;
    }
    lines[i + 1] = rowParts.join(",") + "\n";
  }

  fs.writeFileSync(filePath, lines.join(""), "utf8");
};

// ============================================================================
// Database Entry Functions
// ============================================================================

const buildFcEntriesPayload = (dfCategories, scenarioName, moduleName) => {
  const columns = dfCategories?.columns || [];
  const rows = dfCategories?.values || [];
  const indexValues = getIndexValues(dfCategories);
  const entries = [];
  const module = moduleName || "";

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
        Scenario: scenarioName,
        Year: year,
        Amount: amount,
        Account: account,
        Module: module,
      });
    }
  }

  return entries;
};

const insertCategoryEntries = (dfCategories, scenarioName, moduleName) => {
  if (!scenarioName || mongoose.connection.readyState === 0) {
    return Promise.resolve([]);
  }

  const entries = buildFcEntriesPayload(dfCategories, scenarioName, moduleName);
  if (entries.length === 0) {
    return Promise.resolve([]);
  }

  return FCEntries.insertMany(entries, { ordered: false });
};

// ============================================================================
// Category Writing Functions
// ============================================================================

/**
 * Writes values to a specific row in the categories dataframe
 *
 * @param {number} rowIndex - Row index to write to
 * @param {DataFrame} dfCategories - Categories dataframe
 * @param {number[]} valuesToWrite - Array of values to write
 * @param {number} startYear - Starting year for the values
 * @returns {boolean} True if successful, false otherwise
 */
const writeValuesToCategoryRow = (
  rowIndex,
  dfCategories,
  valuesToWrite,
  startYear
) => {
  if (rowIndex < 0) {
    console.warn(
      `Category ${
        rowIndex ?? "unknown"
      } not found in df_categories, unable to write market values.`
    );
    return false;
  }

  const startColumnIndex = dfCategories.columns.indexOf(startYear);
  if (startColumnIndex === -1) {
    console.warn(
      `Start year ${startYear} not found in df_categories, unable to write market values.`
    );
    return false;
  }

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

// ============================================================================
// Main Processing Function
// ============================================================================

function processModule(module, scenario, df_assumptions, df_categories) {
  console.log(`Processing account: ${module.Account}`);
  console.log(`Processing module: ${module.Name}`);
  console.log("Scenario", scenario);

  // Define forecast period based on module start date and scenario end
  const startyear = scenario.PeriodStart;
  const endyear = scenario.PeriodEnd;
  const yearsCount = endyear - startyear + 1;
  const yearsArr = new Array(yearsCount);

  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    yearsArr[i] = year;
  }

  // Extract inflation series for calculations
  const inflationSeries = df_assumptions.column("Inflation").values;
  //console.log("df_assumptions:\n", df_assumptions.toString());
  const periodStart = years[0];
  const inflationLen = inflationSeries.length;

  const changeDValues = new Array(yearsCount).fill(0);
  const changePValues = new Array(yearsCount);
  const growth = module.Growth ?? 0;
  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    changePValues[i] =
      idx >= 0 && idx < inflationLen ? inflationSeries[idx] * growth : 0;
  }

  // Process changes - map each transaction to the appropriate year
  if (Array.isArray(module.Changes)) {
    for (let i = 0; i < module.Changes.length; i++) {
      const entry = module.Changes[i];
      if (!entry || !entry.Date || entry.Amount == null) continue;
      const year = new Date(entry.Date).getFullYear();
      const idx = year - startyear;
      if (idx >= 0 && idx < yearsCount) {
        if (entry.Flag[0] === "P") {
          changePValues[idx] = entry.Amount;
        } else {
          changeDValues[idx] = entry.Amount;
        }
      }
    }
  }

  const incexpValues = new Array(yearsCount).fill(0);
  const taxValues = new Array(yearsCount).fill(0);
  const cashChange = new Array(yearsCount).fill(0);
  incexpValues[0] =
    module.BaseValue * (1 + (changePValues[0] ?? 0) / 100) +
    (changeDValues[0] ?? 0);
  if (incexpValues[0] > 0)
    taxValues[0] = -(incexpValues[0] * scenario.TaxRate) / 100;
  for (let i = 1, year = startyear + 1; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    incexpValues[i] =
      idx >= 0 && idx < inflationLen
        ? incexpValues[i - 1] * (1 + changePValues[i] / 100) + changeDValues[i]
        : 0;
    if (incexpValues[i] > 0)
      taxValues[i] = -(incexpValues[i] * scenario.TaxRate) / 100;
  }

  for (let i = 0; i < yearsCount; i++) {
    cashChange[i] = incexpValues[i] + taxValues[i];
  }

  // Clear df_categories rows for this module account
  const dfCategoryValues = df_categories.values;
  for (let i = 0; i < dfCategoryValues.length; i++) {
    dfCategoryValues[i].fill(0);
  }

  // Write expense values to df_categories
  categoryRowIndex = df_categories.index.indexOf(module.Account);
  writeValuesToCategoryRow(
    categoryRowIndex,
    df_categories,
    incexpValues,
    startyear
  );
  if (module.Account === "Taxes") {
    for (let i = 0; i < taxValues.length; i++) {
      taxValues[i] += incexpValues[i];
    }
  }

  categoryRowIndex = df_categories.index.indexOf("Taxes");
  writeValuesToCategoryRow(
    categoryRowIndex,
    df_categories,
    taxValues,
    startyear
  );

  categoryRowIndex = df_categories.index.indexOf("Bank Accounts");
  writeValuesToCategoryRow(
    categoryRowIndex,
    df_categories,
    cashChange,
    startyear
  );

  writeEntriesAuditTrail(df_categories, scenario?.Name, module?.Account);
  const dbInsertPromise = trackAuditTrail(
    insertCategoryEntries(df_categories, scenario?.Name, module?.Account)
  );
  console.log(df_categories.toString());
  return dbInsertPromise;
}

module.exports = { processModule };
