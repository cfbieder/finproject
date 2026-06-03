#!/usr/bin/env node
'use strict';
/**
 * seed-cr024-fidelity-cutoffs.js — CR024 Phase 2 cutover gate seed.
 *
 * Sets `account_source_mappings.promote_from_date` for the 5 Fidelity accounts so
 * the bank feed takes over cash flow exactly where PocketSmith stops, with no
 * double-count overlap: cutoff = (max PocketSmith transaction_date on that fin
 * account) + 1 day. PS owns dates before the cutoff; bank-feed promotes from it.
 *
 * Set-once: only writes where promote_from_date IS NULL, so the cutoff is FIXED on
 * first apply and a later PS upload can't move it (re-runs are no-ops). Accounts
 * are resolved by the Fidelity feed UUIDs (same on dev/prod). Requires migration
 * 027. The mapping must exist (run seed-cr024-fidelity-mappings.js first).
 *
 * Usage:
 *   node seed-cr024-fidelity-cutoffs.js            # dry-run: show derived cutoffs
 *   node seed-cr024-fidelity-cutoffs.js --apply    # set them (where NULL)
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 */

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL || 'postgres://fin:findev123@localhost:5434/fin';

const SOURCE = 'bank-feed';
const FIDELITY_UUIDS = [
  '5216d738-82a9-4956-9b23-aff70d07c827', // IRA → 26
  '4edb12ab-749d-4e1f-bbe4-5d31aaee30d8', // Stocks → 27
  '3bd9f941-8d06-4302-8950-35b532cebbaa', // Options → 28
  'e5a23070-13bb-49af-8f2d-e552e159b570', // Cash Mgt → 30
  'e420ad75-9a54-4c3b-b98a-5adbd8b6061e', // Bond → 31
];

function parseArgs(argv) {
  const args = { apply: false };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: CONN_STR });
  const results = [];
  try {
    for (const uuid of FIDELITY_UUIDS) {
      const m = (await pool.query(
        'SELECT account_id, promote_from_date FROM account_source_mappings WHERE source=$1 AND external_name=$2',
        [SOURCE, uuid]
      )).rows[0];
      if (!m) { results.push({ uuid, note: 'NO MAPPING (run seed-cr024-fidelity-mappings.js first)' }); continue; }

      const psLast = (await pool.query(
        `SELECT MAX(transaction_date)::text AS last FROM transactions WHERE source='pocketsmith' AND account_id=$1`,
        [m.account_id]
      )).rows[0].last;
      // cutoff = PS last + 1 day (date arithmetic in SQL for correctness)
      const cutoff = psLast
        ? (await pool.query(`SELECT ($1::date + 1)::text AS c`, [psLast])).rows[0].c
        : null;

      const existing = m.promote_from_date;
      if (args.apply && existing == null && cutoff) {
        await pool.query(
          'UPDATE account_source_mappings SET promote_from_date=$3 WHERE source=$1 AND external_name=$2 AND promote_from_date IS NULL',
          [SOURCE, uuid, cutoff]
        );
      }
      results.push({
        account_id: m.account_id, uuid, ps_last: psLast, cutoff,
        existing: existing ? String(existing).slice(0, 10) : null,
      });
    }
  } finally {
    await pool.end();
  }

  const mode = args.apply ? 'APPLIED (set where NULL)' : 'DRY-RUN (no --apply)';
  console.log(`\nCR024 Fidelity cutover cutoffs — ${mode}\n`);
  for (const r of results) {
    if (r.note) { console.log(`  ${r.uuid}: ${r.note}`); continue; }
    const state = r.existing ? `already set: ${r.existing} (kept)` : `would set: ${r.cutoff}`;
    console.log(`  account ${r.account_id}: PS last=${r.ps_last} → bank-feed owns from ${r.cutoff}   [${r.existing ? state : (args.apply ? 'set ' + r.cutoff : state)}]`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('seed-cr024-fidelity-cutoffs failed:', err.message);
  process.exit(1);
});
