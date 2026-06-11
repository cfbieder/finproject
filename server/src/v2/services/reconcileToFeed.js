'use strict';
/**
 * reconcileToFeed.js — CR023 source-aware reconciliation engine.
 *
 * Reconciles ONE bank-feed-mapped fin account's ledger to the bank's reported
 * balance (`bankfeed_balances`), the way that account is configured
 * (`account_source_mappings.reconcile_mode`):
 *
 *   'mtm' (brokerage) — post/refresh a month-end Unrealized-G/L (category 88,
 *     source='mtm') adjustment = feed_value(monthEnd) − computed(monthEnd).
 *     A market GAIN is a positive amount on the asset account (matches the
 *     pre-existing PocketSmith 'Unrealized…' entries). Recognizes the move in
 *     P&L with a monthly audit trail, and REMOVES the CR024 balance_from_feed
 *     read-override (the entry supersedes it — opening_balance stays real).
 *
 *   'calibrate' (cash) — re-anchor opening_balance = expected − Σtx so the
 *     computed balance equals the bank's (a one-time/occasional fix, not a
 *     periodic move). Sign-aware: liabilities reconcile against −feed.
 *
 * Idempotent: an 'mtm' run deletes this month's prior mtm row before recomputing,
 * so re-running yields the same single entry. Atomic (one db.transaction).
 *
 * The action is MANUAL (button / monthly script) — never on a cron — so feed
 * gaps surface as drift instead of being silently absorbed.
 */

const db = require('../db');
const { ingestBalances } = require('./refreshBankFeedV2');

const UNREALIZED_GL_CATEGORY_ID = 88; // accounts.id "Unrealized G/L" (expense)
const MTM_SOURCE = 'mtm';
const MTM_DESCRIPTION = 'Unrealized G/L (feed MTM)';
const TOLERANCE = 0.01;
// Safety guard: an MTM amount this large a share of the feed almost certainly
// means computed never tracked market (basis unanchored) — feed−computed would
// book unrecorded principal as phantom gain. Block apply unless forced.
const MTM_IMPLAUSIBLE_PCT = 0.15;

/**
 * Convert a feed-reported balance into fin's stored sign.
 * `feed_sign` (per-mapping, migration 029) overrides; NULL falls back to the
 * account_type heuristic (liability -1, asset +1) — the pre-029 behavior.
 * GoCardless/PKO reports a liability positive (→ -feed); Plaid/SnapTrade US
 * cards report it negative (→ +feed, set feed_sign=1).
 */
function expectedFromFeed(m, feedVal) {
  const factor = m.feed_sign != null ? m.feed_sign : (m.account_type === 'liability' ? -1 : 1);
  return feedVal * factor;
}

/**
 * @param {number} accountId fin account id (must have a non-ignored bank-feed mapping)
 * @param {object} [opts]
 * @param {string|null} [opts.asOf] YYYY-MM-DD; defaults to today.
 * @param {string|null} [opts.bookDate] YYYY-MM-DD; explicit MTM booking date used
 *   VERBATIM (entry date + balance as-of), e.g. a quarter/year-end. When absent,
 *   the legacy behavior holds (snap asOf to its month-end). Ignored for calibrate.
 * @param {boolean} [opts.dryRun] compute only, write nothing.
 * @returns {Promise<object>} action summary
 */
async function reconcileToFeed(accountId, { asOf = null, dryRun = false, force = false, bookDate = null } = {}) {
  // Pre-flight (no transaction): load mapping, and for 'mtm' make sure the target
  // month-end balance is cached — the daily cron only caches recent snapshots, so
  // a month-end may be absent locally while the bank-feed service still has it.
  const m = (await db.query(
    `SELECT m.external_name, m.reconcile_mode, m.balance_from_feed, m.ignored, m.feed_sign,
            a.name, a.account_type, a.currency, a.opening_balance
     FROM account_source_mappings m JOIN accounts a ON a.id = m.account_id
     WHERE m.source = 'bank-feed' AND m.account_id = $1`,
    [accountId]
  )).rows[0];
  if (!m) throw new Error(`account ${accountId} has no bank-feed mapping`);
  if (m.ignored) throw new Error(`account ${accountId} mapping is ignored`);

  const asOfDate = (await db.query(
    `SELECT COALESCE($1::date, CURRENT_DATE)::text AS d`, [asOf]
  )).rows[0].d;

  if (m.reconcile_mode === 'mtm') {
    // Booking target: an explicit bookDate is used verbatim (lets the user align
    // the entry to a quarter/year-end); otherwise snap asOf to its month-end
    // (legacy default). Both the entry date and the balance as-of use this.
    const monthEnd = bookDate ? await normalizeDate(db, bookDate) : await resolveMonthEnd(db, asOfDate);
    const cached = (await db.query(
      `SELECT 1 FROM bankfeed_balances
       WHERE feed_account_external_id = $1 AND balance_date <= $2::date LIMIT 1`,
      [m.external_name, monthEnd]
    )).rows[0];
    if (!cached) {
      // backfill the month-end snapshot from the service (the daily cron only
      // caches recent dates). Needs BANK_FEED_URL/API_KEY in the env; if it fails
      // the engine throws a clear "no feed balance" below — surface the cause.
      try {
        await ingestBalances({ asOf: monthEnd });
      } catch (e) {
        console.warn(`[reconcileToFeed] month-end balance backfill failed (${monthEnd}): ${e.message}`);
      }
    }
    return db.transaction((client) => mtm(client, accountId, m, monthEnd, dryRun, force));
  }
  return db.transaction((client) => calibrate(client, accountId, m, asOfDate, dryRun));
}

/** Validate + normalize a YYYY-MM-DD string to a real date (throws on garbage). */
async function normalizeDate(conn, s) {
  return (await conn.query(`SELECT $1::date::text AS d`, [s])).rows[0].d;
}

