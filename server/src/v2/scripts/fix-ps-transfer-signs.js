/**
 * fix-ps-transfer-signs.js — correct PocketSmith transfer rows booked with the
 * wrong sign on the Fidelity accounts.
 *
 * Two waves. The first three (2026-07-28) were found one at a time by a
 * same-signed-cluster sweep. The second six (2026-07-29) came from a much
 * stronger method — see the block comment above their entries — and extend the
 * script to `Fidelity Cash Mgt` as well as `Fidelity Stocks`.
 *
 * PocketSmith booked outgoing transfers as CREDITS. Each is corroborated by an
 * independent record, never by its description alone:
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

  // ─────────────────────────────────────────────────────────────────────────
  // Second wave (2026-07-29). Found by a stronger method than the first three:
  // the Fidelity Brokerage QIF's 2020–2022 rows sit in `quicken_staging`
  // CUTOFF-DROPPED and unpromoted, so they are an INDEPENDENT record of exactly
  // the era PocketSmith owns — they never entered the ledger and cannot be
  // circular evidence. Comparing net-per-(date, magnitude) between the two
  // systems isolates the disagreements; the ACH trace numbers then prove the
  // two records describe one event.
  //
  // Sweep to reproduce: see the roadmap's `#ps-transfer-sign-defects` entry.
  // ─────────────────────────────────────────────────────────────────────────
  {
    // Quicken: `XOut -25,000.00 -> [Chase (C)]`, memo "PPD ID: 1035141375".
    // PocketSmith carries the SAME PPD ID as a +25,000.00 credit, and Chase
    // Checking's own ledger shows the +25,000.00 arriving — so under the
    // current data the money reaches Chase from nowhere.
    //
    // Date + amount alone are ambiguous here: tx 14222 is ALSO +25,000.00 on
    // 2021-04-09 (the genuine XIn from Fidelity Cash Mgt, which Quicken and
    // PocketSmith agree on). The description fragment is what separates them,
    // and the >1-match guard below is what makes that safe.
    account: 'Fidelity Stocks',
    date: '2021-04-09',
    wrongAmount: 25000.00,
    descrLike: '%Fid Bkg Svc%',
    why: 'outgoing ACH to Chase Checking (PPD 1035141375) booked as a credit; Quicken has XOut',
  },
  {
    // Chase's Quicken row names its counterparty explicitly —
    // `+20,000.00, L=[Fidelity Cash Mgt]`, memo "PPD ID: 0368504603" — so the
    // money moved Cash Mgt → Chase. PocketSmith carries the same PPD ID as a
    // credit on Cash Mgt.
    account: 'Fidelity Cash Mgt',
    date: '2021-07-19',
    wrongAmount: 20000.00,
    descrLike: '%Fid Bkg Svc%',
    why: 'outgoing ACH to Chase Checking (PPD 0368504603) booked as a credit on both accounts',
  },
  {
    // Same shape, same proof: Chase Quicken `+15,000.00, L=[Fidelity Cash Mgt]`,
    // memo "PPD ID: 1035141375".
    account: 'Fidelity Cash Mgt',
    date: '2021-11-05',
    wrongAmount: 15000.00,
    descrLike: '%Fid Bkg Svc%',
    why: 'outgoing ACH to Chase Checking (PPD 1035141375) booked as a credit on both accounts',
  },
  {
    // Quicken: `XOut -3,699.99 -> [Fidelity EUR]`, memo "YOU EXCHANGED".
    // Fidelity EUR is not a ledger account, so there is no counterparty row to
    // corroborate with — the Quicken record is the whole of the evidence here,
    // which is weaker than the PPD-matched rows above but still a direct,
    // independent record of the same transaction.
    account: 'Fidelity Stocks',
    date: '2022-06-29',
    wrongAmount: 3699.99,
    descrLike: '%You Exchanged%',
    why: 'outgoing FX conversion to Fidelity EUR booked as a credit; Quicken has XOut',
  },
  {
    // This pair and the next are BOTH backwards, and they cancel: the ledger
    // nets to zero before and after, so no balance on any date moves. They are
    // corrected anyway because each row individually contradicts its own
    // description — "TRANSFERRED FROM" carrying a debit — and a later monthly
    // (rather than annual) anchor re-run would expose the intra-month swing.
    //
    // Quicken: +800,000.00 in from Fidelity Cash Mgt on 06-14, then
    // -800,000.00 out to Fidelity EUR on 06-15. PocketSmith has both flipped.
    account: 'Fidelity Stocks',
    date: '2022-06-14',
    wrongAmount: -800000.00,
    descrLike: '%TRANSFERRED FROM VS X94-929946-1%',
    why: 'incoming transfer from Fidelity Cash Mgt booked as a debit; Quicken has it positive',
  },
  {
    account: 'Fidelity Stocks',
    date: '2022-06-15',
    wrongAmount: 800000.00,
    descrLike: '%Transfer From Cash Management%',
    why: 'outgoing transfer to Fidelity EUR booked as a credit; Quicken has XOut',
  },
];

// NOT corrected, deliberately: 2022-11-02 on Fidelity Stocks, where the two
// systems differ by ~187,689 across two magnitudes. Quicken has +300,000.00 in
// from Cash Mgt and TWO -112,310.56 legs out to Fidelity EUR; PocketSmith has
// +300,000.00, a -300,000.00 "YOU EXCHANGED", and ONE -112,310.56. That is a
// difference in how each system modelled a USD→EUR conversion, not a sign
// error, and picking a winner needs the Fidelity statement. Flipping a sign
// here would move real money to make a heuristic happy.

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

  // Year-ends bracketing every correction, so the printed before/after shows
  // exactly which anchored periods move.
  //
  // Note 2020 DOES move (+57,399.98 on account 27) even though no 2020 row is
  // touched: `opening_balance` re-plugs upward to hold today, which lifts every
  // date BEFORE the first correction. That is the physically correct reading —
  // if 2021 money wrongly arrived, it must have been present earlier and left,
  // rather than never existing. A uniform lift of the pre-2021 ledger is
  // absorbed entirely by the FIRST valuation anchor and cancels out of every
  // interior one, so CR058's 2020 anchor is unaffected.
  const SPOT_DATES = ['2020-12-31', '2021-12-31', '2022-06-13', '2022-06-30', '2022-12-31'];

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
