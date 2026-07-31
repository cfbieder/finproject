/**
 * attribute-unrealized.js — move market movement out of the flow bucket and
 * into `Unrealized G/L`, using the custodian's own cost-basis figures.
 *
 * CR058's anchors hold the historical BALANCE correctly, but they post to
 * `Valuation - Historical`, which carries `is_transfer = TRUE`. CR056's
 * `bucketOf` sends anything with that flag straight to **flow** — so on the
 * Investment Returns report those adjustments are reported as capital the owner
 * put in or took out. For Fidelity Stocks that is +163,865.07 inside 2023's
 * "net external flows" and +156,532.59 inside 2024's, which also corrupts
 * average capital and therefore every return percentage built on it.
 *
 * The anchors are NOT wrong and are not touched. What is missing is the
 * attribution: how much of each period's change was market movement.
 *
 * §12.9 established the only non-circular source for that — market value minus
 * cost basis, from the statement's `Total Holdings` line. `Change in Investment
 * Value` cannot be used: it absorbs "Other Activity In or Out" and reports
 * +2.68M on an account that moved +107K (§12.8).
 *
 * This writes a BALANCE-NEUTRAL PAIR per period:
 *
 *     +U  →  Unrealized G/L        (category 88, is_transfer FALSE → 'price')
 *     −U  →  Valuation - Historical (category 229, is_transfer TRUE → 'flow')
 *
 * so U moves from the flow bucket to the price bucket and **no balance changes
 * by a cent** — which is the invariant asserted below, at every target date and
 * at today.
 *
 * U is a DIFFERENCE of levels: the CSV carries the unrealized *level* at each
 * statement date, and `U(D) = level(D) − level(previous D)`. The first row is a
 * baseline only and writes nothing — there is no prior level to difference
 * against, and inventing one would book the account's entire embedded gain as a
 * single period's return.
 *
 * Usage:
 *   node attribute-unrealized.js --account <name> --targets <csv> [--apply]
 *
 *   CSV: `as_of_date,level`
 *
 * Idempotent: deletes this account's prior rows from this source, then rewrites.
 *
 * DB: honours DATABASE_URL.
 */

'use strict';

const fs = require('node:fs');
const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL ||
  (() => { throw new Error('DATABASE_URL must be set — no insecure default'); })();

const SOURCE = 'statement-unrealized';
const UNREALIZED_CATEGORY_ID = 88;   // "Unrealized G/L"        — is_transfer FALSE
const VALUATION_CATEGORY_ID = 229;   // "Valuation - Historical" — is_transfer TRUE
const DESC_PRICE = 'Unrealized G/L (custodian statement)';
const DESC_OFFSET = 'Valuation reclass (custodian statement)';
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

function parseLevelsCsv(text, path) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error(`${path}: expected a header and at least one row`);
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iDate = header.indexOf('as_of_date');
  const iLevel = header.indexOf('level');
  if (iDate < 0 || iLevel < 0) {
    throw new Error(`${path}: header must contain 'as_of_date' and 'level' — got ${header.join(',')}`);
  }
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const as_of_date = (cells[iDate] || '').trim();
    const raw = (cells[iLevel] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(as_of_date)) throw new Error(`${path}: bad date "${as_of_date}"`);
    const level = Number(raw);
    if (!Number.isFinite(level)) throw new Error(`${path}: bad level "${raw}" on ${as_of_date}`);
    out.push({ as_of_date, level });
  }
  out.sort((x, y) => (x.as_of_date < y.as_of_date ? -1 : x.as_of_date > y.as_of_date ? 1 : 0));
  return out;
}

