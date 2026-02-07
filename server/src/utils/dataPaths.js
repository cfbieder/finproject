const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const COMPONENTS_DATA_DIR = path.join(PROJECT_ROOT, "components/data");
const TEMP_DIR = path.join(COMPONENTS_DATA_DIR, ".temp");

const ensureComponentsDataDir = () => {
  fs.mkdirSync(COMPONENTS_DATA_DIR, { recursive: true });
  return COMPONENTS_DATA_DIR;
};

const ensureTempDir = () => {
  ensureComponentsDataDir();
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  return TEMP_DIR;
};

const resolveDataPath = (envValue, defaultFilename) => {
  const name =
    typeof envValue === "string" && envValue.trim().length > 0
      ? path.basename(envValue.trim())
      : defaultFilename;
  return path.join(COMPONENTS_DATA_DIR, name);
};

const dataPaths = {
  accountNames: resolveDataPath(
    process.env.ACCOUNT_NAMES_PATH,
    "account_names.json"
  ),
  categoryNames: resolveDataPath(
    process.env.CATEGORY_NAMES_PATH,
    "category_names.json"
  ),
  coa: resolveDataPath(process.env.COA_PATH, "coa.json"),
  psTransactions: resolveDataPath(
    process.env.PS_TRANSACTIONS_PATH,
    "ps-transactions.csv"
  ),
  psData: resolveDataPath(process.env.PS_DATA_PATH, "psdata.json"),
  appData: resolveDataPath(process.env.APP_DATA_PATH, "appdata.json"),
  fcAssump: resolveDataPath(process.env.FC_ASSUMP_PATH, "FCAssump.json"),
};

const tempFiles = {
  allTransactions: path.join(TEMP_DIR, "all_transactions.json"),
  updatedTransactions: path.join(TEMP_DIR, "updated_transactions.json"),
  newTransactions: path.join(TEMP_DIR, "new_transactions.json"),
  existingTransactions: path.join(TEMP_DIR, "existing_transactions.json"),
  mongoImportReport: path.join(TEMP_DIR, "mongo_import_report.json"),
  mongoUpdateReport: path.join(TEMP_DIR, "mongo_update_report.json"),
};

const resolveTempFile = (filename) => path.join(TEMP_DIR, filename);

module.exports = {
  PROJECT_ROOT,
  COMPONENTS_DATA_DIR,
  TEMP_DIR,
  resolveDataPath,
  dataPaths,
  tempFiles,
  ensureComponentsDataDir,
  ensureTempDir,
  resolveTempFile,
};
