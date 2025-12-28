const fs = require("fs");
const path = require("path");
const pocketsmith = require("./pocketsmith");
const {
  convertTransactionsToPSdata,
  mapTransactionToPsData,
} = require("./psdataConverter");
const mongoose = require("../../../../components/node_modules/mongoose");
const PSdata = require("../../../../components/models/PSdata");
const { tempFiles, ensureTempDir } = require("../../utils/dataPaths");

const PS_API_KEY = process.env.PS_API_KEY;
const PS_USER_ID = process.env.PS_USER_ID;
const MONGO_URI = process.env.MONGO_URI;

/*********************************************
 * Console Prefixing for PSAPI Logs
 **********************************************/

const PSAPI_PREFIX = "[PSAPI]";
const addConsolePrefix = (method) => {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    if (!args.length) {
      return original(PSAPI_PREFIX);
    }

    const [first, ...rest] = args;
    if (typeof first === "string") {
      if (first.startsWith(PSAPI_PREFIX)) {
        return original(first, ...rest);
      }
      return original(`${PSAPI_PREFIX} ${first}`, ...rest);
    }

    return original(PSAPI_PREFIX, ...args);
  };
};

["log", "info", "warn", "error", "debug"].forEach(addConsolePrefix);

if (!PS_API_KEY) {
  throw new Error("PS_API_KEY environment variable is required");
}

pocketsmith.auth(PS_API_KEY);

/*********************************************
 * Temporary File Paths
 **********************************************/

const OUTPUT_FILES = {
  all: tempFiles.allTransactions,
  updated: tempFiles.updatedTransactions,
  new: tempFiles.newTransactions,
  existing: tempFiles.existingTransactions,
  mongoImportReport: tempFiles.mongoImportReport,
  mongoUpdateReport: tempFiles.mongoUpdateReport,
};

/*********************************************
 * Pagination Helpers
 **********************************************/
const parseLinkHeader = (linkHeader = "") => {
  const links = {};
  linkHeader
    .split(",")
    .map((part) => part.trim())
    .forEach((part) => {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (!match) return;
      const [, url, rel] = match;
      try {
        const parsed = new URL(url);
        const page = Number(parsed.searchParams.get("page"));
        if (Number.isFinite(page)) {
          links[rel] = page;
        }
      } catch (err) {
        /* ignore malformed link */
      }
    });
  return links;
};

/*********************************************
 * Get Total Pages from Response Headers
 **********************************************/

const getTotalPagesFromHeaders = (headers = {}) => {
  const totalPagesHeader =
    headers["x-total-pages"] ||
    headers["x-pages"] ||
    headers["x-total-page"] ||
    headers["x-page-count"];
  const totalPages = Number(totalPagesHeader);
  if (Number.isFinite(totalPages) && totalPages > 1) {
    return totalPages;
  }

  const { last } = parseLinkHeader(headers.link);
  return last && Number.isFinite(last) && last > 1 ? last : null;
};

/*********************************************
 * MongoDB Connection Helper
 **********************************************/
let mongoConnection;
async function ensureMongoConnected() {
  if (!MONGO_URI) {
    console.warn(
      "[PSAPI] Skipping MongoDB check because MONGO_URI is not set."
    );
    return false;
  }

  if (!mongoConnection) {
    mongoConnection = mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 1000,
    });
  }

  try {
    await mongoConnection;
    return true;
  } catch (err) {
    console.error("[PSAPI] Unable to connect to MongoDB:", err.message);
    return false;
  }
}
/*********************************************
 * Main Processing Function
 **********************************************/
