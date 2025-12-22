/**
 * Forecast Builder - Module Processor
 *
 * This module processes individual forecast modules, calculating:
 * - Market values and base values over time
 * - Realized and unrealized gains
 * - Investment and disposal transactions
 * - Income and expense projections
 * - Tax calculations
 * - FX conversions
 * - Audit trail CSV generation
 *
 * @module fcbuilder-module
 */

const dfd = require("danfojs-node");
const fs = require("fs");
const path = require("path");
const mongoose = require("../../../../components/node_modules/mongoose");
const FCEntries = require("../../../../components/models/FCEntries");
const { categories, years } = require("./fcbuilder-setup");

// ============================================================================
// Display Formatting Functions
// ============================================================================

/**
 * Configures dataframe display settings for console output
 * Automatically adjusts column widths based on terminal size
 *
 * @param {DataFrame} df - Danfo.js DataFrame to configure
 * @returns {DataFrame} Rounded dataframe with display settings applied
 */
const configureDisplay = (df) => {
  const dfRounded = df.round(2);
  const totalColumns = dfRounded.columns.length;
  dfRounded.config.setTableMaxColInConsole(totalColumns);
  const visibleColumns = totalColumns + 1; // include index column
  const consoleWidth = process.stdout.columns || 80;
  const indexValues = Array.isArray(dfRounded.index)
    ? dfRounded.index
    : Array.isArray(dfRounded.index?.values)
    ? dfRounded.index.values
    : Array.isArray(dfRounded.index?.index)
    ? dfRounded.index.index
    : [];
  const columnWidth = Math.max(
    6,
    Math.min(8, Math.floor((consoleWidth - 10) / visibleColumns))
  );
  const longestIndexLength = indexValues.reduce(
    (max, value) => Math.max(max, String(value).length),
    "index".length
  );
  const baseIndexWidth = longestIndexLength + 2;
  const remainingWidth =
    consoleWidth - columnWidth * (visibleColumns - 1) - 2; /* padding */
  const indexWidth = Math.max(
    columnWidth,
    remainingWidth > 0 ? Math.min(baseIndexWidth, remainingWidth) : columnWidth
  );
  const columnsConfig = {};
  columnsConfig[0] = { width: indexWidth, truncate: indexWidth - 1 };
  for (let i = 1; i < visibleColumns; i++) {
    columnsConfig[i] = { width: columnWidth, truncate: columnWidth - 1 };
  }
  dfRounded.config.setTableDisplayConfig({ columns: columnsConfig });
  return dfRounded;
};

/**
 * Logs two dataframes (LC and USD) to console with proper formatting
 *
 * @param {DataFrame} dfModuleLC - DataFrame in local currency
 * @param {DataFrame} dfModuleUSD - DataFrame in USD
 */
