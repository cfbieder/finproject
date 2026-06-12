#!/usr/bin/env node
'use strict';
/**
 * backfill-cr032-core-sweeps.js — retro-mirror Fidelity core-cash sweeps.
 *
 * CR032 makes promote auto-mirror "REDEMPTION FROM / PURCHASE INTO CORE ACCOUNT"
 * sweeps (the cash leg whose core-position counter-leg the feed never delivers).
 * Rows promoted BEFORE CR032 still lack that mirror and inflate the reconciled
 * balance (drift). This backfills them.
 *
 * SAFETY — this mutates historical financial data, so it is report-first and
 * conservative. For each core-sweep leg (source='bank-feed') it classifies:
 *   already-mirrored : an auto-offset twin (negated amount, same date+desc) exists → skip
 *   lone             : no real opposite-leg nearby → SAFE to recategorize + mirror
 *   needs-review     : a NON-sweep, NON-offset opposite-amount row sits within ±3d
 *                      (i.e. CR028 may have PAIR-neutralized this sweep against a
 *                      real trade). Mirroring would double-correct → REPORT ONLY,
 *                      never auto-written. A human decides.
 *
 * --apply writes ONLY the 'lone' rows: recategorize the leg to
 * 'Transfer - Securities Trades' and insert the negated auto-offset mirror
 * (accepted=TRUE), exactly as promote now does. Idempotent: re-runs skip
 * already-mirrored legs.
 *
 * Usage:
 *   node backfill-cr032-core-sweeps.js                 # dry-run, all accounts
 *   node backfill-cr032-core-sweeps.js --account 28    # scope to one fin account
 *   node backfill-cr032-core-sweeps.js --apply         # write the 'lone' mirrors
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 */

const { Pool } = require('pg');

const CONN_STR = process.env.DATABASE_URL ||
  (() => { throw new Error('DATABASE_URL must be set — no insecure default'); })();
const SWEEP_RE = '(REDEMPTION FROM|PURCHASE INTO) CORE ACCOUNT'; // POSIX (~*) form of CORE_SWEEP_RE
const PAIR_DAYS = 3;
const XFER_CAT = 'Transfer - Securities Trades';

function parseArgs(argv) {
  const args = { apply: false, account: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--account') args.account = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: CONN_STR });
  const summary = { 'already-mirrored': 0, lone: 0, 'needs-review': 0 };
  const reviewRows = [];
  try {
    const xferId = (await pool.query(`SELECT id FROM accounts WHERE name = $1 LIMIT 1`, [XFER_CAT])).rows[0]?.id;
    if (!xferId) throw new Error(`category not found: "${XFER_CAT}"`);

    const legs = (await pool.query(
      `SELECT t.id, t.account_id, a.name AS account, t.transaction_date::text AS dt,
              t.amount, t.base_amount, t.currency, t.base_currency, t.category_id,
              t.description1
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.source = 'bank-feed' AND t.description1 ~* $1
         AND ($2::int IS NULL OR t.account_id = $2)
       ORDER BY t.account_id, t.transaction_date, t.id`,
      [SWEEP_RE, args.account]
    )).rows;

    for (const leg of legs) {
      const hasMirror = (await pool.query(
        `SELECT 1 FROM transactions
         WHERE source='auto-offset' AND account_id=$1 AND transaction_date=$2::date
           AND amount = $3 AND description1 = $4 LIMIT 1`,
        [leg.account_id, leg.dt, -Number(leg.amount), leg.description1]
      )).rows.length > 0;

      if (hasMirror) { summary['already-mirrored']++; continue; }

      // A real opposite leg nearby = a non-sweep, non-offset row of the negated
      // amount within ±PAIR_DAYS. Signals a possible CR028 pair → don't auto-mirror.
      const realOpposite = (await pool.query(
        `SELECT id, description1, category_id FROM transactions
         WHERE account_id=$1 AND id<>$2 AND amount=$3
           AND transaction_date BETWEEN $4::date - $5::int AND $4::date + $5::int
           AND source <> 'auto-offset' AND description1 !~* $6
         ORDER BY ABS(transaction_date - $4::date), id LIMIT 1`,
        [leg.account_id, leg.id, -Number(leg.amount), leg.dt, PAIR_DAYS, SWEEP_RE]
      )).rows[0];

      if (realOpposite) {
        summary['needs-review']++;
        reviewRows.push({
          account: leg.account, dt: leg.dt, amount: leg.amount,
          leg_id: leg.id, opposite_id: realOpposite.id,
          opposite: String(realOpposite.description1).slice(0, 40),
        });
        continue;
      }

      summary.lone++;
      if (args.apply) {
        if (leg.category_id !== xferId) {
          await pool.query(`UPDATE transactions SET category_id=$1, updated_at=NOW() WHERE id=$2`, [xferId, leg.id]);
        }
        await pool.query(
          `INSERT INTO transactions
             (transaction_date, description1, amount, currency, base_amount, base_currency,
              account_id, category_id, source, accepted)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'auto-offset',TRUE)`,
          [leg.dt, leg.description1, -Number(leg.amount), leg.currency,
           leg.base_amount != null ? -Number(leg.base_amount) : null,
           leg.base_currency || 'USD', leg.account_id, xferId]
        );
      }
    }
  } finally {
    await pool.end();
  }

  console.table(summary);
  if (reviewRows.length) {
    console.log('\nNEEDS REVIEW — a real opposite leg sits nearby (possible CR028 pair); NOT mirrored:');
    console.table(reviewRows);
  }
  console.log(args.apply ? "\nApplied: 'lone' legs recategorized + mirrored." : "\nDry-run (pass --apply to write the 'lone' mirrors).");
}

main().catch((err) => { console.error(err); process.exit(1); });
