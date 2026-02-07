/**
 * Income/Expense Forecast Builder Module
 *
 * This module processes income and expense forecasts, calculating projected values
 * based on base amounts, growth rates, inflation, and discrete changes over time.
 * It handles tax calculations and updates category dataframes with forecast results.
 */

const dfd = require("danfojs-node");
const fs = require("fs");
const path = require("path");
const mongoose = require("../../../../components/node_modules/mongoose");
const FCEntries = require("../../../../components/models/FCEntries");
const {
  categories: legacyCategories,
  years: legacyYears,
} = require("./fcbuilder-setup");

// ============================================================================
// Audit Trail Configuration
// ============================================================================

const { PATHS } = require("./constants");

const auditTrailDir = PATHS.AUDIT_TRAIL_DIR;
let auditTrailDirEnsured = false;

/**
 * Ensures the audit trail directory exists, creating it if necessary.
 * Uses a flag to avoid redundant filesystem checks.
 */
const ensureAuditTrailDir = () => {
  if (auditTrailDirEnsured) return;
  fs.mkdirSync(auditTrailDir, { recursive: true });
  auditTrailDirEnsured = true;
};

/**
 * Sanitizes a string for use in filenames by converting to string and providing fallback.
 *
 * @param {*} value - The value to sanitize
 * @param {string} fallback - Fallback value if input is invalid
 * @returns {string} Sanitized string value
 */
const sanitizeName = (value, fallback) => (value && String(value)) || fallback;

/**
 * Extracts index values from a DataFrame, handling various danfojs index formats.
 *
 * @param {DataFrame} df - The DataFrame to extract index values from
 * @returns {Array} Array of index values
 */
const getIndexValues = (df) => {
  if (Array.isArray(df.index)) return df.index;
  if (Array.isArray(df.index?.values)) return df.index.values;
  if (Array.isArray(df.index?.index)) return df.index.index;
  return [];
};

/**
 * Writes category entries to a CSV file for audit trail purposes.
 * Optimized to build CSV content efficiently using arrays.
 *
 * @param {DataFrame} dfCategories - DataFrame containing category data
 * @param {string} scenarioName - Name of the scenario
 * @param {string} accountName - Name of the account
 */
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

/**
 * Builds an array of forecast entries from a DataFrame for database insertion.
 * Filters out null/zero amounts and creates entry objects with scenario, year, amount, account, and module.
 *
 * @param {DataFrame} dfCategories - DataFrame containing category forecast data
 * @param {string} scenarioName - Name of the forecast scenario
 * @param {string} moduleName - Name of the module/account being processed
 * @param {string} moduleComment - Optional comment from the module
 * @returns {Array<Object>} Array of entry objects ready for database insertion
 */
const buildFcEntriesPayload = (
  dfCategories,
  scenarioName,
  moduleName,
  moduleComment
) => {
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

      const entry = {
        Scenario: scenarioName,
        Year: year,
        Amount: amount,
        Account: account,
        Module: module,
      };

      // Add Comment field if it exists
      if (moduleComment) {
        entry.Comment = moduleComment;
      }

      entries.push(entry);
    }
  }

  return entries;
};

/**
 * Inserts category forecast entries into the database.
 * Validates database connection and scenario name before attempting insertion.
 *
 * @param {DataFrame} dfCategories - DataFrame containing category forecast data
 * @param {string} scenarioName - Name of the forecast scenario
 * @param {string} moduleName - Name of the module/account being processed
 * @param {string} moduleComment - Optional comment from the module
 * @returns {Promise<Array>} Promise resolving to inserted documents or empty array
 */
