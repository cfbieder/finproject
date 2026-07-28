/**
 * quicken-anchor.js — CR058 Quicken-era valuation anchors.
 *
 * CR019 §22's value-only promote tracks a brokerage account's CASH but not its
 * HOLDINGS, so the reconstructed history drifts wherever the cash/securities
 * split moved. This writes one dated adjustment per target date so the balance
 * lands exactly on the owner's Quicken Net Worth Report, plus a single reversal
 * at the handoff so the PocketSmith era and today's balance are untouched.
 *
 *   anchor(D) = target(D) − [ ledger(D) + Σ anchor(d) for d < D ]
 *   reversal  = −Σ anchor           (posted at the handoff date)
 *
 * Rows land on `Valuation - Historical` (migration 042) — deliberately NOT
 * `Unrealized G/L`, because each anchor mixes real market movement with
 * liquidation timing, money-market sweep churn and gaps in Quicken's own share
 * history; feeding CR056's unrealized numerator would manufacture a confident,
 * wrong return series. See CR058 §3.3.
 *
 * Usage:
 *   node quicken-anchor.js --batch <uuid> --account <name> --targets <csv> \
 *                          --handoff <YYYY-MM-DD> [--apply]
 *   node quicken-anchor.js --batch <uuid> --account <name> --targets <csv> --check
 *
 * --check is READ-ONLY: it re-runs the tie-out against the pinned CSV and
 * reports drift without writing. The targets are frozen (Quicken is retired),
 * but each anchor is `target − ledger` and the LEDGER can still move — a
 * re-import or a recategorization silently invalidates the series, and the
 * write-time invariant would never see it.
 *
 * Idempotent: a run deletes this batch's prior anchors BEFORE re-reading the
 * ledger, then recomputes (the `retire-handoff.js` pattern). Anchors carry the
 * batch's import_batch_id, so CR019 §6.5's rollback removes them with the batch.
 *
 * DB: honours DATABASE_URL.
 */

'use strict';

const fs = require('node:fs');
const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL ||
  (() => { throw new Error('DATABASE_URL must be set — no insecure default'); })();

const ANCHOR_SOURCE = 'quicken-valuation';
const ANCHOR_CATEGORY = 'Valuation - Historical';
const MONEY_EPS = 0.01;

const fmt = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round(n * 100) / 100;

function parseArgs(argv) {
  const a = { batch: null, account: null, targets: null, handoff: null, apply: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--batch': a.batch = argv[++i]; break;
      case '--account': a.account = argv[++i]; break;
      case '--targets': a.targets = argv[++i]; break;
      case '--handoff': a.handoff = argv[++i]; break;
      case '--apply': a.apply = true; break;
      case '--check': a.check = true; break;
      default: throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  if (!a.batch) throw new Error('--batch <uuid> is required');
  if (!a.account) throw new Error('--account <name> is required');
  if (!a.targets) throw new Error('--targets <csv> is required');
  if (!a.check && !a.handoff) throw new Error('--handoff <YYYY-MM-DD> is required (omit only with --check)');
  if (a.apply && a.check) throw new Error('--apply and --check are mutually exclusive');
  return a;
}

/**
 * Parse the target CSV fail-loud, mirroring parseFxCsv: headers matched
 * case-insensitively with BOM/whitespace trimmed; a missing or non-numeric
 * target is a hard error, never a silent 0 on a money field; a zero-row file is
 * an error, not a silent success over an empty series.
 */
function parseTargetsCsv(text, sourceName = 'targets') {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error(`${sourceName}: file is empty`);

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iDate = header.indexOf('as_of_date');
  const iTarget = header.indexOf('target');
  if (iDate === -1 || iTarget === -1) {
    throw new Error(`${sourceName}: header must contain as_of_date and target — got [${header.join(', ')}]`);
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim());
    // A thousands separator inside an unquoted field ("1,234.50") splits into
    // extra cells and would otherwise read as 1 — a silently wrong money value,
    // which is exactly what the data-import rule forbids. Cell count must match
    // the header.
    if (cells.length !== header.length) {
      throw new Error(
        `${sourceName} line ${i + 1}: expected ${header.length} columns, got ${cells.length} ` +
        `— a thousands separator in an unquoted field would parse as the wrong number`
      );
    }
    const d = cells[iDate];
    const raw = cells[iTarget];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) {
      throw new Error(`${sourceName} line ${i + 1}: bad as_of_date "${d}" (want YYYY-MM-DD)`);
    }
    if (raw === undefined || raw === '') {
      throw new Error(`${sourceName} line ${i + 1}: missing target for ${d}`);
    }
    const v = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(v)) {
      throw new Error(`${sourceName} line ${i + 1}: non-numeric target "${raw}" for ${d}`);
    }
    rows.push({ as_of_date: d, target: v });
  }
  if (rows.length === 0) throw new Error(`${sourceName}: no data rows`);

  rows.sort((a, b) => (a.as_of_date < b.as_of_date ? -1 : a.as_of_date > b.as_of_date ? 1 : 0));
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].as_of_date === rows[i - 1].as_of_date) {
      throw new Error(`${sourceName}: duplicate as_of_date ${rows[i].as_of_date}`);
    }
  }
  return rows;
}

