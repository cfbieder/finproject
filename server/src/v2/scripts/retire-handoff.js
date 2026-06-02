#!/usr/bin/env node
'use strict';
/**
 * retire-handoff.js — zero out a "retired/consolidated" historical account at its
 * PocketSmith hand-off boundary (CR019 §22; scripts the formerly-manual Fidelity
 * 635 handoff so it is reproducible on the re-run-on-prod cutover).
 *
 * Context: some Quicken accounts are backfilled into a STANDALONE historical
 * container (e.g. "Fidelity (historical)" under "Historical Assets") rather than
 * the live PocketSmith account, because one consolidated Quicken brokerage maps
 * to several live PS sub-accounts. The container holds the pre-coverage history
 * (builds 0 → its peak by the cutoff year), but its value CONTINUES in the live
 * PS accounts after the cutoff. Left alone it would DOUBLE-COUNT against those
 * live accounts from the cutoff onward. The fix is one hand-off transaction at
 * the cutoff date = −(balance there), categorized "Transfer - Historical", which
 * zeros the container from the cutoff forward while preserving its pre-cutoff
 * curve. (Distinct from a genuinely closed account, whose own data zeros it.)
 *
 * Identifies the retired account(s) STRUCTURALLY — accounts the batch promoted to
 * that sit under a "Historical Assets"/"Historical Liabilities" container — so it
 * carries no hardcoded account ids to prod. The hand-off date defaults to the
 * account's entry in the batch's `cutoff_overrides` (override with --handoff-date).
 *
 * The hand-off row is stamped with the batch's import_batch_id and source
 * 'quicken-import', so the existing rollback removes it with the rest of the
 * batch. Idempotent: re-running deletes the prior hand-off (matched by marker)
 * before reinserting — and computes the balance EXCLUDING prior hand-offs, so it
 * is stable across re-runs and also supersedes the original manual SQL entry.
 *
 * Usage:
 *   node retire-handoff.js --batch <uuid> [--handoff-date YYYY-MM-DD]   # dry-run
 *   node retire-handoff.js --batch <uuid> [--handoff-date YYYY-MM-DD] --apply
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 */

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL || 'postgres://fin:findev123@localhost:5434/fin';
const EPS = 0.01;
const HANDOFF_MARKER = 'Quicken handoff'; // description2 — identifies a hand-off row
const HANDOFF_DESC = 'Handoff to PocketSmith (retired account)';
const TRANSFER_HISTORICAL = 'Transfer - Historical';
const HISTORICAL_CONTAINERS = ['Historical Assets', 'Historical Liabilities'];

function parseArgs(argv) {
  const args = { batch: null, handoffDate: null, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--batch') args.batch = argv[++i];
    else if (a === '--handoff-date') args.handoffDate = argv[++i];
    else if (a === '--apply') args.apply = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.batch) throw new Error('--batch <uuid> is required');
  return args;
}

async function resolveBaseAmount(client, amount, currency, dateStr) {
  if (currency === 'USD') return amount;
  const d = new Date(dateStr);
  const { rows } = await client.query(
    `SELECT rate FROM budget_fx_rates WHERE currency=$1 AND year=$2 AND month=$3`,
    [currency, d.getUTCFullYear(), d.getUTCMonth() + 1]
  );
  if (rows.length === 0) return null;
  return Math.round((amount / parseFloat(rows[0].rate)) * 10000) / 10000;
}

