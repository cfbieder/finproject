#!/usr/bin/env node
'use strict';
/**
 * seed-ps-lower-cutoffs.js — set per-account PS *lower* cutoffs (CR023 §4.A, symmetric).
 *
 * The mirror of seed-bankfeed-cutoffs.js. That script sets the UPPER boundary on the
 * bank-feed mapping (PS owns < cutoff, feed owns >= cutoff). This script sets the LOWER
 * boundary on the POCKETSMITH mapping: PS owns >= its own promote_from_date; an earlier
 * backfill source (e.g. quicken-import) owns everything before it.
 *
 * Why this exists: PS dedups on ps_id against the LIVE transactions table, so a deleted
 * pre-handoff PS row (one the backfill source already covers) looks "new" on the next
 * sync and resurrects — staging persists and the PS fetch is updated_since-based, not
 * date-bounded. Setting the PS mapping's promote_from_date makes syncStagingToTransactions
 * skip that era for good (the clause is dormant when promote_from_date IS NULL).
 *
 * NOT auto-derived. The handoff date is an operator decision (quicken_last + 1 would
 * re-admit any post-quicken/pre-PS-history dup tail), so each account's cutoff is listed
 * explicitly below and reviewed. The script prints the backfill-source coverage + current
 * PS min date as a sanity context next to each configured date.
 *
 * Set-once: only writes where promote_from_date IS NULL, so a cutoff is FIXED on first
 * apply and re-runs are no-ops. To change a set cutoff, clear it manually first.
 *
 * Usage:
 *   node seed-ps-lower-cutoffs.js            # dry-run
 *   node seed-ps-lower-cutoffs.js --apply    # set them (where NULL)
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 *
 * To onboard another Quicken-backfilled account (e.g. Chase): add a { account_id, date }
 * row below, where date = the day PS legitimately starts owning (the operator's handoff).
 */

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL ||
  (() => { throw new Error('DATABASE_URL must be set — no insecure default'); })();

// The backfill source that owns the pre-handoff era (used only for sanity context).
const BACKFILL_SOURCE = 'quicken-import';

// Explicit, operator-reviewed handoff dates: PS promotes its own rows on/after `date`.
const CUTOFFS = [
  { account_id: 18, date: '2022-12-01', note: 'PKO main — Quicken owns <=2022-11-26' },
  // Add Chase / other Quicken-backfilled accounts here as they are cut over.
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
    for (const c of CUTOFFS) {
      const ps = (await pool.query(
        `SELECT a.name,
                (SELECT promote_from_date::text FROM account_source_mappings
                  WHERE source='pocketsmith' AND account_id=$1 AND promote_from_date IS NOT NULL LIMIT 1) AS existing,
                (SELECT MAX(transaction_date)::text FROM transactions WHERE source=$2 AND account_id=$1) AS backfill_last,
                (SELECT MIN(transaction_date)::text FROM transactions WHERE source='pocketsmith' AND account_id=$1) AS ps_min
         FROM accounts a WHERE a.id=$1`,
        [c.account_id, BACKFILL_SOURCE]
      )).rows[0];

      if (!ps) { results.push({ ...c, name: '(missing account)', action: 'SKIPPED — no such account' }); continue; }

      let action;
      if (ps.existing) {
        action = `kept ${ps.existing}`;
      } else {
        action = `${args.apply ? 'set' : 'would set'} ${c.date}`;
        if (args.apply) {
          await pool.query(
            `UPDATE account_source_mappings SET promote_from_date=$2
             WHERE source='pocketsmith' AND account_id=$1 AND promote_from_date IS NULL`,
            [c.account_id, c.date]
          );
        }
      }
      results.push({ ...c, name: ps.name, backfill_last: ps.backfill_last, ps_min: ps.ps_min, action });
    }
  } finally {
    await pool.end();
  }

  console.log(`\nPS lower cutoffs (CR023 §4.A) — ${args.apply ? 'APPLIED (set where NULL)' : 'DRY-RUN'}\n`);
  for (const r of results) {
    console.log(`  ${String(r.account_id).padStart(3)} ${String(r.name).padEnd(22)} ${BACKFILL_SOURCE} last=${r.backfill_last || '(none)'}  PS min=${r.ps_min || '(none)'}  →  ${r.action}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('seed-ps-lower-cutoffs failed:', err.message);
  process.exit(1);
});
