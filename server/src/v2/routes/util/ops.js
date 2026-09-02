'use strict';
/**
 * util/ops.js — the true one-offs: the dashboard attention summary and the DB backup.
 * Split out of routes/util.js; paths unchanged.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const archiver = require('archiver');
const db = require('../../db');
const { dataPaths } = require('../../../utils/dataPaths');
// Hoisted out of the handler (CR043 N13).
const bankFeedRecon = require('../../repositories/bankFeedReconciliation');
const manualRecon = require('../../repositories/manualReconciliation');
const bankFeedClient = require('../../services/bankFeedClient');

const execFileAsync = promisify(execFile);

/**
 * GET /api/v2/util/attention-summary  (CR038 P2)
 * The "needs attention" counts for the Home dashboard strip — composition of
 * signals that already exist, one cheap round trip for the frontend:
 *  - review: transactions awaiting review (accepted IS NOT TRUE)
 *  - verifyUsd: KI#7 guard — pending 'ADJUST WIRE TRANSFER' rows in USD
 *    (mislabeled foreign-dividend conversions that must not be accepted on
 *    autopilot; USD value needs checking against the statement)
 *  - staleFeeds: fed accounts whose upstream connection last synced ≥3 days
 *    ago (CR035 thresholds: amber 3–6d, red ≥7d; worstDays = the oldest)
 *  - drift: fed CALIBRATE-mode / manual accounts whose computed balance ≠
 *    target (excludes manual accounts with no balance entered). MTM-mode fed
 *    accounts are deliberately NOT counted here — market drift re-accumulates
 *    the day after a booking, so raw drift would flag them all month.
 *  - mtmDue: fed MTM-mode accounts with no source='mtm' entry dated the last
 *    completed month-end — the actually-actionable MTM signal.
 *  - needsReconnect: bank connections whose consent has expired (CR060). PSD2
 *    consents lapse about every 90 days on the 8 GoCardless connections, and
 *    until now nothing told the owner — `staleFeeds` catches it only as a
 *    SIDE EFFECT, three days later, once the silence is long enough to notice.
 *    This is the day-zero fact the upstream already reports.
 */
router.get('/attention-summary', async (req, res, next) => {
  try {

    const [reviewRow, verifyRow, fedRecon, manRecon] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE accepted IS NOT TRUE`),
      db.query(`
        SELECT COUNT(*)::int AS n FROM transactions
        WHERE accepted IS NOT TRUE AND currency = 'USD'
          AND description1 ILIKE 'ADJUST WIRE TRANSFER%'
      `),
      bankFeedRecon.balanceReconcile({}),
      manualRecon.manualBalanceReconcile({}),
    ]);

    // CR060 — connections needing re-authorisation.
    //
    // Best-effort: this strip is an aid, never a blocker, and a bank-feed outage
    // must not take the Home page's other four signals down with it.
    //
    // ⚠️ Counted as distinct CONNECTIONS, not rows — one dead consent can carry
    // several accounts (Revolut had three wallets), and counting accounts would
    // report "3 need attention" for one thing to fix.
    //
    // ⚠️ Scoped to accounts fin actually MAPS and does not ignore: that is what
    // `balanceReconcile` returns, and it is CR060's own correction — alerting on
    // every upstream connection would report OCME's bank here forever, for a
    // feed switched off on purpose.
    let needsReconnect = 0;
    try {
      const health = await bankFeedClient.feedsHealth();
      const byAccount = (health && health.upstream && health.upstream.accounts_health) || null;
      if (byAccount) {
        const conns = new Set();
        for (const a of fedRecon.accounts || []) {
          const h = byAccount[a.feed_external_id];
          if (h && h.state === 'needs_reconnect') {
            conns.add(h.connection_id || h.institution_name || a.feed_external_id);
          }
        }
        needsReconnect = conns.size;
      }
    } catch (e) {
      console.warn('[v2/util] needs-reconnect check unavailable (non-fatal):', e.message);
    }

    const now = Date.now();
    const staleDaysOf = (a) => {
      if (!a.feed_synced_at) return null;
      const t = new Date(a.feed_synced_at).getTime();
      return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null;
    };
    const fedAccounts = fedRecon.accounts || [];
    const staleDays = fedAccounts
      .map(staleDaysOf)
      .filter((d) => d != null && d >= 3);

    // MTM-due: mtm-mode fed accounts missing their last-month-end booking
    const mtmIds = fedAccounts
      .filter((a) => a.reconcile_mode === 'mtm')
      .map((a) => a.account_id);
    let mtmDue = 0;
    let monthEnd = null;
    if (mtmIds.length > 0) {
      const booked = await db.query(
        `SELECT (date_trunc('month', CURRENT_DATE) - INTERVAL '1 day')::date::text AS month_end,
                ARRAY(
                  SELECT DISTINCT account_id FROM transactions
                  WHERE source = 'mtm' AND account_id = ANY($1::int[])
                    AND transaction_date = (date_trunc('month', CURRENT_DATE) - INTERVAL '1 day')::date
                ) AS booked_ids`,
        [mtmIds]
      );
      monthEnd = booked.rows[0].month_end;
      const bookedIds = new Set(booked.rows[0].booked_ids.map(Number));
      mtmDue = mtmIds.filter((id) => !bookedIds.has(Number(id))).length;
    }

    res.json({
      review: { count: reviewRow.rows[0].n },
      verifyUsd: { count: verifyRow.rows[0].n },
      staleFeeds: {
        count: staleDays.length,
        worstDays: staleDays.length ? Math.max(...staleDays) : null,
      },
      needsReconnect: { count: needsReconnect },
      drift: {
        fed: fedAccounts.filter((a) => a.reconciled === false && a.reconcile_mode !== 'mtm').length,
        manual: (manRecon.accounts || []).filter((a) => a.reconciled === false).length,
      },
      mtmDue: { count: mtmDue, monthEnd },
    });
  } catch (error) {
    next(error);
  }
});

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

    // Create backup using pg_dump. execFile (no shell) + PGPASSWORD via env:
    // connection values never pass through a shell, so passwords with quotes
    // or metacharacters can't break — or inject into — a command line.
    try {
      const { stdout: dumpOutput } = await execFileAsync('pg_dump', [
        '-h', pgHost,
        '-p', pgPort,
        '-U', pgUser,
        '-d', pgDatabase,
        '-F', 'p',
        '--clean', '--if-exists',
        '-f', backupFile,
      ], {
        env: { ...process.env, PGPASSWORD: decodeURIComponent(pgPassword) },
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
