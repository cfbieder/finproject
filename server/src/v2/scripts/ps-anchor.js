#!/usr/bin/env node
'use strict';
/**
 * ps-anchor.js — reconcile active balance-sheet accounts to PocketSmith's
 * authoritative closing_balance (CR019 issue #3 / §22.1 generalization).
 *
 * Why: PocketSmith records an account's pre-coverage balance ONLY in the
 * closing_balance column; its "Opening Balance" row carries amount = 0
 * (verified on acct 19 "PKO Savings": amount = 0, closing_balance = 569,970).
 * fin's balance formula is `opening_balance + Σ(amount)`, so such an account
 * under-reads by exactly that missing opening balance. This script inserts the
 * missing amount as a tagged transaction (source = 'ps-anchor') so the account's
 * computed balance — today AND historically — matches PS's closing_balance,
 * while keeping accounts.opening_balance = 0 (the codebase convention; value
 * lives in transactions).
 *
 * Two classes, distinguished by whether PS's closing_balance is a consistent
 * running total of its amounts. The identity, when it is:
 *
 *     ps_close − Σ(amount)  ==  first_ps_tx.closing_balance − first_ps_tx.amount
 *     └─ "gap" (what's missing) ┘    └─ "opening_anchor" (pre-coverage balance) ┘
 *
 *   - CLEAN  (identity holds): a missing opening balance. The whole gap is a
 *     single pre-coverage constant → FIX by inserting one anchor row = gap,
 *     dated at the first PS transaction. History reconstructs correctly.
 *   - DIVERGENT (identity fails): closing_balance moved without a matching
 *     amount — i.e. brokerage MARK-TO-MARKET (market gains aren't transactions),
 *     or a genuine missing/duplicate ledger row. REPORTED, never auto-fixed:
 *     lump-anchoring brokerage history is a separate, lossy decision (§22), and
 *     a true ledger inconsistency must be investigated, not papered over.
 *
 * Accounts under a feed-owned brokerage container (BROKERAGE_CONTAINERS) are
 * SKIPPED entirely — their balance is mark-to-market and belongs to the bank-feed
 * (`feed_balances`), so ps-anchor must not anchor them (it would re-create the
 * stale row the feed integration removes). Reported, never written.
 *
 * Idempotent: gaps are computed EXCLUDING prior 'ps-anchor' rows, and --apply
 * deletes this script's prior rows for a touched account before reinserting.
 * Safe to re-run. Computes everything from whatever DB DATABASE_URL points at —
 * NO hardcoded account ids — so it is the canonical prod cutover step (the
 * cutover model is re-run-pipeline-on-prod, so dev fixes do not travel; this
 * script does).
 *
 * Usage:
 *   node ps-anchor.js            # dry-run: classify + report, write nothing
 *   node ps-anchor.js --apply    # insert anchor rows for CLEAN accounts
 *
 * DB: honours DATABASE_URL, else defaults to the dev container connection.
 */

const { Pool } = require('pg');

const CONN_STR =
  process.env.DATABASE_URL ||
  (() => { throw new Error('DATABASE_URL must be set — no insecure default'); })();
const EPS = 0.01; // 1¢ tolerance
const ANCHOR_SOURCE = 'ps-anchor';
const ANCHOR_DESC = 'Opening Balance (PS anchor)';

// Feed-owned brokerage subtrees — ps-anchor must NOT anchor these. Their balance
// is mark-to-market and belongs to the bank-feed (`feed_balances`), not to a
// transaction-sum opening balance (a lump anchor can't track market value and
// would re-create the stale row the feed integration deletes — see CR019 §22.2 /
// project-roadmap.md Known Issue #4). Cash accounts that happen to be bank-feed-mapped
// are NOT excluded: their pre-coverage opening balance is real and the feed
// (recent transactions only) does not provide it. Extend as more brokerages land.
const BROKERAGE_CONTAINERS = ['Fidelity Stock', 'Fidelity Fixed Income'];

