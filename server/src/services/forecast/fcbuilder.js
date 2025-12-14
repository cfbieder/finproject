const dfd = require("danfojs-node");
const {
  scenario,
  categories,
  inflationRates,
  fxratesPLN,
  fxratesEUR,
  years,
} = require("./fcbuilder-setup");

const df = new dfd.DataFrame({
  [categories[0]]: years,
  [categories[1]]: inflationRates,
  [categories[2]]: fxratesPLN,
  [categories[3]]: fxratesEUR,
});

console.log(df.toString());
