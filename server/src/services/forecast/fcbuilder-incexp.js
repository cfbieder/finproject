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

const writeEntriesAuditTrail = (dfCategories, scenarioName, accountName) => {
  ensureAuditTrailDir();

  const safeScenario = sanitizeName(scenarioName, "scenario").replace(/[^a-z0-9]/gi, "_");
  const safeAccount = sanitizeName(accountName, "account").replace(/[^a-z0-9]/gi, "_");
  const filePath = path.join(auditTrailDir, `${safeScenario}_${safeAccount}_entries.csv`);

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
      rowParts[j + 1] = row?.[j] == null ? "" : row[j];
    }
    lines[i + 1] = rowParts.join(",") + "\n";
  }

  fs.writeFileSync(filePath, lines.join(""), "utf8");
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

  await db.query(sql, params);
  return entries;
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

/**
 * Process a single income/expense forecast module
 *
 * @param {Object} module - Module data with v1-format fields (Account, Name, BaseValue, Growth, Changes)
 * @param {Object} scenario - Scenario config from FCAssump
 * @param {DataFrame} df_assumptions - Assumptions dataframe
 * @param {DataFrame} df_categories - Categories dataframe to populate
 * @param {Array} categories - Category names from FCAssump
 * @param {Array} years - Years array
 * @param {Object} db - PostgreSQL db module
 * @param {number} scenarioId - PostgreSQL scenario ID
 */
async function processModule(module, scenario, df_assumptions, df_categories, categories, years, db, scenarioId) {
  console.log(`Processing account: ${module.Account}`);
  console.log(`Processing module: ${module.Name}`);

  const startyear = scenario.PeriodStart;
  const endyear = scenario.PeriodEnd;
  const yearsCount = endyear - startyear + 1;

  const inflationSeries = df_assumptions.column("Inflation").values;
  const periodStart = years[0];
  const inflationLen = inflationSeries.length;

  const changeDValues = new Array(yearsCount).fill(0);
  const changePValues = new Array(yearsCount);
  const changeOValues = new Array(yearsCount).fill(0);
  const growth = module.Growth ?? 0;

  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    changePValues[i] = idx >= 0 && idx < inflationLen ? inflationSeries[idx] * growth : 0;
  }

  if (Array.isArray(module.Changes)) {
    for (const entry of module.Changes) {
      if (!entry || !entry.Date || entry.Amount == null) continue;
      const year = new Date(entry.Date).getFullYear();
      const idx = year - startyear;
      if (idx >= 0 && idx < yearsCount) {
        if (entry.Flag[0] === "P") {
          changePValues[idx] = entry.Amount;
        } else if (entry.Flag[0] === "F") {
          changeDValues[idx] = entry.Amount;
        } else if (entry.Flag[0] === "O") {
          changeOValues[idx] = entry.Amount;
        }
      }
    }
  }

  const incexpValues = new Array(yearsCount);
  const baseValues = new Array(yearsCount);
  const taxValues = new Array(yearsCount).fill(0);
  const cashChange = new Array(yearsCount);

  baseValues[0] = module.BaseValue * (1 + (changePValues[0] ?? 0) / 100) + (changeDValues[0] ?? 0);
  incexpValues[0] = baseValues[0] + (changeOValues[0] ?? 0);

  if (incexpValues[0] > 0) {
    taxValues[0] = -(incexpValues[0] * scenario.TaxRate) / 100;
  }

  for (let i = 1; i < yearsCount; i++) {
    const year = startyear + i;
    const idx = year - periodStart;

    if (idx >= 0 && idx < inflationLen) {
      baseValues[i] = baseValues[i - 1] * (1 + changePValues[i] / 100) + changeDValues[i];
      incexpValues[i] = baseValues[i] + changeOValues[i];
    } else {
      baseValues[i] = 0;
      incexpValues[i] = 0;
    }

    if (incexpValues[i] > 0) {
      taxValues[i] = -(incexpValues[i] * scenario.TaxRate) / 100;
    }
  }

  for (let i = 0; i < yearsCount; i++) {
    cashChange[i] = incexpValues[i] + taxValues[i];
  }

  // Clear and populate df_categories
  const dfCategoryValues = df_categories.values;
  for (let i = 0; i < dfCategoryValues.length; i++) {
    dfCategoryValues[i].fill(0);
  }

  let categoryRowIndex = df_categories.index.indexOf(module.Account);
  writeValuesToCategoryRow(categoryRowIndex, df_categories, incexpValues, startyear);

  if (module.Account === "Taxes") {
    for (let i = 0; i < taxValues.length; i++) {
      taxValues[i] += incexpValues[i];
    }
  }

  categoryRowIndex = df_categories.index.indexOf("Taxes");
  writeValuesToCategoryRow(categoryRowIndex, df_categories, taxValues, startyear);

  categoryRowIndex = df_categories.index.indexOf("Bank Accounts");
  writeValuesToCategoryRow(categoryRowIndex, df_categories, cashChange, startyear);

  // Write audit trail
  writeEntriesAuditTrail(df_categories, scenario?.Name, module?.Account);

  // Insert entries into PostgreSQL
  const inserted = await insertCategoryEntries(db, df_categories, scenarioId, module?.Account, module?.Comment);

  return {
    moduleName: module?.Name,
    account: module?.Account,
    entriesCount: inserted.length,
  };
}

module.exports = { processModule };
