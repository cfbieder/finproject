#!/usr/bin/env node
'use strict';
/**
 * seed-cr023-reconcile-modes.js — mark the bank-feed brokerage accounts 'mtm'.
 *
 * CR023 source-aware reconciliation: brokerage accounts recognize market moves
 * via a monthly Unrealized-G/L (category 88) adjustment entry, not a cash
 * opening-balance plug. This sets `account_source_mappings.reconcile_mode='mtm'`
 * on the true brokerage Fidelity accounts:
 *   26 Fidelity IRA · 27 Fidelity Stocks · 28 Fidelity Options · 31 Fidelity Bond
 * Fidelity Cash Mgt (30) is a CASH account and stays 'calibrate' (the default).
 * Every other mapped account stays 'calibrate'.
 *
 * Idempotent: re-runs are no-ops once the modes are set. Resolves account ids by
 * the mapping's fin account_id (NOT name), so it is DB-portable (dev/prod).
 *
 * Usage:
 *   node seed-cr023-reconcile-modes.js            # dry-run
 *   node seed-cr023-reconcile-modes.js --apply    # set reconcile_mode='mtm'
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 */

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL || 'postgres://fin:findev123@localhost:5434/fin';

// True brokerage (mark-to-market) bank-feed accounts. Cash Mgt (30) excluded.
const MTM_ACCOUNT_IDS = [26, 27, 28, 31];

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
    const rows = (await pool.query(
      `SELECT m.account_id, m.external_name, m.reconcile_mode, a.name
       FROM account_source_mappings m JOIN accounts a ON a.id = m.account_id
       WHERE m.source = 'bank-feed' AND m.account_id = ANY($1)
       ORDER BY m.account_id`,
      [MTM_ACCOUNT_IDS]
    )).rows;

    const found = new Set(rows.map((r) => r.account_id));
    for (const id of MTM_ACCOUNT_IDS) {
      if (!found.has(id)) results.push({ account_id: id, name: '(no bank-feed mapping)', action: 'skipped (unmapped)' });
    }

    for (const m of rows) {
      let action;
      if (m.reconcile_mode === 'mtm') action = "kept 'mtm'";
      else {
        action = args.apply ? "set 'mtm'" : "would set 'mtm'";
        if (args.apply) {
          await pool.query(
            `UPDATE account_source_mappings SET reconcile_mode='mtm'
             WHERE source='bank-feed' AND external_name=$1`,
            [m.external_name]
          );
        }
      }
      results.push({ account_id: m.account_id, name: m.name, was: m.reconcile_mode, action });
    }
  } finally {
    await pool.end();
  }

  console.table(results);
  console.log(args.apply ? 'Applied.' : 'Dry-run (pass --apply to write).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
