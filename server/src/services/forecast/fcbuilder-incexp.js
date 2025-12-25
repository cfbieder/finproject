const dfd = require("danfojs-node");
const { categories, years } = require("./fcbuilder-setup");

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
  console.log("df_assumptions:\n", df_assumptions.toString());
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
  incexpValues[0] =
    module.BaseValue * (1 + (changePValues[0] ?? 0) / 100) +
    (changeDValues[0] ?? 0);
  for (let i = 1, year = startyear + 1; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    incexpValues[i] =
      idx >= 0 && idx < inflationLen
        ? incexpValues[i - 1] * (1 + changePValues[i] / 100) + changeDValues[i]
        : 0;
  }
  console.log("Change Pct Values:", changePValues);
  console.log("Change D Values:", changeDValues);
  console.log("Incexp Values:", incexpValues);
}

module.exports = { processModule };