// Accounts this batch promoted to that sit under a Historical container.
async function findRetiredAccounts(pool, batchId) {
  const { rows } = await pool.query(
    `WITH RECURSIVE touched AS (
       SELECT DISTINCT account_id AS id FROM transactions WHERE import_batch_id = $1
     ),
     containers AS (
       SELECT id FROM accounts WHERE name = ANY($2)
     ),
     anc AS (
       SELECT t.id AS leaf, a.id AS node, a.parent_id
         FROM touched t JOIN accounts a ON a.id = t.id
       UNION ALL
       SELECT anc.leaf, p.id, p.parent_id
         FROM anc JOIN accounts p ON p.id = anc.parent_id
     )
     SELECT DISTINCT a.id, a.name, a.currency, a.opening_balance::float8 AS ob
       FROM anc
       JOIN accounts a ON a.id = anc.leaf
      WHERE anc.node IN (SELECT id FROM containers)
      ORDER BY a.id`,
    [batchId, HISTORICAL_CONTAINERS]
  );
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: CONN_STR });

  // Hand-off date: explicit flag, else the account's cutoff_overrides entry.
  const { rows: bRows } = await pool.query(
    `SELECT status, cutoff_overrides FROM quicken_import_batches WHERE id = $1`,
    [args.batch]
  );
  if (bRows.length === 0) throw new Error(`batch ${args.batch} not found`);
  const cutoffOverrides = bRows[0].cutoff_overrides || {};

  const retired = await findRetiredAccounts(pool, args.batch);
  if (retired.length === 0) {
    console.log(
      `\nretire-handoff — batch ${args.batch.slice(0, 8)} promoted to NO accounts under ` +
        `${HISTORICAL_CONTAINERS.join('/')}. Nothing to retire.\n`
    );
    await pool.end();
    return;
  }

  // Resolve the Transfer - Historical category id (by name → prod-portable).
  const { rows: catRows } = await pool.query(
    `SELECT id FROM accounts WHERE name = $1`,
    [TRANSFER_HISTORICAL]
  );
  if (catRows.length === 0) {
    throw new Error(`category "${TRANSFER_HISTORICAL}" not found — seed it first`);
  }
  const categoryId = catRows[0].id;

  console.log(
    `\nretire-handoff — batch ${args.batch.slice(0, 8)}, ${retired.length} retired account(s):\n`
  );

  const plan = [];
  for (const acct of retired) {
    const handoffDate = args.handoffDate || cutoffOverrides[String(acct.id)];
    if (!handoffDate) {
      console.log(
        `  acct ${acct.id} ${acct.name}: ⚠ no hand-off date (not in cutoff_overrides; ` +
          `pass --handoff-date) — SKIPPED`
      );
      continue;
    }
    // Balance up to & including the hand-off date, EXCLUDING any prior hand-off row.
    const { rows: balRows } = await pool.query(
      `SELECT $2::float8 + COALESCE(SUM(amount), 0)::float8 AS bal
         FROM transactions
        WHERE account_id = $1
          AND transaction_date <= $3::date
          AND NOT (description2 = $4 AND source = 'quicken-import')`,
      [acct.id, acct.ob, handoffDate, HANDOFF_MARKER]
    );
    const bal = balRows[0].bal;
    if (Math.abs(bal) <= EPS) {
      console.log(`  acct ${acct.id} ${acct.name}: already ~0 at ${handoffDate} — skip`);
      continue;
    }
    plan.push({ ...acct, handoffDate, amount: -bal, balAt: bal });
    console.log(
      `  acct ${acct.id} ${acct.name} [${acct.currency}]: balance ${bal.toFixed(2)} @ ${handoffDate} ` +
        `→ hand-off ${(-bal).toFixed(2)} (zeros it from ${handoffDate} forward)`
    );
  }

  if (!args.apply) {
    console.log('\nDRY-RUN — pass --apply to write the hand-off row(s).\n');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const p of plan) {
      const baseAmount = await resolveBaseAmount(client, p.amount, p.currency, p.handoffDate);
      if (baseAmount == null) {
        throw new Error(
          `missing FX rate for ${p.currency} at ${p.handoffDate} (acct ${p.id}) — run seed-fx`
        );
      }
      // Idempotent: drop a prior hand-off for this account+batch (incl. the
      // original manual SQL entry, matched by marker) before reinserting.
      await client.query(
        `DELETE FROM transactions
          WHERE account_id = $1 AND import_batch_id = $2
            AND description2 = $3 AND source = 'quicken-import'`,
        [p.id, args.batch, HANDOFF_MARKER]
      );
      await client.query(
        `INSERT INTO transactions
           (account_id, category_id, transaction_date, amount, currency,
            base_amount, base_currency, description1, description2,
            source, accepted, import_batch_id, transfer_matched)
         VALUES ($1, $2, $3, $4, $5, $6, 'USD', $7, $8, 'quicken-import', TRUE, $9, FALSE)`,
        [p.id, categoryId, p.handoffDate, p.amount, p.currency, baseAmount,
         HANDOFF_DESC, HANDOFF_MARKER, args.batch]
      );
      inserted += 1;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`\nAPPLIED — wrote ${inserted} hand-off row(s).`);

  // Verify each retired account now computes to ~0 from the hand-off date forward.
  const problems = [];
  for (const p of plan) {
    const { rows } = await pool.query(
      `SELECT (a.opening_balance + COALESCE(SUM(t.amount), 0))::float8 AS bal
         FROM accounts a
         LEFT JOIN transactions t
           ON t.account_id = a.id AND t.transaction_date >= a.opening_balance_date
        WHERE a.id = $1
        GROUP BY a.opening_balance`,
      [p.id]
    );
    const today = rows[0] ? rows[0].bal : null;
    if (today == null || Math.abs(today) > EPS) {
      problems.push(`acct ${p.id} computes to ${today} (expected ~0)`);
    }
  }
  if (problems.length) {
    console.log(`\n⚠ ${problems.length} retired account(s) not zeroed: ${problems.join('; ')}`);
  } else {
    console.log(`✓ All ${plan.length} retired account(s) now compute to ~0 (post-handoff).`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error('retire-handoff FAILED:', e.message);
  process.exit(1);
});
