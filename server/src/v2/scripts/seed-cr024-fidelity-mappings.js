#!/usr/bin/env node
'use strict';
/**
 * seed-cr024-fidelity-mappings.js — idempotent CR024 Phase 1 mapping seed.
 *
 * Maps the 5 Fidelity feed accounts to their fin balance-sheet accounts and flags
 * them balance_from_feed=TRUE, so the balance sheet reads market value from
 * bankfeed_balances (the read-override) instead of opening_balance+Σtx.
 *
 * Phase 1 keeps each account ignored=TRUE (its transactions stay suppressed in
 * bankfeed_staging — the activity categorizer is Phase 2). So this seed sets
 * balance_from_feed WITHOUT un-ignoring: on a fresh insert it writes ignored=TRUE;
 * on an existing row it leaves ignored untouched (never clobbers a deliberate
 * un-ignore — Phase 2 owns that flip).
 *
 * The "Individual" feed account is intentionally NOT mapped (stays ignored/pending,
 * per the user's instruction).
 *
 * Feed UUIDs are SnapTrade-stable and identical on dev and prod (one bank-feed
 * service feeds both). Fin accounts are resolved BY NAME (no hardcoded ids), so
 * the seed runs against any DB. Requires migration 025 (balance_from_feed,
 * trade_treatment, bankfeed_balances) applied first.
 *
 * Usage:
 *   node seed-cr024-fidelity-mappings.js            # dry-run: report would-write
 *   node seed-cr024-fidelity-mappings.js --apply    # write the mappings
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 */

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL ||
  (() => { throw new Error('DATABASE_URL must be set — no insecure default'); })();

const SOURCE = 'bank-feed';

// feed_external_id (SnapTrade UUID) → fin account NAME + Phase-2 trade_treatment.
// trade_treatment governs BUY/SELL routing in Phase 2 only; set now since known.
const FIDELITY_MAPPINGS = [
  { external_id: '5216d738-82a9-4956-9b23-aff70d07c827', account_name: 'Fidelity IRA',      trade_treatment: 'offset' },
  { external_id: '4edb12ab-749d-4e1f-bbe4-5d31aaee30d8', account_name: 'Fidelity Stocks',   trade_treatment: 'offset' },
  { external_id: '3bd9f941-8d06-4302-8950-35b532cebbaa', account_name: 'Fidelity Options',  trade_treatment: 'income' },
  { external_id: 'e5a23070-13bb-49af-8f2d-e552e159b570', account_name: 'Fidelity Cash Mgt', trade_treatment: 'offset' },
  { external_id: 'e420ad75-9a54-4c3b-b98a-5adbd8b6061e', account_name: 'Fidelity Bond',     trade_treatment: 'offset' },
];

function parseArgs(argv) {
  const args = { apply: false };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function resolveAccountId(client, name) {
  const { rows } = await client.query('SELECT id FROM accounts WHERE name = $1', [name]);
  if (rows.length === 0) throw new Error(`fin account not found by name: "${name}"`);
  if (rows.length > 1) throw new Error(`fin account name is ambiguous: "${name}" (${rows.length} matches)`);
  return rows[0].id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: CONN_STR });
  const results = [];
  try {
    for (const m of FIDELITY_MAPPINGS) {
      const accountId = await resolveAccountId(pool, m.account_name);
      const existing = (await pool.query(
        'SELECT account_id, ignored, balance_from_feed, trade_treatment FROM account_source_mappings WHERE source = $1 AND external_name = $2',
        [SOURCE, m.external_id]
      )).rows[0] || null;

      if (args.apply) {
        // Insert ignored=TRUE for a brand-new row; on conflict update only the
        // CR024 fields (account_id / balance_from_feed / trade_treatment) and
        // leave `ignored` as-is so a later Phase-2 un-ignore isn't clobbered.
        await pool.query(
          `INSERT INTO account_source_mappings
             (source, external_name, account_id, ignored, balance_from_feed, trade_treatment)
           VALUES ($1, $2, $3, TRUE, TRUE, $4)
           ON CONFLICT (source, external_name) DO UPDATE
             SET account_id = EXCLUDED.account_id,
                 balance_from_feed = EXCLUDED.balance_from_feed,
                 trade_treatment = EXCLUDED.trade_treatment`,
          [SOURCE, m.external_id, accountId, m.trade_treatment]
        );
      }
      results.push({
        account: m.account_name,
        account_id: accountId,
        external_id: m.external_id,
        trade_treatment: m.trade_treatment,
        was: existing ? `account_id=${existing.account_id} ignored=${existing.ignored} balance_from_feed=${existing.balance_from_feed}` : '(no row)',
      });
    }
  } finally {
    await pool.end();
  }

  const mode = args.apply ? 'APPLIED' : 'DRY-RUN (no --apply)';
  console.log(`\nCR024 Fidelity mappings — ${mode}\n`);
  for (const r of results) {
    console.log(`  ${r.account.padEnd(20)} -> account_id=${r.account_id}  treat=${r.trade_treatment}  balance_from_feed=TRUE  [before: ${r.was}]`);
  }
  console.log(`\n${results.length} accounts ${args.apply ? 'written' : 'would be written'}. Individual left ignored/unmapped (by design).\n`);
}

main().catch((err) => {
  console.error('seed-cr024-fidelity-mappings failed:', err.message);
  process.exit(1);
});