async function processTransactions(daysHistoryInput) {
  const parsedDaysHistory = Number(daysHistoryInput);
  const daysHistory =
    Number.isFinite(parsedDaysHistory) && parsedDaysHistory > 0
      ? parsedDaysHistory
      : 7;
  const date = new Date(Date.now() - daysHistory * 24 * 60 * 60 * 1000);
  const userId = PS_USER_ID || "330430";

  /*
   * Step 1: Fetch all transactions updated since the specified date
   */

  console.log(
    `Fetching transactions updated since ${date.toISOString()} for user ID ${userId}...`
  );
  await saveUserTransactions(date, OUTPUT_FILES.all, userId);

  /*
   * Step 2: Classify transactions by database presence
   */
  console.log(
    `Classifying transactions from ${OUTPUT_FILES.all} by database presence...`
  );
  await splitTransactionsByDbPresence(
    OUTPUT_FILES.all,
    OUTPUT_FILES.new,
    OUTPUT_FILES.existing
  );

  /*
   * Step 3: Report updated transactions
   */
  console.log(`Reporting changes in ${OUTPUT_FILES.existing}...`);
  reportUpdatedTransactions(OUTPUT_FILES.existing, OUTPUT_FILES.updated);

  /*
   * Step 4: Import new transactions into the database
   */

  console.log(
    `Importing new transactions from ${OUTPUT_FILES.new} into MongoDB...`
  );
  await importTransactionsFileToMongo(
    OUTPUT_FILES.new,
    OUTPUT_FILES.mongoImportReport
  );

//todo: test
  /*
   * Step 5: Update changed transactions in the database
   */
  console.log(
    `Processing changed transactions from ${OUTPUT_FILES.updated} into MongoDB...`
  );
  const modificationResult = await updateTransactionsFileInMongo(
    OUTPUT_FILES.updated
  );
  const modificationResultPath = OUTPUT_FILES.mongoUpdateReport;
  fs.mkdirSync(path.dirname(modificationResultPath), { recursive: true });
  fs.writeFileSync(
    modificationResultPath,
    JSON.stringify(modificationResult?.modified ?? [], null, 2)
  );
}

/*******************************************************
 *  Save User Transactions to File
 * Step 1 of the processTransactions workflow
 * @param {Date} date - Date object representing the cutoff date
 * @param {string} outputFile - Path to the output JSON file
 * @param {string} userId - Pocketsmith user ID
 * @returns {Array} - Array of transactions saved to the file
 ********************************************************/

async function saveUserTransactions(date, outputFile, userId) {
  const updatedSince = date.toISOString();
  const { data, headers } = await pocketsmith.getUsersIdTransactions({
    updated_since: updatedSince,
    id: userId,
  });
  const transactions = [...data];
  await Promise.all(transactions.map(mapTransactionToPsData));

  const totalPages = getTotalPagesFromHeaders(headers) || 1;
  const initialLinkInfo = parseLinkHeader(headers?.link);
  if (totalPages > 1) {
    const pagePromises = [];
    for (let page = 2; page <= totalPages; page += 1) {
      pagePromises.push(
        pocketsmith.getUsersIdTransactions({
          updated_since: updatedSince,
          id: userId,
          page,
        })
      );
    }

    const pagedResponses = await Promise.all(pagePromises);
    for (const { data: pageData } of pagedResponses) {
      await Promise.all(pageData.map(mapTransactionToPsData));
      transactions.push(...pageData);
    }
  } else if (initialLinkInfo.next) {
    let nextPage = initialLinkInfo.next;
    while (nextPage) {
      const { data: pageData, headers: pageHeaders } =
        await pocketsmith.getUsersIdTransactions({
          updated_since: updatedSince,
          id: userId,
          page: nextPage,
        });
      await Promise.all(pageData.map(mapTransactionToPsData));
      transactions.push(...pageData);
      nextPage = parseLinkHeader(pageHeaders?.link).next;
    }
  }

  /*
  for (let i = 0; i < data.length; i += 1) {
    const txn = data[i];
    console.log(
      `Merchant: ${txn?.payee || txn?.merchant || "Unknown"} | Amount: ${
        txn?.amount
      }`
    );
  }
  */
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(transactions, null, 2));
  console.log(
    `Saved ${transactions.length || 0} transactions to ${outputFile}`
  );
  return transactions;
}

/*******************************************************
 *  Split Transactions by Database Presence
 * step 2 of the processTransactions workflow
 * @param {string} outputFile - Path to the JSON file with transactions to classify
 * @param {string} newTransactionsFile - Path to output new transactions
 * @param {string} existingTransactionsFile - Path to output existing transactions
 * @returns {Object|null} - Object with counts of existing and new transactions or null on error
 ********************************************************/