function parseArgs(argv) {
  const args = { apply: false };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

// Resolve USD base amount via the same monthly-rate table promote uses.
async function resolveBaseAmount(client, amount, currency, transactionDate) {
  if (currency === 'USD') return amount;
  const d = new Date(transactionDate);
  const { rows } = await client.query(
    `SELECT rate FROM budget_fx_rates WHERE currency = $1 AND year = $2 AND month = $3`,
    [currency, d.getUTCFullYear(), d.getUTCMonth() + 1]
  );
  if (rows.length === 0) return null; // caller treats null as "needs FX"
  return Math.round((amount / parseFloat(rows[0].rate)) * 10000) / 10000;
}

// Account ids whose ancestry includes a feed-owned brokerage container.
async function findFeedOwnedAccountIds(pool) {
  const { rows } = await pool.query(
    `WITH RECURSIVE containers AS (
       SELECT id FROM accounts WHERE name = ANY($1)
     ),
     down AS (
       SELECT id FROM accounts WHERE id IN (SELECT id FROM containers)
       UNION ALL
       SELECT a.id FROM accounts a JOIN down ON a.parent_id = down.id
     )
     SELECT id FROM down`,
    [BROKERAGE_CONTAINERS]
  );
  return new Set(rows.map((r) => r.id));
}

async function classify(pool, feedOwned = new Set()) {
  const { rows } = await pool.query(`
    WITH base AS (
      SELECT a.id, a.name, a.currency, a.opening_balance, a.opening_balance_date
        FROM accounts a
       WHERE a.is_active = TRUE AND a.section = 'balance_sheet'
    ),
    sums AS (
      SELECT b.id,
             COALESCE(SUM(t.amount) FILTER (WHERE t.source <> '${ANCHOR_SOURCE}'), 0) AS real_sum
        FROM base b
        LEFT JOIN transactions t
          ON t.account_id = b.id AND t.transaction_date >= b.opening_balance_date
       GROUP BY b.id
    ),
    ps_latest AS (
      SELECT DISTINCT ON (account_id) account_id, closing_balance AS ps_close
        FROM transactions
       WHERE source = 'pocketsmith' AND closing_balance IS NOT NULL
       ORDER BY account_id, transaction_date DESC, id DESC
    ),
    ps_first AS (
      SELECT DISTINCT ON (account_id) account_id,
             transaction_date AS first_date, closing_balance AS first_cb, amount AS first_amt
        FROM transactions
       WHERE source = 'pocketsmith'
       ORDER BY account_id, transaction_date ASC, id ASC
    )
    SELECT b.id, b.name, b.currency,
           b.opening_balance::float8                 AS ob,
           s.real_sum::float8                        AS real_sum,
           pl.ps_close::float8                       AS ps_close,
           pf.first_date, pf.first_cb::float8        AS first_cb,
           pf.first_amt::float8                      AS first_amt
      FROM base b
      JOIN sums s       ON s.id = b.id
      JOIN ps_latest pl ON pl.account_id = b.id          -- only accounts WITH a PS anchor
      LEFT JOIN ps_first pf ON pf.account_id = b.id
     ORDER BY b.id
  `);

  const reconciled = [];
  const clean = [];
  const divergent = [];
  const feedOwnedSkipped = [];
  for (const r of rows) {
    const computed = r.ob + r.real_sum;
    const gap = r.ps_close - computed;
    if (Math.abs(gap) <= EPS) {
      reconciled.push(r);
      continue;
    }
    // Feed-owned brokerage: never anchored (the bank-feed owns its balance).
    if (feedOwned.has(r.id)) {
      feedOwnedSkipped.push({ ...r, computed, gap });
      continue;
    }
    const openingAnchor =
      r.first_cb != null && r.first_amt != null ? r.first_cb - r.first_amt : null;
    const consistent =
      openingAnchor != null && Math.abs(openingAnchor - gap) <= EPS;
    const rec = { ...r, computed, gap, openingAnchor, consistent };
    if (consistent) clean.push(rec);
    else divergent.push(rec);
  }
  return { reconciled, clean, divergent, feedOwnedSkipped };
}

function fmt(n) {
  return n == null
    ? '—'
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: CONN_STR });

  const feedOwned = await findFeedOwnedAccountIds(pool);
  const { reconciled, clean, divergent, feedOwnedSkipped } = await classify(pool, feedOwned);

  console.log(
    `\nps-anchor — ${reconciled.length} reconciled, ${clean.length} CLEAN (fixable), ` +
      `${divergent.length} DIVERGENT (report only), ` +
      `${feedOwnedSkipped.length} FEED-OWNED (skipped)\n`
  );

  if (feedOwnedSkipped.length) {
    console.log(
      'FEED-OWNED brokerage — NOT anchored (balance belongs to the bank-feed; see\n' +
        '  CR019 §22.2 / project-roadmap.md Known Issue #4). Any existing ps-anchor row here\n' +
        '  is left untouched, to be superseded by the feed integration:'
    );
    for (const r of feedOwnedSkipped) {
      console.log(
        `  acct ${r.id} ${r.name} [${r.currency}]: computed ${fmt(r.computed)} vs ps_close ${fmt(r.ps_close)}`
      );
    }
    console.log('');
  }

  if (clean.length) {
    console.log('CLEAN — missing opening balance (will insert anchor in --apply):');
    for (const r of clean) {
      console.log(
        `  acct ${r.id} ${r.name} [${r.currency}]: computed ${fmt(r.computed)} → ps_close ` +
          `${fmt(r.ps_close)}  (anchor +${fmt(r.gap)} @ ${String(r.first_date).slice(0, 10)})`
      );
    }
    console.log('');
  }

  if (divergent.length) {
    console.log(
      'DIVERGENT — closing_balance diverges from Σ(amount): brokerage mark-to-market\n' +
        '  or a genuine ledger inconsistency. NOT auto-fixed — needs a per-account decision:'
    );
    for (const r of divergent) {
      console.log(
        `  acct ${r.id} ${r.name} [${r.currency}]: computed ${fmt(r.computed)} vs ps_close ` +
          `${fmt(r.ps_close)}  (gap ${fmt(r.gap)}; opening_anchor ${fmt(r.openingAnchor)})`
      );
    }
    console.log('');
  }

  if (!args.apply) {
    console.log('DRY-RUN — pass --apply to insert anchor rows for the CLEAN accounts above.\n');
    await pool.end();
    return;
  }

  // --apply: insert anchors for CLEAN accounts, idempotently, in one transaction.
  const client = await pool.connect();
  let inserted = 0;
  const needsFx = [];
  try {
    await client.query('BEGIN');
    for (const r of clean) {
      const baseAmount = await resolveBaseAmount(client, r.gap, r.currency, r.first_date);
      if (baseAmount == null) {
        needsFx.push(r);
        continue;
      }
      await client.query(
        `DELETE FROM transactions WHERE account_id = $1 AND source = $2`,
        [r.id, ANCHOR_SOURCE]
      );
      await client.query(
        `INSERT INTO transactions
           (account_id, category_id, transaction_date, amount, currency,
            base_amount, base_currency, description1, description2,
            source, accepted, transfer_matched)
         VALUES ($1, NULL, $2, $3, $4, $5, 'USD', $6, $7, $8, TRUE, FALSE)`,
        [
          r.id,
          r.first_date,
          r.gap,
          r.currency,
          baseAmount,
          ANCHOR_DESC,
          `PS-anchored to closing_balance ${fmt(r.ps_close)}`,
          ANCHOR_SOURCE,
        ]
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

  console.log(`APPLIED — inserted ${inserted} anchor row(s).`);
  if (needsFx.length) {
    console.log(
      `SKIPPED ${needsFx.length} (missing FX rate for anchor month — run seed-fx): ` +
        needsFx.map((r) => `${r.id} ${r.name} [${r.currency}]`).join(', ')
    );
  }

  // Re-verify: the FULL ledger balance (INCLUDING the anchor rows just written —
  // classify() excludes them for gap math, so it can't be reused here) must now
  // equal PS closing_balance for every account we anchored.
  const fixedIds = clean.filter((r) => !needsFx.includes(r)).map((r) => r.id);
  if (fixedIds.length) {
    const { rows: check } = await pool.query(
      `WITH bal AS (
         SELECT a.id, a.opening_balance + COALESCE(SUM(t.amount), 0) AS computed_all
           FROM accounts a
           LEFT JOIN transactions t
             ON t.account_id = a.id AND t.transaction_date >= a.opening_balance_date
          WHERE a.id = ANY($1)
          GROUP BY a.id
       ),
       ps AS (
         SELECT DISTINCT ON (account_id) account_id, closing_balance AS ps_close
           FROM transactions
          WHERE source = 'pocketsmith' AND closing_balance IS NOT NULL AND account_id = ANY($1)
          ORDER BY account_id, transaction_date DESC, id DESC
       )
       SELECT bal.id, (bal.computed_all - ps.ps_close)::float8 AS diff
         FROM bal JOIN ps ON ps.account_id = bal.id
        WHERE ABS(bal.computed_all - ps.ps_close) > ${EPS}`,
      [fixedIds]
    );
    if (check.length) {
      console.log(
        `\n⚠ ${check.length} anchored account(s) still off PS closing_balance: ` +
          check.map((r) => `${r.id}(${fmt(r.diff)})`).join(', ')
      );
    } else {
      console.log(
        `\n✓ All ${fixedIds.length} anchored accounts now reconcile to PS closing_balance.`
      );
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error('ps-anchor FAILED:', e.message);
  process.exit(1);
});
