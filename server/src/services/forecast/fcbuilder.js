/**
 * Forecast Builder - Main Module
 *
 * This module orchestrates the financial forecast building process by:
 * 1. Loading scenario configuration and assumptions (inflation, FX rates)
 * 2. Connecting to MongoDB to retrieve forecast modules
 * 3. Processing each module to generate forecast entries
 * 4. Persisting results to the database
 *
 * @module fcbuilder
 */

const dfd = require("danfojs-node");
const {
  scenario,
  categories,
  inflationRates,
  fxratesPLN,
  fxratesEUR,
  years,
  taxRate,
} = require("./fcbuilder-setup");
const mongoose = require("../../../../components/node_modules/mongoose");
const FCModule = require("../../../../components/models/FCModule");
const FCEntries = require("../../../../components/models/FCEntries");
const FCIncExp = require("../../../../components/models/FCIncExp");
const { processModule: processBSModule } = require("./fcbuilder-module");
const { processModule: processIncExpModule } = require("./fcbuilder-incexp");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27018/fin";

// ============================================================================
// Initialize Assumptions DataFrame
// ============================================================================

// Process tax rate - use explicit taxRate if finite, otherwise use scenario default
const scenarioTaxRate = Number.isFinite(taxRate)
  ? taxRate
  : Number(scenario?.TaxRate ?? 0);
scenario.TaxRate = scenarioTaxRate;

//console.log("FX Rates (PLN):", fxratesPLN);

// Create assumptions dataframe with inflation and FX rates indexed by year
const df_assumptions = new dfd.DataFrame(
  {
    [categories[1]]: inflationRates,
    [categories[2]]: fxratesPLN,
    [categories[3]]: fxratesEUR,
  },
  { index: years }
);

//console.log("Scenario Configuration:", scenario);
//console.log(df_assumptions.toString());

// ============================================================================
// Database Connection Functions
// ============================================================================

/**
 * Ensures MongoDB connection is established
 *
 * @returns {Promise<void>}
 * @throws {Error} If connection fails
 */
async function ensureConnection() {
  if (mongoose.connection.readyState === 0 && MONGO_URI) {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 1000 });
  }
}

/**
 * Loads all unique expense categories, income categories, and account names
 * for a given scenario from the database
 *
 * @param {string} name - Scenario name
 * @returns {Promise<{expenseCategories: string[], incomeCategories: string[], accountNames: string[]}>}
 */
async function loadCategoriesForScenario(name) {
  if (!name || !MONGO_URI) {
    return { expenseCategories: [], incomeCategories: [], accountNames: [] };
  }

  await ensureConnection();

  const [result] =
    (await FCModule.aggregate([
      { $match: { Scenario: name } },
      {
        $group: {
          _id: null,
          expenseCategories: { $addToSet: "$ExpCategory" },
          incomeCategories: { $addToSet: "$IncomeCategory" },
          accountNames: { $addToSet: "$Account" },
        },
      },
    ])) || [];

  return {
    expenseCategories: result?.expenseCategories?.filter(Boolean) ?? [],
    incomeCategories: result?.incomeCategories?.filter(Boolean) ?? [],
    accountNames: result?.accountNames?.filter(Boolean) ?? [],
  };
}

/**
 * Loads all unique income/expense categories for a given scenario from FCIncExp
 *
 * @param {string} name - Scenario name
 * @returns {Promise<{incexpCategories: string[]}>}
 */
async function loadIncExpCategoriesForScenario(name) {
  if (!name || !MONGO_URI) {
    return { incexpCategories: [] };
  }

  await ensureConnection();

  const [result] =
    (await FCIncExp.aggregate([
      { $match: { Scenario: name } },
      {
        $group: {
          _id: null,
          incexpCategories: { $addToSet: "$Account" },
        },
      },
    ])) || [];

  return { incexpCategories: result?.incexpCategories?.filter(Boolean) ?? [] };
}

/**
 * Loads all forecast modules for a given scenario from the database
 *
 * @param {string} name - Scenario name
 * @returns {Promise<Array>} Array of FCModule documents
 */
async function loadModulesForScenario(name) {
  if (!name || !MONGO_URI) {
    return [];
  }

  await ensureConnection();

  return FCModule.find({ Scenario: name }).lean().exec();
}

/**
 * Loads all income/expense modules for a given scenario from the database
 *
 * @param {string} name - Scenario name
 * @returns {Promise<Array>} Array of FCIncExp documents
 */
async function loadIncExpModulesForScenario(name) {
  if (!name || !MONGO_URI) {
    return [];
  }

  await ensureConnection();

  return FCIncExp.find({ Scenario: name }).lean().exec();
}

/**
 * Clears all existing forecast entries for a given scenario
 * This ensures a clean slate before regenerating forecasts
 *
 * @param {string} name - Scenario name
 * @returns {Promise<number>} Number of deleted entries
 */
async function clearEntriesForScenario(name) {
  console.log(`Clearing existing fcEntry entries for scenario ${name}...`);
  if (!name || !MONGO_URI) {
    return 0;
  }

  await ensureConnection();

  const { deletedCount = 0 } =
    (await FCEntries.deleteMany({ Scenario: name })) || {};

  if (deletedCount) {
    console.log(`Deleted ${deletedCount} fcEntry entries for scenario ${name}`);
  }

  return deletedCount;
}

// ============================================================================
// Main Execution
// ============================================================================

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
  pushUnique("Bank Accounts");
  pushUnique("Transfer - Bank");
  accountNames.forEach(pushUnique);
  incomeCategories.forEach(pushUnique);
  expenseCategories.forEach(pushUnique);
  pushUnique("Taxes US");

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
 * Main execution function - orchestrates the entire forecast building process
 */
async function main() {
  try {
    // Step 1: Clear existing entries for this scenario
    await clearEntriesForScenario(scenario.Name);

    // Step 2: Load modules and categories in parallel
    const [
      bsModules,
      { expenseCategories, incomeCategories, accountNames },
      { incexpCategories },
      incexpModules,
    ] = await Promise.all([
      loadModulesForScenario(scenario.Name),
      loadCategoriesForScenario(scenario.Name),
      loadIncExpCategoriesForScenario(scenario.Name),
      loadIncExpModulesForScenario(scenario.Name),
    ]);

    console.log(
      `Loaded ${bsModules.length} FCModule entries for scenario ${scenario.Name}`
    );
    console.log(
      `Loaded ${incexpModules.length} FCIncExpModule entries for scenario ${scenario.Name}`
    );
    console.log("Scenario details:", scenario);

    // Step 3: Build category structure and initialize dataframe
    const scenarioCategories = buildScenarioCategories(
      accountNames,
      incomeCategories,
      expenseCategories
    );

    if (!incexpCategories.includes("Taxes")) {
      incexpCategories.push("Taxes");
    }
    incexpCategories.push("Bank Accounts");
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

    // Step 4: Process all modules in parallel
    await Promise.all(
      bsModules.map((module) =>
        processBSModule(module, scenario, df_assumptions, df_categories)
      )
    );

    // Step 5: Process income/expense modules in parallel
    await Promise.all(
      incexpModules.map((module) =>
        processIncExpModule(module, scenario, df_assumptions, df_categories2)
      )
    );

    console.log("All Done");
  } catch (error) {
    console.error("Failed to build forecast:", error);
    process.exitCode = 1;
  }
}

// Execute main function
main();
