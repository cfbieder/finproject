/**
 * Forecast Generation Service - Main Entry Point
 *
 * This module provides the main async function for generating forecasts.
 * It orchestrates the entire forecast building process by:
 * 1. Loading scenario configuration and assumptions
 * 2. Connecting to MongoDB to retrieve forecast modules
 * 3. Processing each module to generate forecast entries
 * 4. Persisting results to the database
 *
 * This is the new, refactored implementation that replaces the old
 * process-spawning approach with a direct async function call.
 */

const dfd = require("danfojs-node");
const { loadScenarioConfig } = require("./fcbuilder-setup");
const ForecastDatabaseManager = require("./database-manager");
const { processModule: processBSModule } = require("./fcbuilder-module");
const { processModule: processIncExpModule } = require("./fcbuilder-incexp");
const { CATEGORIES } = require("./constants");

/**
 * Builds a unique, ordered list of scenario categories
 * Order: Bank Accounts → Transfer - Bank → Account Names → Income → Expenses → Tax Reserve
 *
 * @param {string[]} accountNames - Account names from modules
 * @param {string[]} incomeCategories - Income categories from modules
 * @param {string[]} expenseCategories - Expense categories from modules
 * @returns {string[]} Ordered list of unique categories
 */
function buildScenarioCategories(
  accountNames,
  incomeCategories,
  expenseCategories
) {
  const seen = new Set();
  const ordered = [];

  const pushUnique = (item) => {
    if (item && !seen.has(item)) {
      seen.add(item);
      ordered.push(item);
    }
  };

  // Add categories in specific order
  pushUnique(CATEGORIES.BANK_ACCOUNTS);
  pushUnique(CATEGORIES.TRANSFER_BANK);
  accountNames.forEach(pushUnique);
  incomeCategories.forEach(pushUnique);
  expenseCategories.forEach(pushUnique);
  pushUnique(CATEGORIES.TAXES_US);

  return ordered;
}

/**
 * Creates column headers for the forecast period
 * Includes the year before the forecast period as baseline
 *
 * @param {number[]} years - Array of forecast years
 * @returns {number[]} Array of years including baseline year
 */
function buildColumns(years) {
  const result = new Array(years.length + 1);
  result[0] = years[0] - 1; // Baseline year
  for (let i = 0; i < years.length; i++) {
    result[i + 1] = years[i];
  }
  return result;
}

/**
 * Creates a zero-filled matrix for the categories dataframe
 *
 * @param {number} rowCount - Number of rows (categories)
 * @param {number} colCount - Number of columns (years)
 * @returns {number[][]} Zero-filled matrix
 */
function createZerosMatrix(rowCount, colCount) {
  const matrix = new Array(rowCount);
  for (let i = 0; i < rowCount; i++) {
    matrix[i] = new Array(colCount).fill(0);
  }
  return matrix;
}

/**
 * Main forecast generation function
 *
 * Generates a complete financial forecast for the specified scenario by:
 * - Loading scenario configuration and assumptions
 * - Querying database for forecast modules and income/expense entries
 * - Processing each module to calculate projections
 * - Writing results to database and audit trail
 *
 * @param {string} scenarioName - Name of the scenario to generate
 * @param {Object} options - Optional configuration
 * @param {string} options.mongoUri - MongoDB connection URI (defaults to env var or localhost)
 * @returns {Promise<Object>} Result object with success status and metadata
 *
 * @example
 * const result = await generateForecast('Baseline');
 * if (result.success) {
 *   console.log(`Created ${result.entriesCreated} forecast entries`);
 * }
 */
async function generateForecast(scenarioName, options = {}) {
  const startTime = Date.now();

  console.log(`[FORECAST-GENERATE] Starting forecast generation for scenario: ${scenarioName}`);

  try {
    // Step 1: Load configuration and create assumptions dataframe
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

    // Step 2: Initialize database manager
    const dbManager = new ForecastDatabaseManager(options.mongoUri);
    await dbManager.ensureConnection();

    // Step 3: Clear existing entries for this scenario
    const deletedCount = await dbManager.clearEntriesForScenario(scenarioName);

    // Step 4: Load modules and categories in parallel
    const [
      bsModules,
      incexpModules,
      { expenseCategories, incomeCategories, accountNames },
      { incexpCategories },
    ] = await Promise.all([
      dbManager.loadModulesForScenario(scenarioName),
      dbManager.loadIncExpModulesForScenario(scenarioName),
      dbManager.loadCategoriesForScenario(scenarioName),
      dbManager.loadIncExpCategoriesForScenario(scenarioName),
    ]);

    console.log(
      `[FORECAST-GENERATE] Loaded ${bsModules.length} FCModule entries for scenario ${scenarioName}`
    );
    console.log(
      `[FORECAST-GENERATE] Loaded ${incexpModules.length} FCIncExp entries for scenario ${scenarioName}`
    );

    // Step 5: Build category structures and initialize dataframes
    const scenarioCategories = buildScenarioCategories(
      accountNames,
      incomeCategories,
      expenseCategories
    );

    if (!incexpCategories.includes(CATEGORIES.TAXES)) {
      incexpCategories.push(CATEGORIES.TAXES);
    }
    incexpCategories.push(CATEGORIES.BANK_ACCOUNTS);

    const columns = buildColumns(years);
    const zerosMatrix = createZerosMatrix(
      scenarioCategories.length,
      columns.length
    );
    const zerosMatrix2 = createZerosMatrix(
      incexpCategories.length,
      columns.length
    );

    const df_categories = new dfd.DataFrame(zerosMatrix, {
      columns: columns,
      index: scenarioCategories,
    });
    df_categories.config.setMaxRow(1000);

    const df_categories2 = new dfd.DataFrame(zerosMatrix2, {
      columns: columns,
      index: incexpCategories,
    });
    df_categories2.config.setMaxRow(1000);

    // Step 6: Process all modules in parallel
    // Each module needs its own temporary dataframe to avoid race conditions
    console.log(`[FORECAST-GENERATE] Processing ${bsModules.length + incexpModules.length} modules...`);

    const results = await Promise.all([
      ...bsModules.map((module) => {
        // Create a fresh dataframe for this module
        const df_module_categories = new dfd.DataFrame(
          createZerosMatrix(scenarioCategories.length, columns.length),
          { columns: columns, index: scenarioCategories }
        );
        df_module_categories.config.setMaxRow(1000);
        return processBSModule(module, scenario, df_assumptions, df_module_categories, categories, years);
      }),
      ...incexpModules.map((module) => {
        // Create a fresh dataframe for this module
        const df_module_categories2 = new dfd.DataFrame(
          createZerosMatrix(incexpCategories.length, columns.length),
          { columns: columns, index: incexpCategories }
        );
        df_module_categories2.config.setMaxRow(1000);
        return processIncExpModule(module, scenario, df_assumptions, df_module_categories2, categories, years);
      }),
    ]);

    // Step 7: Calculate statistics
    const totalEntries = results.reduce(
      (sum, r) => sum + (r?.entriesCount || 0),
      0
    );

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