async function resolveAccount(client, name) {
  const { rows } = await client.query(
    `SELECT id, name, currency, to_char(opening_balance_date,'YYYY-MM-DD') AS sentinel
       FROM accounts WHERE name = $1`,
    [name]
  );
  if (rows.length === 0) throw new Error(`no account named "${name}"`);
  if (rows.length > 1) throw new Error(`"${name}" is ambiguous — ${rows.length} accounts share it`);
  if (rows[0].currency !== 'USD') {
    throw new Error(`"${name}" is ${rows[0].currency}; this tool only handles USD accounts`);
  }
  return rows[0];
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const levels = parseLevelsCsv(fs.readFileSync(args.targets, 'utf8'), args.targets);

  const pool = new Pool({ connectionString: CONN_STR });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const acct = await resolveAccount(client, args.account);

    const pre = levels.filter((t) => t.as_of_date < acct.sentinel);
    if (pre.length > 0) {
      throw new Error(
        `${pre.length} date(s) fall before "${acct.name}"'s opening_balance_date (${acct.sentinel}) — ` +
        `those rows would be invisible to every balance query.`
      );
    }

    // DOUBLE-COUNT GUARD. From 2025-01 both Fidelity accounts already carry
    // real Unrealized G/L postings (PocketSmith's own, then CR023 marks).
    // Attributing a period that already has one would report the same market
    // movement twice, and nothing downstream would notice — the balance is
    // unchanged either way, which is exactly why this must be checked here.
    const existing = (await client.query(
      `SELECT to_char(MIN(transaction_date),'YYYY-MM-DD') AS first
         FROM transactions
        WHERE account_id = $1 AND category_id = $2 AND source <> $3`,
      [acct.id, UNREALIZED_CATEGORY_ID, SOURCE]
    )).rows[0].first;
    if (existing) {
      const clash = levels.filter((t) => t.as_of_date >= existing);
      if (clash.length > 0) {
        throw new Error(
          `${clash.length} target date(s) fall on or after ${existing}, where "${acct.name}" already ` +
          `has Unrealized G/L postings (earliest ${clash[0].as_of_date}). That would double-count the ` +
          `same market movement. Trim the CSV to end before ${existing}.`
        );
      }
    }

    const beforeAt = {};
    for (const t of levels) beforeAt[t.as_of_date] = await balanceAt(client, acct.id, t.as_of_date);
    const todayBefore = await balanceAt(client, acct.id, 'now');

    const cleared = await client.query(
      `DELETE FROM transactions WHERE account_id = $1 AND source = $2`,
      [acct.id, SOURCE]
    );

    console.log(`attribute-unrealized — ${args.apply ? 'APPLY' : 'DRY RUN'}`);
    console.log(`account : ${acct.name} (${acct.id})`);
    console.log(`levels  : ${levels.length} from ${args.targets}`);
    if (cleared.rowCount) console.log(`cleared : ${cleared.rowCount} prior row(s)`);
    console.log(`baseline: ${levels[0].as_of_date} level ${fmt(levels[0].level)} (writes nothing)`);
    console.log('');
    console.log('date          level        Δ = unrealized for the period');
    console.log('----------  -----------  -----------');

    let written = 0;
    let total = 0;
    for (let i = 1; i < levels.length; i++) {
      const t = levels[i];
      const u = round2(t.level - levels[i - 1].level);
      total = round2(total + u);
      if (Math.abs(u) < TOLERANCE) {
        console.log(`${t.as_of_date}  ${fmt(t.level).padStart(11)}  ${fmt(u).padStart(11)}  (below tolerance — skipped)`);
        continue;
      }
      for (const [amount, categoryId, desc] of [
        [u, UNREALIZED_CATEGORY_ID, DESC_PRICE],
        [-u, VALUATION_CATEGORY_ID, DESC_OFFSET],
      ]) {
        await client.query(
          `INSERT INTO transactions
             (transaction_date, description1, amount, currency, base_amount, base_currency,
              account_id, category_id, source, accepted)
           VALUES ($1, $2, $3, 'USD', $3, 'USD', $4, $5, $6, TRUE)`,
          [t.as_of_date, desc, amount, acct.id, categoryId, SOURCE]
        );
      }
      written += 2;
      console.log(`${t.as_of_date}  ${fmt(t.level).padStart(11)}  ${fmt(u).padStart(11)}`);
    }

    // THE invariant: this reclassifies, it does not revalue. Every balance the
    // app can display must be byte-identical afterwards.
    for (const t of levels) {
      const after = await balanceAt(client, acct.id, t.as_of_date);
      const moved = round2(after - beforeAt[t.as_of_date]);
      if (Math.abs(moved) > MONEY_EPS) {
        throw new Error(
          `${t.as_of_date}: balance moved by ${fmt(moved)} — this must be balance-neutral. Refusing to commit.`
        );
      }
    }
    const todayAfter = await balanceAt(client, acct.id, 'now');
    const todayMoved = round2(todayAfter - todayBefore);
    if (Math.abs(todayMoved) > MONEY_EPS) {
      throw new Error(`today's balance moved by ${fmt(todayMoved)} — refusing to commit.`);
    }

    console.log('');
    console.log(`rows written : ${written} (${written / 2} paired periods)`);
    console.log(`reclassified : ${fmt(total)} moved from 'flow' to 'price'`);
    console.log(`balances     : unchanged at all ${levels.length} dates and today (${fmt(todayAfter)})`);

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
  parseLevelsCsv,
  parseArgs,
  SOURCE,
  UNREALIZED_CATEGORY_ID,
  VALUATION_CATEGORY_ID,
};
