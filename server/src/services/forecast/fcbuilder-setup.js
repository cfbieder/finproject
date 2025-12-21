let FCAssump;
try {
  FCAssump = require("../../../../components/data/FCAssump.json");
} catch (error) {
  throw new Error(`Failed to load FCAssump.json: ${error.message}`);
}

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

const scenarioName = process.argv[2];
const scenario =
  (scenarioName
    ? FCAssump.scenarios.find((entry) => entry.Name === scenarioName)
    : null) || FCAssump.scenarios[0];

if (!scenario) {
  throw new Error("No scenarios available in FCAssump.scenarios");
}

if (scenarioName && scenario.Name !== scenarioName) {
  throw new Error(`Scenario "${scenarioName}" not found in FCAssump.scenarios`);
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
    fxratePLN.push({ Year: entry.Year, Rate: entry.Rates.USDPLN });
    fxrateEUR.push({ Year: entry.Year, Rate: entry.Rates.USDEUR });
  }
}
fxratePLN.sort((a, b) => a.Year - b.Year);
fxrateEUR.sort((a, b) => a.Year - b.Year);

function buildRates(entries) {
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

const inflationRates = buildRates(inflation);
const fxratesPLN = buildRates(fxratePLN);
const fxratesEUR = buildRates(fxrateEUR);

const years = (() => {
  const yearsCount = periodEnd - periodStart + 1;
  const yearsArr = new Array(yearsCount);
  for (let i = 0, year = periodStart; year <= periodEnd; i++, year++) {
    yearsArr[i] = year;
  }
  return yearsArr;
})();

module.exports = {
  scenario,
  categories,
  inflationRates,
  fxratesPLN,
  fxratesEUR,
  taxRate: scenario.TaxRate,
  years,
};
