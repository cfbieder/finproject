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

/**
 * GET /api/v2/util/coa-traits
 * Get Chart of Accounts traits
 */
router.get('/coa-traits', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    const coaTraitsPath = dataPaths.coaTraits;
    let traits = {};

    try {
      if (fs.existsSync(coaTraitsPath)) {
        const content = fs.readFileSync(coaTraitsPath, 'utf8');
        traits = JSON.parse(content);
      }
    } catch (readError) {
      console.warn('[v2/util/coa-traits] Could not read coa_traits file:', readError.message);
    }

    res.json(traits);
  } catch (error) {
    console.error('[v2/util/coa-traits] Failed to fetch coa-traits:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/coa/BalanceSheet
 * Get Balance Sheet section of Chart of Accounts
 */
router.get('/coa/BalanceSheet', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    const coaPath = dataPaths.coa;
    const coaData = JSON.parse(fs.readFileSync(coaPath, 'utf8'));

    if (!Array.isArray(coaData)) {
      return res.json([]);
    }

    // Find Balance Sheet Accounts section
    const bsEntry = coaData.find(
      item => item && typeof item === 'object' &&
      Object.prototype.hasOwnProperty.call(item, 'Balance Sheet Accounts')
    );

    if (!bsEntry) {
      return res.json([]);
    }

    res.json(bsEntry['Balance Sheet Accounts'] || []);
  } catch (error) {
    console.error('[v2/util/coa/BalanceSheet] Failed:', error);
    next(error);
  }
});

/**
 * GET /api/v2/util/coa/CashFlow
 * Get Profit & Loss (Cash Flow) section of Chart of Accounts
 */
router.get('/coa/CashFlow', async (req, res, next) => {
  try {
    const fs = require('fs');
    const { dataPaths } = require('../../utils/dataPaths');

    const coaPath = dataPaths.coa;
    const coaData = JSON.parse(fs.readFileSync(coaPath, 'utf8'));

    if (!Array.isArray(coaData)) {
      return res.json([]);
    }

    // Find Profit & Loss Accounts section
    const plEntry = coaData.find(
      item => item && typeof item === 'object' &&
      Object.prototype.hasOwnProperty.call(item, 'Profit & Loss Accounts')
    );

    if (!plEntry) {
      return res.json([]);
    }

    res.json(plEntry['Profit & Loss Accounts'] || []);
  } catch (error) {
    console.error('[v2/util/coa/CashFlow] Failed:', error);
    next(error);
  }
});

// ============================================================================
// COA Management (file-based operations)
// ============================================================================

const COA_TRAITS_PATH = require('path').join(
  require('path').dirname(dataPaths.coa),
  'coa_traits.json'
);

const loadJson = async (filePath) => {
  const fsp = require('fs/promises');
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
};

const saveJson = async (filePath, data) => {
  const fsp = require('fs/promises');
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
};

const updateCoaEntryName = (data, pathParts, oldName, newName) => {
  if (!Array.isArray(data) || !Array.isArray(pathParts) || pathParts.length === 0) {
    return false;
  }
  const targetName = pathParts[pathParts.length - 1];
  const parentPath = pathParts.slice(0, -1);

  let current = data;
  for (const key of parentPath) {
    const match = current.find(
      (entry) => entry && typeof entry === 'object' && !Array.isArray(entry) &&
        Object.prototype.hasOwnProperty.call(entry, key)
    );
    if (!match) return false;
    current = match[key];
    if (!Array.isArray(current)) return false;
  }

  const idxString = current.findIndex((item) => item === targetName);
  if (idxString !== -1) {
    current[idxString] = newName;
    return true;
  }

  for (let i = 0; i < current.length; i++) {
    const entry = current[i];
    if (entry && typeof entry === 'object' && !Array.isArray(entry) &&
        Object.prototype.hasOwnProperty.call(entry, targetName)) {
      const value = entry[targetName];
      current[i] = { [newName]: value };
      return true;
    }
  }
  return false;
};

const deleteCoaEntry = (data, pathParts, targetName) => {
  if (!Array.isArray(data) || !Array.isArray(pathParts) || pathParts.length === 0) {
    return false;
  }
  const parentPath = pathParts.slice(0, -1);
  const nameToDelete = targetName || pathParts[pathParts.length - 1];

  let current = data;
  for (const key of parentPath) {
    const match = current.find(
      (entry) => entry && typeof entry === 'object' && !Array.isArray(entry) &&
        Object.prototype.hasOwnProperty.call(entry, key)
    );
    if (!match) return false;
    current = match[key];
    if (!Array.isArray(current)) return false;
  }

  const idxString = current.findIndex((item) => item === nameToDelete);
  if (idxString !== -1) {
    current.splice(idxString, 1);
    return true;
  }

  const idxObject = current.findIndex(
    (entry) => entry && typeof entry === 'object' && !Array.isArray(entry) &&
      Object.prototype.hasOwnProperty.call(entry, nameToDelete)
  );
  if (idxObject !== -1) {
    current.splice(idxObject, 1);
    return true;
  }
  return false;
};

