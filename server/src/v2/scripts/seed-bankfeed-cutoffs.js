#!/usr/bin/env node
'use strict';
/**
 * seed-bankfeed-cutoffs.js — set per-account cutover cutoffs for the bank feed.
 *
 * The general "controlled switchover" tool: for each MAPPED, non-ignored bank-feed
 * account, set `account_source_mappings.promote_from_date` = (that fin account's
 * last PocketSmith transaction_date) + 1. PS owns dates before the cutoff; the bank
 * feed promotes from it on — so when PS is turned off for an account, the bank feed
 * takes over with zero double-count overlap (the dedup path's weakness on recurring
 * identical charges can't bite, since there's no overlap to mis-merge).
 *
 * Set-once: only writes where promote_from_date IS NULL, so a cutoff is FIXED on
 * first apply and re-runs are no-ops (a later stray PS row can't move it). Accounts
 * with no PS history are skipped (nothing to anchor to — they were always bank-feed).
 * Generalises seed-cr024-fidelity-cutoffs.js to every account; run it after you
 * un-ignore each account you're switching over.
 *
 * Usage:
 *   node seed-bankfeed-cutoffs.js                       # dry-run, all mapped accounts
 *   node seed-bankfeed-cutoffs.js --apply               # set them (where NULL)
 *   node seed-bankfeed-cutoffs.js --accounts 18,67,69   # restrict to these fin account ids
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 */

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL || 'postgres://fin:findev123@localhost:5434/fin';

function parseArgs(argv) {
  const args = { apply: false, accounts: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--accounts') args.accounts = (argv[++i] || '').split(',').map((s) => parseInt(s, 10)).filter(Number.isFinite);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: CONN_STR });
  const results = [];
  try {
    const filter = args.accounts && args.accounts.length ? 'AND m.account_id = ANY($1)' : '';
    const params = args.accounts && args.accounts.length ? [args.accounts] : [];
    const mappings = (await pool.query(
      `SELECT m.account_id, m.external_name, m.promote_from_date, a.name
       FROM account_source_mappings m JOIN accounts a ON a.id = m.account_id
       WHERE m.source = 'bank-feed' AND m.ignored = FALSE AND m.account_id IS NOT NULL ${filter}
       ORDER BY m.account_id`,
      params
    )).rows;

    for (const m of mappings) {
      const psLast = (await pool.query(
        `SELECT MAX(transaction_date)::text AS last FROM transactions WHERE source='pocketsmith' AND account_id=$1`,
        [m.account_id]
      )).rows[0].last;
      const cutoff = psLast
        ? (await pool.query(`SELECT ($1::date + 1)::text AS c`, [psLast])).rows[0].c
        : null;

      let action;
      if (m.promote_from_date) action = `kept ${String(m.promote_from_date).slice(0, 10)}`;
      else if (!cutoff) action = 'skipped (no PS history)';
      else {
        action = `${args.apply ? 'set' : 'would set'} ${cutoff}`;
        if (args.apply) {
          await pool.query(
            `UPDATE account_source_mappings SET promote_from_date=$2
             WHERE source='bank-feed' AND external_name=$1 AND promote_from_date IS NULL`,
            [m.external_name, cutoff]
          );
        }
      }
      results.push({ account_id: m.account_id, name: m.name, ps_last: psLast, action });
    }
  } finally {
    await pool.end();
  }

  console.log(`\nbank-feed cutover cutoffs — ${args.apply ? 'APPLIED (set where NULL)' : 'DRY-RUN'}\n`);
  for (const r of results) {
    console.log(`  ${String(r.account_id).padStart(3)} ${String(r.name).padEnd(22)} PS last=${r.ps_last || '(none)'}  →  ${r.action}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('seed-bankfeed-cutoffs failed:', err.message);
  process.exit(1);
});
