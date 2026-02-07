/**
 * Forecast Service Constants
 *
 * Centralized constants for forecast generation including:
 * - Category names used throughout forecast calculations
 * - File paths for data storage
 * - Default configuration values
 */

const path = require("path");
const { COMPONENTS_DATA_DIR } = require("../../utils/dataPaths");

/**
 * Standard category names used in forecast calculations
 */
const CATEGORIES = {
  BANK_ACCOUNTS: "Bank Accounts",
  TRANSFER_BANK: "Transfer - Bank",
  TAXES_US: "Taxes US",
  TAXES: "Taxes",
  INFLATION: "Inflation",
  FX_PLN: "FX - PLN",
  FX_EUR: "FX - EUR",
};

/**
 * File paths for data storage
 */
const PATHS = {
  ASSUMP_FILE: path.join(COMPONENTS_DATA_DIR, "FCAssump.json"),
  AUDIT_TRAIL_DIR: path.join(COMPONENTS_DATA_DIR, "auditTrail"),
};

/**
 * Default configuration values
 */
const DEFAULTS = {
  MONGO_URI: "mongodb://localhost:27018/fin",
  TIMEOUT_MS: 60000,
  TAX_RATE: 0,
};

module.exports = {
  CATEGORIES,
  PATHS,
  DEFAULTS,
};
