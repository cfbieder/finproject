#!/usr/bin/env node
'use strict';
/**
 * ps-exit-monitor.js — CR023 PocketSmith-removal exit gate (read-only).
 *
 * Reports which active balance-sheet accounts are STILL PS-dependent: a non-fed,
 * non-ignored fin account with `source='pocketsmith'` rows inside the recency
 * window. This is the live gate for CR023 §6 — when the count reaches 0, every
 * active account is either on a direct feed or has stopped receiving PS data
 * (migrated to manual/CR025 or frozen), and PS removal can be scheduled.
 *
 * Per-account dispositions live in CR023_PS_MIGRATION_TRACKER.md; this script is
 * the live signal only (it does not know intended dispositions, just real data).
 *
 * Read-only: SELECT only, writes nothing. Safe against prod.
 *
 * Usage:
 *   node ps-exit-monitor.js                 # window = last 45 days
 *   node ps-exit-monitor.js --days 30       # custom window
 *   node ps-exit-monitor.js --json          # machine-readable
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 */

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL || 'postgres://fin:findev123@localhost:5434/fin';

function parseArgs(argv) {
  const args = { days: 45, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') args.days = parseInt(argv[++i], 10);
    else if (argv[i] === '--json') args.json = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!Number.isFinite(args.days) || args.days <= 0) throw new Error('--days must be a positive integer');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: CONN_STR });
  let report;
  try {
    // Coverage summary: of active balance-sheet accounts (any tx in last `days`),
    // how many are fed vs still PS-dependent.
    const dependent = (await pool.query(
      `WITH fed AS (
         SELECT account_id FROM account_source_mappings
         WHERE source='bank-feed' AND ignored=false AND account_id IS NOT NULL
       )
       SELECT a.id, a.name, a.account_type, a.currency,
              MAX(t.transaction_date)::text AS last_ps,
              COUNT(*) FILTER (WHERE t.transaction_date >= CURRENT_DATE - $1::int) AS ps_in_window
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.source='pocketsmith'
         AND a.section='balance_sheet'
         AND a.id NOT IN (SELECT account_id FROM fed)
       GROUP BY a.id, a.name, a.account_type, a.currency
       HAVING COUNT(*) FILTER (WHERE t.transaction_date >= CURRENT_DATE - $1::int) > 0
       ORDER BY MAX(t.transaction_date) DESC`,
      [args.days]
    )).rows;

    const fedCount = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM account_source_mappings
       WHERE source='bank-feed' AND ignored=false AND account_id IS NOT NULL`
    )).rows[0].n;

    report = { window_days: args.days, fed_accounts: fedCount, ps_dependent_count: dependent.length, ps_dependent: dependent };
  } finally {
    await pool.end();
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\nCR023 PS-removal exit gate — window: last ${report.window_days} days\n`);
  console.log(`  fed accounts (cut over): ${report.fed_accounts}`);
  console.log(`  STILL PS-DEPENDENT:      ${report.ps_dependent_count}\n`);
  if (report.ps_dependent_count === 0) {
    console.log('  ✓ EXIT GATE MET — no active account depends on PS for new data.\n');
  } else {
    for (const r of report.ps_dependent) {
      console.log(
        `   ${String(r.id).padStart(3)} ${String(r.name).padEnd(26)} ${String(r.account_type).padEnd(9)} ${String(r.currency).padEnd(3)}  last PS=${r.last_ps}  (${r.ps_in_window} in window)`
      );
    }
    console.log(`\n  ✗ EXIT GATE NOT MET — ${report.ps_dependent_count} account(s) still PS-dependent. See CR023_PS_MIGRATION_TRACKER.md for dispositions.\n`);
  }
}

main().catch((err) => {
  console.error('ps-exit-monitor failed:', err.message);
  process.exit(1);
});
