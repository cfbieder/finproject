/**
 * PocketSmith API Refresh V2 (PostgreSQL)
 *
 * Fetches transactions from PocketSmith API and syncs to PostgreSQL.
 * Replaces MongoDB-based v1 implementation.
 */

const fs = require('node:fs');
const path = require('node:path');
const pocketsmith = require('../../services/retrieval/pocketsmith');
const {
  convertTransactionsToPSdata,
  mapTransactionToPsData,
} = require('../../services/retrieval/psdataConverter');
const psdata = require('../repositories/psdata');
const { tempFiles, ensureTempDir } = require('../../utils/dataPaths');

const PS_API_KEY = process.env.PS_API_KEY;
const PS_USER_ID = process.env.PS_USER_ID;

const PSAPI_PREFIX = '[v2/PSAPI]';

if (!PS_API_KEY) {
  console.warn(`${PSAPI_PREFIX} PS_API_KEY not set - API refresh will not work`);
} else {
  pocketsmith.auth(PS_API_KEY);
}

const OUTPUT_FILES = {
  all: tempFiles.allTransactions,
  updated: tempFiles.updatedTransactions,
  new: tempFiles.newTransactions,
  existing: tempFiles.existingTransactions,
  mongoImportReport: tempFiles.mongoImportReport,
  mongoUpdateReport: tempFiles.mongoUpdateReport,
};

/**
 * Parse Link header for pagination
 */
const parseLinkHeader = (linkHeader = '') => {
  const links = {};
  linkHeader
    .split(',')
    .map((part) => part.trim())
    .forEach((part) => {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (!match) return;
      const [, url, rel] = match;
      try {
        const parsed = new URL(url);
        const page = Number(parsed.searchParams.get('page'));
        if (Number.isFinite(page)) {
          links[rel] = page;
        }
      } catch {
        /* ignore malformed link */
      }
    });
  return links;
};

/**
 * Get total pages from response headers
 */
const getTotalPagesFromHeaders = (headers = {}) => {
  const totalPagesHeader =
    headers['x-total-pages'] ||
    headers['x-pages'] ||
    headers['x-total-page'] ||
    headers['x-page-count'];
  const totalPages = Number(totalPagesHeader);
  if (Number.isFinite(totalPages) && totalPages > 1) {
    return totalPages;
  }

  const { last } = parseLinkHeader(headers.link);
  return last && Number.isFinite(last) && last > 1 ? last : null;
};

/**
 * Save user transactions to file (Step 1)
 */
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

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(transactions, null, 2));
  console.log(
    `${PSAPI_PREFIX} Saved ${transactions.length || 0} transactions to ${outputFile}`
  );
  return transactions;
}

/**
 * Split transactions by database presence (Step 2)
 */
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
    const raw = fs.readFileSync(outputFile, 'utf8');
    const parsed = JSON.parse(raw);
    const transactions = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.transactions)
      ? parsed.transactions
      : parsed
      ? [parsed]
      : [];

    if (!transactions.length) {
      console.log(`${PSAPI_PREFIX} No transactions found to classify.`);
      return { existingCount: 0, newCount: 0 };
    }

    // Collect IDs
    const idSet = new Set();
    for (const txn of transactions) {
      const id = txn?.id;
      if (id !== undefined && id !== null) {
        idSet.add(String(id));
      }
    }

    if (!idSet.size) {
      console.log(`${PSAPI_PREFIX} Transactions missing IDs; writing all as new.`);
      ensureOutputDirs();
      fs.writeFileSync(newFile, JSON.stringify(transactions, null, 2));
      fs.writeFileSync(existingFile, JSON.stringify([], null, 2));
      return { existingCount: 0, newCount: transactions.length };
    }

    // Check which IDs exist in PostgreSQL
    const existingDocs = await psdata.findByPsIds([...idSet]);
    const existingIds = new Set(existingDocs.map((doc) => String(doc.ps_id)));

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
      `${PSAPI_PREFIX} Classified ${transactions.length} transactions: ${existing.length} existing, ${fresh.length} new.`
    );
    return { existingCount: existing.length, newCount: fresh.length };
  } catch (err) {
    console.error(
      `${PSAPI_PREFIX} Failed to classify transactions from ${outputFile}:`,
      err.message
    );
    return null;
  }
}

/**
 * Report updated transactions (Step 3)
 */
