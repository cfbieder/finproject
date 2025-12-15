const dfd = require("danfojs-node");
const {
  scenario,
  categories,
  inflationRates,
  fxratesPLN,
  fxratesEUR,
  years,
} = require("./fcbuilder-setup");
const mongoose = require("../../../../components/node_modules/mongoose");
const FCModule = require("../../../../components/models/FCModule");
const { processModule } = require("./fcbuilder-module");

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

async function loadModulesForScenario(name) {
  const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27018/fin";
  if (!name || !MONGO_URI) {
    return [];
  }

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 1000 });
  }

  return FCModule.find({ Scenario: name }).lean().exec();
}

loadModulesForScenario(scenario.Name)
  .then((modules) => {
    console.log(
      `Loaded ${modules.length} FCModule entries for scenario ${scenario.Name}`
    );
    console.log("Scenario details:", scenario);
    modules.forEach((module) =>
      processModule(module, scenario, df_assumptions)
    );
  })
  .catch((error) => {
    console.error("Failed to load FCModule entries:", error);
  });