async function splitTransactionsByDbPresence(
  outputFile,
  newTransactionsFile,
  existingTransactionsFile
) {
  const newFile = newTransactionsFile || OUTPUT_FILES.new;
  const existingFile = existingTransactionsFile || OUTPUT_FILES.existing;
  const outputDirs = new Set([
    path.dirname(newFile),
    path.dirname(existingFile),
  ]);
  const ensureOutputDirs = () => {
    for (const dir of outputDirs) {
      fs.mkdirSync(dir, { recursive: true });
    }
  };

  try {
    const raw = fs.readFileSync(outputFile, "utf8");
    const parsed = JSON.parse(raw);
    const transactions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.transactions)
      ? parsed.transactions
      : parsed
      ? [parsed]
      : [];

    if (!transactions.length) {
      console.log("[PSAPI] No transactions found to classify.");
      return { existingCount: 0, newCount: 0 };
    }

    const connected = await ensureMongoConnected();
    if (!connected) {
      return null;
    }

    const idSet = new Set();
    for (const txn of transactions) {
      const id = txn?.id;
      if (id !== undefined && id !== null) {
        idSet.add(String(id));
      }
    }

    if (!idSet.size) {
      console.log("[PSAPI] Transactions missing IDs; writing all as new.");
      ensureOutputDirs();
      fs.writeFileSync(newFile, JSON.stringify(transactions, null, 2));
      fs.writeFileSync(existingFile, JSON.stringify([], null, 2));
      return { existingCount: 0, newCount: transactions.length };
    }

    const existingDocs = await PSdata.find({ ID: { $in: [...idSet] } })
      .select({ ID: 1 })
      .lean();
    const existingIds = new Set(existingDocs.map((doc) => String(doc.ID)));

    const existing = [];
    const fresh = [];
    for (const txn of transactions) {
      const id = txn?.id;
      if (id !== undefined && id !== null && existingIds.has(String(id))) {
        existing.push(txn);
      } else {
        fresh.push(txn);
      }
    }

    ensureOutputDirs();
    fs.writeFileSync(existingFile, JSON.stringify(existing, null, 2));
    fs.writeFileSync(newFile, JSON.stringify(fresh, null, 2));

    console.log(
      `[PSAPI] Classified ${transactions.length} transactions: ${existing.length} existing, ${fresh.length} new.`
    );
    return { existingCount: existing.length, newCount: fresh.length };
  } catch (err) {
    console.error(
      `[PSAPI] Failed to classify transactions from ${outputFile}:`,
      err.message
    );
    return null;
  }
}

/*******************************************************
 *  Report Transactions with Updated Timestamps
 *  step 3 of the processTransactions workflow
 * Identifies transactions where the created_at and updated_at timestamps differ
 * (i.e., updated_at differs from created_at by more than 1 minute)
 * @param {string} filePathNew - Path to the JSON file with transactions to check
 * @param {string} filePathUpdated - Path to output the report of updated transactions
 * @returns {Array|null} - Array of transactions with updated timestamps or null on error
 ********************************************************/

function reportUpdatedTransactions(filePathNew, filePathUpdated) {
  try {
    const raw = fs.readFileSync(filePathNew, "utf8");
    const parsed = JSON.parse(raw);
    const transactions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.transactions)
      ? parsed.transactions
      : parsed
      ? [parsed]
      : [];

    const toMillis = (value) => {
      if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? null : time;
      }
      if (typeof value === "string" || typeof value === "number") {
        const time = Date.parse(value);
        return Number.isNaN(time) ? null : time;
      }
      return null;
    };

    const mismatched = [];
    const withDates = [];
    for (const txn of transactions) {
      if (!txn) continue;
      const createdMs = toMillis(txn.created_at);
      const updatedMs = toMillis(txn.updated_at);

      if (createdMs === null || updatedMs === null) {
        continue;
      }

      withDates.push(txn);
      if (Math.abs(createdMs - updatedMs) > 60000) {
        mismatched.push(txn);
      }
    }

    if (withDates.length !== transactions.length) {
      fs.writeFileSync(filePathNew, JSON.stringify(withDates, null, 2));
      console.log(
        "Removed %d transactions missing created_at/updated_at dates from %s",
        transactions.length - withDates.length,
        filePathNew
      );
    }

    const report = mismatched;
    console.log(
      "found %d transactions with different created_at and updated_at dates",
      mismatched.length
    );
    fs.writeFileSync(filePathUpdated, JSON.stringify(report, null, 2));
    console.log(`Wrote report to ${filePathUpdated}`);
    return report;
  } catch (err) {
    console.error(
      `[PSAPI] Failed to report transactions with mismatched timestamps from ${filePathNew}:`,
      err.message
    );
    return null;
  }
}

