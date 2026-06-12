/**
 * quicken-verify.js — post-promote correctness check for a CR019 import batch
 *
 * Reusable validation harness for the multi-account historical backfill. Run it
 * against a LANDED (promoted, not rolled-back) batch to assert the same
 * invariants that were checked by hand on the first pko walkthrough
 * (batch 3a04495d): no cross-source overlap, account integrity, and a
 * PS-anchored balance invariant (each touched account's live computed balance
 * equals PocketSmith's closing_balance — see check 5). Two informational warnings
 * (within-import duplicates, uncategorized rows) are reported but never fail —
 * on the pko batch both were verified benign (faithful repeated Quicken rows /
 * one stray uncategorized row).
 *
 * Usage:
 *   node quicken-verify.js --batch <uuid> [--expect-account <id>] [--source <name>]
 *
 *   --batch           (required) import_batch_id to verify
 *   --expect-account  (optional) assert EVERY batch row sits on this account_id
 *   --source          (optional) assert the batch's single source equals this
 *
 * Exit code: 0 if all hard checks pass, 1 if any hard check fails (or on usage
 * error). Warnings do not affect the exit code.
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 */

'use strict';

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL ||
  (() => { throw new Error('DATABASE_URL must be set — no insecure default'); })();

const MONEY_EPS = 0.01; // 1¢ tolerance for balance invariants