function reportUpdatedTransactions(filePathNew, filePathUpdated) {
  try {
    const raw = fs.readFileSync(filePathNew, 'utf8');
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
      if (typeof value === 'string' || typeof value === 'number') {
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
        `${PSAPI_PREFIX} Removed %d transactions missing created_at/updated_at dates from %s`,
        transactions.length - withDates.length,
        filePathNew
      );
    }

    console.log(
      `${PSAPI_PREFIX} Found %d transactions with different created_at and updated_at dates`,
      mismatched.length
    );
    fs.writeFileSync(filePathUpdated, JSON.stringify(mismatched, null, 2));
    console.log(`${PSAPI_PREFIX} Wrote report to ${filePathUpdated}`);
    return mismatched;
  } catch (err) {
    console.error(
      `${PSAPI_PREFIX} Failed to report transactions from ${filePathNew}:`,
      err.message
    );
    return null;
  }
}

/**
 * Import transactions to PostgreSQL (Step 4)
 */
async function importTransactionsToPostgres(filePath, importReportPath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      console.log(
        `${PSAPI_PREFIX} No entries found in ${filePath}; nothing to import.`
      );
      if (importReportPath) {
        fs.mkdirSync(path.dirname(importReportPath), { recursive: true });
        fs.writeFileSync(importReportPath, '[]');
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
        `${PSAPI_PREFIX} Parsed 0 transactions from ${filePath}; nothing to import.`
      );
      if (importReportPath) {
        fs.mkdirSync(path.dirname(importReportPath), { recursive: true });
        fs.writeFileSync(importReportPath, '[]');
      }
      return { inserted: 0, duplicates: 0, total: 0 };
    }

    // Convert to PSdata format
    const psDataRecords = await convertTransactionsToPSdata(transactions);
    if (!psDataRecords.length) {
      console.log(
        `${PSAPI_PREFIX} No PSdata records produced from ${filePath}; nothing to import.`
      );
      if (importReportPath) {
        fs.mkdirSync(path.dirname(importReportPath), { recursive: true });
        fs.writeFileSync(importReportPath, '[]');
      }
      return { inserted: 0, duplicates: 0, total: transactions.length };
    }

    // Check for existing IDs
    const ids = new Set();
    for (const record of psDataRecords) {
      const id = record?.ID;
      if (id !== undefined && id !== null) {
        ids.add(String(id));
      }
    }

    let existingIds = new Set();
    if (ids.size) {
      const existingDocs = await psdata.findByPsIds([...ids]);
      existingIds = new Set(existingDocs.map((doc) => String(doc.ps_id)));
    }

    // Filter out duplicates
    const newRecords = [];
    let duplicates = 0;
    if (ids.size) {
      for (const record of psDataRecords) {
        const id = record?.ID;
        if (id !== undefined && id !== null && existingIds.has(String(id))) {
          duplicates += 1;
          continue;
        }
        newRecords.push(record);
      }
    } else {
      newRecords.push(...psDataRecords);
    }

    // Insert new records
    const insertedRecords = [];
    for (const record of newRecords) {
      try {
        const inserted = await psdata.insert(record);
        insertedRecords.push(inserted);
      } catch (err) {
        if (err.code !== '23505') {
          console.error(`${PSAPI_PREFIX} Failed to insert record:`, err.message);
        }
      }
    }

    if (importReportPath) {
      fs.mkdirSync(path.dirname(importReportPath), { recursive: true });
      fs.writeFileSync(
        importReportPath,
        JSON.stringify(insertedRecords, null, 2)
      );
    }

    console.log(
      `${PSAPI_PREFIX} Imported ${insertedRecords.length} new PSdata records from ${filePath}` +
        (ids.size ? ` (${duplicates} duplicates skipped)` : '')
    );
    return { inserted: insertedRecords.length, duplicates, total: psDataRecords.length };
  } catch (err) {
    console.error(
      `${PSAPI_PREFIX} Failed to import transactions from ${filePath}:`,
      err.message
    );
    return null;
  }
}

/**
 * Update transactions in PostgreSQL (Step 5)
 */
