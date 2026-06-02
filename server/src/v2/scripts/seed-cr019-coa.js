#!/usr/bin/env node
'use strict';
/**
 * seed-cr019-coa.js — idempotent seeder for the CR019 chart-of-accounts objects
 * that the import pipeline depends on (containers, the Transfer-Historical leaf,
 * the value-only-promote income leaves, and the Fidelity historical container).
 *
 * Why: these 10 COA objects were hand-created on dev during CR019. The
 * re-run-on-prod cutover (CR019 §23) forbids manual SQL, so prod needs a
 * repeatable, idempotent way to create them. Promote resolves the income leaves
 * and Transfer-Historical BY NAME and fails loud if missing; ps-anchor /
 * retire-handoff resolve the Historical containers by name too.
 *
 * Create-by-name-if-absent: an object already present (matched by name) is left
 * untouched (attributes are NOT mutated — reported as "exists"). Parents are
 * resolved by NAME at insert time (so a parent created earlier in this same run
 * resolves), failing loud if a required parent is missing or ambiguous — no
 * hardcoded account ids, so it runs against any DB (dev or prod).
 *
 * Objects are listed in dependency order (containers before their children).
 *
 * Usage:
 *   node seed-cr019-coa.js            # dry-run: report exists/would-create
 *   node seed-cr019-coa.js --apply    # create missing objects
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 */

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL || 'postgres://fin:findev123@localhost:5434/fin';

// Dependency-ordered. parent: a parent account NAME, or null for a root node.
// Standard parents (Assets/Liabilities/Transfers/Financial Income) must already
// exist on the target DB; CR019 parents (Historical Assets/Liabilities) are
// created earlier in this same list.
const SEED_OBJECTS = [
  { name: 'Historical Assets',           parent: 'Assets',               section: 'balance_sheet', account_type: 'asset' },
  { name: 'Historical Liabilities',      parent: 'Liabilities',          section: 'balance_sheet', account_type: 'liability' },
  { name: 'Closed Cash (default)',       parent: 'Historical Assets',    section: 'balance_sheet', account_type: 'asset' },
  { name: 'Closed Debt (default)',       parent: 'Historical Liabilities', section: 'balance_sheet', account_type: 'liability' },
  { name: 'Fidelity (historical)',       parent: 'Historical Assets',    section: 'balance_sheet', account_type: 'asset' },
  { name: 'Transfer - Historical',       parent: 'Transfers',            section: 'profit_loss',   account_type: 'expense', is_transfer: true, skip_transfer_analysis: false },
  { name: 'Return of Capital',           parent: 'Transfers',            section: 'profit_loss',   account_type: 'expense', is_transfer: true, skip_transfer_analysis: true },
  { name: 'Financial Income - Dividend', parent: 'Financial Income',     section: 'profit_loss',   account_type: 'income' },
  { name: 'Interest Income',             parent: 'Financial Income',     section: 'profit_loss',   account_type: 'income' },
  { name: 'Realized Gain (Historical)',  parent: null,                   section: 'profit_loss',   account_type: 'income' },
];

function parseArgs(argv) {
  const args = { apply: false };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function resolveParentId(client, parentName) {
  const { rows } = await client.query(
    'SELECT id FROM accounts WHERE name = $1',
    [parentName]
  );
  if (rows.length === 0) {
    throw new Error(`required parent "${parentName}" not found — seed/check the base COA first`);
  }
  if (rows.length > 1) {
    throw new Error(`parent "${parentName}" is ambiguous (${rows.length} matches) — resolve manually`);
  }
  return rows[0].id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: CONN_STR });
  const client = await pool.connect();

  let created = 0;
  let exists = 0;
  try {
    await client.query('BEGIN');
    console.log(`\nseed-cr019-coa — ${SEED_OBJECTS.length} object(s)${args.apply ? ' (--apply)' : ' (dry-run)'}\n`);
    for (const o of SEED_OBJECTS) {
      const { rows: present } = await client.query(
        'SELECT id FROM accounts WHERE name = $1',
        [o.name]
      );
      if (present.length > 0) {
        exists += 1;
        console.log(`  exists   "${o.name}" (id ${present.map((r) => r.id).join(',')})`);
        continue;
      }
      const parentId = o.parent ? await resolveParentId(client, o.parent) : null;
      if (!args.apply) {
        console.log(`  CREATE   "${o.name}" → parent ${o.parent ? `"${o.parent}" (id ${parentId})` : '(root)'} [${o.section}/${o.account_type}]`);
        created += 1;
        continue;
      }
      const { rows: ins } = await client.query(
        `INSERT INTO accounts
           (name, parent_id, section, account_type, currency, is_active,
            opening_balance, is_transfer, skip_transfer_analysis)
         VALUES ($1, $2, $3, $4, 'USD', TRUE, 0, $5, $6)
         RETURNING id`,
        [o.name, parentId, o.section, o.account_type,
         o.is_transfer === true, o.skip_transfer_analysis === true]
      );
      created += 1;
      console.log(`  created  "${o.name}" (id ${ins[0].id}) → parent ${o.parent ? `"${o.parent}"` : '(root)'}`);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(
    `\n${args.apply ? 'APPLIED' : 'DRY-RUN'} — ${exists} already present, ` +
      `${created} ${args.apply ? 'created' : 'to create'}.` +
      (args.apply ? '' : ' Pass --apply to create.') + '\n'
  );
  await pool.end();
}

main().catch((e) => {
  console.error('seed-cr019-coa FAILED:', e.message);
  process.exit(1);
});