const logDataFrames = (dfModuleLC, dfModuleUSD) => {
  let dfRounded = configureDisplay(dfModuleLC);
  console.log(dfRounded.toString());
  dfRounded = configureDisplay(dfModuleUSD);
  console.log(dfRounded.toString());
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
// Audit Trail Functions
// ============================================================================

const auditTrailDir = path.resolve(
  __dirname,
  "../../../../components/data/auditTrail"
);

let auditTrailDirEnsured = false;
const pendingAuditTrails = new Set();
let exitScheduled = false;

/**
 * Ensures audit trail directory exists, creates it if needed
 */
const ensureAuditTrailDir = () => {
  if (auditTrailDirEnsured) return;
  fs.mkdirSync(auditTrailDir, { recursive: true });
  auditTrailDirEnsured = true;
};

/**
 * Sanitizes a value for use in filenames
 *
 * @param {*} value - Value to sanitize
 * @param {string} fallback - Fallback value if invalid
 * @returns {string} Sanitized string
 */
const sanitizeName = (value, fallback) => (value && String(value)) || fallback;

/**
 * Extracts index values from a dataframe
 * Handles different danfojs index structures
 *
 * @param {DataFrame} df - Danfo.js DataFrame
 * @returns {Array} Array of index values
 */
const getIndexValues = (df) => {
  if (Array.isArray(df.index)) return df.index;
  if (Array.isArray(df.index?.values)) return df.index.values;
  if (Array.isArray(df.index?.index)) return df.index.index;
  return [];
};

/**
 * Schedules process exit when all audit trails are written
 */
const scheduleExitIfIdle = () => {
  if (exitScheduled || pendingAuditTrails.size !== 0) {
    return;
  }
  exitScheduled = true;
  setImmediate(() => process.exit(process.exitCode ?? 0));
};

/**
 * Tracks an audit trail promise and handles errors
 *
 * @param {Promise} promise - Audit trail write promise
 * @returns {Promise} The tracked promise
 */
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

/**
 * Writes audit trail CSV files for a processed module
 * Creates three files: LC (local currency), USD, and entries
 *
 * @param {DataFrame} dfModuleLC - Module dataframe in local currency
 * @param {DataFrame} dfModuleUSD - Module dataframe in USD
 * @param {DataFrame} dfCategories - Categories dataframe
 * @param {Object} scenario - Scenario configuration
 * @param {Object} module - Module configuration
 * @returns {Promise<void>}
 */
const writeAuditTrail = (
  dfModuleLC,
  dfModuleUSD,
  dfCategories,
  scenario,
  module
) => {
  ensureAuditTrailDir();
  const scenarioName = sanitizeName(scenario?.Name, "scenario").replace(
    /[^a-z0-9]/gi,
    "_"
  );
  const moduleName = sanitizeName(module?.Name, "module").replace(
    /[^a-z0-9]/gi,
    "_"
  );
  /**
   * Writes a single CSV file with headers for a dataframe
   *
   * @param {DataFrame} df - Dataframe to export
   * @param {string} suffix - File suffix (LC, USD, or entries)
   * @returns {Promise<void>}
   */
  const writeCsvWithHeaders = (df, suffix) => {
    const filePath = path.join(
      auditTrailDir,
      `${scenarioName}_${moduleName}_${suffix}.csv`
    );
    const columns = df.columns || [];
    const rows = df.values || [];
    const indexValues = getIndexValues(df);
    return new Promise((resolve, reject) => {
      try {
        // Pre-allocate array for better performance
        const lines = new Array(rows.length + 1);

        // Write header row
        lines[0] = ["index", ...columns].join(",") + "\n";

        // Write data rows
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

        // Write synchronously for consistency with audit trail tracking
        fs.writeFileSync(filePath, lines.join(""), "utf8");
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  };

  const auditPromise = Promise.all([
    writeCsvWithHeaders(dfModuleLC, "LC"),
    writeCsvWithHeaders(dfCategories, "entries"),
    writeCsvWithHeaders(dfModuleUSD, "USD"),
  ]);

  return trackAuditTrail(auditPromise);
};

// ============================================================================
// Database Entry Functions
// ============================================================================

/**
 * Builds an array of FCEntries documents from the categories dataframe
 * Transforms dataframe rows and columns into individual database entries
 *
 * @param {DataFrame} dfCategories - Categories dataframe with years as columns
 * @param {string} scenarioName - Scenario identifier
 * @param {string} moduleName - Module identifier
 * @returns {Array<Object>} Array of FCEntries documents ready for insertion
 */
const buildFcEntriesPayload = (dfCategories, scenarioName, moduleName) => {
  const columns = dfCategories?.columns || [];
  const rows = dfCategories?.values || [];
  const indexValues = getIndexValues(dfCategories);
  const entries = [];
  const module = moduleName || "";

  // Iterate through each row (category/account)
  for (let i = 0; i < rows.length; i++) {
    const account = indexValues[i];
    if (!account) continue;

    const row = rows[i];
    // Iterate through each column (year)
    for (let j = 0; j < columns.length; j++) {
      const amount = row[j];
      // Skip zero and null values to reduce database size
      if (amount == null || amount === 0) continue;

      const year = columns[j];
      if (year == null) continue;

      // Create entry for this specific year/account/amount combination
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

/**
 * Inserts category entries into the FCEntries collection
 * Skips zero values to reduce database size and improve query performance
 *
 * @param {DataFrame} dfCategories - Categories dataframe
 * @param {string} scenarioName - Scenario identifier
 * @param {string} moduleName - Module identifier
 * @returns {Promise<Array>} Promise resolving to inserted documents
 */
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
// Main Processing Function
// ============================================================================

/**
 * Processes a single forecast module to calculate financial projections
 *
 * This function performs complex financial calculations including:
 * - Base value and market value projections over time
 * - Growth calculations based on inflation and module-specific growth rates
 * - Investment and disposal transaction processing
 * - Realized and unrealized gain/loss calculations
 * - Income and expense projections
 * - Tax calculations on realized gains
 * - Foreign exchange conversions (LC to USD)
 * - Integration with the categories dataframe
 * - Audit trail CSV generation
 *
 * @param {Object} module - FCModule document containing:
 *   - Name: Module identifier
 *   - Account: Account name
 *   - BaseDate: Starting date for forecasts
 *   - BaseValue: Initial value in local currency
 *   - BaseValueUSD: Initial value in USD
 *   - MarketValue: Initial market value in local currency
 *   - MarketValueUSD: Initial market value in USD
 *   - Currency: Currency code (USD, PLN, EUR)
 *   - Growth: Growth percentage (inflation-adjusted)
 *   - IncomePct: Income percentage (inflation-adjusted)
 *   - ExpensePct: Expense percentage (inflation-adjusted)
 *   - IncomeCategory: Category for income entries
 *   - ExpCategory: Category for expense entries
 *   - Invest: Array of investment transactions
 *   - Dispose: Array of disposal transactions
 *
 * @param {Object} scenario - Scenario configuration containing:
 *   - Name: Scenario identifier
 *   - PeriodEnd: End year for forecasts
 *   - TaxRate: Tax rate percentage for realized gains
 *
 * @param {DataFrame} df_assumptions - Assumptions dataframe indexed by year with columns:
 *   - Inflation rates
 *   - FX rates (PLN, EUR)
 *
 * @param {DataFrame} df_categories - Categories dataframe to be updated with:
 *   - Market values by account
 *   - Transfer values (invest/dispose)
 *   - Income by category
 *   - Expenses by category
 *   - Tax reserves
 *   - Bank account cash changes
 *
 * @returns {Promise<void>} Promise that resolves when processing and audit trail writing complete
 */
function processModule(module, scenario, df_assumptions, df_categories) {
  console.log(`Processing module: ${module.Name}`);
  console.log(`Processing account: ${module.Account}`);
  console.log("Scenario", scenario);

  // Define forecast period based on module start date and scenario end
  const startyear = module.BaseDate.getFullYear();
  const endyear = scenario.PeriodEnd;
  const yearsCount = endyear - startyear + 1;
  const yearsArr = new Array(yearsCount);

  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    yearsArr[i] = year;
  }

  // Initialize value arrays - all start with base/market values, calculations will update these
  const baseValues = new Array(yearsCount).fill(module.BaseValue ?? 0);
  const marketValues = new Array(yearsCount).fill(module.MarketValue ?? 0);
  const fxrates = new Array(yearsCount).fill(1);
  const investValues = new Array(yearsCount).fill(0);
  const disposeValues = new Array(yearsCount).fill(0);

  // Extract inflation series for calculations
  const inflationSeries = df_assumptions.column(categories[1]).values;
  const periodStart = years[0];
  const inflationLen = inflationSeries.length;

  // Prepare FX rates for non-USD currencies
  if (module.Currency && module.Currency !== "USD") {
    const fxColumn =
      module.Currency === "PLN"
        ? categories[2]
        : module.Currency === "EUR"
        ? categories[3]
        : null;
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

  // Calculate inflation-adjusted growth, income, and expense percentages for each year
  // These percentages are multiplied by the inflation rate to adjust for purchasing power
  const growthPct = module.Growth ?? 0;
  const incomePct = module.IncomePct ?? 0;
  const expPct = module.ExpensePct ?? 0;
  const incomePctValues = new Array(yearsCount);
  const growthValues = new Array(yearsCount);
  const expPctValues = new Array(yearsCount);
  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    growthValues[i] =
      idx >= 0 && idx < inflationLen ? growthPct * inflationSeries[idx] : 0;
    incomePctValues[i] =
      idx >= 0 && idx < inflationLen ? incomePct * inflationSeries[idx] : 0;
    expPctValues[i] =
      idx >= 0 && idx < inflationLen ? -expPct * inflationSeries[idx] : 0;
  }

  // Process investment transactions - map each transaction to the appropriate year
  if (Array.isArray(module.Invest)) {
    for (let i = 0; i < module.Invest.length; i++) {
      const entry = module.Invest[i];
      if (!entry || !entry.Date || entry.Amount == null) continue;
      const year = new Date(entry.Date).getFullYear();
      const idx = year - startyear;
      if (idx >= 0 && idx < yearsCount) {
        investValues[idx] = entry.Amount;
      }
    }
  }

  // Process disposal transactions - stored as negative values for cash flow purposes
  if (Array.isArray(module.Dispose)) {
    for (let i = 0; i < module.Dispose.length; i++) {
      const entry = module.Dispose[i];
      if (!entry || !entry.Date || entry.Amount == null) continue;
      const idx = new Date(entry.Date).getFullYear() - startyear;
      if (idx >= 0 && idx < yearsCount) {
        disposeValues[idx] = -entry.Amount;
      }
    }
  }

  // Calculate yearly realized and unrealized gains/losses
  // Core financial calculation loop - updates base values and market values year over year
  const unrealizedGainValues = new Array(yearsCount).fill(0);
  const realizedGainValues = new Array(yearsCount).fill(0);
  for (let i = 1; i < yearsCount; i++) {
    // Unrealized gain = previous market value * growth rate
    unrealizedGainValues[i] = marketValues[i - 1] * (growthValues[i] / 100);

    const prevMarket = marketValues[i - 1];
    const prevBase = baseValues[i - 1];

    // When disposing, adjust base value proportionally to maintain cost basis accuracy
    // Prevents division by zero when market value is 0
    const safeDisposeAdjustment =
      prevMarket === 0 ? 0 : (disposeValues[i] * prevBase) / prevMarket;

    // Base value = previous base + new investments + proportional reduction from disposals
    baseValues[i] = prevBase + investValues[i] + safeDisposeAdjustment;

    // Market value = previous market + growth + investments + disposals (disposals are negative)
    marketValues[i] =
      prevMarket + unrealizedGainValues[i] + investValues[i] + disposeValues[i];

    // Realized gain = disposal proceeds - proportional cost basis
    realizedGainValues[i] =
      -disposeValues[i] +
      (prevMarket === 0 ? 0 : (disposeValues[i] * prevBase) / prevMarket);
  }

  // Handle "Full" disposals - complete liquidation of the position
  // This zeroes out all future values after the disposal date
  if (Array.isArray(module.Dispose)) {
    for (let i = 0; i < module.Dispose.length; i++) {
      const entry = module.Dispose[i];
      if (entry.Flag != "Full") continue;
      const idx = new Date(entry.Date).getFullYear() - startyear;
      if (idx >= 0 && idx < yearsCount) {
        // For full disposal, recalculate unrealized gain as half the year's growth
        unrealizedGainValues[idx] =
          (marketValues[idx] - marketValues[idx - 1]) / 2;
        disposeValues[idx] = marketValues[idx - 1] + unrealizedGainValues[idx];
        realizedGainValues[idx] = disposeValues[idx] - baseValues[idx];

        // Zero out all future years after full disposal
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

  // Data validation - check for NaN in baseValues and provide detailed diagnostic info
  const nanBaseIndex = baseValues.findIndex((value) => Number.isNaN(value));
  if (nanBaseIndex !== -1) {
    const prevBase =
      nanBaseIndex > 0 && Number.isFinite(baseValues[nanBaseIndex - 1])
        ? baseValues[nanBaseIndex - 1]
        : 0;
    const prevMarket =
      nanBaseIndex > 0 && Number.isFinite(marketValues[nanBaseIndex - 1])
        ? marketValues[nanBaseIndex - 1]
        : 0;
    const invest = investValues[nanBaseIndex];
    const dispose = disposeValues[nanBaseIndex];
    let cause = "calculation produced NaN unexpectedly";

    if (nanBaseIndex === 0) {
      cause = "initial BaseValue is missing or NaN";
    } else if (!Number.isFinite(prevBase)) {
      cause = "previous BaseValue is non-finite";
    } else if (!Number.isFinite(prevMarket)) {
      cause = "previous MarketValue is non-finite";
    } else if (prevMarket === 0) {
      cause =
        "previous MarketValue is 0, making the dispose adjustment a division by zero";
    } else if (!Number.isFinite(invest) || !Number.isFinite(dispose)) {
      cause = "invest or dispose entry is non-finite";
    }

    console.warn(
      `BaseValue for module ${module.Name} becomes NaN in year ${yearsArr[nanBaseIndex]}: ${cause}. Inputs -> prevBase=${prevBase}, prevMarket=${prevMarket}, invest=${invest}, dispose=${dispose}.`
    );
  }

  // Calculate tax values on realized gains only (not unrealized)
  // Taxes are negative values (cash outflows)
  const taxValues = new Array(yearsCount).fill(0);
  const taxRate = Number(
    scenario?.TaxRate ?? scenario?.taxRate ?? scenario?.["Tax Rate"] ?? 0
  );
  if (Number.isFinite(taxRate) && taxRate !== 0) {
    const rateFactor = -taxRate / 100; // Negative because taxes are an outflow
    for (let i = 0; i < yearsCount; i++) {
      const gain = realizedGainValues[i];
      // Only apply tax to positive realized gains
      if (gain > 0) {
        taxValues[i] = rateFactor * gain;
      }
    }
  }

  // Calculate income and expense values based on average market value for the year
  // Using average of beginning and ending values smooths out intra-year fluctuations
  const expenseValues = new Array(yearsCount).fill(0);
  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    expenseValues[i] =
      idx >= 0 && idx < inflationLen
        ? (((marketValues[i] + marketValues[i - 1]) / 2) * expPctValues[i]) /
          100
        : 0;
  }

  const incomeValues = new Array(yearsCount).fill(0);
  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    incomeValues[i] =
      idx >= 0 && idx < inflationLen
        ? (((marketValues[i] + marketValues[i - 1]) / 2) * incomePctValues[i]) /
          100
        : 0;
  }

  // Convert all local currency (LC) values to USD using FX rates
  // Creates parallel arrays for all financial metrics in USD
  const baseValuesUSD = new Array(yearsCount).fill(module.BaseValue ?? 0);
  const marketValuesUSD = new Array(yearsCount).fill(module.MarketValue ?? 0);
  const investValuesUSD = new Array(yearsCount).fill(0);
  const disposeValuesUSD = new Array(yearsCount).fill(0);
  const unrealizedGainValuesUSD = new Array(yearsCount).fill(0);
  const realizedGainValuesUSD = new Array(yearsCount).fill(0);
  const incomeValuesUSD = new Array(yearsCount).fill(0);
  const expenseValuesUSD = new Array(yearsCount).fill(0);
  const taxValuesUSD = new Array(yearsCount).fill(0);

  // Convert each year's values from LC to USD
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

  // Override year 0 with explicit USD values from module, calculate actual FX rate
  baseValuesUSD[0] = module.BaseValueUSD ?? 0;
  marketValuesUSD[0] = module.MarketValueUSD ?? 0;
  fxrates[0] = baseValues[0] / baseValuesUSD[0];

  // Create dataframes for local currency and USD values
  const df_module_LC = new dfd.DataFrame(
    {
      FX: fxrates,
      GrowthPct: growthValues,
      IncomePct: incomePctValues,
      ExpensePct: expPctValues,
      BaseValue: baseValues,
      MarketValue: marketValues,
      UnrealizedGain: unrealizedGainValues,
      RealizedGain: realizedGainValues,
      Invest: investValues,
      Dispose: disposeValues,
      [module.IncomeCategory]: incomeValues,
      [module.ExpCategory]: expenseValues,
      Tax: taxValues,
    },
    { index: yearsArr }
  );

  const df_module_USD = new dfd.DataFrame(
    {
      FX: fxrates,
      GrowthPct: growthValues,
      IncomePct: incomePctValues,
      ExpensePct: expPctValues,
      BaseValueUSD: baseValuesUSD,
      marketValuesUSD: marketValuesUSD,
      UnrealizedGain: unrealizedGainValuesUSD,
      RealizedGain: realizedGainValuesUSD,
      Invest: investValuesUSD,
      Dispose: disposeValuesUSD,
      [module.IncomeCategory]: incomeValuesUSD,
      [module.ExpCategory]: expenseValuesUSD,
      Tax: taxValuesUSD,
    },
    { index: yearsArr }
  );

  // Clear df_categories rows for this module account
  const dfCategoryValues = df_categories.values;
  for (let i = 0; i < dfCategoryValues.length; i++) {
    dfCategoryValues[i].fill(0);
  }

  // Write market values to df_categories
  let categoryRowIndex = df_categories.index.indexOf(module.Account);
  writeValuesToCategoryRow(
    categoryRowIndex,
    df_categories,
    marketValuesUSD,
    startyear
  );

  // Write invest/dispose values to df_categories (net transfers to/from bank)
  categoryRowIndex = df_categories.index.indexOf("Transfer - Bank");
  const transferValues = disposeValuesUSD.map(
    (dispose, idx) => dispose - investValuesUSD[idx]
  );
  writeValuesToCategoryRow(
    categoryRowIndex,
    df_categories,
    transferValues,
    startyear
  );

  // Write income values to df_categories
  categoryRowIndex = df_categories.index.indexOf(module.IncomeCategory);
  writeValuesToCategoryRow(
    categoryRowIndex,
    df_categories,
    incomeValuesUSD,
    startyear
  );

  // Write expense values to df_categories
  categoryRowIndex = df_categories.index.indexOf(module.ExpCategory);
  writeValuesToCategoryRow(
    categoryRowIndex,
    df_categories,
    expenseValuesUSD,
    startyear
  );

  // Write tax values to df_categories
  categoryRowIndex = df_categories.index.indexOf("Tax Reserve");
  writeValuesToCategoryRow(
    categoryRowIndex,
    df_categories,
    taxValuesUSD,
    startyear
  );

  // Calculate net cash change (income + expenses + taxes + transfers)
  const cashChange = new Array(yearsCount);
  for (let i = 0; i < yearsCount; i++) {
    cashChange[i] =
      incomeValuesUSD[i] +
      expenseValuesUSD[i] +
      taxValuesUSD[i] +
      transferValues[i];
  }

  // Write cashChange values to df_categories
  categoryRowIndex = df_categories.index.indexOf("Bank Accounts");
  writeValuesToCategoryRow(
    categoryRowIndex,
    df_categories,
    cashChange,
    startyear
  );

  // Display the categories dataframe for debugging
  const dfCategoriesDisplay = configureDisplay(df_categories);
  console.log(dfCategoriesDisplay.toString());

  // Optional: Display module dataframes (currently commented out)
  // logDataFrames(df_module_LC, df_module_USD);

  // Insert entries into database and track as audit trail
  const dbInsertPromise = trackAuditTrail(
    insertCategoryEntries(df_categories, scenario?.Name, module?.Name)
  );

  // Return promises for both audit trail CSV writing and database insertion
  return Promise.all([
    writeAuditTrail(
      df_module_LC,
      df_module_USD,
      df_categories,
      scenario,
      module
    ),
    dbInsertPromise,
  ]);
}
module.exports = { processModule };