/** Month-end of asOf (asOf itself if it already IS a month-end, else previous month-end). */
async function resolveMonthEnd(conn, asOfDate) {
  return (await conn.query(
    `SELECT CASE
       WHEN $1::date = (date_trunc('month',$1::date) + interval '1 month - 1 day')::date
         THEN $1::date
       ELSE (date_trunc('month',$1::date) - interval '1 day')::date
     END::text AS d`,
    [asOfDate]
  )).rows[0].d;
}

async function mtm(client, accountId, m, monthEnd, dryRun, force = false) {
  if (m.currency !== 'USD') {
    // No non-USD brokerage account exists today; fail loud rather than write a
    // wrong base_amount (USD balance sheet would mis-aggregate).
    throw new Error(`MTM for non-USD account ${accountId} (${m.currency}) not supported`);
  }

  const feed = (await client.query(
    `SELECT balance, balance_date::text AS balance_date FROM bankfeed_balances
     WHERE feed_account_external_id = $1 AND balance_date <= $2::date
     ORDER BY balance_date DESC LIMIT 1`,
    [m.external_name, monthEnd]
  )).rows[0];
  if (!feed) throw new Error(`no feed balance for account ${accountId} on/before ${monthEnd}`);

  // computed AS-OF month-end, EXCLUDING any mtm row already dated that month-end
  // (so a re-run recomputes against the same base → idempotent).
  const comp = (await client.query(
    `SELECT $2::numeric + COALESCE(SUM(amount), 0) AS computed
     FROM transactions
     WHERE account_id = $1 AND transaction_date <= $3::date
       AND NOT (source = $4 AND transaction_date = $3::date)`,
    [accountId, m.opening_balance, monthEnd, MTM_SOURCE]
  )).rows[0];

  const feedVal = Number(feed.balance);
  const computed = Number(comp.computed);
  const expected = expectedFromFeed(m, feedVal);
  const amount = Math.round((expected - computed) * 100) / 100;

  // Phantom-gain guard (Q2): an MTM this large a share of the feed means the
  // account's basis was never anchored (e.g. Bond's 33%). Flag always; block
  // apply unless forced.
  const implausiblePct = feedVal !== 0 ? Math.abs(amount) / Math.abs(feedVal) : 0;
  const implausible = implausiblePct > MTM_IMPLAUSIBLE_PCT;

  const summary = {
    account_id: accountId, name: m.name, mode: 'mtm', month_end: monthEnd,
    feed_date: feed.balance_date, feed_balance: feedVal, computed_excl_mtm: computed,
    mtm_amount: amount, category_id: UNREALIZED_GL_CATEGORY_ID,
    implausible, implausible_pct: Math.round(implausiblePct * 1000) / 1000,
    removed_read_override: false, applied: false,
  };

  if (implausible && !force) {
    summary.note = `MTM ${amount} is ${(implausiblePct * 100).toFixed(1)}% of feed — implausible ` +
      `(basis likely unanchored). Anchor the account's basis first, or pass force to override.`;
    if (!dryRun) return summary; // refuse to write; surface the reason
  }

  if (!dryRun) {
    await client.query(
      `DELETE FROM transactions WHERE account_id = $1 AND source = $2 AND transaction_date = $3::date`,
      [accountId, MTM_SOURCE, monthEnd]
    );
    if (Math.abs(amount) >= TOLERANCE) {
      await client.query(
        `INSERT INTO transactions
           (transaction_date, description1, amount, currency, base_amount, base_currency,
            account_id, category_id, source, accepted)
         VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, TRUE)`,
        [monthEnd, MTM_DESCRIPTION, amount, m.currency, amount, accountId,
         UNREALIZED_GL_CATEGORY_ID, MTM_SOURCE]
      );
    } else {
      summary.note = 'no adjustment posted (< tolerance)';
    }
    if (m.balance_from_feed) {
      await client.query(
        `UPDATE account_source_mappings SET balance_from_feed = FALSE
         WHERE source = 'bank-feed' AND external_name = $1`,
        [m.external_name]
      );
      summary.removed_read_override = true;
    }
    summary.applied = true;
  } else if (Math.abs(amount) < TOLERANCE) {
    summary.note = 'no adjustment needed (< tolerance)';
  }
  return summary;
}

async function calibrate(client, accountId, m, asOfDate, dryRun) {
  const feed = (await client.query(
    `SELECT balance, balance_date::text AS balance_date FROM bankfeed_balances
     WHERE feed_account_external_id = $1 AND balance_date <= $2::date
     ORDER BY balance_date DESC LIMIT 1`,
    [m.external_name, asOfDate]
  )).rows[0];
  if (!feed) throw new Error(`no feed balance for account ${accountId} on/before ${asOfDate}`);

  const feedVal = Number(feed.balance);
  const expected = expectedFromFeed(m, feedVal);
  const sumTx = Number((await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM transactions WHERE account_id = $1`,
    [accountId]
  )).rows[0].s);
  const newOpening = Math.round((expected - sumTx) * 100) / 100;

  const summary = {
    account_id: accountId, name: m.name, mode: 'calibrate', as_of: asOfDate,
    feed_date: feed.balance_date, feed_balance: feedVal, expected, sum_tx: sumTx,
    old_opening: Number(m.opening_balance), new_opening: newOpening, applied: false,
  };

  if (!dryRun) {
    await client.query(
      `UPDATE accounts SET opening_balance = $2, opening_balance_date = '2000-01-01' WHERE id = $1`,
      [accountId, newOpening]
    );
    summary.applied = true;
  }
  return summary;
}

module.exports = { reconcileToFeed, UNREALIZED_GL_CATEGORY_ID, MTM_SOURCE };
