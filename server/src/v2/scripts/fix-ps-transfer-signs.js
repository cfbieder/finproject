/**
 * fix-ps-transfer-signs.js — correct PocketSmith transfer rows booked with the
 * wrong sign on Fidelity Stocks.
 *
 * PocketSmith booked two outgoing transfers as CREDITS. Each was found by a
 * different independent method and each is corroborated by a counterparty:
 *
 *   2020-08-26  +617,957.20  "Transferred From Vs X27-2309 …"
 *       A 617,957.20 transfer to Fidelity Cash Mgt, booked as a credit on BOTH
 *       accounts with no opposing leg anywhere in the ledger. The counterparty
 *       shows the money ARRIVING in Cash Mgt, and Quicken records it leaving
 *       Stocks as `XOut -617,957.20`.
 *
 *   2020-11-04  +100,000.00  "ELECTRONIC FUNDS TRANSFER PAID"
 *       Paired against a Chase Checking +100,000.00 "Fid Bkg Svc" row from the
 *       Quicken import — both legs positive. "PAID" is outgoing.
 *       (NOT the two Feb-2020 `Fid Bkg Svc` rows CR056 identified as genuine
 *       deposits — those are different rows and are left alone.)
 *
 * Both went unnoticed for six years because `accounts.opening_balance` is a plug
 * that absorbs them: today's balance stays right while every date BEFORE the row
 * is understated. Correcting the sign therefore requires re-plugging
 * `opening_balance` by the same total, or today's balance moves.
 *
 * Corroboration that these are real: correcting them collapses CR058's 2020
 * valuation anchor from -1,445,246.13 to -9,331.73, i.e. Quicken and PocketSmith
 * come to agree on 2020 to within 2.4% of a 383,389.13 account.
 *
 * Accounts are resolved BY NAME (dev and prod ids differ) per CR019 §22.2.
 * Idempotent: a row is only flipped if it still carries the wrong sign, so a
 * re-run is a no-op. Dry-run by default; --apply writes.
 *
 * Usage:
 *   node fix-ps-transfer-signs.js [--apply]
 *
 * DB: honours DATABASE_URL. Reverse by flipping the signs back and subtracting
 * the same total from opening_balance (the script prints both).
 */

'use strict';

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL ||
  (() => { throw new Error('DATABASE_URL must be set — no insecure default'); })();

const MONEY_EPS = 0.01;

// Each correction is matched structurally: account NAME + date + the exact
// wrong amount + a description fragment. All four must match, so the script
// cannot touch a row that has already been fixed or a similar-looking sibling.
const CORRECTIONS = [
  {
    account: 'Fidelity Stocks',
    date: '2020-08-26',
    wrongAmount: 617957.20,
    descrLike: '%Transferred From Vs X27-2309%',
    why: 'transfer to Fidelity Cash Mgt booked as a credit on both accounts',
  },
  {
    account: 'Fidelity Stocks',
    date: '2020-11-04',
    wrongAmount: 100000.00,
    descrLike: '%ELECTRONIC FUNDS TRANSFER PAID%',
    why: 'outgoing ACH to Chase Checking booked as a credit on both accounts',
  },
  {
    // Third of the same class, found by the same sweep. Quicken records
    // `XOut -5,400.00` to `Chase (C)` on this date with payee "Fid Bkg Svc",
    // and Chase Checking carries the matching +5,400.00 from the Quicken
    // import — so the money left Fidelity Stocks.
    //
    // NOTE the description alone does NOT establish direction: "Fid Bkg Svc"
    // appears 4 times on this account and runs BOTH ways — CR056 confirmed the
    // two Feb-2020 instances as genuine deposits INTO Fidelity. What decides
    // this one is the same-date Quicken XOut plus the Chase counterparty, which
    // is why the match is pinned to date + exact amount, not description.
    account: 'Fidelity Stocks',
    date: '2022-07-05',
    wrongAmount: 5400.00,
    descrLike: '%Fid Bkg Svc%',
    why: 'outgoing ACH to Chase Checking booked as a credit on both accounts',
  },
];

const fmt = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function computedBalance(client, accountId) {
  const { rows } = await client.query(
    `SELECT (a.opening_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t
              WHERE t.account_id = a.id
                AND t.transaction_date >= a.opening_balance_date), 0)) AS bal
       FROM accounts a WHERE a.id = $1`,
    [accountId]
  );
  return Number(rows[0].bal);
}

