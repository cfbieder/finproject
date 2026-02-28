/**
 * V2 PocketSmith Ingest Routes (PostgreSQL)
 *
 * Direct PostgreSQL implementation for PS data ingestion.
 * Replaces MongoDB-based v1 implementation.
 */

const express = require('express');
const router = express.Router();
const fs = require('node:fs/promises');
const psdata = require('../repositories/psdata');
const { dataPaths, tempFiles, ensureComponentsDataDir } = require('../../utils/dataPaths');

ensureComponentsDataDir();

const csvBodyParser = express.text({
  type: ['text/csv', 'text/plain', 'application/octet-stream'],
  limit: '10mb',
});

// ============================================================================
// Utility Functions
// ============================================================================

const normalizeStringList = (values) => {
  if (!Array.isArray(values)) return [];
  const unique = new Set();
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) unique.add(trimmed);
    }
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

const readCoaCategories = async () => {
  try {
    const db = require('../db');
    // Get leaf-level P&L account names in display order using recursive CTE
    const result = await db.query(`
      WITH RECURSIVE cat_tree AS (
        SELECT id, name, parent_id, display_order,
               ARRAY[display_order, id] as sort_path
        FROM accounts
        WHERE section = 'profit_loss' AND parent_id IS NULL AND is_active = TRUE
        UNION ALL
        SELECT a.id, a.name, a.parent_id, a.display_order,
               ct.sort_path || ARRAY[a.display_order, a.id]
        FROM accounts a
        JOIN cat_tree ct ON a.parent_id = ct.id
        WHERE a.is_active = TRUE
      )
      SELECT ct.name FROM cat_tree ct
      WHERE ct.id NOT IN (
        SELECT DISTINCT parent_id FROM accounts WHERE parent_id IS NOT NULL AND is_active = TRUE
      )
      ORDER BY ct.sort_path
    `);
    return result.rows.map(r => r.name);
  } catch (error) {
    console.error('[v2/ingest-ps] Unable to read COA from DB:', error);
    return [];
  }
};

const orderCategoriesByCoa = (psCategories, coaCategories) => {
  const cleaned = normalizeStringList(psCategories);
  if (!cleaned.length) return coaCategories;

  const remaining = new Set(cleaned);
  const ordered = [];

  for (const cat of coaCategories) {
    if (remaining.has(cat)) {
      ordered.push(cat);
      remaining.delete(cat);
    }
  }
  for (const cat of cleaned) {
    if (remaining.has(cat)) {
      ordered.push(cat);
    }
  }
  return ordered;
};

// ============================================================================
// Sync Helper Function
// ============================================================================

/**
 * Sync staging data to transactions table
 * Maps account_name/category_name to account_id/category_id
 */