/** Balance the way the Balance Sheet computes it — deliberately the READER's
 *  query, so a writer that forgets the sentinel filter is caught (invariant 1). */
async function balanceAt(client, accountId, asOf) {
  const { rows } = await client.query(
    `SELECT (a.opening_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t
              WHERE t.account_id = a.id AND t.transaction_date <= $2::date
                AND t.transaction_date >= a.opening_balance_date), 0)) AS bal
       FROM accounts a WHERE a.id = $1`,
    [accountId, asOf]
  );
  return Number(rows[0].bal);
}

async function todayBalance(client, accountId) {
  const { rows } = await client.query(
    `SELECT (a.opening_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t
              WHERE t.account_id = a.id
                AND t.transaction_date >= a.opening_balance_date), 0)) AS bal
       FROM accounts a WHERE a.id = $1`,
    [accountId]
  );
  return Number(rows[0].bal);
}

async function resolve(client, accountName, batchId) {
  const { rows: acct } = await client.query(
    `SELECT id, opening_balance_date::text AS sentinel FROM accounts
      WHERE name = $1 AND section = 'balance_sheet'`,
    [accountName]
  );
  if (acct.length !== 1) {
    throw new Error(`expected exactly 1 balance-sheet account named "${accountName}", found ${acct.length}`);
  }
  const { rows: cat } = await client.query(
    `SELECT id FROM accounts WHERE name = $1`, [ANCHOR_CATEGORY]
  );
  if (cat.length !== 1) {
    throw new Error(`"${ANCHOR_CATEGORY}" category not found — apply migration 042 first`);
  }
  const { rows: batch } = await client.query(
    `SELECT id FROM quicken_import_batches WHERE id = $1`, [batchId]
  );
  if (batch.length !== 1) throw new Error(`batch ${batchId} not found`);

  return { accountId: acct[0].id, sentinel: acct[0].sentinel, categoryId: cat[0].id };
}

/** Sequential anchors. Each is computed against the balance AFTER all prior
 *  anchors, so posting them in date order lands every target exactly. */