async function historyAt(client, accountId, dates) {
  const out = [];
  for (const d of dates) {
    const { rows } = await client.query(
      `SELECT (a.opening_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t
                WHERE t.account_id = a.id AND t.transaction_date <= $2
                  AND t.transaction_date >= a.opening_balance_date), 0)) AS bal
         FROM accounts a WHERE a.id = $1`,
      [accountId, d]
    );
    out.push({ date: d, bal: Number(rows[0].bal) });
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const pool = new Pool({ connectionString: CONN_STR });
  const client = await pool.connect();

  const SPOT_DATES = ['2020-01-31', '2020-08-25', '2020-08-27', '2020-11-05', '2020-12-31'];

  try {
    await client.query('BEGIN');

    // Resolve accounts by name and collect the rows that still need fixing.
    const planned = [];
    for (const c of CORRECTIONS) {
      const { rows: acct } = await client.query(
        `SELECT id FROM accounts WHERE name = $1 AND section = 'balance_sheet'`,
        [c.account]
      );
      if (acct.length !== 1) {
        throw new Error(
          `expected exactly 1 balance-sheet account named "${c.account}", found ${acct.length}`
        );
      }
      const accountId = acct[0].id;

      const { rows } = await client.query(
        `SELECT id, amount, description1 FROM transactions
          WHERE account_id = $1 AND transaction_date = $2
            AND amount = $3 AND description1 ILIKE $4 AND source = 'pocketsmith'`,
        [accountId, c.date, c.wrongAmount, c.descrLike]
      );
      if (rows.length > 1) {
        throw new Error(`ambiguous match for ${c.account} ${c.date} ${c.wrongAmount}: ${rows.length} rows`);
      }
      planned.push({ ...c, accountId, row: rows[0] || null });
    }

    const toFix = planned.filter((p) => p.row);
    const accountIds = [...new Set(planned.map((p) => p.accountId))];

    console.log(`fix-ps-transfer-signs — ${apply ? 'APPLY' : 'DRY RUN'}\n`);
    for (const p of planned) {
      if (p.row) {
        console.log(`  FIX  ${p.account} ${p.date}  ${fmt(p.row.amount)} → ${fmt(-p.wrongAmount)}`);
        console.log(`       ${p.why}`);
      } else {
        console.log(`  skip ${p.account} ${p.date}  ${fmt(p.wrongAmount)} — already corrected or absent`);
      }
    }

    if (toFix.length === 0) {
      console.log('\nNothing to do — already idempotent-clean.');
      await client.query('ROLLBACK');
      return;
    }

    const before = {};
    const beforeHist = {};
    for (const id of accountIds) {
      before[id] = await computedBalance(client, id);
      beforeHist[id] = await historyAt(client, id, SPOT_DATES);
    }

    // Flip signs, and re-plug opening_balance by the same total so TODAY's
    // computed balance is unchanged (it is already correct — the feed owns it).
    let totalDelta = 0;
    for (const p of toFix) {
      await client.query(`UPDATE transactions SET amount = $2 WHERE id = $1`, [
        p.row.id,
        -p.wrongAmount,
      ]);
      totalDelta += -p.wrongAmount - Number(p.row.amount); // negative
    }
    for (const id of accountIds) {
      const delta = toFix
        .filter((p) => p.accountId === id)
        .reduce((s, p) => s + (-p.wrongAmount - Number(p.row.amount)), 0);
      await client.query(
        `UPDATE accounts SET opening_balance = opening_balance - $2 WHERE id = $1`,
        [id, delta]
      );
    }

    // Invariant: today's balance must be unchanged on every touched account.
    const mismatches = [];
    for (const id of accountIds) {
      const after = await computedBalance(client, id);
      if (Math.abs(after - before[id]) > MONEY_EPS) {
        mismatches.push(`acct=${id} before=${fmt(before[id])} after=${fmt(after)}`);
      }
    }
    if (mismatches.length > 0) {
      throw new Error(`today's balance moved on ${mismatches.length} account(s): ${mismatches.join('; ')}`);
    }

    console.log(`\n  rows corrected      : ${toFix.length}`);
    console.log(`  ledger delta        : ${fmt(totalDelta)}`);
    console.log(`  opening_balance     : re-plugged by ${fmt(-totalDelta)} (today preserved)`);

    for (const id of accountIds) {
      console.log(`\n  account ${id} — today unchanged at ${fmt(before[id])}`);
      const after = await historyAt(client, id, SPOT_DATES);
      console.log('    date          before          after           change');
      for (let i = 0; i < SPOT_DATES.length; i++) {
        const b = beforeHist[id][i].bal;
        const a = after[i].bal;
        console.log(
          `    ${SPOT_DATES[i]}  ${fmt(b).padStart(14)}  ${fmt(a).padStart(14)}  ${fmt(a - b).padStart(14)}`
        );
      }
    }

    if (apply) {
      await client.query('COMMIT');
      console.log('\nCOMMITTED.');
    } else {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — rolled back. Re-run with --apply to write.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\nFAILED (rolled back): ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