async function syncStagingToTransactions() {
  const db = require('../db');

  // Check for unmapped accounts/categories first
  const unmappedAcctResult = await db.query(`
    SELECT DISTINCT s.account_name
    FROM psdata_staging s
    LEFT JOIN accounts a ON LOWER(s.account_name) = LOWER(a.name)
    WHERE s.account_name IS NOT NULL AND a.id IS NULL
  `);
  const unmappedAccounts = unmappedAcctResult.rows.map(r => r.account_name);

  const unmappedCatResult = await db.query(`
    SELECT DISTINCT s.category_name
    FROM psdata_staging s
    LEFT JOIN categories c ON LOWER(s.category_name) = LOWER(c.name)
    WHERE s.category_name IS NOT NULL AND c.id IS NULL
  `);
  const unmappedCategories = unmappedCatResult.rows.map(r => r.category_name);

  // Count records that will be skipped (missing required fields or unmapped account)
  const skippedResult = await db.query(`
    SELECT COUNT(*) as cnt FROM psdata_staging s
    LEFT JOIN accounts a ON LOWER(s.account_name) = LOWER(a.name)
    WHERE a.id IS NULL OR s.amount IS NULL OR s.transaction_date IS NULL OR s.currency IS NULL
  `);
  const skipped = parseInt(skippedResult.rows[0].cnt, 10);

  // Bulk upsert: INSERT ... ON CONFLICT (ps_id) DO UPDATE
  // Uses a single SQL statement joining staging with accounts and categories
  const upsertResult = await db.query(`
    WITH staged AS (
      SELECT
        s.ps_id::bigint as ps_id,
        s.transaction_date,
        s.description1,
        s.description2,
        s.amount,
        s.currency,
        s.base_amount,
        s.base_currency,
        s.transaction_type,
        a.id as account_id,
        c.id as category_id,
        s.closing_balance,
        CASE WHEN s.labels IS NOT NULL AND s.labels != ''
          THEN string_to_array(s.labels, ',')
          ELSE NULL
        END as labels,
        s.memo,
        s.note,
        s.bank
      FROM psdata_staging s
      LEFT JOIN accounts a ON LOWER(s.account_name) = LOWER(a.name)
      LEFT JOIN categories c ON LOWER(s.category_name) = LOWER(c.name)
      WHERE a.id IS NOT NULL
        AND s.amount IS NOT NULL
        AND s.transaction_date IS NOT NULL
        AND s.currency IS NOT NULL
    )
    INSERT INTO transactions (
      ps_id, transaction_date, description1, description2,
      amount, currency, base_amount, base_currency,
      transaction_type, account_id, category_id,
      closing_balance, labels, memo, note, bank, source
    )
    SELECT
      ps_id, transaction_date, description1, description2,
      amount, currency, base_amount, base_currency,
      transaction_type, account_id, category_id,
      closing_balance, labels, memo, note, bank, 'pocketsmith'
    FROM staged
    ON CONFLICT (ps_id) DO UPDATE SET
      transaction_date = EXCLUDED.transaction_date,
      description1 = EXCLUDED.description1,
      description2 = EXCLUDED.description2,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      base_amount = EXCLUDED.base_amount,
      base_currency = EXCLUDED.base_currency,
      transaction_type = EXCLUDED.transaction_type,
      account_id = EXCLUDED.account_id,
      category_id = EXCLUDED.category_id,
      closing_balance = EXCLUDED.closing_balance,
      labels = EXCLUDED.labels,
      memo = EXCLUDED.memo,
      note = EXCLUDED.note,
      bank = EXCLUDED.bank,
      updated_at = NOW()
    WHERE transactions.accepted IS NOT TRUE
    RETURNING id,
      (xmax = 0) as was_inserted
  `);

  const inserted = upsertResult.rows.filter(r => r.was_inserted).length;
  const updated = upsertResult.rows.filter(r => !r.was_inserted).length;

  // Count accepted transactions that were protected from overwrite
  const protectedResult = await db.query(`
    SELECT COUNT(*) as cnt
    FROM psdata_staging s
    JOIN transactions t ON t.ps_id = s.ps_id::bigint
    WHERE t.accepted = TRUE
      AND s.amount IS NOT NULL
      AND s.transaction_date IS NOT NULL
      AND s.currency IS NOT NULL
  `);
  const protectedCount = parseInt(protectedResult.rows[0].cnt, 10);

  console.log(`[v2/ingest-ps] Sync complete: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${protectedCount} protected (accepted)`);

  return {
    inserted,
    updated,
    skipped,
    protectedCount,
    total: inserted + updated + skipped,
    unmappedAccounts,
    unmappedCategories
  };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /api/v2/ingest-ps
 * Ingest PS transactions from CSV into PostgreSQL
 * Automatically syncs to transactions table after ingestion
 */
router.post('/', async (req, res, next) => {
  try {
    const PsCsvIngestorV2 = require('../services/psCsvIngestorV2');
    const ingestor = new PsCsvIngestorV2();
    const ingestResult = await ingestor.ingestPsTransactionsFromCsv();

    // Update lastIngest timestamp
    await psdata.setAppData('lastIngest', new Date().toISOString());

    console.log('[v2/ingest-ps] Auto-syncing to transactions table...');

    // Auto-sync to transactions table
    const syncResult = await syncStagingToTransactions();

    res.json({
      ingest: {
        insertedCount: ingestResult.insertedCount || 0,
        skippedCount: ingestResult.skippedCount || 0,
        updatedCount: ingestResult.updatedCount || 0,
      },
      sync: {
        inserted: syncResult.inserted,
        updated: syncResult.updated,
        skipped: syncResult.skipped,
        total: syncResult.total,
        unmappedAccounts: syncResult.unmappedAccounts,
        unmappedCategories: syncResult.unmappedCategories,
      }
    });
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to ingest PS transactions:', error);
    next(error);
  }
});

/**
 * POST /api/v2/ingest-ps/clearall
 * Clear all PS records from PostgreSQL
 */
router.post('/clearall', async (req, res, next) => {
  try {
    const count = await psdata.clearAll();
    res.json({ cleared: true, count });
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to clear PS records:', error);
    next(error);
  }
});

/**
 * POST /api/v2/ingest-ps/upload-ps
 * Upload PS CSV file to server
 */
router.post('/upload-ps', csvBodyParser, async (req, res) => {
  const payload = req.body;
  if (!payload) {
    return res.status(400).json({ error: 'CSV payload is required' });
  }

  try {
    await fs.writeFile(dataPaths.psTransactions, payload, 'utf8');
    res.json({
      message: 'Payroll file saved',
      size: Buffer.byteLength(payload, 'utf8'),
    });
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to write CSV:', error);
    res.status(500).json({ error: 'Unable to save payroll file' });
  }
});

/**
 * GET/POST /api/v2/ingest-ps/analyze-ps
 * Analyze PS data for missing accounts/categories
 */
const analyzePsHandler = async (req, res, next) => {
  try {
    const DataAnalyzerUtils = require('../../services/retrieval/dataAnalyzerUtils');

    // Create a proxy object that mimics the MongoDB model interface
    const PSdataProxy = {
      distinct: (field) => {
        // Return an object with an exec() method to match MongoDB API
        return {
          exec: async () => {
            if (field === 'Account') {
              return psdata.distinctAccounts();
            }
            if (field === 'Category') {
              return psdata.distinctCategories();
            }
            return [];
          }
        };
      }
    };

    await DataAnalyzerUtils.writeAccountNamesFile(PSdataProxy, dataPaths.accountNames);
    const misAcct = await DataAnalyzerUtils.reportMissingAccounts(dataPaths.accountNames);
    const missCOAact = await DataAnalyzerUtils.reportUnknownCoaAccounts(dataPaths.accountNames);

    await DataAnalyzerUtils.writeCategoryNamesFile(PSdataProxy, dataPaths.categoryNames);
    const misCat = await DataAnalyzerUtils.reportMissingCategories(dataPaths.categoryNames);
    const missCOACat = await DataAnalyzerUtils.reportUnknownCoaCategories(dataPaths.categoryNames);

    res.json({
      misAcct,
      missCOAact,
      misCat,
      missCOACat,
    });
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to analyze PS data:', error);
    next(error);
  }
};

router.post('/analyze-ps', analyzePsHandler);
router.get('/analyze-ps', analyzePsHandler);

/**
 * GET /api/v2/ingest-ps/psdata/count
 * Get count of PS data records
 */
router.get('/psdata/count', async (req, res, next) => {
  try {
    const count = await psdata.count();
    res.json({ count });
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to count psdata:', error);
    next(error);
  }
});

/**
 * GET /api/v2/ingest-ps/psdata/options
 * Get distinct accounts and categories from PS data
 */
router.get('/psdata/options', async (req, res, next) => {
  try {
    const [accounts, categories] = await Promise.all([
      psdata.distinctAccounts(),
      psdata.distinctCategories(),
    ]);
    const coaCategories = await readCoaCategories();

    res.json({
      accounts: normalizeStringList(accounts),
      categories: orderCategoriesByCoa(categories, coaCategories),
    });
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to fetch PS data options:', error);
    next(error);
  }
});

/**
 * POST /api/v2/ingest-ps/appdata/last-refresh
 * Update last refresh timestamp
 */
router.post('/appdata/last-refresh', async (req, res, next) => {
  try {
    const now = new Date().toISOString();
    await psdata.setAppData('lastRefresh', now);

    res.json({
      modifiedCount: 1,
      upsertedCount: 0,
      lastRefresh: now,
    });
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to update lastRefresh:', error);
    next(error);
  }
});

/**
 * GET /api/v2/ingest-ps/new-transactions
 * Get newly imported transactions report
 */
router.get('/new-transactions', async (req, res) => {
  try {
    const raw = await fs.readFile(tempFiles.importReport, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : [];
    res.json(Array.isArray(parsed) ? parsed : [parsed].filter(Boolean));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.json([]);
    }
    console.error('[v2/ingest-ps] Failed to read import report:', error);
    res.status(500).json({ error: 'Unable to load new transactions report' });
  }
});

/**
 * GET /api/v2/ingest-ps/modified-transactions
 * Get modified transactions report
 */
router.get('/modified-transactions', async (req, res) => {
  try {
    const raw = await fs.readFile(tempFiles.updateReport, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : [];
    res.json(Array.isArray(parsed) ? parsed : [parsed].filter(Boolean));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.json([]);
    }
    console.error('[v2/ingest-ps] Failed to read update report:', error);
    res.status(500).json({ error: 'Unable to load modified transactions report' });
  }
});

/**
 * POST /api/v2/ingest-ps/refresh-ps
 * Refresh PS data from PocketSmith API
 */
router.post('/refresh-ps', async (req, res, next) => {
  try {
    const { processTransactionsV2, logTransactionFileCounts } = require('../services/refreshPsApiV2');
    const { daysHistory } = req.body ?? {};
    await processTransactionsV2(daysHistory);
    const fileCounts = logTransactionFileCounts();

    // Auto-sync staging to transactions table
    console.log('[v2/ingest-ps] Auto-syncing staging to transactions after API refresh...');
    const syncResult = await syncStagingToTransactions();
    console.log('[v2/ingest-ps] Auto-sync after refresh complete:', syncResult);

    res.json({ ...fileCounts, syncResult });
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to refresh PS data:', error);
    next(error);
  }
});

/**
 * POST /api/v2/ingest-ps/review-new-transactions
 * Fetch all unaccepted transactions for review.
 * Queries the transactions table directly so entries persist across
 * refreshes until explicitly accepted.
 */
router.post('/review-new-transactions', async (req, res) => {
  try {
    const db = require('../db');
    const result = await db.query(`
      SELECT
        t.id,
        t.ps_id,
        t.transaction_date,
        t.description1,
        t.description2,
        t.amount,
        t.currency,
        t.base_amount,
        t.base_currency,
        COALESCE(a.name, '') as account_name,
        COALESCE(c.name, '') as category_name,
        t.account_id,
        t.category_id,
        t.closing_balance,
        t.labels,
        t.memo,
        t.note,
        t.bank,
        t.source
      FROM transactions t
      LEFT JOIN accounts a ON t.account_id = a.id
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.accepted IS NOT TRUE
      ORDER BY t.transaction_date DESC, t.id DESC
    `);

    res.json({ data: result.rows });
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to load review transactions:', error);
    res.status(500).json({ error: 'Unable to load review transactions' });
  }
});

/**
 * POST /api/v2/ingest-ps/sync-to-transactions
 * Sync PS staging data to main transactions table
 * Maps account_name/category_name to account_id/category_id
 */
router.post('/sync-to-transactions', async (req, res, next) => {
  try {
    const result = await syncStagingToTransactions();
    res.json(result);
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to sync to transactions:', error);
    next(error);
  }
});

module.exports = router;
