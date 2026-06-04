#!/usr/bin/env node
'use strict';
/**
 * mtm-reconcile.js — monthly batch: post the Unrealized-G/L (MTM) entry for every
 * bank-feed brokerage account (`reconcile_mode='mtm'`) for a target month-end.
 *
 * Human-run, never on a cron (a feed gap must surface as drift, not be silently
 * absorbed). Cash calibration is deliberately NOT done here — it is on-demand via
 * the "Reconcile to feed" button after investigating drift, because auto-calibrating
 * cash would bury a missing-transaction gap in opening_balance.
 *
 * Each per-account call is the shared, idempotent reconcileToFeed() engine
 * (delete-then-insert this month's mtm row), so re-runs are safe.
 *
 * Usage (DATABASE_URL selects the DB — dev :5434 / prod :5433):
 *   DATABASE_URL=postgres://fin:findev123@localhost:5434/fin node mtm-reconcile.js
 *   DATABASE_URL=... node mtm-reconcile.js --apply
 *   DATABASE_URL=... node mtm-reconcile.js --month 2026-05 --apply
 */

const db = require('../db');
const { reconcileToFeed } = require('../services/reconcileToFeed');

function parseArgs(argv) {
  const args = { apply: false, month: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') args.apply = true;
    else if (argv[i] === '--month') args.month = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (args.month && !/^\d{4}-\d{2}$/.test(args.month)) {
    throw new Error(`--month must be YYYY-MM (got ${args.month})`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Resolve target month-end: end of --month, else null (engine → latest completed).
  let asOf = null;
  if (args.month) {
    asOf = (await db.query(
      `SELECT (date_trunc('month', ($1 || '-01')::date) + interval '1 month - 1 day')::date::text AS d`,
      [args.month]
    )).rows[0].d;
  }

  const accts = (await db.query(
    `SELECT account_id FROM account_source_mappings
     WHERE source = 'bank-feed' AND reconcile_mode = 'mtm'
       AND ignored = FALSE AND account_id IS NOT NULL
     ORDER BY account_id`
  )).rows;

  const results = [];
  for (const a of accts) {
    try {
      results.push(await reconcileToFeed(a.account_id, { asOf, dryRun: !args.apply }));
    } catch (err) {
      results.push({ account_id: a.account_id, error: err.message });
    }
  }

  console.table(results.map((r) => ({
    acct: r.account_id,
    name: r.name,
    month_end: r.month_end,
    feed: r.feed_balance,
    computed: r.computed_excl_mtm,
    mtm: r.mtm_amount,
    override_removed: r.removed_read_override,
    applied: r.applied,
    note: r.note || r.error || '',
  })));
  console.log(args.apply ? 'Applied.' : 'Dry-run (pass --apply to write).');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
