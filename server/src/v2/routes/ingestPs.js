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
// Memoized: does transactions.bank_feed_external_id exist? (CR022 migration 023).
// PS promote must stay safe on a DB where 023 hasn't been applied (e.g. prod
// before cutover) — referencing a missing column would break every PS refresh.
let _bankFeedColumnExists = null;
async function bankFeedColumnExists(db) {
  if (_bankFeedColumnExists !== null) return _bankFeedColumnExists;
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'transactions' AND column_name = 'bank_feed_external_id'`
  );
  _bankFeedColumnExists = r.rows.length > 0;
  return _bankFeedColumnExists;
}

async function syncStagingToTransactions() {
  const db = require('../db');

  // CR022 R2.2 — reverse cross-source dedup. When a PS staging row duplicates a
  // transaction already imported via bank-feed (source='bank-feed', so a genuine
  // bank-feed-origin insert, NOT a PS row that was merely linked), drop the PS
  // row: we already hold that transaction. Match on (account_id, ABS(amount),
  // currency) within ±1 day. Applied only when BANK_FEED_DEDUP_ENABLED is on
  // (default) AND migration 023 has landed (column present) — otherwise the
  // clause is empty and PS promote behaves exactly as before. The column check
  // makes this safe regardless of migrate-vs-deploy ordering.
  const dedupOn =
    process.env.BANK_FEED_DEDUP_ENABLED !== 'false' && (await bankFeedColumnExists(db));
  const bankFeedDedupClause = !dedupOn ? '' : `
        AND NOT EXISTS (
          SELECT 1 FROM transactions bf
          WHERE bf.source = 'bank-feed'
            AND bf.bank_feed_external_id IS NOT NULL
            AND bf.account_id = a.id
            AND bf.currency = s.currency
            AND ROUND(ABS(bf.amount), 2) = ROUND(ABS(COALESCE(s.amount, 0)), 2)
            AND ABS(bf.transaction_date - s.transaction_date) <= 1
        )`;

  // Check for unmapped accounts/categories first
  const unmappedAcctResult = await db.query(`
    SELECT DISTINCT s.account_name
    FROM psdata_staging s
    LEFT JOIN account_source_mappings asm
      ON LOWER(s.account_name) = LOWER(asm.external_name) AND asm.source = 'pocketsmith'
    LEFT JOIN accounts a ON asm.account_id = a.id
    WHERE s.account_name IS NOT NULL AND a.id IS NULL
  `);
  const unmappedAccounts = unmappedAcctResult.rows.map(r => r.account_name);

  // After migration 021, "categories" are P&L leaves on the accounts table.
  // PocketSmith category names map via account_source_mappings.
  const unmappedCatResult = await db.query(`
    SELECT DISTINCT s.category_name
    FROM psdata_staging s
    LEFT JOIN account_source_mappings asm
      ON LOWER(s.category_name) = LOWER(asm.external_name) AND asm.source = 'pocketsmith'
    LEFT JOIN accounts c ON asm.account_id = c.id AND c.section = 'profit_loss'
    WHERE s.category_name IS NOT NULL AND c.id IS NULL
  `);
  const unmappedCategories = unmappedCatResult.rows.map(r => r.category_name);

  // Count records that will be skipped (missing required fields or unmapped account)
  // NULL amounts are coerced to 0 below (legitimate $0 events like expired options),
  // so amount IS NULL alone is not a skip reason.
  const skippedResult = await db.query(`
    SELECT COUNT(*) as cnt FROM psdata_staging s
    LEFT JOIN account_source_mappings asm
      ON LOWER(s.account_name) = LOWER(asm.external_name) AND asm.source = 'pocketsmith'
    LEFT JOIN accounts a ON asm.account_id = a.id
    WHERE a.id IS NULL OR s.transaction_date IS NULL OR s.currency IS NULL
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
        COALESCE(s.amount, 0) as amount,
        s.currency,
        COALESCE(s.base_amount, 0) as base_amount,
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
      LEFT JOIN account_source_mappings asm
        ON LOWER(s.account_name) = LOWER(asm.external_name) AND asm.source = 'pocketsmith'
      LEFT JOIN accounts a ON asm.account_id = a.id
      LEFT JOIN account_source_mappings csm
        ON LOWER(s.category_name) = LOWER(csm.external_name) AND csm.source = 'pocketsmith'
      LEFT JOIN accounts c ON csm.account_id = c.id AND c.section = 'profit_loss'
      WHERE a.id IS NOT NULL
        AND s.transaction_date IS NOT NULL
        AND s.currency IS NOT NULL${bankFeedDedupClause}
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
    const { refreshAllRates } = require('../../utils/refreshExchangeRates');
    const { daysHistory } = req.body ?? {};
    await processTransactionsV2(daysHistory);
    const fileCounts = logTransactionFileCounts();

    // Auto-sync staging to transactions table
    console.log('[v2/ingest-ps] Auto-syncing staging to transactions after API refresh...');
    const syncResult = await syncStagingToTransactions();
    console.log('[v2/ingest-ps] Auto-sync after refresh complete:', syncResult);

    // Refresh exchange rates from Frankfurter
    let fxResult = { updated: 0 };
    try {
      fxResult = await refreshAllRates();
    } catch (err) {
      console.warn('[v2/ingest-ps] FX rate refresh failed (non-fatal):', err.message);
    }

    // Compute per-refresh review breakdown: of the ps_ids just inserted to
    // staging, how many reached the Review queue, and why the rest dropped.
    const reviewBreakdown = await computeRefreshReviewBreakdown();

    res.json({ ...fileCounts, syncResult, fxRatesUpdated: fxResult.updated, reviewBreakdown });
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to refresh PS data:', error);
    next(error);
  }
});

async function computeRefreshReviewBreakdown() {
  try {
    const raw = await fs.readFile(tempFiles.importReport, 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const insertedPsIds = records
      .map((r) => r?.ps_id ?? r?.ID)
      .filter((id) => id !== undefined && id !== null)
      .map(String);
    if (insertedPsIds.length === 0) {
      return { inserted_to_staging: 0, reviewable: 0, already_accepted: 0, missing_amount: 0, unmapped_account: 0, other_skipped: 0 };
    }
    const db = require('../db');
    const result = await db.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE t.id IS NOT NULL AND t.accepted IS NOT TRUE)::int AS reviewable,
        COUNT(*) FILTER (WHERE t.id IS NOT NULL AND t.accepted IS TRUE)::int AS already_accepted,
        COUNT(*) FILTER (WHERE t.id IS NULL AND s.amount IS NULL)::int AS missing_amount,
        COUNT(*) FILTER (WHERE t.id IS NULL AND s.amount IS NOT NULL AND a.id IS NULL)::int AS unmapped_account,
        COUNT(*) FILTER (WHERE t.id IS NULL AND s.amount IS NOT NULL AND a.id IS NOT NULL)::int AS other_skipped
      FROM psdata_staging s
      LEFT JOIN account_source_mappings asm
        ON LOWER(s.account_name) = LOWER(asm.external_name) AND asm.source = 'pocketsmith'
      LEFT JOIN accounts a ON asm.account_id = a.id
      LEFT JOIN transactions t ON t.ps_id = s.ps_id::bigint
      WHERE s.ps_id = ANY($1::varchar[])
      `,
      [insertedPsIds]
    );
    return { inserted_to_staging: insertedPsIds.length, ...result.rows[0] };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[v2/ingest-ps] Failed to compute review breakdown:', err.message);
    }
    return null;
  }
}

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
      LEFT JOIN accounts c ON t.category_id = c.id
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
