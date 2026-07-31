/**
 * restate-mtm.js — restate a month-end MTM mark against the custodian's own
 * statement.
 *
 * CR023's `mtm()` marks an account to whatever the bank feed reports for the
 * month-end date. That is right whenever the feed is current, and CR061's
 * stale-feed guard now refuses the case where it is not. But a mark already
 * written against a stale balance stays wrong, and it cannot be re-marked: the
 * feed row for that date IS the stale value, so re-running `mtm()` reproduces
 * it. The settled close only exists on a LATER-dated row (empirically
 * month-end + 2 days for Fidelity), and the feed gives no way to tell which
 * row that is — for 2026-06-30 the first row that breaks the flat run
 * (07-01) is not the settled close; 07-02 is.
 *
 * So the custodian's statement is the authority for a historical month-end,
 * and this restates the mark to it:
 *
 *     amount' = amount + (target − balance(D))
 *
 * The correction lands in `Unrealized G/L` (category 88) — the same bucket the
 * original mark used, and the correct one here, because a stale feed
 * understates exactly one thing: market movement. This is deliberately NOT the
 * `Valuation - Historical` bucket CR058's anchors use; those mix flows,
 * liquidation timing and gaps in Quicken's share history, so feeding them to
 * CR056's unrealized numerator would manufacture a confident wrong return.
 * A stale mark has no such ambiguity.
 *
 * TODAY'S BALANCE MOVES, by design. Restating a mark lifts every balance from
 * D onward, including today, until the next month-end mark re-pins the account
 * to the feed. That is the point: the alternative (an anchor plus a next-day
 * reversal) leaves today untouched but leaves BOTH the restated month AND the
 * following month's unrealized figure wrong, because the following mark still
 * absorbs the error it should not.
 *
 * Targets are processed in DATE ORDER and each balance is re-read after the
 * previous write — restating an earlier quarter changes every later one.
 *
 * Usage:
 *   node restate-mtm.js --account <name> --targets <csv> [--apply]
 *
 *   CSV: `as_of_date,target` (same shape as quicken-anchor.js)
 *
 * Idempotent: the amount is derived from the balance as it stands, so a
 * re-run against an already-restated account computes a zero delta and
 * rewrites the same row.
 *
 * DB: honours DATABASE_URL.
 */

'use strict';

const fs = require('node:fs');
const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL ||
  (() => { throw new Error('DATABASE_URL must be set — no insecure default'); })();

const MTM_SOURCE = 'mtm';
const MTM_DESCRIPTION = 'Unrealized G/L (feed MTM)';
const UNREALIZED_GL_CATEGORY_ID = 88;
const TOLERANCE = 0.01;
const MONEY_EPS = 0.005;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseArgs(argv) {
  const a = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--account': a.account = argv[++i]; break;
      case '--targets': a.targets = argv[++i]; break;
      case '--apply': a.apply = true; break;
      default: throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  if (!a.account) throw new Error('--account <name> is required');
  if (!a.targets) throw new Error('--targets <csv> is required');
  return a;
}

function parseTargetsCsv(text, path) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error(`${path}: expected a header and at least one row`);
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iDate = header.indexOf('as_of_date');
  const iTarget = header.indexOf('target');
  if (iDate < 0 || iTarget < 0) {
    throw new Error(`${path}: header must contain 'as_of_date' and 'target' — got ${header.join(',')}`);
  }
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const as_of_date = (cells[iDate] || '').trim();
    const raw = (cells[iTarget] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(as_of_date)) throw new Error(`${path}: bad date "${as_of_date}"`);
    const target = Number(raw);
    if (!Number.isFinite(target)) throw new Error(`${path}: bad target "${raw}" on ${as_of_date}`);
    out.push({ as_of_date, target });
  }
  out.sort((x, y) => (x.as_of_date < y.as_of_date ? -1 : x.as_of_date > y.as_of_date ? 1 : 0));
  return out;
}

