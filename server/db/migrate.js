#!/usr/bin/env node
/**
 * migrate.js — forward-only migration runner + ledger (CR043 Phase 1.1 / N11).
 *
 * Until now migrations ran ONLY via Postgres `docker-entrypoint-initdb.d` on a
 * fresh (empty) volume; existing dev/prod DBs were migrated by hand with `psql`
 * before each deploy, tracked by nothing. That let the schema drift from the
 * migration files twice (commits 4931b2a, 8c1823a). This runner records what
 * has been applied in a `schema_migrations` ledger and applies only the gap,
 * each file in its own transaction.
 *
 * Adoption / baselining — the one subtlety:
 *   dev+prod already have 001..NNN applied but no ledger. Re-running
 *   001_initial_schema against them would fail (objects already exist). So when
 *   the ledger is ABSENT but the schema is already populated (a sentinel table
 *   exists), the runner *baselines*: it records every current file as applied
 *   WITHOUT executing it. This is also correct for a fresh volume, because
 *   initdb.d has by then already run every *.sql present. Only a genuinely
 *   empty DB (sentinel absent) gets a from-scratch apply.
 *
 * Usage (needs DATABASE_URL):
 *   node server/db/migrate.js            # apply pending (auto-baseline on first run)
 *   node server/db/migrate.js --dry-run  # show the plan, write nothing
 *   node server/db/migrate.js --baseline # force: mark all current files applied, run none
 *
 * Assumes migration filenames sort lexicographically into apply order
 * (the NNN_ prefix convention) and that a populated DB matches the current
 * file set at adoption time (true here — see docs/current/migrations.md).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LEDGER_TABLE = 'schema_migrations';
// A table that exists on any real Fin DB but not on an empty one. Used only to
// tell "populated DB adopting the ledger" from "truly fresh DB".
const SENTINEL_TABLE = 'accounts';

/** List *.sql migration files in apply order (lexicographic == numeric here). */
function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function checksum(contents) {
  return crypto.createHash('md5').update(contents).digest('hex');
}

/**
 * Pure planning step — decide what to do without touching the DB.
 *
 * @param {string[]} allFiles       every migration filename, apply order
 * @param {Set<string>} appliedSet  filenames already in the ledger
 * @param {boolean} ledgerExisted   did schema_migrations exist before this run?
 * @param {boolean} schemaPopulated does the sentinel table exist?
 * @param {boolean} forceBaseline   --baseline flag
 * @returns {{mode:'baseline'|'apply', pending:string[], baseline:string[]}}
 */
function planMigrations(allFiles, appliedSet, ledgerExisted, schemaPopulated, forceBaseline) {
  // Baseline when explicitly asked, or on first adoption of an already-populated
  // DB (ledger absent + schema present). Records-without-running.
  const shouldBaseline = forceBaseline || (!ledgerExisted && schemaPopulated);
  if (shouldBaseline) {
    const baseline = allFiles.filter((f) => !appliedSet.has(f));
    return { mode: 'baseline', pending: [], baseline };
  }
  const pending = allFiles.filter((f) => !appliedSet.has(f));
  return { mode: 'apply', pending, baseline: [] };
}

async function ledgerExists(client, table = LEDGER_TABLE) {
  const r = await client.query('SELECT to_regclass($1) AS oid', [`public.${table}`]);
  return r.rows[0].oid !== null;
}

async function tableExists(client, table) {
  const r = await client.query('SELECT to_regclass($1) AS oid', [`public.${table}`]);
  return r.rows[0].oid !== null;
}

