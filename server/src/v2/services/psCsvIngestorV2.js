/**
 * PocketSmith CSV Ingestor V2 (PostgreSQL)
 *
 * Ingests PS transactions from CSV file into PostgreSQL.
 * Replaces MongoDB-based v1 implementation.
 */

const fs = require('node:fs');
const readline = require('node:readline');
const psdata = require('../repositories/psdata');
const { toNumber, toDate } = require('../../../components/helpers/utils');
const {
  dataPaths,
  resolveDataPath,
  ensureComponentsDataDir,
} = require('../../utils/dataPaths');

class PsCsvIngestorV2 {
  constructor({ csvPath } = {}) {
    ensureComponentsDataDir();
    this.csvPath = csvPath
      ? resolveDataPath(csvPath, 'ps-transactions.csv')
      : dataPaths.psTransactions;
  }

  /**
   * Simple CSV line parser handling quoted fields
   */
  parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (ch === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    values.push(current);
    return values;
  }

  /**
   * Build PSdata record from CSV row
   */
  buildPsRecord(row) {
    const record = {};

    const date = toDate(row.Date);
    if (date) record.Date = date;

    if (row.Merchant) record.Description1 = row.Merchant;
    if (row['Merchant Changed From']) record.Description2 = row['Merchant Changed From'];

    const amount = toNumber(row.Amount);
    if (amount !== undefined) record.Amount = amount;

    if (row.Currency) record.Currency = row.Currency;

    const baseAmount = toNumber(row['Amount in base currency']);
    if (baseAmount !== undefined) record.BaseAmount = baseAmount;

    if (row['Base currency']) record.BaseCurrency = row['Base currency'];
    if (row['Transaction Type']) record.TransactionType = row['Transaction Type'];
    if (row.Account) record.Account = row.Account;

    const closingBalance = toNumber(row['Closing Balance']);
    if (closingBalance !== undefined) record.ClosingBalance = closingBalance;

    if (row.Category) record.Category = row.Category;
    if (row['Parent Categories']) record.ParentCategories = row['Parent Categories'];
    if (row.Labels) record.Labels = row.Labels;
    if (row.Memo) record.Memo = row.Memo;
    if (row.Note) record.Note = row.Note;
    if (row.ID) record.ID = row.ID;
    if (row.Bank) record.Bank = row.Bank;

    return Object.keys(record).length ? record : null;
  }

  /**
   * Check if two records are different
   */
  isDifferent(existing, incoming) {
    const compareFields = [
      'description1', 'description2', 'amount', 'currency',
      'base_amount', 'base_currency', 'transaction_type', 'account_name',
      'closing_balance', 'category_name', 'parent_categories', 'labels',
      'memo', 'note', 'bank'
    ];

    const incomingMapped = {
      description1: incoming.Description1,
      description2: incoming.Description2,
      amount: incoming.Amount,
      currency: incoming.Currency,
      base_amount: incoming.BaseAmount,
      base_currency: incoming.BaseCurrency,
      transaction_type: incoming.TransactionType,
      account_name: incoming.Account,
      closing_balance: incoming.ClosingBalance,
      category_name: incoming.Category,
      parent_categories: incoming.ParentCategories,
      labels: incoming.Labels,
      memo: incoming.Memo,
      note: incoming.Note,
      bank: incoming.Bank
    };

    for (const field of compareFields) {
      const existingVal = existing[field];
      const incomingVal = incomingMapped[field];

      // Both null/undefined - same
      if ((existingVal == null) && (incomingVal == null)) continue;

      // One is null, other has value - different
      if ((existingVal == null) !== (incomingVal == null)) return true;

      // Compare values
      if (String(existingVal) !== String(incomingVal)) return true;
    }

    // Compare date separately (needs date comparison)
    if (incoming.Date) {
      const existingDate = existing.transaction_date;
      const incomingDate = incoming.Date;
      if (existingDate && incomingDate) {
        const existingTime = new Date(existingDate).getTime();
        const incomingTime = new Date(incomingDate).getTime();
        if (existingTime !== incomingTime) return true;
      } else if ((existingDate == null) !== (incomingDate == null)) {
        return true;
      }
    }

    return false;
  }

  /**
   * MAIN FUNCTION
   * Ingest PS transactions from CSV file into PostgreSQL
   */
  async ingestPsTransactionsFromCsv() {
    if (!fs.existsSync(this.csvPath)) {
      console.warn('[v2/ingestor] CSV file not found:', this.csvPath);
      return { insertedCount: 0, updatedCount: 0, skippedCount: 0 };
    }

    const stream = fs.createReadStream(this.csvPath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    const streamClosePromise = new Promise((resolve) => {
      if (stream.closed || stream.destroyed) {
        resolve();
        return;
      }
      stream.once('close', resolve);
    });

    let headers = null;
    let batch = [];
    const batchSize = 1000;
    let addedCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;

    console.log('[v2/ingestor] Ingesting PS transactions from CSV:', this.csvPath);

    const flushBatch = async () => {
      if (!batch.length) {
        console.log('[v2/ingestor] No records to insert in batch.');
        return;
      }

      try {
        // Collect all IDs to check existence
        const ids = [];
        for (const record of batch) {
          if (record.ID) {
            ids.push(String(record.ID));
          }
        }
        const uniqueIds = Array.from(new Set(ids));

        // Find existing records in PostgreSQL
        const existingDocs = uniqueIds.length
          ? await psdata.findByPsIds(uniqueIds)
          : [];
        const existingMap = new Map(existingDocs.map((doc) => [doc.ps_id, doc]));

        let batchAdded = 0;
        let batchUpdated = 0;
        let batchSkipped = 0;

        for (const record of batch) {
          if (record.ID) {
            const existing = existingMap.get(String(record.ID));

            if (existing) {
              // Record exists - check if it changed
              if (this.isDifferent(existing, record)) {
                await psdata.updateByPsId(record.ID, record);
                batchUpdated++;
              } else {
                batchSkipped++;
              }
              continue;
            }
          }

          // New record - insert
          try {
            await psdata.insert(record);
            batchAdded++;
          } catch (err) {
            // Handle duplicate key errors gracefully
            if (err.code === '23505') {
              batchSkipped++;
            } else {
              throw err;
            }
          }
        }

        addedCount += batchAdded;
        updatedCount += batchUpdated;
        skippedCount += batchSkipped;
      } catch (err) {
        console.error('[v2/ingestor] Failed to process batch:', err.message);
      }

      batch = [];
    };

    console.log('[v2/ingestor] Reading CSV file line by line...');

    try {
      for await (const rawLine of rl) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.trim()) {
          continue;
        }

        const values = this.parseCsvLine(line);
        if (!headers) {
          headers = values;
          continue;
        }

        if (values.length < headers.length) {
          continue;
        }

        const row = {};
        for (let i = 0; i < headers.length; i++) {
          row[headers[i]] = values[i] ? values[i].trim() : '';
        }

        const record = this.buildPsRecord(row);
        if (!record) {
          continue;
        }

        batch.push(record);
        if (batch.length >= batchSize) {
          await flushBatch();
        }
      }

      await flushBatch();
    } finally {
      rl.close();
      await streamClosePromise;
      console.log('[v2/ingestor] CSV file stream closed.');
    }

    console.log(
      '[v2/ingestor] Added %d, Updated %d, Skipped %d PS transactions from CSV',
      addedCount,
      updatedCount,
      skippedCount
    );

    return {
      insertedCount: addedCount,
      updatedCount,
      skippedCount,
    };
  }
}

module.exports = PsCsvIngestorV2;
