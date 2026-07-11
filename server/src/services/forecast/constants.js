const path = require("path");
const { COMPONENTS_DATA_DIR } = require("../../utils/dataPaths");

const CATEGORIES = {
  BANK_ACCOUNTS: "Bank Accounts",
  TRANSFER_BANK: "Transfer - Bank",
  TAXES_US: "Taxes",
  TAXES: "Taxes",
  INFLATION: "Inflation",
  FX_PLN: "FX - PLN",
  FX_EUR: "FX - EUR",
};

const PATHS = {
  // ASSUMP_FILE removed (CR043 N12): forecast assumptions moved to the
  // forecast_assumptions table in CR039; FCAssump.json is no longer read.
  AUDIT_TRAIL_DIR: path.join(COMPONENTS_DATA_DIR, "auditTrail"),
};

module.exports = {
  CATEGORIES,
  PATHS,
};
