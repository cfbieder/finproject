const express = require("express");
const fs = require("node:fs/promises");
const DataGateway = require("../../../components/helpers/DataGateway");
const PsCsvIngestor = require("../services/retrieval/psCsvIngestor");
const DataAnalyzerUtils = require("../services/retrieval/dataAnalyzerUtils");
const PSdata = require("../../../components/models/PSdata");
const {
  dataPaths,
  ensureComponentsDataDir,
  tempFiles,
} = require("../utils/dataPaths");
const {
  processTransactions,
  logTransactionFileCounts,
} = require("../services/retrieval/refreshPSAPI");

const router = express.Router();
const gateway = new DataGateway();
const psCsvIngestor = new PsCsvIngestor({ gateway });
const csvFilePath = dataPaths.psTransactions;
const csvBodyParser = express.text({
  type: ["text/csv", "text/plain", "application/octet-stream"],
  limit: "10mb",
});

ensureComponentsDataDir();

const DEFAULT_ACCOUNT_NAMES_PATH = dataPaths.accountNames;
const DEFAULT_COA_PATH = dataPaths.coa;
const DEFAULT_CATEGORY_NAMES_PATH = dataPaths.categoryNames;

const normalizeStringList = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  const unique = new Set();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed) {
      unique.add(trimmed);
    }
  }

  return Array.from(unique).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
};

const collectProfitAndLossCategories = (coaData) => {
  if (!Array.isArray(coaData)) {
    return [];
  }

  const duplicates = new Set();
  const categories = [];

  const addCategory = (value) => {
    if (typeof value !== "string") {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed || duplicates.has(trimmed)) {
      return;
    }

    duplicates.add(trimmed);
    categories.push(trimmed);
  };

  const traverseNode = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) {
        traverseNode(child);
      }
      return;
    }

    if (node && typeof node === "object") {
      for (const value of Object.values(node)) {
        traverseNode(value);
      }
      return;
    }

    if (typeof node === "string") {
      addCategory(node);
    }
  };

  for (const entry of coaData) {
    if (entry && typeof entry === "object" && entry["Profit & Loss Accounts"]) {
      traverseNode(entry["Profit & Loss Accounts"]);
      break;
    }
  }

  return categories;
};

const readCoaCategories = async () => {
  try {
    const raw = await fs.readFile(dataPaths.coa, "utf8");
    const parsed = JSON.parse(raw);
    return collectProfitAndLossCategories(parsed);
  } catch (error) {
    console.error("[PSDATA-OPTIONS] Unable to read COA file:", error);
    return [];
  }
};

const normalizeCategoryList = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const cleaned = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    cleaned.push(trimmed);
  }

  return cleaned;
};

const orderCategoriesByCoa = (psCategories, coaCategories) => {
  const cleaned = normalizeCategoryList(psCategories);
  if (!cleaned.length) {
    return coaCategories;
  }

  const remaining = new Set(cleaned);
  const ordered = [];

  for (const category of coaCategories) {
    if (remaining.has(category)) {
      ordered.push(category);
      remaining.delete(category);
    }
  }

  for (const category of cleaned) {
    if (remaining.has(category)) {
      ordered.push(category);
      remaining.delete(category);
    }
  }

  return ordered;
};

// Ingest PS transactions from CSV into MongoDB
router.post("/", async (req, res) => {
  try {
    const ingestResult = await psCsvIngestor.ingestPsTransactionsFromCsv();
    await PSdata.db
      .collection("appdata")
      .updateOne({}, { $set: { lastIngest: new Date() } }, { upsert: true });
    const insertedCount =
      Number.isFinite(ingestResult?.insertedCount) &&
      ingestResult?.insertedCount >= 0
        ? ingestResult.insertedCount
        : Number.isFinite(ingestResult)
        ? ingestResult
        : 0;
    const skippedCount =
      Number.isFinite(ingestResult?.skippedCount) &&
      ingestResult?.skippedCount >= 0
        ? ingestResult.skippedCount
        : 0;
    const updatedCount =
      Number.isFinite(ingestResult?.updatedCount) &&
      ingestResult?.updatedCount >= 0
        ? ingestResult.updatedCount
        : 0;
    return res.json({
      insertedCount,
      skippedCount,
      updatedCount,
    });
  } catch (error) {
    console.error("[INGEST-PS] Failed to ingest PS transactions:", error);
    return res.status(500).json({
      error: "Failed to ingest PS transactions into MongoDB",
    });
  }
});

// Clear all PS records from MongoDB
router.post("/clearall", async (req, res) => {
  try {
    await psCsvIngestor.clearAllRecords();
    return res.json({ cleared: true });
  } catch (error) {
    console.error("[INGEST-PS] Failed to clear PS records:", error);
    return res.status(500).json({
      error: "Failed to clear PS records in MongoDB",
    });
  }
});

// Upload PS CSV file to server
router.post("/upload-ps", csvBodyParser, async (req, res) => {
  const payload = req.body;
  if (!payload) {
    return res.status(400).json({ error: "CSV payload is required" });
  }

  try {
    await fs.writeFile(csvFilePath, payload, "utf8");
    return res.json({
      message: "Payroll file saved to components/data/ps-transactions.csv",
      size: Buffer.byteLength(payload, "utf8"),
    });
  } catch (error) {
    console.error("[UPLOAD-PS] Failed to write CSV:", error);
    res.status(500).json({ error: "Unable to save payroll file" });
  }
});