///*******************************************************
// *  Import Transactions File to MongoDB
// * Step 4 of the processTransactions workflow
// * @param {string} filePath - Path to the JSON file with transactions to import
// * @returns {Object|null} - Object with counts of inserted, duplicates, and total or null on error
// ********************************************************/

async function importTransactionsFileToMongo(filePath, mongoImportReportPath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      console.log(
        `[PSAPI] No entries found in ${filePath}; nothing to import.`
      );
      if (mongoImportReportPath) {
        fs.mkdirSync(path.dirname(mongoImportReportPath), { recursive: true });
        fs.writeFileSync(mongoImportReportPath, "[]");
      }
      return { inserted: 0, duplicates: 0, total: 0 };
    }

    const parsed = JSON.parse(raw);
    const transactions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.transactions)
      ? parsed.transactions
      : parsed
      ? [parsed]
      : [];

    if (!transactions.length) {
      console.log(
        `[PSAPI] Parsed 0 transactions from ${filePath}; nothing to import.`
      );
      if (mongoImportReportPath) {
        fs.mkdirSync(path.dirname(mongoImportReportPath), { recursive: true });
        fs.writeFileSync(mongoImportReportPath, "[]");
      }
      return { inserted: 0, duplicates: 0, total: 0 };
    }

    const connected = await ensureMongoConnected();
    if (!connected) {
      return null;
    }

    const psData = await convertTransactionsToPSdata(transactions);
    if (!psData.length) {
      console.log(
        `[PSAPI] No PSdata records produced from ${filePath}; nothing to import.`
      );
      if (mongoImportReportPath) {
        fs.mkdirSync(path.dirname(mongoImportReportPath), { recursive: true });
        fs.writeFileSync(mongoImportReportPath, "[]");
      }
      return { inserted: 0, duplicates: 0, total: transactions.length };
    }

    const ids = new Set();
    for (const record of psData) {
      const id = record?.ID;
      if (id !== undefined && id !== null) {
        ids.add(String(id));
      }
    }

    let existingIds = new Set();
    if (ids.size) {
      const existingDocs = await PSdata.find({ ID: { $in: [...ids] } })
        .select({ ID: 1 })
        .lean();
      existingIds = new Set(existingDocs.map((doc) => String(doc.ID)));
    }

    const newRecords = [];
    let duplicates = 0;
    if (ids.size) {
      for (const record of psData) {
        const id = record?.ID;
        if (id !== undefined && id !== null && existingIds.has(String(id))) {
          duplicates += 1;
          continue;
        }
        newRecords.push(record);
      }
    } else {
      newRecords.push(...psData);
    }

    let inserted = 0;
    if (newRecords.length) {
      const insertedDocs = await PSdata.insertMany(newRecords, {
        ordered: false,
      });
      if (mongoImportReportPath) {
        fs.mkdirSync(path.dirname(mongoImportReportPath), { recursive: true });
        fs.writeFileSync(
          mongoImportReportPath,
          JSON.stringify(insertedDocs, null, 2)
        );
      }
    }

    console.log(
      `[PSAPI] Imported ${inserted} new PSdata records from ${filePath}` +
        (ids.size ? ` (${duplicates} duplicates skipped)` : "")
    );
    return { inserted, duplicates, total: psData.length };
  } catch (err) {
    console.error(
      `[PSAPI] Failed to import transactions from ${filePath}:`,
      err.message
    );
    return null;
  }
}

///*******************************************************
// *  Update Transactions File in MongoDB
// * Step 5 of the processTransactions workflow
// * @param {string} filePath - Path to the JSON file with transactions to update
// * @returns {Object|null} - Object with counts of matched, modified, upserted, skipped, and total or null on error
// ********************************************************/

