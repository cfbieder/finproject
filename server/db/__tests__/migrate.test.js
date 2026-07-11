'use strict';
/**
 * migrate.test.js — CR043 Phase 1.1 migration runner.
 *
 * Pure planning tests always run. The integration block (DB-backed, skip with
 * SKIP_DB_TESTS=1) exercises real apply/idempotency/baseline/drift against a
 * SCRATCH ledger table + a temp migrations dir writing THROWAWAY tables — it
 * never touches app tables or the real schema_migrations ledger. Everything it
 * creates is dropped in afterAll.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  planMigrations,
  runMigrations,
  checksum,
  listMigrationFiles,
} = require('../migrate');

describe('planMigrations (pure)', () => {
  const files = ['001_a.sql', '002_b.sql', '003_c.sql'];

  test('adoption: no ledger + populated schema → baseline all, apply none', () => {
    const p = planMigrations(files, new Set(), /*ledgerExisted*/ false, /*schemaPopulated*/ true, false);
    expect(p.mode).toBe('baseline');
    expect(p.baseline).toEqual(files);
    expect(p.pending).toEqual([]);
  });

  test('fresh install: no ledger + empty schema → apply all', () => {
    const p = planMigrations(files, new Set(), false, /*schemaPopulated*/ false, false);
    expect(p.mode).toBe('apply');
    expect(p.pending).toEqual(files);
  });

  test('incremental: ledger present → apply only the gap, in order', () => {
    const p = planMigrations(files, new Set(['001_a.sql', '002_b.sql']), true, true, false);
    expect(p.mode).toBe('apply');
    expect(p.pending).toEqual(['003_c.sql']);
  });

  test('up to date: ledger present, all applied → nothing pending', () => {
    const p = planMigrations(files, new Set(files), true, true, false);
    expect(p.mode).toBe('apply');
    expect(p.pending).toEqual([]);
  });

  test('--baseline forces baseline even when the ledger already exists', () => {
    const p = planMigrations(files, new Set(['001_a.sql']), true, true, /*forceBaseline*/ true);
    expect(p.mode).toBe('baseline');
    // only the not-yet-recorded files get baselined
    expect(p.baseline).toEqual(['002_b.sql', '003_c.sql']);
  });
});

describe('listMigrationFiles (real dir)', () => {
  test('returns the NNN_*.sql files in sorted order', () => {
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThan(30);
    expect(files[0]).toBe('001_initial_schema.sql');
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });
});

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('runMigrations (DB integration, scratch objects only)', () => {
  const db = require('../../src/v2/db');
  const TABLE = '_cr043_schema_migrations_test';
  const T1 = '_cr043_mig_one';
  const T2 = '_cr043_mig_two';
  let tmpDir;
  let pool;

  beforeAll(() => {
    pool = db.getPool();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr043-mig-'));
    fs.writeFileSync(path.join(tmpDir, '001_one.sql'), `CREATE TABLE ${T1} (id int);`);
    fs.writeFileSync(path.join(tmpDir, '002_two.sql'), `CREATE TABLE ${T2} (id int);`);
  });

  async function drop() {
    await pool.query(`DROP TABLE IF EXISTS ${T1}, ${T2}`);
    await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
  }

  beforeEach(drop);

  afterAll(async () => {
    await drop();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    await db.close();
  });

  const run = (over = {}) =>
    runMigrations({ pool, dir: tmpDir, table: TABLE, sentinel: T1, log: () => {}, ...over });

  test('fresh (sentinel absent): applies both and records them; re-run is a no-op', async () => {
    const first = await run();
    expect(first.mode).toBe('apply');
    expect(first.applied).toEqual(['001_one.sql', '002_two.sql']);

    // Both throwaway tables now exist.
    const t1 = await pool.query(`SELECT to_regclass('public.${T1}') AS o`);
    expect(t1.rows[0].o).not.toBeNull();

    const ledger = await pool.query(`SELECT filename FROM ${TABLE} ORDER BY filename`);
    expect(ledger.rows.map((r) => r.filename)).toEqual(['001_one.sql', '002_two.sql']);

    const second = await run();
    expect(second.applied).toEqual([]);
    expect(second.skipped).toBe(2);
  });

  test('incremental: a new file applies without re-running the earlier one', async () => {
    await run(); // applies 001+002
    fs.writeFileSync(path.join(tmpDir, '003_three.sql'), `CREATE TABLE _cr043_mig_three (id int);`);
    try {
      const r = await run();
      expect(r.applied).toEqual(['003_three.sql']);
    } finally {
      await pool.query('DROP TABLE IF EXISTS _cr043_mig_three');
      fs.rmSync(path.join(tmpDir, '003_three.sql'), { force: true });
    }
  });

  test('adoption/baseline: sentinel present + no ledger → records both, runs neither', async () => {
    // Pre-create the sentinel so the DB looks "already populated".
    await pool.query(`CREATE TABLE ${T1} (id int)`);
    const r = await run();
    expect(r.mode).toBe('baseline');
    expect(r.baselined).toEqual(['001_one.sql', '002_two.sql']);
    // 002's table was NOT created (baseline runs no SQL).
    const t2 = await pool.query(`SELECT to_regclass('public.${T2}') AS o`);
    expect(t2.rows[0].o).toBeNull();
    const ledger = await pool.query(`SELECT filename, baselined FROM ${TABLE} ORDER BY filename`);
    expect(ledger.rows.every((row) => row.baselined === true)).toBe(true);
  });

  test('drift: editing an applied file surfaces a checksum warning, not a failure', async () => {
    await run();
    fs.writeFileSync(path.join(tmpDir, '002_two.sql'), `CREATE TABLE ${T2} (id int, note text);`);
    try {
      const r = await run();
      expect(r.drift).toContain('002_two.sql');
      expect(r.applied).toEqual([]); // still recorded as applied — not re-run
    } finally {
      fs.writeFileSync(path.join(tmpDir, '002_two.sql'), `CREATE TABLE ${T2} (id int);`);
    }
  });

  test('dry-run writes nothing (no ledger table created)', async () => {
    const r = await run({ dryRun: true });
    expect(r.applied).toEqual([]);
    const exists = await pool.query(`SELECT to_regclass('public.${TABLE}') AS o`);
    expect(exists.rows[0].o).toBeNull();
  });
});