const insertCategoryEntries = (
  dfCategories,
  scenarioName,
  moduleName,
  moduleComment
) => {
  if (!scenarioName || mongoose.connection.readyState === 0) {
    return Promise.resolve([]);
  }

  const entries = buildFcEntriesPayload(
    dfCategories,
    scenarioName,
    moduleName,
    moduleComment
  );
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

/**
 * Processes an income/expense module to generate forecast values across multiple years.
 *
 * This function:
 * 1. Calculates projected income/expense values based on base value, growth, and inflation
 * 2. Applies discrete changes (percentage or dollar amount) for specific years
 * 3. Calculates associated tax impacts
 * 4. Updates the categories DataFrame with results
 * 5. Writes audit trail and database entries
 *
 * @param {Object} module - The income/expense module configuration
 * @param {string} module.Account - Account name (e.g., "Salary", "Rent")
 * @param {string} module.Name - Module display name
 * @param {number} module.BaseValue - Starting value for year 1
 * @param {number} [module.Growth=0] - Growth multiplier applied to inflation (0-1)
 * @param {Array<Object>} [module.Changes] - Array of discrete changes by year
 * @param {Object} scenario - Scenario configuration
 * @param {number} scenario.PeriodStart - First year of forecast
 * @param {number} scenario.PeriodEnd - Last year of forecast
 * @param {number} scenario.TaxRate - Tax rate as percentage
 * @param {string} scenario.Name - Scenario name
 * @param {DataFrame} df_assumptions - DataFrame containing assumptions (e.g., inflation rates)
 * @param {DataFrame} df_categories - DataFrame to update with calculated values
 * @param {Array<string>} categories - Category names array from scenario config
 * @param {Array<number>} years - Years array from scenario config
 * @returns {Promise<Object>} Promise that resolves with processing metadata
 */
async function processModule(
  module,
  scenario,
  df_assumptions,
  df_categories,
  categories,
  years
) {
  // Use provided categories/years or fall back to legacy imports for backward compatibility
  const _categories = categories || legacyCategories;
  const _years = years || legacyYears;

  console.log(`Processing account: ${module.Account}`);
  console.log(`Processing module: ${module.Name}`);
  console.log("Scenario", scenario);

  // Define forecast period based on scenario start and end years
  const startyear = scenario.PeriodStart;
  const endyear = scenario.PeriodEnd;
  const yearsCount = endyear - startyear + 1;

  // Extract inflation series and period configuration
  const inflationSeries = df_assumptions.column("Inflation").values;
  const periodStart = _years[0];
  const inflationLen = inflationSeries.length;

  // Initialize change arrays: P = percentage changes, D = dollar amount changes, O = one-off dollar changes
  const changeDValues = new Array(yearsCount).fill(0);
  const changePValues = new Array(yearsCount);
  const changeOValues = new Array(yearsCount).fill(0);
  const growth = module.Growth ?? 0;

  // Calculate default percentage changes based on inflation and growth rate
  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    changePValues[i] =
      idx >= 0 && idx < inflationLen ? inflationSeries[idx] * growth : 0;
  }

  // Apply module-specific changes, overriding defaults where specified
  if (Array.isArray(module.Changes)) {
    for (let i = 0; i < module.Changes.length; i++) {
      const entry = module.Changes[i];
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

  // Calculate income/expense values for each year
  const incexpValues = new Array(yearsCount);
  const baseValues = new Array(yearsCount); // Track base values without one-off amounts for growth calculation
  const taxValues = new Array(yearsCount).fill(0);
  const cashChange = new Array(yearsCount);

  // Year 1: Base value with first year adjustments
  baseValues[0] =
    module.BaseValue * (1 + (changePValues[0] ?? 0) / 100) +
    (changeDValues[0] ?? 0);
  incexpValues[0] = baseValues[0] + (changeOValues[0] ?? 0);

  if (incexpValues[0] > 0) {
    taxValues[0] = -(incexpValues[0] * scenario.TaxRate) / 100;
  }

  // Subsequent years: Apply percentage growth and dollar changes
  // Note: One-Off values are only applied in the specific year, not carried forward
  // The baseValues array tracks the recurring amount (used for growth), while incexpValues includes one-time amounts
  for (let i = 1; i < yearsCount; i++) {
    const year = startyear + i;
    const idx = year - periodStart;

    if (idx >= 0 && idx < inflationLen) {
      // Calculate base value from previous base (excluding one-off amounts)
      baseValues[i] =
        baseValues[i - 1] * (1 + changePValues[i] / 100) + changeDValues[i];
      // Add one-off amount only to the actual income/expense value
      incexpValues[i] = baseValues[i] + changeOValues[i];
    } else {
      baseValues[i] = 0;
      incexpValues[i] = 0;
    }

    if (incexpValues[i] > 0) {
      taxValues[i] = -(incexpValues[i] * scenario.TaxRate) / 100;
    }
  }

  // Calculate net cash impact (income/expense + tax)
  for (let i = 0; i < yearsCount; i++) {
    cashChange[i] = incexpValues[i] + taxValues[i];
  }

  // Clear all rows in df_categories to prepare for new values
  const dfCategoryValues = df_categories.values;
  for (let i = 0; i < dfCategoryValues.length; i++) {
    dfCategoryValues[i].fill(0);
  }

  // Write calculated values to appropriate category rows
  let categoryRowIndex = df_categories.index.indexOf(module.Account);
  writeValuesToCategoryRow(
    categoryRowIndex,
    df_categories,
    incexpValues,
    startyear
  );

  // Special handling: If account is Taxes, add incexpValues to taxValues
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

  // Write audit trail and persist to database
  writeEntriesAuditTrail(df_categories, scenario?.Name, module?.Account);

  const inserted = await insertCategoryEntries(
    df_categories,
    scenario?.Name,
    module?.Account,
    module?.Comment
  );

  //console.log(df_categories.toString());

  // Return metadata about processing
  return {
    moduleName: module?.Name,
    account: module?.Account,
    entriesCount: Array.isArray(inserted) ? inserted.length : 0,
  };
}

module.exports = { processModule };