async function resolveAccount(client, name) {
  // opening_balance_date as TEXT, not a JS Date: the pre-sentinel guard below
  // compares it against 'YYYY-MM-DD' target strings, and `'2026-06-30' < Date`
  // coerces the string to NaN, so the comparison is always false and the guard
  // silently never fires.
  const { rows } = await client.query(
    `SELECT id, name, currency,
            to_char(opening_balance_date, 'YYYY-MM-DD') AS opening_balance_date
       FROM accounts WHERE name = $1`,
    [name]
  );
  if (rows.length === 0) throw new Error(`no account named "${name}"`);
  if (rows.length > 1) throw new Error(`"${name}" is ambiguous — ${rows.length} accounts share it`);
  const a = rows[0];
  // A non-USD account needs an FX rate for base_amount; guessing one would
  // silently corrupt the USD invariant. Out of scope — fail loud.
  if (a.currency !== 'USD') {
    throw new Error(`"${name}" is ${a.currency}; this tool only handles USD accounts (base_amount would need an FX rate)`);
  }
  return a;
}

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
              WHERE t.account_id = a.id AND t.transaction_date <= CURRENT_DATE
                AND t.transaction_date >= a.opening_balance_date), 0)) AS bal
       FROM accounts a WHERE a.id = $1`,
    [accountId]
  );
  return Number(rows[0].bal);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = parseTargetsCsv(fs.readFileSync(args.targets, 'utf8'), args.targets);

  const pool = new Pool({ connectionString: CONN_STR });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const acct = await resolveAccount(client, args.account);

    const preSentinel = targets.filter((t) => t.as_of_date < acct.opening_balance_date);
    if (preSentinel.length > 0) {
      throw new Error(
        `${preSentinel.length} target date(s) fall before "${acct.name}"'s opening_balance_date ` +
        `(${acct.opening_balance_date}) — those rows would be invisible to every balance query.`
      );
    }

    const todayBefore = await todayBalance(client, acct.id);

    console.log(`restate-mtm — ${args.apply ? 'APPLY' : 'DRY RUN'}`);
    console.log(`account : ${acct.name} (${acct.id}), sentinel ${acct.opening_balance_date}`);
    console.log(`targets : ${targets.length} from ${args.targets}`);
    console.log('');
    console.log('date          balance        target        delta      was mtm      now mtm');
    console.log('----------  -----------  ------------  -----------  -----------  -----------');

    for (const t of targets) {
      const bal = await balanceAt(client, acct.id, t.as_of_date);
      const delta = round2(t.target - bal);

      const prior = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS amt FROM transactions
          WHERE account_id = $1 AND source = $2 AND transaction_date = $3::date`,
        [acct.id, MTM_SOURCE, t.as_of_date]
      );
      const was = Number(prior.rows[0].amt);
      const now = round2(was + delta);

      await client.query(
        `DELETE FROM transactions WHERE account_id = $1 AND source = $2 AND transaction_date = $3::date`,
        [acct.id, MTM_SOURCE, t.as_of_date]
      );
      if (Math.abs(now) >= TOLERANCE) {
        await client.query(
          `INSERT INTO transactions
             (transaction_date, description1, amount, currency, base_amount, base_currency,
              account_id, category_id, source, accepted)
           VALUES ($1, $2, $3, 'USD', $3, 'USD', $4, $5, $6, TRUE)`,
          [t.as_of_date, MTM_DESCRIPTION, now, acct.id, UNREALIZED_GL_CATEGORY_ID, MTM_SOURCE]
        );
      }

      // Re-read rather than trusting the arithmetic: the whole point is that
      // the balance lands on the custodian's figure.
      const after = await balanceAt(client, acct.id, t.as_of_date);
      const resid = round2(after - t.target);
      if (Math.abs(resid) > MONEY_EPS) {
        throw new Error(
          `${t.as_of_date}: balance ${fmt(after)} does not equal target ${fmt(t.target)} ` +
          `after restatement (residual ${fmt(resid)}). Refusing to commit.`
        );
      }

      console.log(
        `${t.as_of_date}  ${fmt(bal).padStart(11)}  ${fmt(t.target).padStart(12)}  ` +
        `${fmt(delta).padStart(11)}  ${fmt(was).padStart(11)}  ${fmt(now).padStart(11)}`
      );
    }

    const todayAfter = await todayBalance(client, acct.id);
    console.log('');
    console.log(`today   : ${fmt(todayAfter)} (was ${fmt(todayBefore)}, moved ${fmt(round2(todayAfter - todayBefore))})`);
    console.log('          expected to move — the next month-end mark re-pins this to the feed.');

    if (args.apply) {
      await client.query('COMMIT');
      console.log('\nCOMMITTED.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — rolled back. Re-run with --apply to write.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\nFAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) main();

module.exports = {
  parseTargetsCsv,
  // exported for tests: date ORDER is a correctness property, not cosmetics —
  // restating an earlier quarter changes every later balance, so an unsorted
  // CSV silently computes the later marks against a pre-correction ledger.
  parseArgs,
  MTM_SOURCE,
  MTM_DESCRIPTION,
  UNREALIZED_GL_CATEGORY_ID,
};
