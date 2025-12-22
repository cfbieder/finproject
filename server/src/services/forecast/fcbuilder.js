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
const { processModule } = require("./fcbuilder-module");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27018/fin";

// processs assumptions
const scenarioTaxRate = Number.isFinite(taxRate)
  ? taxRate
  : Number(scenario?.TaxRate ?? 0);
scenario.TaxRate = scenarioTaxRate;
console.log("FX", fxratesPLN);
const df_assumptions = new dfd.DataFrame(
  {
    [categories[1]]: inflationRates,
    [categories[2]]: fxratesPLN,
    [categories[3]]: fxratesEUR,
  },
  { index: years }
);

console.log(scenario);
console.log(df_assumptions.toString());

async function ensureConnection() {
  if (mongoose.connection.readyState === 0 && MONGO_URI) {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 1000 });
  }
}

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

async function loadModulesForScenario(name) {
  if (!name || !MONGO_URI) {
    return [];
  }

  await ensureConnection();

  return FCModule.find({ Scenario: name }).lean().exec();
}

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

clearEntriesForScenario(scenario.Name)
  .then(() =>
    Promise.all([
      loadModulesForScenario(scenario.Name),
      loadCategoriesForScenario(scenario.Name),
    ])
  )
  .then(([modules, { expenseCategories, incomeCategories, accountNames }]) => {
    console.log(
      `Loaded ${modules.length} FCModule entries for scenario ${scenario.Name}`
    );
    console.log("Scenario details:", scenario);
    const scenarioCategories = (() => {
      const seen = new Set();
      const ordered = [];
      const pushUnique = (item) => {
        if (item && !seen.has(item)) {
          seen.add(item);
          ordered.push(item);
        }
      };
      pushUnique("Bank Accounts");
      pushUnique("Transfer - Bank");
      accountNames.forEach(pushUnique);
      incomeCategories.forEach(pushUnique);
      expenseCategories.forEach(pushUnique);
      pushUnique("Tax Reserve");

      return ordered;
    })();
    const columns = (() => {
      const result = new Array(years.length + 1);
      result[0] = years[0] - 1;
      for (let i = 0; i < years.length; i++) {
        result[i + 1] = years[i];
      }
      return result;
    })();

    const zerosMatrix = new Array(scenarioCategories.length);

    for (let i = 0; i < scenarioCategories.length; i++) {
      zerosMatrix[i] = new Array(columns.length).fill(0);
    }
    const cat = scenarioCategories;
    const df_categories = new dfd.DataFrame(zerosMatrix, {
      columns: columns,
      index: scenarioCategories,
    });
    df_categories.config.setMaxRow(1000);

    return Promise.all(
      modules.map((module) =>
        processModule(module, scenario, df_assumptions, df_categories)
      )
    )
      .then(() => {
        console.log("All Done");
      })
      .catch((error) => {
        console.error("Failed to process modules:", error);
      });
  })
  .catch((error) => {
    console.error("Failed to load FCModule entries:", error);
  });