async function updateTransactionsInPostgres(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      console.log(
        `${PSAPI_PREFIX} No entries found in ${filePath}; nothing to update.`
      );
      const reportPath = OUTPUT_FILES.mongoUpdateReport;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, '[]');
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
        `${PSAPI_PREFIX} Parsed 0 transactions from ${filePath}; nothing to update.`
      );
      const reportPath = OUTPUT_FILES.mongoUpdateReport;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, '[]');
      return { matched: 0, modified: 0, upserted: 0, skipped: 0, total: 0 };
    }

    // Convert to PSdata format
    const psDataRecords = await convertTransactionsToPSdata(transactions);
    if (!psDataRecords.length) {
      console.log(
        `${PSAPI_PREFIX} No PSdata records produced from ${filePath}; nothing to update.`
      );
      const reportPath = OUTPUT_FILES.mongoUpdateReport;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, '[]');
      return {
        matched: 0,
        modified: 0,
        upserted: 0,
        skipped: 0,
        total: transactions.length,
      };
    }

    // Upsert records
    let skipped = 0;
    let upserted = 0;
    const modifiedRecords = [];

    for (const record of psDataRecords) {
      const id = record?.ID;
      if (id === undefined || id === null) {
        skipped += 1;
        continue;
      }

      try {
        const result = await psdata.upsert(record);
        if (result) {
          modifiedRecords.push(result);
          if (result.inserted) {
            upserted++;
          }
        }
      } catch (err) {
        console.error(`${PSAPI_PREFIX} Failed to upsert record:`, err.message);
        skipped++;
      }
    }

    const reportPath = OUTPUT_FILES.mongoUpdateReport;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(modifiedRecords, null, 2));

    console.log(
      `${PSAPI_PREFIX} Updated ${modifiedRecords.length} records from ${filePath} (${upserted} upserted, ${skipped} skipped).`
    );
    return {
      modified: modifiedRecords,
    };
  } catch (err) {
    console.error(
      `${PSAPI_PREFIX} Failed to update transactions from ${filePath}:`,
      err.message
    );
    const reportPath = OUTPUT_FILES.mongoUpdateReport;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, '[]');
    return null;
  }
}

/**
 * Main processing function (V2 for PostgreSQL)
 */
async function processTransactionsV2(daysHistoryInput) {
  if (!PS_API_KEY) {
    throw new Error('PS_API_KEY environment variable is required');
  }

  const parsedDaysHistory = Number(daysHistoryInput);
  const daysHistory =
    Number.isFinite(parsedDaysHistory) && parsedDaysHistory > 0
      ? parsedDaysHistory
      : 7;
  const date = new Date(Date.now() - daysHistory * 24 * 60 * 60 * 1000);
  const userId = PS_USER_ID || '330430';

  // Step 1: Fetch all transactions updated since the specified date
  console.log(
    `${PSAPI_PREFIX} Fetching transactions updated since ${date.toISOString()} for user ID ${userId}...`
  );
  await saveUserTransactions(date, OUTPUT_FILES.all, userId);

  // Step 2: Classify transactions by database presence
  console.log(
    `${PSAPI_PREFIX} Classifying transactions from ${OUTPUT_FILES.all} by database presence...`
  );
  await splitTransactionsByDbPresence(
    OUTPUT_FILES.all,
    OUTPUT_FILES.new,
    OUTPUT_FILES.existing
  );

  // Step 3: Report updated transactions
  console.log(`${PSAPI_PREFIX} Reporting changes in ${OUTPUT_FILES.existing}...`);
  reportUpdatedTransactions(OUTPUT_FILES.existing, OUTPUT_FILES.updated);

  // Step 4: Import new transactions into PostgreSQL
  console.log(
    `${PSAPI_PREFIX} Importing new transactions from ${OUTPUT_FILES.new} into PostgreSQL...`
  );
  await importTransactionsToPostgres(
    OUTPUT_FILES.new,
    OUTPUT_FILES.mongoImportReport
  );

  // Step 5: Update changed transactions in PostgreSQL
  console.log(
    `${PSAPI_PREFIX} Processing changed transactions from ${OUTPUT_FILES.updated} into PostgreSQL...`
  );
  const modificationResult = await updateTransactionsInPostgres(OUTPUT_FILES.updated);
  const modificationResultPath = OUTPUT_FILES.mongoUpdateReport;
  fs.mkdirSync(path.dirname(modificationResultPath), { recursive: true });
  fs.writeFileSync(
    modificationResultPath,
    JSON.stringify(modificationResult?.modified ?? [], null, 2)
  );
}

/**
 * Log transaction file counts
 */
function logTransactionFileCounts() {
  const counts = {};
  for (const [key, filePath] of Object.entries(OUTPUT_FILES)) {
    counts[key] = countEntries(filePath);
  }
  return counts;
}

/**
 * Count entries in a JSON file
 */
function countEntries(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
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
    if (err.code === 'ENOENT') {
      return 0;
    }
    console.error(
      `${PSAPI_PREFIX} Failed to count entries in ${filePath}:`,
      err.message
    );
    return 0;
  }
}

module.exports = {
  processTransactionsV2,
  saveUserTransactions,
  splitTransactionsByDbPresence,
  reportUpdatedTransactions,
  importTransactionsToPostgres,
  updateTransactionsInPostgres,
  logTransactionFileCounts,
  countEntries,
  OUTPUT_FILES,
};