function parseArgs(argv) {
  const args = { batch: null, expectAccount: null, source: null, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--batch') args.batch = argv[++i];
    else if (a === '--expect-account') args.expectAccount = Number(argv[++i]);
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--all') args.all = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!args.batch && !args.all) throw new Error('--batch <uuid> or --all is required');
  return args;
}

// Each check pushes { name, status: 'PASS'|'FAIL'|'WARN', detail } and may set
// failed=true. Hard failures flip the process exit code; warnings never do.
async function verify(pool, args) {
  const results = [];
  const pass = (name, detail) => results.push({ name, status: 'PASS', detail });
  const fail = (name, detail) => results.push({ name, status: 'FAIL', detail });
  const warn = (name, detail) => results.push({ name, status: 'WARN', detail });

  // 1. Batch exists + summary --------------------------------------------------
  const summary = await pool.query(
    `select count(*)::int           as n,
            min(transaction_date)    as first,
            max(transaction_date)    as last,
            count(distinct source)::int as n_sources,
            min(source)              as source
       from transactions
      where import_batch_id = $1`,
    [args.batch]
  );
  const s = summary.rows[0];
  if (s.n === 0) {
    // A promoted batch with 0 landed rows is BENIGN, not broken: every parsed
    // row sat on/after its account's PocketSmith cutoff and was correctly
    // dropped (the account's history is already in PS). The admin UI shows the
    // same "0 — all already in PocketSmith" state. Only flag a hard FAIL when a
    // non-promoted batch unexpectedly has no rows.
    const { rows: br } = await pool.query(
      `select status from quicken_import_batches where id = $1`,
      [args.batch]
    );
    const status = br[0] && br[0].status;
    if (status === 'promoted') {
      warn(
        'batch-exists',
        `0 imported — all parsed rows cutoff-dropped (redundant with PocketSmith)`
      );
    } else {
      fail(
        'batch-exists',
        `no transactions for import_batch_id=${args.batch} (status=${status || 'unknown'})`
      );
    }
    return results; // nothing else is meaningful with 0 rows
  }
  pass(
    'batch-exists',
    `${s.n} tx, ${s.first.toISOString().slice(0, 10)} → ${s.last
      .toISOString()
      .slice(0, 10)}, source=${s.source}`
  );

  // 2. Single source -----------------------------------------------------------
  if (s.n_sources !== 1) {
    fail('single-source', `batch spans ${s.n_sources} sources (expected 1)`);
  } else if (args.source && s.source !== args.source) {
    fail('single-source', `source=${s.source}, expected ${args.source}`);
  } else {
    pass('single-source', `source=${s.source}`);
  }

  // 3. Account integrity -------------------------------------------------------
  const accts = await pool.query(
    `select account_id, count(*)::int as n
       from transactions where import_batch_id = $1
      group by account_id order by n desc`,
    [args.batch]
  );
  const acctList = accts.rows.map((r) => `${r.account_id}:${r.n}`).join(', ');
  if (args.expectAccount != null) {
    const off = accts.rows.filter((r) => r.account_id !== args.expectAccount);
    if (off.length) {
      const offN = off.reduce((t, r) => t + r.n, 0);
      fail(
        'account-integrity',
        `${offN} tx not on expected account ${args.expectAccount} (got ${acctList})`
      );
    } else {
      pass('account-integrity', `all ${s.n} tx on account ${args.expectAccount}`);
    }
  } else {
    pass('account-integrity', `accounts → ${acctList}`);
  }

  // 4. Cross-source overlap (the "no PocketSmith dupes" check) ------------------
  // A batch row that matches a row from a DIFFERENT source on
  // (account_id, transaction_date, amount) is a probable double-count.
  const overlap = await pool.query(
    `select t.account_id, t.transaction_date, t.amount, o.source as other_source,
            count(*)::int as n
       from transactions t
       join transactions o
         on o.account_id       = t.account_id
        and o.transaction_date = t.transaction_date
        and o.amount           = t.amount
        and o.source <> t.source
      where t.import_batch_id = $1
      group by t.account_id, t.transaction_date, t.amount, o.source
      order by n desc
      limit 10`,
    [args.batch]
  );
  if (overlap.rows.length) {
    const tot = overlap.rows.reduce((t, r) => t + r.n, 0);
    const sample = overlap.rows
      .slice(0, 5)
      .map(
        (r) =>
          `  acct ${r.account_id} ${r.transaction_date
            .toISOString()
            .slice(0, 10)} ${r.amount} vs ${r.other_source} (${r.n})`
      )
      .join('\n');
    fail(
      'cross-source-overlap',
      `${tot}+ batch rows collide with other-source rows:\n${sample}`
    );
  } else {
    pass('cross-source-overlap', 'no overlap with other sources');
  }

  // 5. Balance invariant (PS-anchored, CR §22.1) ------------------------------
  // Promote pins each touched account's opening_balance so its LIVE computed
  // balance (opening_balance + Σ all tx) equals PocketSmith's authoritative
  // closing_balance — "today == bank truth". This check reads the live ledger
  // (not quicken_calibration_audit.delta_amount, whose meaning changed when the
  // PS-anchored redesign landed: delta is now old_ob − new_ob, no longer Σtx) so
  // it validates the actual end state, mirroring promote's verifyBalances(batchId).
  // Touched accounts with no PS anchor are reconstruction-only (info, never fail).
  const bal = await pool.query(
    `with touched as (
       select distinct account_id from transactions where import_batch_id = $1
     ),
     post as (
       select a.id as account_id,
              a.opening_balance + coalesce(sum(t.amount), 0) as computed
         from accounts a
         left join transactions t
           on t.account_id = a.id and t.transaction_date >= a.opening_balance_date
        where a.id in (select account_id from touched)
        group by a.id, a.opening_balance
     ),
     anchor as (
       select tt.account_id,
              (select x.closing_balance from transactions x
                 where x.account_id = tt.account_id and x.source <> 'quicken-import'
                   and x.closing_balance is not null
                 order by x.transaction_date desc, x.id desc limit 1) as ps_close
         from touched tt
     )
     select post.account_id, post.computed, anchor.ps_close
       from post join anchor on anchor.account_id = post.account_id`,
    [args.batch]
  );
  const balProblems = [];
  let anchored = 0;
  let reconOnly = 0;
  for (const r of bal.rows) {
    if (r.ps_close == null) {
      reconOnly++;
    } else if (Math.abs(Number(r.computed) - Number(r.ps_close)) > MONEY_EPS) {
      balProblems.push(
        `acct ${r.account_id}: computed ${Number(r.computed).toFixed(2)} ≠ PS closing ${Number(r.ps_close).toFixed(2)}`
      );
    } else {
      anchored++;
    }
  }
  if (balProblems.length) {
    fail('balance-invariant', balProblems.join('; '));
  } else {
    pass(
      'balance-invariant',
      `${anchored} account(s) match PS closing_balance` +
        (reconOnly ? `, ${reconOnly} reconstruction-only (no PS anchor)` : '')
    );
  }

  // 5b. Split-sum integrity (staging-level) ------------------------------------
  // Each split parent's children must sum to the parent amount. Promote expands
  // children into the ledger and drops parents, so this is checked against
  // quicken_staging (retained post-promote). Skipped if staging was wiped.
  const stagingCount = await pool.query(
    `select count(*)::int as n from quicken_staging where import_batch_id = $1`,
    [args.batch]
  );
  if (stagingCount.rows[0].n === 0) {
    warn('split-integrity', 'no staging rows for batch — skipped (staging wiped)');
  } else {
    const splitMismatch = await pool.query(
      `with kids as (
         select split_parent_id, round(sum(amount), 2) as s
           from quicken_staging
          where import_batch_id = $1 and split_parent_id is not null
          group by split_parent_id)
       select count(*)::int as n
         from kids k
         join quicken_staging p on p.id = k.split_parent_id
        where abs(round(p.amount, 2) - k.s) > $2`,
      [args.batch, MONEY_EPS]
    );
    const sm = splitMismatch.rows[0].n;
    if (sm > 0) {
      fail('split-integrity', `${sm} split group(s) where children ≠ parent amount`);
    } else {
      pass('split-integrity', 'all split children sum to their parent');
    }
  }

  // 5c. Cross-source time overlap ----------------------------------------------
  // Historical (Quicken) data should sit BEFORE the live (PocketSmith) era on
  // each account. If the batch's date range overlaps in time with other-source
  // rows on the same account, the per-account cutoff likely didn't trim the QIF
  // — a double-coverage risk even when no exact-match dupes exist (those are the
  // hard cross-source-overlap check above).
  const timeOverlap = await pool.query(
    `with b as (
       select account_id, min(transaction_date) lo, max(transaction_date) hi
         from transactions where import_batch_id = $1 group by account_id),
     o as (
       select account_id, min(transaction_date) lo, max(transaction_date) hi
         from transactions
        where source <> (select min(source) from transactions where import_batch_id = $1)
          and import_batch_id is distinct from $1
        group by account_id)
     select b.account_id,
            greatest(b.lo, o.lo) as ov_lo,
            least(b.hi, o.hi)    as ov_hi
       from b join o on o.account_id = b.account_id
      where o.lo <= b.hi and b.lo <= o.hi`,
    [args.batch]
  );
  if (timeOverlap.rows.length) {
    const detail = timeOverlap.rows
      .map(
        (r) =>
          `acct ${r.account_id}: ${r.ov_lo.toISOString().slice(0, 10)}→${r.ov_hi
            .toISOString()
            .slice(0, 10)}`
      )
      .join('; ');
    warn('time-overlap', `batch overlaps other-source dates on ${timeOverlap.rows.length} account(s): ${detail}`);
  } else {
    pass('time-overlap', 'no date overlap with other-source rows on the same account(s)');
  }

  // 6. Within-import duplicates (informational) --------------------------------
  const dupes = await pool.query(
    `select count(*)::int as groups, coalesce(sum(c - 1), 0)::int as extra
       from (select account_id, transaction_date, amount, description1,
                    count(*)::int as c
               from transactions where import_batch_id = $1
              group by account_id, transaction_date, amount, description1
             having count(*) > 1) g`,
    [args.batch]
  );
  const d = dupes.rows[0];
  if (d.groups > 0) {
    warn(
      'within-import-dupes',
      `${d.groups} group(s), ${d.extra} extra row(s) — verify these are genuine repeated entries`
    );
  } else {
    pass('within-import-dupes', 'none');
  }

  // 7. Uncategorized rows (informational) --------------------------------------
  const uncat = await pool.query(
    `select count(*)::int as n from transactions
      where import_batch_id = $1 and category_id is null`,
    [args.batch]
  );
  const u = uncat.rows[0].n;
  if (u > 0) warn('uncategorized', `${u} row(s) with null category_id`);
  else pass('uncategorized', 'all rows categorized');

  return results;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`usage error: ${e.message}`);
    console.error(
      'usage: node quicken-verify.js (--batch <uuid> [--expect-account <id>] | --all) [--source <name>]'
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: CONN_STR });
  let anyFail = false;
  try {
    if (args.all) {
      // Sweep every promoted batch (optionally filtered by --source). No
      // --expect-account assertion — account-integrity is reported per batch.
      const { rows: batches } = await pool.query(
        `select id, label from quicken_import_batches
          where status = 'promoted'
          order by created_at`
      );
      console.log(`\nquicken-verify --all — ${batches.length} promoted batch(es)\n`);
      for (const b of batches) {
        const res = await verify(pool, { batch: b.id, expectAccount: null, source: args.source });
        const fails = res.filter((r) => r.status === 'FAIL');
        const warns = res.filter((r) => r.status === 'WARN');
        if (fails.length) anyFail = true;
        const tag = fails.length ? '✗ FAIL' : warns.length ? '! warn' : '✓ ok';
        const summ = res.find((r) => r.name === 'batch-exists');
        console.log(
          `${tag}  ${(b.label || b.id.slice(0, 8)).padEnd(22)} — ${summ ? summ.detail : ''}` +
            (fails.length ? `  [${fails.map((f) => f.name).join(', ')}]` : '')
        );
      }
      console.log(`\n${anyFail ? 'SOME BATCHES FAILED' : 'ALL BATCHES OK'} — run with --batch <id> for detail\n`);
    } else {
      const results = await verify(pool, args);
      console.log(`\nquicken-verify — batch ${args.batch}\n`);
      for (const r of results) {
        const icon = r.status === 'PASS' ? '✓' : r.status === 'WARN' ? '!' : '✗';
        console.log(`${icon} [${r.status}] ${r.name}: ${r.detail}`);
      }
      const fails = results.filter((r) => r.status === 'FAIL');
      const warns = results.filter((r) => r.status === 'WARN');
      anyFail = fails.length > 0;
      console.log(
        `\n${fails.length ? 'FAILED' : 'PASSED'} — ${
          results.filter((r) => r.status === 'PASS').length
        } passed, ${warns.length} warning(s), ${fails.length} failure(s)\n`
      );
    }
  } finally {
    await pool.end();
  }
  process.exit(anyFail ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { verify, parseArgs };
