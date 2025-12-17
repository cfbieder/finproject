const { fcSetup } = require("./fc-setup");
const { getUnmatchedAccounts } = require("./fcbuilder-unmatched");
const mongoose = require("../../../../components/node_modules/mongoose");

async function main() {
  const scenarioName = process.argv[2];
  const { scenario } = fcSetup(scenarioName);

  const unmatched = await getUnmatchedAccounts(scenario.Name);
  console.log(unmatched);
}

main()
  .catch((error) => {
    console.error("Failed to load unmatched modules:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });
