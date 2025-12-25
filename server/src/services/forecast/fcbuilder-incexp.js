const dfd = require("danfojs-node");

function processModule(module, scenario, df_assumptions, df_categories) {
  console.log(`Processing account: ${module.Account}`);
  console.log(`Processing module: ${module.Name}`);
  console.log("Scenario", scenario);

  // Define forecast period based on module start date and scenario end
  const startyear = module.BaseDate.getFullYear();
  const endyear = scenario.PeriodEnd;
  const yearsCount = endyear - startyear + 1;
  const yearsArr = new Array(yearsCount);

  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    yearsArr[i] = year;
  }
}

module.exports = { processModule };
