/**
 * V2 Utility Routes
 *
 * Miscellaneous utility endpoints using PostgreSQL data
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { dataPaths } = require('../../utils/dataPaths');

/**
 * GET /api/v2/util/currencies
 * Returns list of unique currencies from transactions
 */
router.get('/currencies', async (req, res, next) => {
  try {
    const sql = `
      SELECT DISTINCT currency FROM (
        SELECT currency FROM transactions WHERE currency IS NOT NULL
        UNION
        SELECT base_currency as currency FROM transactions WHERE base_currency IS NOT NULL
        UNION
        SELECT currency FROM budget_entries WHERE currency IS NOT NULL
        UNION
        SELECT base_currency as currency FROM budget_entries WHERE base_currency IS NOT NULL
      ) currencies
      ORDER BY currency
    `;

    const result = await db.query(sql);
    const currencies = result.rows
      .map(row => row.currency)
      .filter(c => c && typeof c === 'string')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean);

    // Ensure USD is always included
    if (!currencies.includes('USD')) {
      currencies.unshift('USD');
    }

    res.json({ currencies });
  } catch (error) {
    console.error('[v2/util/currencies] Failed to list currencies:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/exchange-rates
 * Get exchange rates from the local database (bulk/historical)
 * Query params: currencies (comma-separated), fromDate, toDate, latest (boolean)
 */
router.get('/exchange-rates', async (req, res, next) => {
  try {
    const { currencies, fromDate, toDate, latest } = req.query;

    const conditions = ['to_currency = \'USD\''];
    const params = [];
    let paramIndex = 1;

    if (currencies) {
      const currencyList = currencies.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
      if (currencyList.length > 0) {
        conditions.push(`from_currency = ANY($${paramIndex++})`);
        params.push(currencyList);
      }
    }

    if (fromDate) {
      conditions.push(`rate_date >= $${paramIndex++}`);
      params.push(fromDate);
    }

    if (toDate) {
      conditions.push(`rate_date <= $${paramIndex++}`);
      params.push(toDate);
    }

    let sql;
    if (latest === 'true') {
      sql = `
        SELECT DISTINCT ON (from_currency)
          from_currency, to_currency, rate, rate_date, source
        FROM exchange_rates
        WHERE ${conditions.join(' AND ')}
        ORDER BY from_currency, rate_date DESC
      `;
    } else {
      sql = `
        SELECT from_currency, to_currency, rate, rate_date, source
        FROM exchange_rates
        WHERE ${conditions.join(' AND ')}
        ORDER BY from_currency, rate_date DESC
      `;
    }

    const result = await db.query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('[v2/util/exchange-rates] Failed:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/exchange-rate
 * Get exchange rate for a currency pair
 */
router.get('/exchange-rate', async (req, res, next) => {
  try {
    const { currency, asOfDate } = req.query;

    if (!currency) {
      return res.status(400).json({ error: "Missing required 'currency' parameter" });
    }

    const quoteCurrency = currency.trim().toUpperCase();
    if (quoteCurrency === 'USD') {
      return res.json({
        baseCurrency: 'USD',
        quoteCurrency: 'USD',
        rate: 1
      });
    }

    const frankfurterExchangeRates = require('../../utils/frankfurterExchangeRates');
    const asOf = asOfDate ? new Date(asOfDate) : new Date();

    const rate = await frankfurterExchangeRates.getExchangeRate('USD', quoteCurrency, asOf);

    res.json({
      baseCurrency: 'USD',
      quoteCurrency,
      asOfDate: asOf,
      rate
    });
  } catch (error) {
    console.error('[v2/util/exchange-rate] Failed to fetch rate:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/appdata
 * Get application data (budget exchange rates, etc.)
 */
router.get('/appdata', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    // Try to read appData from JSON file if it exists
    const appDataPath = dataPaths.appData;
    let appData = {};

    try {
      if (fs.existsSync(appDataPath)) {
        const content = fs.readFileSync(appDataPath, 'utf8');
        const parsed = JSON.parse(content);
        appData = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed;
      }
    } catch (readError) {
      console.warn('[v2/util/appdata] Could not read appData file:', readError.message);
    }

    res.json([appData]);
  } catch (error) {
    console.error('[v2/util/appdata] Failed to fetch appdata:', error);
    next(error);
  }
});

/**
 * POST /api/v2/util/appdata
 * Update application data (budget exchange rates, etc.)
 */
router.post('/appdata', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    const payload = req.body ?? {};
    const updates = Array.isArray(payload.updates)
      ? payload.updates
      : Array.isArray(payload.entries)
      ? payload.entries
      : [];

    const setFields = {};
    for (const update of updates) {
      if (!update || typeof update !== 'object') continue;
      const { key, value } = update;
      if (typeof key === 'string' && key.trim()) {
        setFields[key.trim()] = value;
      }
    }

    if (Object.keys(setFields).length === 0) {
      return res.status(400).json({
        error: 'No valid appdata entries were provided',
      });
    }

    const appDataPath = dataPaths.appData;
    let existing = {};

    try {
      if (fs.existsSync(appDataPath)) {
        const content = fs.readFileSync(appDataPath, 'utf8');
        const parsed = JSON.parse(content);
        existing = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed;
      }
    } catch (readError) {
      console.warn('[v2/util/appdata POST] Could not read existing file:', readError.message);
    }

    // Merge updates
    const merged = { ...existing, ...setFields };
    fs.writeFileSync(appDataPath, JSON.stringify([merged], null, 2), 'utf8');

    res.json({
      updatedKeys: Object.keys(setFields),
    });
  } catch (error) {
    console.error('[v2/util/appdata POST] Failed to persist appdata:', error);
    next(error);
  }
});

// ============================================================================
// COA endpoints (PostgreSQL-backed)
// ============================================================================

const accountsRepo = require('../repositories').accounts;

/**
 * GET /api/v2/util/coa-traits
 * Get Chart of Accounts traits from PostgreSQL
 */
router.get('/coa-traits', async (req, res, next) => {
  try {
    const traits = await accountsRepo.getTraitsMap();
    res.json(traits);
  } catch (error) {
    console.error('[v2/util/coa-traits] Failed to fetch coa-traits:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/coa/BalanceSheet
 * Get Balance Sheet section as nested tree from PostgreSQL
 */
router.get('/coa/BalanceSheet', async (req, res, next) => {
  try {
    const tree = await accountsRepo.getNestedTree({ section: 'balance_sheet' });
    // Return the children of the root "Balance Sheet Accounts" node
    const root = tree.find(n => n.name === 'Balance Sheet Accounts');
    res.json(root ? root.children : tree);
  } catch (error) {
    console.error('[v2/util/coa/BalanceSheet] Failed:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/coa/CashFlow
 * Get Profit & Loss (Cash Flow) section as nested tree from PostgreSQL
 */
router.get('/coa/CashFlow', async (req, res, next) => {
  try {
    const tree = await accountsRepo.getNestedTree({ section: 'profit_loss' });
    // Return the children of the root "Profit & Loss Accounts" node
    const root = tree.find(n => n.name === 'Profit & Loss Accounts');
    res.json(root ? root.children : tree);
  } catch (error) {
    console.error('[v2/util/coa/CashFlow] Failed:', error);
    next(error);
  }
});

/**
 * POST /api/v2/util/coa/add
 * Add a new account to the COA via PostgreSQL
 */
router.post('/coa/add', async (req, res, next) => {
  try {
    const { path: pathParts, name, type, currency, accountNumber, isCategory } = req.body || {};
    if (!Array.isArray(pathParts) || pathParts.length === 0) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Missing account name' });
    }

    // Check if name already exists
    const existing = await accountsRepo.findByName(trimmedName);
    if (existing) {
      return res.status(409).json({ error: 'COA entry already exists.' });
    }

    // Resolve parent from path — last element in path is the direct parent
    const parentName = pathParts[pathParts.length - 1];
    const parent = await accountsRepo.findByName(parentName);
    if (!parent) {
      return res.status(404).json({ error: 'COA entry not found for the provided path.' });
    }

    const account = await accountsRepo.create({
      name: trimmedName,
      parent_id: parent.id,
      account_type: parent.account_type,
      section: parent.section,
      currency: currency || parent.currency || 'USD',
      account_number: accountNumber || null,
    });

    res.json({ success: true, added: true, name: trimmedName, id: account.id });
  } catch (error) {
    console.error('[v2/util/coa/add] Failed:', error);
    next(error);
  }
});

/**
 * POST /api/v2/util/coa/update
 * Rename / update an account in the COA via PostgreSQL
 */
router.post('/coa/update', async (req, res, next) => {
  try {
    const { oldName, name, type, currency, accountNumber } = req.body || {};
    if (!oldName || !name) {
      return res.status(400).json({ error: 'Missing account name' });
    }

    const account = await accountsRepo.findByName(String(oldName));
    if (!account) {
      return res.status(404).json({ error: 'COA entry not found for the provided path/name.' });
    }

    const updates = { name: String(name) };
    if (currency) updates.currency = currency;
    if (accountNumber !== undefined) updates.account_number = accountNumber;

    const updated = await accountsRepo.update(account.id, updates);

    res.json({
      success: true,
      updated: {
        name: updated.name,
        type: updated.account_type,
        currency: updated.currency,
        accountNumber: updated.account_number || '',
      },
    });
  } catch (error) {
    console.error('[v2/util/coa/update] Failed:', error);
    next(error);
  }
});

/**
 * POST /api/v2/util/coa/delete
 * Soft-delete an account from the COA via PostgreSQL
 */
router.post('/coa/delete', async (req, res, next) => {
  try {
    const { path: pathParts, name } = req.body || {};
    const targetName = String(name || (Array.isArray(pathParts) ? pathParts[pathParts.length - 1] : '') || '');
    if (!targetName) {
      return res.status(400).json({ error: 'Missing account name' });
    }

    const account = await accountsRepo.findByName(targetName);
    if (!account) {
      return res.status(404).json({ error: 'COA entry not found for the provided path/name.' });
    }

    await accountsRepo.remove(account.id);
    res.json({ success: true, deleted: true, name: targetName });
  } catch (error) {
    console.error('[v2/util/coa/delete] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Database Backup (PostgreSQL pg_dump)
// ============================================================================

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const archiver = require('archiver');

const execAsync = promisify(exec);

/**
 * POST /api/v2/util/backup-database
 * Create a PostgreSQL database backup using pg_dump
 */
router.post('/backup-database', async (req, res) => {
  const TIMESTAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
  const BACKUP_NAME = `backup_pg_${TIMESTAMP}`;
  const BACKUP_DIR = path.join('/data', 'pg_backups');
  const backupFile = path.join(BACKUP_DIR, `${BACKUP_NAME}.sql`);

  try {
    console.log('[PG_BACKUP] Starting PostgreSQL backup...');
    console.log('[PG_BACKUP] Backup name:', BACKUP_NAME);

    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      console.log('[PG_BACKUP] Creating backup directory:', BACKUP_DIR);
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    // Parse DATABASE_URL to get connection info
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return res.status(500).json({ error: 'DATABASE_URL not configured' });
    }

    // Parse the URL (format: postgresql://user:pass@host:port/dbname)
    const url = new URL(databaseUrl);
    const pgHost = url.hostname;
    const pgPort = url.port || '5432';
    const pgUser = url.username;
    const pgPassword = url.password;
    const pgDatabase = url.pathname.slice(1); // Remove leading /

    console.log(`[PG_BACKUP] Connecting to ${pgHost}:${pgPort}/${pgDatabase}`);

    // Create backup using pg_dump
    // PGPASSWORD is set as env var to avoid password prompt
    const pgDumpCmd = `PGPASSWORD='${pgPassword}' pg_dump -h ${pgHost} -p ${pgPort} -U ${pgUser} -d ${pgDatabase} -F p --clean --if-exists -f "${backupFile}"`;

    try {
      const { stdout: dumpOutput } = await execAsync(pgDumpCmd, {
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
        timeout: 300000, // 5 minute timeout
      });
      console.log('[PG_BACKUP] pg_dump completed');
      if (dumpOutput) {
        console.log('[PG_BACKUP] Output:', dumpOutput);
      }
    } catch (error) {
      console.error('[PG_BACKUP] pg_dump failed:', error);
      return res.status(500).json({
        error: `Failed to create backup: ${error.message}`,
      });
    }

    // Verify backup was created
    if (!fs.existsSync(backupFile)) {
      console.error('[PG_BACKUP] Backup file not found:', backupFile);
      return res.status(500).json({
        error: 'Backup file was not created',
      });
    }

    // Create a tar.gz archive of the backup
    const archiveName = `${BACKUP_NAME}.tar.gz`;
    const archivePath = path.join(BACKUP_DIR, archiveName);

    console.log('[PG_BACKUP] Creating archive:', archiveName);

    const output = fs.createWriteStream(archivePath);
    const archive = archiver('tar', {
      gzip: true,
      gzipOptions: { level: 9 },
    });

    // Handle archive events
    output.on('close', () => {
      console.log(
        `[PG_BACKUP] Archive created: ${archiveName} (${archive.pointer()} bytes)`
      );

      // Send the file to the client
      res.download(archivePath, archiveName, (err) => {
        if (err) {
          console.error('[PG_BACKUP] Download error:', err);
        }

        // Clean up: remove the archive and SQL file after sending
        try {
          fs.unlinkSync(archivePath);
          fs.unlinkSync(backupFile);
          console.log('[PG_BACKUP] Backup files cleaned up');
        } catch (cleanupError) {
          console.warn('[PG_BACKUP] Failed to clean up:', cleanupError);
        }
      });
    });

    archive.on('error', (err) => {
      console.error('[PG_BACKUP] Archive error:', err);
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'Failed to create backup archive',
        });
      }
    });

    archive.pipe(output);
    archive.file(backupFile, { name: `${BACKUP_NAME}.sql` });
    await archive.finalize();
  } catch (error) {
    console.error('[PG_BACKUP] Backup failed:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: error.message || 'Failed to create database backup',
      });
    }
  }
});

module.exports = router;
