// CR039: assumptions live in the forecast_assumptions table (formerly the
// on-disk FCAssump.json — migration 034 + import-fc-assumptions.js).
const assumpRepo = require("../../v2/repositories/forecastAssumptions");

async function loadFCAssump() {
  try {
    const FCAssump = await assumpRepo.getDoc();

    if (!FCAssump || Object.keys(FCAssump).length === 0) {
      throw new Error(
        "forecast_assumptions is empty — run import-fc-assumptions.js (migration 034)"
      );
    }
    if (!Array.isArray(FCAssump.scenarios) || FCAssump.scenarios.length === 0) {
      throw new Error("FCAssump.scenarios must be a non-empty array");
    }
    if (!FCAssump.category) {
      throw new Error("FCAssump.category is missing or undefined");
    }

    return FCAssump;
  } catch (error) {
    throw new Error(`Failed to load forecast assumptions: ${error.message}`);
  }
}

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

async function loadScenarioConfig(scenarioName) {
  const FCAssump = await loadFCAssump();

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

  const taxRateEntry = Array.isArray(FCAssump["Tax Rate"])
    ? FCAssump["Tax Rate"].find((entry) => entry.Scenario === scenario.Name)
    : null;
  const taxRate = Number(taxRateEntry?.Rate ?? 0);
  scenario.TaxRate = Number.isFinite(taxRate) ? taxRate : 0;

  const categories = FCAssump.category;
  const { PeriodStart: periodStart, PeriodEnd: periodEnd } = scenario;

  const inflation = [];
  for (let i = 0; i < FCAssump.inflation.length; i++) {
    const entry = FCAssump.inflation[i];
    if (entry.Scenario === scenario.Name) {
      inflation.push({ Year: entry.Year, Rate: entry.Rate });
    }
  }
  inflation.sort((a, b) => a.Year - b.Year);

  const fxratePLN = [];
  const fxrateEUR = [];
  for (let i = 0; i < FCAssump.FX.length; i++) {
    const entry = FCAssump.FX[i];
    if (entry.Scenario === scenario.Name) {
      fxratePLN.push({ Year: entry.Year, Rate: entry.Rates.PLN ?? entry.Rates.USDPLN ?? 0 });
      fxrateEUR.push({ Year: entry.Year, Rate: entry.Rates.EUR ?? entry.Rates.USDEUR ?? 0 });
    }
  }
  fxratePLN.sort((a, b) => a.Year - b.Year);
  fxrateEUR.sort((a, b) => a.Year - b.Year);

  const inflationRates = buildRates(inflation, periodStart, periodEnd);
  const fxratesPLN = buildRates(fxratePLN, periodStart, periodEnd);
  const fxratesEUR = buildRates(fxrateEUR, periodStart, periodEnd);

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

/**
 * CR051 — the base-year FX rate (native units per USD) the engine would use for `currency` in
 * `scenarioName`. The income/expense write path uses this to derive `base_value_usd` from the
 * native `base_value` at save time, so the stored USD figure matches what the engine computes at
 * build (both read the same assumptions). `deriveYear` is pinned to the first forecast year
 * (PeriodStart, index 0), never the line's base_date — a historical base_date can fall before the
 * FX series and would derive at a wrong rate (finding F2).
 *
 * Returns 1 for USD. Throws when a non-USD currency has no usable base-year rate — the same
 * misconfiguration the engine would hit at build (finding F1), surfaced early at save time.
 */
async function baseYearFxRate(scenarioName, currency) {
  if (!currency || currency === "USD") return 1;
  const { fxratesPLN, fxratesEUR } = await loadScenarioConfig(scenarioName);
  const series =
    currency === "PLN" ? fxratesPLN :
    currency === "EUR" ? fxratesEUR : null;
  const rate = Array.isArray(series) ? Number(series[0]) : NaN;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(
      `No valid base-year FX rate for ${currency} in scenario "${scenarioName}"; ` +
      `set the "FX - ${currency}" assumption before using this currency.`
    );
  }
  return rate;
}

module.exports = {
  loadScenarioConfig,
  baseYearFxRate,
};