async function ensureLedger(client, table = LEDGER_TABLE) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      filename    text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      baselined   boolean NOT NULL DEFAULT false
    )
  `);
}

/**
 * Run pending migrations (or baseline). Side-effecting.
 *
 * @param {object} opts
 * @param {import('pg').Pool} opts.pool
 * @param {string} [opts.dir]     migrations dir (override for tests)
 * @param {string} [opts.table]   ledger table (override for tests)
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.baseline]
 * @param {string}  [opts.sentinel]
 * @param {(m:string)=>void} [opts.log]
 * @returns {Promise<{mode:string, applied:string[], baselined:string[], drift:string[], skipped:number}>}
 */
async function runMigrations(opts = {}) {
  const {
    pool,
    dir = MIGRATIONS_DIR,
    table = LEDGER_TABLE,
    dryRun = false,
    baseline = false,
    sentinel = SENTINEL_TABLE,
    log = () => {},
  } = opts;

  const client = await pool.connect();
  try {
    const allFiles = listMigrationFiles(dir);
    const hadLedger = await ledgerExists(client, table);
    const schemaPopulated = await tableExists(client, sentinel);

    const appliedSet = new Set();
    const appliedChecksums = new Map();
    if (hadLedger) {
      const r = await client.query(`SELECT filename, checksum FROM ${table}`);
      for (const row of r.rows) {
        appliedSet.add(row.filename);
        appliedChecksums.set(row.filename, row.checksum);
      }
    }

    // Checksum drift on already-applied files — surface, don't fail (the exact
    // class that bit CI when a live column was never captured in a migration).
    const drift = [];
    for (const f of allFiles) {
      if (appliedSet.has(f)) {
        const cur = checksum(fs.readFileSync(path.join(dir, f), 'utf8'));
        const rec = appliedChecksums.get(f);
        if (rec && rec !== cur) drift.push(f);
      }
    }
    for (const f of drift) {
      log(`⚠ drift: ${f} was edited after it was applied (ledger checksum ≠ file)`);
    }

    const plan = planMigrations(allFiles, appliedSet, hadLedger, schemaPopulated, baseline);

    if (dryRun) {
      if (plan.mode === 'baseline') {
        log(`[dry-run] would BASELINE ${plan.baseline.length} file(s) as already-applied (no SQL run):`);
        plan.baseline.forEach((f) => log(`  baseline  ${f}`));
      } else {
        log(`[dry-run] would APPLY ${plan.pending.length} pending file(s):`);
        plan.pending.forEach((f) => log(`  apply     ${f}`));
      }
      return { mode: plan.mode, applied: [], baselined: [], drift, skipped: appliedSet.size };
    }

    await ensureLedger(client, table);

    if (plan.mode === 'baseline') {
      log(`Adopting existing schema — baselining ${plan.baseline.length} migration(s) as already-applied (running none):`);
      for (const f of plan.baseline) {
        const sum = checksum(fs.readFileSync(path.join(dir, f), 'utf8'));
        await client.query(
          `INSERT INTO ${table} (filename, checksum, baselined) VALUES ($1, $2, true)
           ON CONFLICT (filename) DO NOTHING`,
          [f, sum]
        );
        log(`  baselined ${f}`);
      }
      return { mode: 'baseline', applied: [], baselined: plan.baseline, drift, skipped: appliedSet.size };
    }

    if (plan.pending.length === 0) {
      log(`No pending migrations. ${appliedSet.size} already applied.`);
      return { mode: 'apply', applied: [], baselined: [], drift, skipped: appliedSet.size };
    }

    const applied = [];
    for (const f of plan.pending) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      const sum = checksum(sql);
      // Each migration in its own transaction: a mid-file failure rolls that
      // file back and aborts the run, leaving a clean, resumable ledger.
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO ${table} (filename, checksum) VALUES ($1, $2)`,
          [f, sum]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        log(`✗ ${f} failed — rolled back, run aborted: ${err.message}`);
        throw new Error(`Migration ${f} failed: ${err.message}`);
      }
      applied.push(f);
      log(`✓ applied   ${f}`);
    }
    log(`Applied ${applied.length} migration(s); ${appliedSet.size} were already present.`);
    return { mode: 'apply', applied, baselined: [], drift, skipped: appliedSet.size };
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const baseline = args.includes('--baseline');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await runMigrations({ pool, dryRun, baseline, log: (m) => console.log(m) });
    if (result.drift.length) {
      console.log(`\nNote: ${result.drift.length} applied migration(s) show checksum drift (see above).`);
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  listMigrationFiles,
  checksum,
  planMigrations,
  runMigrations,
  ledgerExists,
  tableExists,
  ensureLedger,
  LEDGER_TABLE,
  SENTINEL_TABLE,
  MIGRATIONS_DIR,
};
