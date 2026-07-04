'use strict';
/**
 * import-fc-assumptions.js (CR039) — one-time, idempotent import of
 * components/data/FCAssump.json into the forecast_assumptions table
 * (migration 034). Key order in the file becomes `ord`, so the
 * /forecast/assumptions response stays byte-identical after the cutover.
 *
 * Usage:  DATABASE_URL=postgres://… node src/v2/scripts/import-fc-assumptions.js
 * Re-running overwrites values from the file (file wins) — safe until the
 * DB-backed API goes live, after which this script should not be run again
 * (it would clobber DB edits with the stale file).
 */

const fs = require('fs');
const db = require('../db');
const { dataPaths } = require('../../utils/dataPaths');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const filePath = dataPaths.fcAssump;
  if (!fs.existsSync(filePath)) {
    console.error(`FCAssump.json not found at ${filePath}`);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const keys = Object.keys(doc);
  console.log(`Importing ${keys.length} top-level keys from ${filePath}: ${keys.join(', ')}`);

  await db.transaction(async (client) => {
    for (let i = 0; i < keys.length; i++) {
      await client.query(
        `INSERT INTO forecast_assumptions (key, value, ord)
         VALUES ($1, $2::json, $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, ord = EXCLUDED.ord, updated_at = NOW()`,
        [keys[i], JSON.stringify(doc[keys[i]]), i]
      );
    }
  });

  const check = await db.query(`SELECT key, ord FROM forecast_assumptions ORDER BY ord`);
  console.log('forecast_assumptions now holds:', check.rows.map((r) => `${r.ord}:${r.key}`).join(' '));
  await db.close();
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
