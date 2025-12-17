let FCAssump;
try {
  FCAssump = require("../../../../components/data/FCAssump.json");
} catch (error) {
  throw new Error(`Failed to load FCAssump.json: ${error.message}`);
}

if (
  !FCAssump ||
  !Array.isArray(FCAssump.scenarios) ||
  !FCAssump.scenarios.length ||
  !FCAssump.category
) {
  throw new Error("FCAssump is missing required scenario or category data");
}

const cache = new Map();

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

function selectScenario(name) {
  if (typeof name !== "string" || !name.trim()) {
    return FCAssump.scenarios[0];
  }

  const scenario = FCAssump.scenarios.find(
    (entry) => entry && entry.Name === name
  );

  if (!scenario) {
    throw new Error(`Scenario "${name}" not found in FCAssump.scenarios`);
  }

  return scenario;
}

function fcSetup(scenarioName) {
  const cacheKey = scenarioName || "__default__";
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const scenario = selectScenario(scenarioName);
  const { PeriodStart: periodStart, PeriodEnd: periodEnd } = scenario;

  if (!periodStart || !periodEnd) {
    throw new Error(
      `Scenario missing required fields: PeriodStart=${periodStart}, PeriodEnd=${periodEnd}`
    );
  }

  const inflation = [];
  const fxratePLN = [];
  const fxrateEUR = [];

  for (let i = 0; i < FCAssump.inflation.length; i++) {
    const entry = FCAssump.inflation[i];
    if (entry && entry.Scenario === scenario.Name) {
      inflation.push({ Year: entry.Year, Rate: entry.Rate });
    }
  }

  for (let i = 0; i < FCAssump.FX.length; i++) {
    const entry = FCAssump.FX[i];
    if (entry && entry.Scenario === scenario.Name) {
      fxratePLN.push({ Year: entry.Year, Rate: entry.Rates.USDPLN });
      fxrateEUR.push({ Year: entry.Year, Rate: entry.Rates.USDEUR });
    }
  }

  inflation.sort((a, b) => a.Year - b.Year);
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

  const result = {
    scenario,
    categories: FCAssump.category,
    inflationRates,
    fxratesPLN,
    fxratesEUR,
    years,
  };

  cache.set(cacheKey, result);
  return result;
}

module.exports = { fcSetup };
