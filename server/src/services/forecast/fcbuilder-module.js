const dfd = require("danfojs-node");
const fs = require("fs");
const path = require("path");
const { categories, years } = require("./fcbuilder-setup");

function processModule(module, scenario, df_assumptions) {
  console.log(`Processing module: ${module.Name}`);
  console.log("Scenario", scenario);
  const startyear = module.BaseDate.getFullYear();
  const endyear = scenario.PeriodEnd;
  const yearsCount = endyear - startyear + 1;
  const yearsArr = new Array(yearsCount);

  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    yearsArr[i] = year;
  }

  const baseValues = new Array(yearsCount).fill(module.BaseValue ?? 0);
  const marketValues = new Array(yearsCount).fill(module.MarketValue ?? 0);
  const fxrates = new Array(yearsCount).fill(1);
  const investValues = new Array(yearsCount).fill(0);
  const disposeValues = new Array(yearsCount).fill(0);

  const inflationSeries = df_assumptions.column(categories[1]).values;
  const periodStart = years[0];
  const inflationLen = inflationSeries.length;

  // Prepare FX rates if needed
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

  // Prepare growth, expense and income percentage arrays
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
      idx >= 0 && idx < inflationLen ? expPct * inflationSeries[idx] : 0;
  }

  // Process Invest and Dispose entries
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
  const unrealizedGainValues = new Array(yearsCount).fill(0);
  const realizedGainValues = new Array(yearsCount).fill(0);
  for (let i = 1; i < yearsCount; i++) {
    unrealizedGainValues[i] = marketValues[i - 1] * (growthValues[i] / 100);
    const prevMarket = marketValues[i - 1];
    const prevBase = baseValues[i - 1];
    const safeDisposeAdjustment =
      prevMarket === 0 ? 0 : (disposeValues[i] * prevBase) / prevMarket;
    baseValues[i] =
      prevBase + investValues[i] + safeDisposeAdjustment;
    marketValues[i] =
      prevMarket + unrealizedGainValues[i] + investValues[i] + disposeValues[i];
    realizedGainValues[i] =
      -disposeValues[i] +
      (prevMarket === 0 ? 0 : (disposeValues[i] * prevBase) / prevMarket);
  }

  if (Array.isArray(module.Dispose)) {
    for (let i = 0; i < module.Dispose.length; i++) {
      const entry = module.Dispose[i];
      if (entry.Flag != "Full") continue;
      const idx = new Date(entry.Date).getFullYear() - startyear;
      if (idx >= 0 && idx < yearsCount) {
        unrealizedGainValues[idx] =
          (marketValues[idx] - marketValues[idx - 1]) / 2;
        disposeValues[idx] = marketValues[idx - 1] + unrealizedGainValues[idx];
        realizedGainValues[idx] = disposeValues[idx] - baseValues[idx];
        for (let j = idx + 1; j < yearsCount; j++) {
          baseValues[j] = 0;
          marketValues[j] = 0;
          unrealizedGainValues[j] = 0;
          incomePctValues[j] = 0;
          growthValues[j] = 0;
        }
      }
    }
  }

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

  // Apply FX rates to base, market, invest, and dispose  values
  const baseValuesUSD = new Array(yearsCount).fill(module.BaseValue ?? 0);
  const marketValuesUSD = new Array(yearsCount).fill(module.MarketValue ?? 0);
  const investValuesUSD = new Array(yearsCount).fill(0);
  const disposeValuesUSD = new Array(yearsCount).fill(0);
  const unrealizedGainValuesUSD = new Array(yearsCount).fill(0);
  const realizedGainValuesUSD = new Array(yearsCount).fill(0);
  const incomeValuesUSD = new Array(yearsCount).fill(0);
  const expenseValuesUSD = new Array(yearsCount).fill(0);

  for (let i = 0; i < yearsCount; i++) {
    baseValuesUSD[i] = baseValues[i] / fxrates[i];
    marketValuesUSD[i] = marketValues[i] / fxrates[i];
    investValuesUSD[i] = investValues[i] / fxrates[i];
    disposeValuesUSD[i] = disposeValues[i] / fxrates[i];
    unrealizedGainValuesUSD[i] = unrealizedGainValues[i] / fxrates[i];
    realizedGainValuesUSD[i] = realizedGainValues[i] / fxrates[i];
    incomeValuesUSD[i] = incomeValues[i] / fxrates[i];
    expenseValuesUSD[i] = expenseValues[i] / fxrates[i];
  }
  baseValuesUSD[0] = module.BaseValueUSD ?? 0;
  marketValuesUSD[0] = module.MarketValueUSD ?? 0;
  fxrates[0] = baseValues[0] / baseValuesUSD[0];

  //update the dataframe
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
    },
    { index: yearsArr }
  );

  // Display the dataframe in console with adjusted column widths
  let dfRounded = df_module_LC.round(2);
  let totalColumns = dfRounded.columns.length;
  dfRounded.config.setTableMaxColInConsole(totalColumns);
  let visibleColumns = totalColumns + 1; // include index column
  let consoleWidth = process.stdout.columns || 80;
  let columnWidth = Math.max(
    6,
    Math.min(8, Math.floor((consoleWidth - 10) / visibleColumns))
  );
  let columnsConfig = {};
  for (let i = 0; i < visibleColumns; i++) {
    columnsConfig[i] = { width: columnWidth, truncate: columnWidth - 1 };
  }
  dfRounded.config.setTableDisplayConfig({ columns: columnsConfig });
  console.log(dfRounded.toString());

  // Display the dataframe in console with adjusted column widths
  dfRounded = df_module_USD.round(2);
  totalColumns = dfRounded.columns.length;
  dfRounded.config.setTableMaxColInConsole(totalColumns);
  visibleColumns = totalColumns + 1; // include index column
  consoleWidth = process.stdout.columns || 80;
  columnWidth = Math.max(
    6,
    Math.min(8, Math.floor((consoleWidth - 10) / visibleColumns))
  );
  columnsConfig = {};
  for (let i = 0; i < visibleColumns; i++) {
    columnsConfig[i] = { width: columnWidth, truncate: columnWidth - 1 };
  }
  dfRounded.config.setTableDisplayConfig({ columns: columnsConfig });
  console.log(dfRounded.toString());

  // Write audit trail
  const auditTrailDir = path.resolve(
    __dirname,
    "../../../../components/data/auditTrail"
  );

  if (!fs.existsSync(auditTrailDir)) {
    fs.mkdirSync(auditTrailDir, { recursive: true });
  }

  const scenarioName = (
    scenario && scenario.Name ? scenario.Name : "scenario"
  ).replace(/[^a-z0-9]/gi, "_");
  const moduleName = (module && module.Name ? module.Name : "module").replace(
    /[^a-z0-9]/gi,
    "_"
  );

  dfd.toCSV(df_module_LC, {
    filePath: path.join(auditTrailDir, `${scenarioName}_${moduleName}_LC.csv`),
  });

  dfd.toCSV(df_module_USD, {
    filePath: path.join(auditTrailDir, `${scenarioName}_${moduleName}_USD.csv`),
  });
}

module.exports = { processModule };