async function updateTransactionsFileInMongo(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      console.log(
        `[PSAPI] No entries found in ${filePath}; nothing to update.`
      );
      const reportPath = OUTPUT_FILES.mongoUpdateReport;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, "[]");
      return { matched: 0, modified: 0, upserted: 0, skipped: 0, total: 0 };
    }

    const parsed = JSON.parse(raw);
    const transactions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.transactions)
      ? parsed.transactions
      : parsed
      ? [parsed]
      : [];

    if (!transactions.length) {
      console.log(
        `[PSAPI] Parsed 0 transactions from ${filePath}; nothing to update.`
      );
      const reportPath = OUTPUT_FILES.mongoUpdateReport;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, "[]");
      return { matched: 0, modified: 0, upserted: 0, skipped: 0, total: 0 };
    }

    const connected = await ensureMongoConnected();
    if (!connected) {
      return null;
    }

    const psData = await convertTransactionsToPSdata(transactions);
    if (!psData.length) {
      console.log(
        `[PSAPI] No PSdata records produced from ${filePath}; nothing to update.`
      );
      const reportPath = OUTPUT_FILES.mongoUpdateReport;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, "[]");
      return {
        matched: 0,
        modified: 0,
        upserted: 0,
        skipped: 0,
        total: transactions.length,
      };
    }

    const operations = [];
    const transactionIds = [];
    let skipped = 0;
    for (const record of psData) {
      const id = record?.ID;
      if (id === undefined || id === null) {
        skipped += 1;
        continue;
      }
      transactionIds.push(String(id));
      operations.push({
        updateOne: {
          filter: { ID: String(id) },
          update: { $set: record },
          upsert: true,
        },
      });
    }

    if (!operations.length) {
      console.log(
        `[PSAPI] No valid records with IDs found in ${filePath}; nothing to update.`
      );
      const reportPath = OUTPUT_FILES.mongoUpdateReport;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, "[]");
      return {
        matched: 0,
        modified: 0,
        upserted: 0,
        skipped,
        total: psData.length,
      };
    }

    const result = await PSdata.bulkWrite(operations, { ordered: false });
    const modified = psData.filter(
      (record) => record?.ID !== undefined && record?.ID !== null
    );

    const reportPath = OUTPUT_FILES.mongoUpdateReport;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(modified, null, 2));
    const upserted =
      result.upsertedCount ??
      result.result?.upserted?.length ??
      Object.keys(result.upsertedIds || {}).length;

    console.log(
      `[PSAPI] Updated ${operations.length} records from ${filePath} (${modified.length} modified, ${upserted} upserted, ${skipped} skipped).`
    );
    return {
      modified,
    };
  } catch (err) {
    console.error(
      `[PSAPI] Failed to update transactions from ${filePath}:`,
      err.message
    );
    const reportPath = OUTPUT_FILES.mongoUpdateReport;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, "[]");
    return null;
  }
}

///*******************************************************
// *  Log Transaction File Counts
// ********************************************************/

function logTransactionFileCounts() {
  const counts = {};
  for (const [key, filePath] of Object.entries(OUTPUT_FILES)) {
    counts[key] = countEntries(filePath);
  }
  return counts;
}
/*******************************************************
 *  Count Entries in a JSON File
 * @param {string} filePath - Path to the JSON file
 * @returns {number} - Number of entries found in the file
 ********************************************************/
function countEntries(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return 0;
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length;
    if (Array.isArray(parsed?.transactions)) return parsed.transactions.length;
    if (Array.isArray(parsed?.transactions_with_mismatched_dates)) {
      return parsed.transactions_with_mismatched_dates.length;
    }

    return parsed ? 1 : 0;
  } catch (err) {
    if (err.code === "ENOENT") {
      return 0;
    }
    console.error(
      `[PSAPI] Failed to count entries in ${filePath}:`,
      err.message
    );
    return 0;
  }
}

/*********************************************
 * Module Exports
 **********************************************/

module.exports = {
  processTransactions,
  saveUserTransactions,
  splitTransactionsByDbPresence,
  reportUpdatedTransactions,
  importTransactionsFileToMongo,
  updateTransactionsFileInMongo,
  logTransactionFileCounts,
  countEntries,
  OUTPUT_FILES,
};
