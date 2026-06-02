#!/usr/bin/env node
'use strict';
/**
 * copy-quicken-to-prod.js — land the dev Quicken backfill (staging + mappings +
 * batches) onto another DB (prod) for the re-run-on-prod cutover (CR019 §23, G2).
 *
 * The parse+map work was done on dev; this copies it to a fresh target so promote
 * can run there natively — WITHOUT re-uploading QIFs or re-mapping 156 names.
 *
 * What it copies (idempotent; safe to re-run):
 *   - quicken_import_batches: verbatim EXCEPT status reset to 'mapped' (so the
 *     target can promote them) and promoted_at/rolled_back_at cleared; the
 *     cutoff_overrides JSON keys (source account ids) are NAME-translated to the
 *     target's ids. ON CONFLICT (id) DO NOTHING — never clobbers a target batch.
 *   - quicken_staging / quicken_securities_staging / _security_master_staging /
 *     _price_staging: verbatim, preserving ids (so split_parent_id self-refs hold).
 *     Two-pass for quicken_staging (insert with split_parent_id NULL, then UPDATE)
 *     because the self-FK can't be satisfied within one multi-row insert.
 *     ON CONFLICT (id) DO NOTHING; target sequences advanced to max(id) after.
 *   - account_source_mappings WHERE source='quicken': account_id NAME-translated;
 *     id NOT copied (target assigns). ON CONFLICT (source, external_name) DO UPDATE.
 *
 * Translation: every source account referenced (by mappings + cutoff_overrides
 * keys) is resolved to the target by NAME (ids differ dev↔prod). Any name missing
 * or ambiguous in the target is a hard error — run seed-cr019-coa.js first and
 * confirm the base COA matches. No hardcoded account ids.
 *
 * Does NOT promote, run ps-anchor, or run retire-handoff — those are later §23
 * steps, run directly against the target.
 *
 * Usage:
 *   node copy-quicken-to-prod.js --target <prod-conn>            # dry-run (default)
 *   node copy-quicken-to-prod.js --target <prod-conn> --apply
 *   [--source <conn>]  # default: DATABASE_URL (dev)
 *
 * SAFETY: always run the dry-run first and review the name map + unresolved list.
 */

const { Pool } = require('pg');

const DEV = 'postgres://fin:findev123@localhost:5434/fin';
const STAGING_TABLES = [
  'quicken_staging',
  'quicken_securities_staging',
  'quicken_security_master_staging',
  'quicken_price_staging',
];

function parseArgs(argv) {
  const a = { source: process.env.DATABASE_URL || DEV, target: null, apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') a.source = argv[++i];
    else if (argv[i] === '--target') a.target = argv[++i];
    else if (argv[i] === '--apply') a.apply = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!a.target) throw new Error('--target <conn> is required');
  if (a.target === a.source) throw new Error('--target must differ from --source');
  return a;
}

async function columns(pool, table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => ({ name: r.column_name, isJson: r.data_type === 'json' || r.data_type === 'jsonb' }));
}

// Build (colList, placeholders, values) for an INSERT, JSON.stringify-ing json
// columns + casting them ::jsonb (node-pg would otherwise send a JS object/array
// as a Postgres array literal → "invalid input syntax for type json"). `overrides`
// replaces a column's value by name.
function buildInsert(cols, row, overrides = {}) {
  const names = cols.map((c) => c.name);
  const placeholders = [];
  const values = [];
  cols.forEach((c, i) => {
    let v = c.name in overrides ? overrides[c.name] : row[c.name];
    if (c.isJson) {
      placeholders.push(`$${i + 1}::jsonb`);
      values.push(v == null ? null : JSON.stringify(v));
    } else {
      placeholders.push(`$${i + 1}`);
      values.push(v);
    }
  });
  return { names, placeholders: placeholders.join(','), values };
}

