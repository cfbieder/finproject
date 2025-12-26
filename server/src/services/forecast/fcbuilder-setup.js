const fs = require("fs");
const { PATHS } = require("./constants");

/**
 * Loads and parses the FCAssump.json file
 *
 * @returns {Object} Parsed FCAssump configuration
 * @throws {Error} If file cannot be loaded or parsed
 */
function loadFCAssump() {
  try {
    const FCAssump = require("../../../../components/data/FCAssump.json");

    // Defensive validation for FCAssump object
    if (!FCAssump) {
      throw new Error("FCAssump is undefined or null after require");
    }

    if (!Array.isArray(FCAssump.scenarios) || FCAssump.scenarios.length === 0) {
      throw new Error("FCAssump.scenarios must be a non-empty array");
    }

    if (!FCAssump.category) {
      throw new Error("FCAssump.category is missing or undefined");
    }

    return FCAssump;
  } catch (error) {
    throw new Error(`Failed to load FCAssump.json: ${error.message}`);
  }
}

/**
 * Builds rate arrays for the forecast period based on yearly entries
 * Carries forward rates when no entry exists for a given year
 *
 * @param {Array<{Year: number, Rate: number}>} entries - Sorted array of year/rate entries
 * @param {number} periodStart - First year of forecast period
 * @param {number} periodEnd - Last year of forecast period
 * @returns {number[]} Array of rates for each year in the period
 */
function buildRates(entries, periodStart, periodEnd) {
  const yearsCount = periodEnd - periodStart + 1;
  const result = new Array(yearsCount);
  let idx = 0;
  let currentRate = entries[0]?.Rate ?? 0;

  for (let year = periodStart; year <= periodEnd; year++) {
    while (idx + 1 < entries.length && entries[idx + 1].Year <= year) {
      idx++;
      currentRate = entries[idx].Rate;
    }
    result[year - periodStart] = currentRate;
  }
  return result;
}

/**
 * Factory function to load scenario configuration
 * This is the new, reusable way to load scenario data
 *
 * @param {string} scenarioName - Name of the scenario to load
 * @returns {Object} Scenario configuration with all calculated rates and arrays
 * @throws {Error} If scenario not found or configuration invalid
 */
function loadScenarioConfig(scenarioName) {
  const FCAssump = loadFCAssump();

  // Find scenario by name, or use first if not specified
  const scenario = scenarioName
    ? FCAssump.scenarios.find((entry) => entry.Name === scenarioName)
    : FCAssump.scenarios[0];

  if (!scenario) {
    throw new Error("No scenarios available in FCAssump.scenarios");
  }

  if (scenarioName && scenario.Name !== scenarioName) {
    throw new Error(
      `Scenario "${scenarioName}" not found in FCAssump.scenarios`
    );
  }

  if (!scenario.PeriodStart || !scenario.PeriodEnd) {
    throw new Error(
      `Scenario missing required fields: PeriodStart=${scenario.PeriodStart}, PeriodEnd=${scenario.PeriodEnd}`
    );
  }

  // Extract tax rate for this scenario
  const taxRateEntry = Array.isArray(FCAssump["Tax Rate"])
    ? FCAssump["Tax Rate"].find((entry) => entry.Scenario === scenario.Name)
    : null;
  const taxRate = Number(taxRateEntry?.Rate ?? 0);
  scenario.TaxRate = Number.isFinite(taxRate) ? taxRate : 0;

  const categories = FCAssump.category;
  const { PeriodStart: periodStart, PeriodEnd: periodEnd } = scenario;

  // Extract and sort inflation data for this scenario
  const inflation = [];
  for (let i = 0; i < FCAssump.inflation.length; i++) {
    const entry = FCAssump.inflation[i];
    if (entry.Scenario === scenario.Name) {
      inflation.push({ Year: entry.Year, Rate: entry.Rate });
    }
  }
  inflation.sort((a, b) => a.Year - b.Year);

  // Extract and sort FX rate data for this scenario
  const fxratePLN = [];
  const fxrateEUR = [];
  for (let i = 0; i < FCAssump.FX.length; i++) {
    const entry = FCAssump.FX[i];
    if (entry.Scenario === scenario.Name) {
      fxratePLN.push({ Year: entry.Year, Rate: entry.Rates.USDPLN });
      fxrateEUR.push({ Year: entry.Year, Rate: entry.Rates.USDEUR });
    }
  }
  fxratePLN.sort((a, b) => a.Year - b.Year);
  fxrateEUR.sort((a, b) => a.Year - b.Year);

  // Build rate arrays for the full forecast period
  const inflationRates = buildRates(inflation, periodStart, periodEnd);
  const fxratesPLN = buildRates(fxratePLN, periodStart, periodEnd);
  const fxratesEUR = buildRates(fxrateEUR, periodStart, periodEnd);

  // Build years array
  const yearsCount = periodEnd - periodStart + 1;
  const years = new Array(yearsCount);
  for (let i = 0, year = periodStart; year <= periodEnd; i++, year++) {
    years[i] = year;
  }

  return {
    scenario,
    categories,
    inflationRates,
    fxratesPLN,
    fxratesEUR,
    taxRate: scenario.TaxRate,
    years,
  };
}

// ============================================================================
// Backward Compatibility - Legacy Exports
// ============================================================================
// This section maintains compatibility with the old module-level execution
// pattern where setup runs on require with process.argv[2]

let cachedConfig;
const scenarioName = process.argv[2];

if (scenarioName) {
  try {
    cachedConfig = loadScenarioConfig(scenarioName);
  } catch (error) {
    // In legacy mode, throw errors immediately
    throw error;
  }
}

module.exports = {
  // New factory function export (preferred)
  loadScenarioConfig,

  // Legacy exports for backward compatibility
  scenario: cachedConfig?.scenario,
  categories: cachedConfig?.categories,
  inflationRates: cachedConfig?.inflationRates,
  fxratesPLN: cachedConfig?.fxratesPLN,
  fxratesEUR: cachedConfig?.fxratesEUR,
  taxRate: cachedConfig?.taxRate,
  years: cachedConfig?.years,
};
