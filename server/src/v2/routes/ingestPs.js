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

const collectProfitAndLossCategories = (coaData) => {
  if (!Array.isArray(coaData)) return [];
  const categories = [];
  const seen = new Set();

  const traverse = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) traverse(child);
      return;
    }
    if (node && typeof node === 'object') {
      for (const value of Object.values(node)) traverse(value);
      return;
    }
    if (typeof node === 'string') {
      const trimmed = node.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        categories.push(trimmed);
      }
    }
  };

  for (const entry of coaData) {
    if (entry?.['Profit & Loss Accounts']) {
      traverse(entry['Profit & Loss Accounts']);
      break;
    }
  }
  return categories;
};

const readCoaCategories = async () => {
  try {
    const raw = await fs.readFile(dataPaths.coa, 'utf8');
    return collectProfitAndLossCategories(JSON.parse(raw));
  } catch (error) {
    console.error('[v2/ingest-ps] Unable to read COA file:', error);
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
// Routes
// ============================================================================

/**
 * POST /api/v2/ingest-ps
 * Ingest PS transactions from CSV into PostgreSQL
 */
router.post('/', async (req, res, next) => {
  try {
    const PsCsvIngestorV2 = require('../services/psCsvIngestorV2');
    const ingestor = new PsCsvIngestorV2();
    const result = await ingestor.ingestPsTransactionsFromCsv();

    // Update lastIngest timestamp
    await psdata.setAppData('lastIngest', new Date().toISOString());

    res.json({
      insertedCount: result.insertedCount || 0,
      skippedCount: result.skippedCount || 0,
      updatedCount: result.updatedCount || 0,
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
      distinct: async (field) => {
        if (field === 'Account') {
          return psdata.distinctAccounts();
        }
        if (field === 'Category') {
          return psdata.distinctCategories();
        }
        return [];
      }
    };

    await DataAnalyzerUtils.writeAccountNamesFile(PSdataProxy, dataPaths.accountNames);
    const misAcct = DataAnalyzerUtils.reportMissingAccounts(dataPaths.accountNames, dataPaths.coa);
    const missCOAact = DataAnalyzerUtils.reportUnknownCoaAccounts(dataPaths.accountNames, dataPaths.coa);

    await DataAnalyzerUtils.writeCategoryNamesFile(PSdataProxy, dataPaths.categoryNames);
    const misCat = DataAnalyzerUtils.reportMissingCategories(dataPaths.categoryNames, dataPaths.coa);
    const missCOACat = DataAnalyzerUtils.reportUnknownCoaCategories(dataPaths.categoryNames, dataPaths.coa);

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
    const raw = await fs.readFile(tempFiles.mongoImportReport, 'utf8');
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
    const raw = await fs.readFile(tempFiles.mongoUpdateReport, 'utf8');
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
    res.json(logTransactionFileCounts());
  } catch (error) {
    console.error('[v2/ingest-ps] Failed to refresh PS data:', error);
    next(error);
  }
});

module.exports = router;