const analyzePsHandler = async (req, res) => {
  try {
    console.log(
      "[ANALYZE-PS] Using account/coa paths:",
      DEFAULT_ACCOUNT_NAMES_PATH,
      DEFAULT_COA_PATH
    );

    // Write account names file and report missing/unknown accounts

    await DataAnalyzerUtils.writeAccountNamesFile(
      PSdata,
      DEFAULT_ACCOUNT_NAMES_PATH
    );

    const accountNamesData = DataAnalyzerUtils.readJson(
      DEFAULT_ACCOUNT_NAMES_PATH
    );
    const accountNames = Object.keys(accountNamesData).filter(
      (name) => typeof name === "string" && name.length > 0
    );
    const coaData = DataAnalyzerUtils.readJson(DEFAULT_COA_PATH);
    const coaAccounts = DataAnalyzerUtils.collectCoaStrings(coaData);
    const misAcct = DataAnalyzerUtils.reportMissingAccounts(
      DEFAULT_ACCOUNT_NAMES_PATH,
      DEFAULT_COA_PATH
    );
    console.log("[DA] Missing Accounts: ", misAcct);
    const missCOAact = DataAnalyzerUtils.reportUnknownCoaAccounts(
      DEFAULT_ACCOUNT_NAMES_PATH,
      DEFAULT_COA_PATH
    );
    console.log("[DA] Unknown COA Accounts: ", missCOAact);
    await DataAnalyzerUtils.writeCategoryNamesFile(
      PSdata,
      DEFAULT_CATEGORY_NAMES_PATH
    );
    const misCat = DataAnalyzerUtils.reportMissingCategories(
      DEFAULT_CATEGORY_NAMES_PATH,
      DEFAULT_COA_PATH
    );
    console.log("[DA] Missing Categories: ", misCat);
    const missCOACat = DataAnalyzerUtils.reportUnknownCoaCategories(
      DEFAULT_CATEGORY_NAMES_PATH,
      DEFAULT_COA_PATH
    );
    console.log("[DA] Unknown COA Categories: ", missCOACat);
    return res.json({
      misAcct,
      missCOAact,
      misCat,
      missCOACat,
    });
  } catch (error) {
    console.error("[ANALYZE-PS] Failed to analyze PS data:", error);
    return res
      .status(500)
      .json({ error: "Failed to analyze PS data. See server logs." });
  }
};

router.post("/analyze-ps", analyzePsHandler);
router.get("/analyze-ps", analyzePsHandler);

router.get("/psdata/count", async (req, res) => {
  try {
    const count = await PSdata.db.collection("psdata").countDocuments({});
    return res.json({ count });
  } catch (error) {
    console.error("[PSDATA-COUNT] Failed to fetch psdata count:", error);
    return res.status(500).json({
      error: "Failed to count PS data records in MongoDB",
    });
  }
});

router.get("/psdata/options", async (req, res) => {
  try {
    const [accounts, categories] = await Promise.all([
      PSdata.distinct("Account"),
      PSdata.distinct("Category"),
    ]);
    const coaCategories = await readCoaCategories();

    return res.json({
      accounts: normalizeStringList(accounts),
      categories: orderCategoriesByCoa(categories, coaCategories),
    });
  } catch (error) {
    console.error("[PSDATA-OPTIONS] Failed to fetch PS data options:", error);
    return res.status(500).json({
      error: "Failed to fetch PS data account and category options",
    });
  }
});

router.post("/appdata/last-refresh", async (req, res) => {
  try {
    const now = new Date();
    const result =
      (await PSdata.db
        .collection("appdata")
        .updateMany({}, { $set: { lastRefresh: now } }, { upsert: true })) ??
      {};
    const {
      matchedCount = 0,
      modifiedCount = 0,
      upsertedCount = 0,
      upsertedId = null,
    } = result;

    return res.json({
      matchedCount,
      modifiedCount,
      upsertedCount,
      upsertedId,
      lastRefresh: now,
    });
  } catch (error) {
    console.error("[SET-LAST-REFRESH] Failed to update appdata:", error);
    return res.status(500).json({
      error: "Failed to update appdata refresh timestamp",
    });
  }
});

router.get("/new-transactions", async (req, res) => {
  try {
    const raw = await fs.readFile(tempFiles.mongoImportReport, "utf8");
    const parsed = raw.trim() ? JSON.parse(raw) : [];
    const transactions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.transactions)
      ? parsed.transactions
      : parsed
      ? [parsed]
      : [];

    return res.json(transactions);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.json([]);
    }

    console.error("[NEW-TRANSACTIONS] Failed to read import report:", error);
    return res
      .status(500)
      .json({ error: "Unable to load new transactions report" });
  }
});

router.get("/modified-transactions", async (req, res) => {
  try {
    const raw = await fs.readFile(tempFiles.mongoUpdateReport, "utf8");
    const parsed = raw.trim() ? JSON.parse(raw) : [];
    const transactions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.transactions)
      ? parsed.transactions
      : parsed
      ? [parsed]
      : [];

    return res.json(transactions);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.json([]);
    }

    console.error(
      "[MODIFIED-TRANSACTIONS] Failed to read update report:",
      error
    );
    return res
      .status(500)
      .json({ error: "Unable to load modified transactions report" });
  }
});

router.post("/refresh-ps", async (req, res) => {
  try {
    const { daysHistory } = req.body ?? {};
    await processTransactions(daysHistory);
    return res.json(logTransactionFileCounts());
  } catch (error) {
    console.error("[REFRESH-PS] Failed to refresh PS data:", error);
    return res.status(500).json({ error: "Unable to refresh PS data" });
  }
});

module.exports = router;