function computeAnchors(targets, ledgerAt) {
  let cum = 0;
  const out = [];
  for (const t of targets) {
    const anchor = round2(t.target - (ledgerAt[t.as_of_date] + cum));
    cum = round2(cum + anchor);
    out.push({ ...t, ledger: ledgerAt[t.as_of_date], prior: round2(cum - anchor), anchor });
  }
  return { anchors: out, sigma: cum };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = parseTargetsCsv(fs.readFileSync(args.targets, 'utf8'), args.targets);

  const pool = new Pool({ connectionString: CONN_STR });
  const client = await pool.connect();
  let failed = false;

  try {
    await client.query('BEGIN');
    const { accountId, sentinel, categoryId } = await resolve(client, args.account, args.batch);

    // Guard (CR058 §4.2): an anchor dated before the account's sentinel is
    // silently excluded from every balance query — it would write rows nothing
    // ever reads and a tie-out that only appears to hold.
    const preSentinel = targets.filter((t) => t.as_of_date < sentinel);
    if (preSentinel.length > 0) {
      throw new Error(
        `${preSentinel.length} target date(s) fall before "${args.account}"'s opening_balance_date ` +
        `(${sentinel}) — earliest ${preSentinel[0].as_of_date}. Those anchors would be invisible to ` +
        `every balance query. Lower the sentinel or drop those rows.`
      );
    }

    // --check reads the ledger AS IT STANDS, anchors included: it is asking
    // "does the written series still tie?". Clearing first would strip the very
    // rows under test and report the full anchor value as drift on every date.
    // The write paths clear first (idempotency) so a re-run recomputes from a
    // clean base — the `retire-handoff.js` pattern.
    const cleared = args.check
      ? { rowCount: 0 }
      : await client.query(
          `DELETE FROM transactions WHERE import_batch_id = $1 AND source = $2`,
          [args.batch, ANCHOR_SOURCE]
        );

    const before = await todayBalance(client, accountId);
    const ledgerAt = {};
    for (const t of targets) ledgerAt[t.as_of_date] = await balanceAt(client, accountId, t.as_of_date);
    const { anchors, sigma } = computeAnchors(targets, ledgerAt);

    console.log(`quicken-anchor — ${args.check ? 'CHECK (read-only)' : args.apply ? 'APPLY' : 'DRY RUN'}`);
    console.log(`account : ${args.account} (${accountId}), sentinel ${sentinel}`);
    console.log(`batch   : ${args.batch}`);
    console.log(`targets : ${targets.length} from ${args.targets}`);
    if (cleared.rowCount > 0) console.log(`cleared : ${cleared.rowCount} prior anchor row(s)`);
    console.log('');

    if (args.check) {
      // With the anchors in place the balance should already EQUAL the target,
      // so drift is simply balance − target. Any non-zero means the ledger moved
      // under the anchors after they were written — a re-import, a
      // recategorization, or one of the untriaged transfer-sign defects.
      const anchored = (await client.query(
        `SELECT COUNT(*)::int AS n FROM transactions
          WHERE import_batch_id = $1 AND source = $2`,
        [args.batch, ANCHOR_SOURCE]
      )).rows[0].n;
      if (anchored === 0) {
        console.log('No anchors written for this batch yet — nothing to check.');
        await client.query('ROLLBACK');
        return;
      }

      const drift = [];
      console.log('date          target       balance        drift');
      console.log('----------  -----------  ------------  -----------');
      for (const t of targets) {
        const bal = ledgerAt[t.as_of_date];
        const d = round2(bal - t.target);
        if (Math.abs(d) > MONEY_EPS) drift.push({ ...t, bal, d });
        console.log(`${t.as_of_date}  ${fmt(t.target).padStart(11)}  ${fmt(bal).padStart(12)}  ${fmt(d).padStart(11)}`);
      }
      console.log('');
      if (drift.length > 0) {
        console.log(`DRIFT on ${drift.length} of ${targets.length} date(s) — the ledger moved under the anchors.`);
        failed = true;
      } else {
        console.log(`OK — all ${targets.length} dates still tie to the report (${anchored} anchor rows).`);
      }
      await client.query('ROLLBACK');
      return;
    }

    console.log('date          ledger      + prior       target       anchor');
    console.log('----------  -----------  -----------  -----------  -----------');
    for (const a of anchors) {
      console.log(
        `${a.as_of_date}  ${fmt(a.ledger).padStart(11)}  ${fmt(a.prior).padStart(11)}  ${fmt(a.target).padStart(11)}  ${fmt(a.anchor).padStart(11)}`
      );
    }
    const reversal = round2(-sigma);
    console.log(`${args.handoff}  ${''.padStart(11)}  ${''.padStart(11)}  ${'reversal'.padStart(11)}  ${fmt(reversal).padStart(11)}`);
    console.log('');
    console.log(`Σ anchors : ${fmt(sigma)}`);
    console.log(`reversal  : ${fmt(reversal)} at ${args.handoff}`);

    // Pre-write assertion (invariant 5): the set must net to zero, or the
    // handoff does not neutralize and today's balance moves.
    const net = round2(sigma + reversal);
    if (Math.abs(net) > MONEY_EPS) {
      throw new Error(`Σ(anchors) + reversal = ${fmt(net)}, expected 0.00 — rounding bug`);
    }

    const rows = anchors
      .filter((a) => Math.abs(a.anchor) > 0)
      .map((a) => ({ date: a.as_of_date, amount: a.anchor, label: `Valuation anchor ${a.as_of_date}` }));
    rows.push({ date: args.handoff, amount: reversal, label: 'Quicken-era handoff reversal' });

    for (const r of rows) {
      await client.query(
        `INSERT INTO transactions
           (account_id, category_id, transaction_date, amount, currency, base_amount,
            base_currency, description1, description2, source, accepted,
            import_batch_id, transfer_matched, closing_balance)
         VALUES ($1,$2,$3,$4,'USD',$4,'USD',$5,'CR058 valuation anchor',$6,TRUE,$7,FALSE,NULL)`,
        [accountId, categoryId, r.date, r.amount, r.label, ANCHOR_SOURCE, args.batch]
      );
    }

    // Invariant 1 — cross-implementation tie-out, using the READER's query.
    const misses = [];
    for (const t of targets) {
      const got = await balanceAt(client, accountId, t.as_of_date);
      if (Math.abs(got - t.target) > MONEY_EPS) {
        misses.push(`${t.as_of_date} expected=${fmt(t.target)} got=${fmt(got)} miss=${fmt(got - t.target)}`);
      }
    }
    if (misses.length > 0) {
      throw new Error(`tie-out failed on ${misses.length} date(s): ${misses.slice(0, 5).join('; ')}`);
    }

    // Invariant 2 — handoff neutrality.
    const after = await todayBalance(client, accountId);
    if (Math.abs(after - before) > MONEY_EPS) {
      throw new Error(`today's balance moved: before=${fmt(before)} after=${fmt(after)}`);
    }

    console.log(`rows written : ${rows.length}`);
    console.log(`tie-out      : all ${targets.length} target dates match to the cent`);
    console.log(`today        : unchanged at ${fmt(after)}`);

    if (args.apply) {
      await client.query('COMMIT');
      console.log('\nCOMMITTED.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — rolled back. Re-run with --apply to write.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\nFAILED (rolled back): ${err.message}`);
    failed = true;
  } finally {
    client.release();
    await pool.end();
    if (failed) process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseTargetsCsv, computeAnchors };