const addCoaEntry = (data, pathParts, entry) => {
  if (!Array.isArray(data) || !Array.isArray(pathParts) || pathParts.length === 0) {
    return { ok: false, reason: 'invalid' };
  }
  const name = entry?.name;
  if (!name) {
    return { ok: false, reason: 'invalid' };
  }

  let current = data;
  for (const key of pathParts) {
    const match = current.find(
      (item) => item && typeof item === 'object' && !Array.isArray(item) &&
        Object.prototype.hasOwnProperty.call(item, key)
    );
    if (!match) return { ok: false, reason: 'not_found' };
    current = match[key];
    if (!Array.isArray(current)) return { ok: false, reason: 'not_found' };
  }

  const exists = current.some((item) => {
    if (typeof item === 'string') return item === name;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.prototype.hasOwnProperty.call(item, name);
    }
    return false;
  });
  if (exists) {
    return { ok: false, reason: 'exists' };
  }

  if (entry.isCategory) {
    current.push({ [name]: [] });
  } else {
    current.push(name);
  }
  return { ok: true };
};

// POST /api/v2/util/coa/add
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

    const coaData = await loadJson(dataPaths.coa);
    const result = addCoaEntry(coaData, pathParts, {
      name: trimmedName,
      isCategory: Boolean(isCategory),
    });

    if (!result.ok) {
      if (result.reason === 'exists') {
        return res.status(409).json({ error: 'COA entry already exists.' });
      }
      if (result.reason === 'not_found') {
        return res.status(404).json({ error: 'COA entry not found for the provided path.' });
      }
      return res.status(400).json({ error: 'Invalid request' });
    }

    await saveJson(dataPaths.coa, coaData);

    if (!isCategory) {
      let traits = {};
      try {
        traits = await loadJson(COA_TRAITS_PATH);
      } catch (e) {
        traits = {};
      }
      traits[trimmedName] = {
        Type: type || '',
        Currency: currency || '',
        AccountNumber: accountNumber || '',
      };
      await saveJson(COA_TRAITS_PATH, traits);
    }

    res.json({ success: true, added: true, name: trimmedName });
  } catch (error) {
    console.error('[v2/util/coa/add] Failed:', error);
    next(error);
  }
});

// POST /api/v2/util/coa/update
router.post('/coa/update', async (req, res, next) => {
  try {
    const { path: pathParts, oldName, name, type, currency, accountNumber } = req.body || {};
    if (!Array.isArray(pathParts) || pathParts.length === 0) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    if (!oldName || !name) {
      return res.status(400).json({ error: 'Missing account name' });
    }

    const coaData = await loadJson(dataPaths.coa);
    const updated = updateCoaEntryName(coaData, pathParts, String(oldName), String(name));
    if (!updated) {
      return res.status(404).json({ error: 'COA entry not found for the provided path/name.' });
    }

    await saveJson(dataPaths.coa, coaData);

    let traits = {};
    try {
      traits = await loadJson(COA_TRAITS_PATH);
    } catch (e) {
      traits = {};
    }
    const existingTraits = traits[oldName] || {};
    delete traits[oldName];
    traits[name] = {
      ...existingTraits,
      Type: type || existingTraits.Type || '',
      Currency: currency || existingTraits.Currency || '',
      AccountNumber: accountNumber || existingTraits.AccountNumber || '',
    };
    await saveJson(COA_TRAITS_PATH, traits);

    res.json({
      success: true,
      updated: {
        name,
        type: traits[name].Type,
        currency: traits[name].Currency,
        accountNumber: traits[name].AccountNumber,
      },
    });
  } catch (error) {
    console.error('[v2/util/coa/update] Failed:', error);
    next(error);
  }
});

// POST /api/v2/util/coa/delete
router.post('/coa/delete', async (req, res, next) => {
  try {
    const { path: pathParts, name } = req.body || {};
    if (!Array.isArray(pathParts) || pathParts.length === 0) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    const targetName = String(name || pathParts[pathParts.length - 1] || '');
    if (!targetName) {
      return res.status(400).json({ error: 'Missing account name' });
    }

    const coaData = await loadJson(dataPaths.coa);
    const deleted = deleteCoaEntry(coaData, pathParts, targetName);
    if (!deleted) {
      return res.status(404).json({ error: 'COA entry not found for the provided path/name.' });
    }

    await saveJson(dataPaths.coa, coaData);

    let traits = {};
    try {
      traits = await loadJson(COA_TRAITS_PATH);
    } catch (e) {
      traits = {};
    }
    if (traits[targetName]) {
      delete traits[targetName];
      await saveJson(COA_TRAITS_PATH, traits);
    }

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