// source account_id → target account_id, resolved by name. Throws listing any
// source id whose name is missing/ambiguous in target.
async function buildAccountMap(src, tgt, sourceIds) {
  const map = new Map();
  const unresolved = [];
  for (const id of sourceIds) {
    const { rows: sn } = await src.query('SELECT name FROM accounts WHERE id = $1', [id]);
    if (sn.length === 0) { unresolved.push(`src id ${id} (no such account in source)`); continue; }
    const name = sn[0].name;
    const { rows: tn } = await tgt.query('SELECT id FROM accounts WHERE name = $1', [name]);
    if (tn.length === 0) unresolved.push(`"${name}" (src id ${id}) — missing in target`);
    else if (tn.length > 1) unresolved.push(`"${name}" — ambiguous in target (${tn.length})`);
    else map.set(id, tn[0].id);
  }
  return { map, unresolved };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const src = new Pool({ connectionString: args.source });
  const tgt = new Pool({ connectionString: args.target });

  // Source account ids referenced: quicken mappings + cutoff_overrides keys.
  const { rows: mapRows } = await src.query(
    `SELECT id, account_id, external_name, COALESCE(ignored, false) AS ignored
       FROM account_source_mappings WHERE source = 'quicken'`
  );
  const { rows: batchRows } = await src.query(
    `SELECT * FROM quicken_import_batches WHERE status IN ('promoted','rolled_back','mapped')`
  );
  const referenced = new Set(mapRows.map((m) => m.account_id).filter((x) => x != null));
  for (const b of batchRows) {
    for (const k of Object.keys(b.cutoff_overrides || {})) referenced.add(parseInt(k, 10));
  }

  const { map, unresolved } = await buildAccountMap(src, tgt, [...referenced]);

  // Staging counts
  const counts = {};
  for (const t of STAGING_TABLES) {
    const { rows } = await src.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    counts[t] = rows[0].n;
  }

  console.log(`\ncopy-quicken-to-prod — ${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  source: ${args.source.replace(/:[^:@]*@/, ':***@')}`);
  console.log(`  target: ${args.target.replace(/:[^:@]*@/, ':***@')}\n`);
  console.log(`  batches: ${batchRows.length} | quicken mappings: ${mapRows.length} | referenced accounts: ${referenced.size}`);
  for (const t of STAGING_TABLES) console.log(`  ${t}: ${counts[t]}`);
  console.log('');

  if (unresolved.length) {
    console.log(`✗ ${unresolved.length} account name(s) UNRESOLVED in target — fix before --apply:`);
    for (const u of unresolved) console.log(`    ${u}`);
    console.log('\n  (run seed-cr019-coa.js on the target; confirm the base PS COA matches by name)\n');
    await src.end(); await tgt.end();
    process.exit(1);
  }
  console.log(`✓ all ${referenced.size} referenced accounts resolve by name in target.`);

  if (!args.apply) {
    console.log('\nDRY-RUN — pass --apply to copy. (Re-run is idempotent.)\n');
    await src.end(); await tgt.end();
    return;
  }

  const batchCols = await columns(src, 'quicken_import_batches');
  const tc = await tgt.connect();
  let copiedBatches = 0, copiedMappings = 0;
  const copiedStaging = {};
  try {
    await tc.query('BEGIN');

    // 1. batches — status reset to 'mapped', cutoff_overrides keys translated.
    for (const b of batchRows) {
      const overrides = b.cutoff_overrides
        ? Object.fromEntries(Object.entries(b.cutoff_overrides).map(([k, v]) => [String(map.get(parseInt(k, 10))), v]))
        : null;
      const { names, placeholders, values } = buildInsert(batchCols, b, {
        status: 'mapped', promoted_at: null, rolled_back_at: null, cutoff_overrides: overrides,
      });
      const res = await tc.query(
        `INSERT INTO quicken_import_batches (${names.join(',')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
        values
      );
      copiedBatches += res.rowCount;
    }

    // 2. mappings — account_id translated, id omitted (target assigns).
    for (const m of mapRows) {
      const res = await tc.query(
        `INSERT INTO account_source_mappings (account_id, source, external_name, ignored)
         VALUES ($1, 'quicken', $2, $3)
         ON CONFLICT (source, external_name) DO UPDATE SET account_id = EXCLUDED.account_id, ignored = EXCLUDED.ignored`,
        [map.get(m.account_id), m.external_name, m.ignored]
      );
      copiedMappings += res.rowCount;
    }

    // 3. staging tables — verbatim, preserving ids.
    for (const t of STAGING_TABLES) {
      if (counts[t] === 0) { copiedStaging[t] = 0; continue; }
      const cols = await columns(src, t);
      const colNames = cols.map((c) => c.name);
      const hasSplit = colNames.includes('split_parent_id');
      const { rows } = await src.query(`SELECT ${colNames.join(',')} FROM ${t} ORDER BY id`);
      let n = 0;
      for (const r of rows) {
        // pass A: insert with split_parent_id NULL (self-FK satisfied later)
        const { names, placeholders, values } = buildInsert(cols, r, hasSplit ? { split_parent_id: null } : {});
        const res = await tc.query(
          `INSERT INTO ${t} (${names.join(',')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
          values
        );
        n += res.rowCount;
      }
      // pass B: set split_parent_id now that all rows exist
      if (hasSplit) {
        for (const r of rows) {
          if (r.split_parent_id != null) {
            await tc.query(`UPDATE ${t} SET split_parent_id = $1 WHERE id = $2`, [r.split_parent_id, r.id]);
          }
        }
      }
      // advance the target sequence past the copied ids
      await tc.query(
        `SELECT setval(pg_get_serial_sequence($1,'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM ${t}), 1))`,
        [t]
      );
      copiedStaging[t] = n;
    }

    await tc.query('COMMIT');
  } catch (e) {
    await tc.query('ROLLBACK');
    throw e;
  } finally {
    tc.release();
  }

  console.log(`\nAPPLIED:`);
  console.log(`  batches inserted: ${copiedBatches} (existing skipped)`);
  console.log(`  mappings upserted: ${copiedMappings}`);
  for (const t of STAGING_TABLES) console.log(`  ${t} inserted: ${copiedStaging[t]}`);

  // verify counts match (target >= source for each)
  const problems = [];
  for (const t of STAGING_TABLES) {
    const { rows } = await tgt.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    if (rows[0].n < counts[t]) problems.push(`${t}: target ${rows[0].n} < source ${counts[t]}`);
  }
  console.log(problems.length ? `\n⚠ count mismatch: ${problems.join('; ')}` : `\n✓ target staging counts ≥ source.`);
  await src.end(); await tgt.end();
}

main().catch((e) => { console.error('copy-quicken-to-prod FAILED:', e.message); process.exit(1); });
