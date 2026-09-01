'use strict';

const { sumWithinBalanceWindow, BALANCE_WINDOW_FLOOR_SQL } = require('./openingBalanceWindow');
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
const { usdBaseAmount } = require('./fx');

const UNREALIZED_GL_CATEGORY_ID = 88; // accounts.id "Unrealized G/L" (expense)
const MTM_SOURCE = 'mtm';
const MTM_DESCRIPTION = 'Unrealized G/L (feed MTM)';
const ACCRUAL_SOURCE = 'accrual';
const ACCRUAL_DESCRIPTION = 'Yield accrual (feed-derived)';
const TOLERANCE = 0.01;
// CR080: plausible band for the implied ANNUALISED yield an `accrue` run books.
// This replaces mtm's %-of-balance test, which cannot do this job: a missed 500
// transfer on a 4,100 balance is 12% — inside mtm's 15% threshold — and would be
// booked as income permanently, where an mtm row at least re-marks against the
// feed next period and self-corrects. A rate band asks the only question that
// separates yield from a missing transaction: does it accrue like interest?
const ACCRUAL_MIN_APY = -0.01; // a fund CAN dip; a sustained negative cannot be yield
const ACCRUAL_MAX_APY = 0.10;
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
 * @param {string|null} [opts.balanceDate] YYYY-MM-DD; which OBSERVATION to mark
 *   against, when it is not the one the booking date would pick. The feed labels
 *   a balance with the date it was SYNCED, and it syncs in the small hours — so
 *   the row dated D reflects an earlier close, and D's own close lands on a later
 *   row. Lets the caller say "book at month-end, using the observation that
 *   actually contains it" without this code guessing a lag rule it cannot yet
 *   prove (calendar vs business days — roadmap Known Issue #14).
 * @param {boolean} [opts.dryRun] compute only, write nothing.
 * @returns {Promise<object>} action summary. A run the engine DECLINES to write
 *   returns `refused: true` with `applied: false` and a `note` saying why — on a
 *   dry run too, so a preview can say it BEFORE the owner approves a figure that
 *   will never be booked. `refused` is always present on every mode's summary:
 *   an absent-means-false flag is how the UI's refusal gate came to read
 *   `undefined` on every feed reconcile and offer Apply on a run that could not
 *   succeed (only reconcileManual set the equivalent `blocked`).
 */
async function reconcileToFeed(accountId, { asOf = null, dryRun = false, force = false, bookDate = null, balanceDate = null, expect = null, liveFeedAccountIds = null } = {}) {
  // Pre-flight (no transaction): load mapping, and for 'mtm' make sure the target
  // month-end balance is cached — the daily cron only caches recent snapshots, so
  // a month-end may be absent locally while the bank-feed service still has it.
  const m = (await db.query(
    `SELECT m.external_name, m.reconcile_mode, m.balance_from_feed, m.ignored, m.feed_sign,
            m.accrual_category_id,
            a.name, a.account_type, a.currency, a.opening_balance
     FROM account_source_mappings m JOIN accounts a ON a.id = m.account_id
     WHERE m.source = 'bank-feed' AND m.account_id = $1`,
    [accountId]
  )).rows[0];
  if (!m) throw new Error(`account ${accountId} has no bank-feed mapping`);
  if (m.ignored) throw new Error(`account ${accountId} mapping is ignored`);

  // ── CR060: refuse to reconcile a mapping that points at nothing ────────────
  //
  // Since CR059 P3a `external_name` IS fintable's account id, and a bank
  // reconnect can mint a NEW one. The mapping then resolves to no feed account —
  // but fin's `bankfeed_balances` cache still holds the OLD id's rows, so the
  // feed side does not go blank, it FREEZES. Reconciling against it would
  // re-anchor `opening_balance` (calibrate) or book a yield (accrue) from a
  // figure the bank has not reported since the reconnect, permanently and with
  // nothing to say the number was stale. That is CR080's fabricated −32.56 loss
  // in a new costume, and that one took three migrations to undo.
  //
  // ⚠️ Only when the caller could actually ASK. A null set means the account
  // list was unavailable, and refusing every reconcile because bank-feed blipped
  // would be a worse failure than the one being guarded against — the same
  // could-not-ask rule the health surface and the orphan report both keep.
  //
  // `force` overrides, as everywhere else here: the owner may know the mapping
  // is about to be repointed and want the run anyway.
  if (liveFeedAccountIds && liveFeedAccountIds.size > 0
      && !liveFeedAccountIds.has(String(m.external_name)) && !force) {
    return {
      account_id: accountId, name: m.name, mode: m.reconcile_mode,
      refused: true, applied: false, feed_orphaned: true,
      note: `this account's mapping points at feed account ${m.external_name}, which the feed no ` +
        `longer carries — most likely a bank reconnect re-keyed it. The bank figures shown are the ` +
        `last ones cached before that happened, so reconciling now would anchor the account to a ` +
        `stale number. Re-map it to its new feed account first (Bank feed diagnostic), or pass force.`,
    };
  }

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
    const markAgainst = balanceDate ? await normalizeDate(db, balanceDate) : null;
    return db.transaction((client) => mtm(client, accountId, m, monthEnd, dryRun, force, markAgainst));
  }

  if (m.reconcile_mode === 'accrue') {
    return db.transaction((client) => accrue(client, accountId, m, asOfDate, dryRun, force, balanceDate));
  }

  // An UNRECOGNISED mode must not silently fall through to calibrate. This was a
  // live hazard the moment a third mode existed: `calibrate` rewrites
  // opening_balance, so a mapping set to a mode this build does not know — a DB
  // migrated ahead of its code, which is the REQUIRED deploy order here — would
  // have re-anchored the account on the next Reconcile click and destroyed
  // exactly the history migration 065 had just booked. Refuse instead.
  if (m.reconcile_mode !== 'calibrate') {
    throw new Error(
      `account ${accountId} (${m.name}) has reconcile_mode '${m.reconcile_mode}', which this build ` +
      `does not implement — refusing rather than falling back to calibrate, which would rewrite ` +
      `opening_balance. Deploy the code that implements this mode, or set the mapping back.`
    );
  }
  return db.transaction((client) => calibrate(client, accountId, m, asOfDate, dryRun, expect));
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

async function mtm(client, accountId, m, monthEnd, dryRun, force = false, markAgainst = null) {
  // The three most recent feed observations on/before the observation date. One
  // row is enough to compute a mark; three are needed to tell a MOVING feed from
  // a STALLED one, which is the difference between a real month-end value and a
  // carried-forward one.
  //
  // `markAgainst` (CR065 §11) decouples WHICH OBSERVATION we mark against from
  // WHICH DATE the entry carries. They are not the same question: the feed labels
  // a balance with the date it was synced, and it syncs in the small hours, so
  // the row dated D was taken before D traded.
  const observationDate = markAgainst || monthEnd;
  const feedRows = (await client.query(
    `SELECT balance, balance_date::text AS balance_date, fetched_at,
            source_synced_at,
            (source_synced_at AT TIME ZONE 'UTC')::date::text AS synced_on
       FROM bankfeed_balances
      WHERE feed_account_external_id = $1 AND balance_date <= $2::date
      ORDER BY balance_date DESC LIMIT 3`,
    [m.external_name, observationDate]
  )).rows;
  const feed = feedRows[0];
  if (!feed) throw new Error(`no feed balance for account ${accountId} on/before ${monthEnd}`);

  // ── Stale-feed guard ──────────────────────────────────────────────────────
  // A month-end mark pins the account to whatever the feed says on that date,
  // so it is only as good as the feed being CURRENT on that date. Twice in
  // 2026 it was not, and both times the mark silently locked in a stale number
  // that no later check could see:
  //
  //   Bond, 2026-05-31 — the 05-31 row was not fetched until 06-04, so the mark
  //     fell back to an earlier date's balance and left the ledger a CONSTANT
  //     9,815.27 below the feed, which June's mark then inherited as its base.
  //
  //   Stocks + IRA, 2026-06-30 — all four Fidelity feeds went flat 06-28→06-30
  //     (one connection stalling) and the 06-30 row was not fetched until 07-03.
  //     The true 30-June closes arrived on the row dated 07-02: Stocks
  //     -28,417.32 and IRA -3,243.65 understated at month end.
  //
  // Two distinct signals, because neither catches both cases:
  //   (a) no row dated month-end at all — the feed has not reported that day,
  //       so marking it is asserting a value nobody supplied;
  //   (b) the month-end balance is identical across three consecutive
  //       observations — a security-holding account does not sit still for
  //       three days, so this is a stalled connection, not a quiet account.
  //       (Only `mtm` accounts reach here, and all of them hold securities;
  //       genuinely static cash accounts use `calibrate`.)
  // ── (c) CR065 §11: the row has the right DATE and the wrong CONTENTS ───────
  //
  // The two guards above test the date LABEL. Neither can see a row that is
  // labelled for the booking day but was taken BEFORE that day happened — and
  // that is the common case here, because the feed syncs in the small hours:
  //
  //   Fidelity Stocks, marking 2026-07-31 (a Friday). The row dated 07-31 was
  //     synced at 01:48 ON 07-31, so it predates Friday's trading. Marking
  //     against it booked -44,600.45 and left the account 24,352.57 BELOW the
  //     custodian. Friday's actual close sits on the row dated 08-02 — provable
  //     because 08-01 and 08-02 are a weekend, so Friday's close and "today"
  //     must be the same number, and they are not.
  //
  //   Fidelity Cash Mgt, same day: the 07-31 row predates that day's -41,564.86
  //     wire, and proposed +40,150.79 — a 3.6% one-month unrealized gain on a CD
  //     ladder held at PAR, under the implausibility threshold and so unflagged.
  //
  // So: an observation may only mark a day it could actually contain. Deliberately
  // NOT a lag rule — how far behind the feed runs, and whether in calendar or
  // business days, is still unproven (Known Issue #14). This refuses what is
  // provably wrong and leaves `balanceDate` to state what is right.
  const syncedBeforeDayEnded = feed.synced_on != null && feed.synced_on <= monthEnd;

  // When refusing, hand back the observations that COULD contain the day, with
  // their balances — so the caller can pick one on the evidence rather than
  // guessing a lag. This is how the 2026-07-31 case was actually settled: 07-31
  // was a Friday, so its close had to equal the weekend's, and only one
  // candidate matched.
  let laterObservations = [];
  if (syncedBeforeDayEnded) {
    laterObservations = (await client.query(
      `SELECT balance_date::text AS balance_date, balance,
              (source_synced_at AT TIME ZONE 'UTC')::date::text AS synced_on
         FROM bankfeed_balances
        WHERE feed_account_external_id = $1 AND balance_date > $2::date
        ORDER BY balance_date ASC LIMIT 4`,
      [m.external_name, monthEnd]
    )).rows.map((r) => ({ ...r, balance: Number(r.balance) }));
  }

  const feedIsForMonthEnd = feed.balance_date === observationDate;
  const flatRun =
    feedRows.length === 3 &&
    Number(feedRows[0].balance) === Number(feedRows[1].balance) &&
    Number(feedRows[1].balance) === Number(feedRows[2].balance);
  const stale = !feedIsForMonthEnd || flatRun || syncedBeforeDayEnded;
  const staleReason = !feedIsForMonthEnd
    ? `feed has no balance dated ${observationDate} — latest is ${feed.balance_date}`
    : flatRun
      ? `feed balance unchanged across ${feedRows.map((r) => r.balance_date).reverse().join(', ')} — connection likely stalled`
      : syncedBeforeDayEnded
        ? `the balance dated ${feed.balance_date} was synced on ${feed.synced_on}, so it was taken ` +
          `BEFORE ${monthEnd} ended and cannot contain that day's activity. Mark against a later ` +
          `observation instead (balanceDate), or pass force to override.` +
          (laterObservations.length
            ? ` Later observations: ${laterObservations
                .map((o) => `${o.balance_date} = ${o.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
                .join(' · ')}.`
            : '')
        : null;

  // computed AS-OF month-end, EXCLUDING any mtm row already dated that month-end
  // (so a re-run recomputes against the same base → idempotent).
  const comp = (await client.query(
    `SELECT $2::numeric + COALESCE(SUM(amount), 0) AS computed
     FROM transactions
     WHERE account_id = $1 AND transaction_date <= $3::date
       ${BALANCE_WINDOW_FLOOR_SQL}
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
    feed_date: feed.balance_date, feed_synced_on: feed.synced_on,
    feed_balance: feedVal, computed_excl_mtm: computed,
    mtm_amount: amount, category_id: UNREALIZED_GL_CATEGORY_ID,
    implausible, implausible_pct: Math.round(implausiblePct * 1000) / 1000,
    stale_feed: stale, stale_reason: staleReason, later_observations: laterObservations,
    removed_read_override: false, refused: false, applied: false,
  };

  // USD base_amount for the (account-currency) MTM amount — needed only when an
  // entry will actually be posted. Non-USD accounts convert via the FX table; a
  // missing rate is a hard blocker (can't book a correct balance-sheet figure).
  let baseAmount = null;
  if (Math.abs(amount) >= TOLERANCE) {
    baseAmount = await usdBaseAmount(client, amount, m.currency, monthEnd);
    if (baseAmount == null) {
      throw new Error(`no USD exchange rate for ${m.currency} on/before ${monthEnd} — cannot book MTM for account ${accountId} (${m.name})`);
    }
    summary.base_amount = baseAmount;
  }

  // Checked BEFORE the implausibility guard: a stale feed makes the computed
  // amount meaningless, so reporting it as "implausible" would name the symptom
  // and hide the cause.
  if (stale && !force) {
    summary.note = `stale feed — ${staleReason}. Marking ${monthEnd} against it would pin the ` +
      `account to a value the custodian never reported. Wait for the feed to settle (it has run ` +
      `~2 days behind month-end), or pass force to override.`;
    summary.refused = true;
    if (!dryRun) return summary; // refuse to write; surface the reason
  }

  if (implausible && !force && !summary.refused) {
    summary.note = `MTM ${amount} is ${(implausiblePct * 100).toFixed(1)}% of feed — implausible ` +
      `(basis likely unanchored). Anchor the account's basis first, or pass force to override.`;
    summary.refused = true;
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
        [monthEnd, MTM_DESCRIPTION, amount, m.currency, baseAmount, accountId,
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

/**
 * CR080 `accrue` — book the yield a feed reports in its BALANCE but never posts
 * as a transaction (Wise Assets: the money sits in a money-market fund, and the
 * feed delivers only the monthly service fee charged against the yield).
 *
 * Deliberately a SIBLING of `mtm()` rather than a parameterization of it. The two
 * share the plug arithmetic and little else: mtm's month-end snap, flat-run
 * detection and %-of-balance threshold are all wrong here, and threading four
 * behaviour flags through one function to express that would be harder to read —
 * and riskier to a working mtm — than the ~20 lines they have in common.
 *
 * Three things differ from mtm, and each is the fix to a specific way this can lie:
 *
 *   1. The booking date is the OBSERVATION'S OWN `balance_date`, and only an
 *      observation the feed synced AFTER that day ended is eligible. Booking on
 *      the click date against the newest row would turn any transaction fin has
 *      recorded ahead of the feed into "yield" — near-certain on an active day
 *      with a feed that syncs in the small hours (CR065 §11).
 *   2. The category comes from the mapping and there is NO default. Falling back
 *      to Unrealized G/L would silently reintroduce the exact defect CR080 exists
 *      to fix: yield booked to an expense category, invisible to income and tax.
 *   3. The guard is a RATE, not a share of balance — see ACCRUAL_MIN/MAX_APY.
 */
async function accrue(client, accountId, m, asOfDate, dryRun, force = false, balanceDate = null) {
  if (m.accrual_category_id == null) {
    throw new Error(
      `account ${accountId} (${m.name}) is set to 'accrue' but has no accrual_category_id — ` +
      `set the income category this account's yield belongs to before reconciling`
    );
  }

  // ── Which day can this observation speak for? ────────────────────────────────
  //
  // NOT the date it is labelled with. Measured across this feed's whole history,
  // `synced_on - balance_date` is 0 (53 rows), -1 (29) or -2 (2) and NEVER
  // positive: the feed labels a balance with the date it was synced, or with a
  // date up to two days AHEAD of the sync. So a row dated D was in general taken
  // before D happened, and pairing it with fin's balance on D would count fin's
  // own later transactions for that day as yield.
  //
  //     bookDate = LEAST(balance_date, synced_on - 1)
  //
  // — the last day the observation can be presumed to fully contain, correct in
  // all three regimes: labelled ahead of the sync (take synced_on-1), labelled on
  // the sync day (same), and genuinely settled, synced after the labelled day
  // ended (take balance_date, losing nothing).
  //
  // This is deliberately a CONSERVATIVE PAIRING, not a claim about the feed's
  // true lag — whether that lag runs in calendar or business days is still
  // unproven (roadmap Known Issue #14, and CR065 §11 declined to guess it). It
  // can only ever under-claim a day, which costs one day of accrual that the next
  // run picks up, where over-claiming books a real transaction as income forever.
  //
  // A NULL `source_synced_at` (rows predating CR035's sync-time capture) cannot be
  // placed at all and is excluded unless the caller names it via `balanceDate`.
  const obs = (await client.query(
    balanceDate
      ? `SELECT balance, balance_date::text AS balance_date,
                (source_synced_at AT TIME ZONE 'UTC')::date::text AS synced_on,
                $3::date AS book_date
           FROM bankfeed_balances
          WHERE feed_account_external_id = $1 AND balance_date = $2::date`
      : `SELECT balance, balance_date::text AS balance_date,
                (source_synced_at AT TIME ZONE 'UTC')::date::text AS synced_on,
                LEAST(balance_date,
                      (source_synced_at AT TIME ZONE 'UTC')::date - 1) AS book_date
           FROM bankfeed_balances
          WHERE feed_account_external_id = $1
            AND balance_date <= $2::date
            AND source_synced_at IS NOT NULL
          ORDER BY LEAST(balance_date,
                         (source_synced_at AT TIME ZONE 'UTC')::date - 1) DESC,
                   balance_date DESC
          LIMIT 1`,
    balanceDate
      ? [m.external_name, balanceDate, balanceDate]
      : [m.external_name, asOfDate]
  )).rows[0];

  if (!obs) {
    throw new Error(
      `no usable feed balance for account ${accountId} on/before ${asOfDate} — no observation ` +
      `carries a sync time, so none can be placed against a day. Pass balanceDate to name the ` +
      `observation to use.`
    );
  }

  const bookDate = (await client.query(`SELECT $1::date::text AS d`, [obs.book_date])).rows[0].d;

  // An accrual already booked LATER than the day this observation can speak for
  // means the period is already closed past this point. Booking here would double
  // count it: the later row sits outside the `<= bookDate` base and would be added
  // again. Refuse rather than silently re-recognise income.
  const laterAccrual = (await client.query(
    `SELECT MAX(transaction_date)::text AS d FROM transactions
      WHERE account_id = $1 AND source = $2 AND transaction_date > $3::date`,
    [accountId, ACCRUAL_SOURCE, bookDate]
  )).rows[0].d;
  if (laterAccrual) {
    throw new Error(
      `account ${accountId} (${m.name}) already has an accrual dated ${laterAccrual}, later than the ` +
      `${bookDate} this feed observation can speak for — the feed has not advanced past the last ` +
      `booking yet. Wait for a newer observation.`
    );
  }

  // The period this accrual covers, for the rate guard: since the last accrual
  // row, or — on the first ever run — since the earliest feed observation, which
  // is the earliest date any of this is evidenced from.
  const period = (await client.query(
    `SELECT COALESCE(
              (SELECT MAX(transaction_date) FROM transactions
                WHERE account_id = $1 AND source = $3 AND transaction_date < $2::date),
              (SELECT MIN(balance_date) FROM bankfeed_balances
                WHERE feed_account_external_id = $4)
            )::text AS since`,
    [accountId, bookDate, ACCRUAL_SOURCE, m.external_name]
  )).rows[0];

  const days = period.since
    ? (await client.query(`SELECT ($1::date - $2::date) AS d`, [bookDate, period.since])).rows[0].d
    : null;

  // computed AS-OF the booking date, EXCLUDING any accrual row already dated it
  // (so a re-run recomputes against the same base → idempotent). Earlier accrual
  // rows are deliberately INCLUDED: they are booked income, not part of the gap.
  const comp = (await client.query(
    `SELECT $2::numeric + COALESCE(SUM(amount), 0) AS computed
     FROM transactions
     WHERE account_id = $1 AND transaction_date <= $3::date
       ${BALANCE_WINDOW_FLOOR_SQL}
       AND NOT (source = $4 AND transaction_date = $3::date)`,
    [accountId, m.opening_balance, bookDate, ACCRUAL_SOURCE]
  )).rows[0];

  const feedVal = Number(obs.balance);
  const computed = Number(comp.computed);
  const expected = expectedFromFeed(m, feedVal);
  const amount = Math.round((expected - computed) * 100) / 100;

  // ── The guard ────────────────────────────────────────────────────────────────
  // Annualise what this run would book over the period it covers and require it
  // to look like a yield. A missing transaction does not accrue linearly, so it
  // lands far outside the band; genuine yield sits inside it by construction.
  const apy = days > 0 && Math.abs(computed) > 0
    ? (amount / Math.abs(computed)) * (365 / Number(days))
    : null;
  const implausible = apy === null || apy < ACCRUAL_MIN_APY || apy > ACCRUAL_MAX_APY;

  const summary = {
    account_id: accountId, name: m.name, mode: 'accrue', book_date: bookDate,
    feed_date: obs.balance_date, feed_synced_on: obs.synced_on,
    feed_balance: feedVal, computed_excl_accrual: computed,
    accrual_amount: amount, category_id: m.accrual_category_id,
    period_since: period.since, period_days: days === null ? null : Number(days),
    implied_apy: apy === null ? null : Math.round(apy * 10000) / 10000,
    implausible, refused: false, applied: false,
  };

  let baseAmount = null;
  if (Math.abs(amount) >= TOLERANCE) {
    // Always via the helper — never a re-derivation of the conversion rule. An
    // inline copy in migration 065 dropped its USD-is-1 case and wrote four NULL
    // base_amounts that migration 066 had to repair.
    baseAmount = await usdBaseAmount(client, amount, m.currency, bookDate);
    if (baseAmount == null) {
      throw new Error(`no USD exchange rate for ${m.currency} on/before ${bookDate} — cannot book accrual for account ${accountId} (${m.name})`);
    }
    summary.base_amount = baseAmount;
  }

  if (implausible && !force) {
    summary.note = apy === null
      ? `cannot establish the period this accrual covers (no prior accrual row and no feed history), ` +
        `so the yield it implies cannot be checked. Pass force to book it anyway.`
      : `${amount} over ${days} day(s) on ${computed.toFixed(2)} implies ${(apy * 100).toFixed(2)}%/yr, ` +
        `outside the plausible band ${(ACCRUAL_MIN_APY * 100).toFixed(0)}%..${(ACCRUAL_MAX_APY * 100).toFixed(0)}%. ` +
        `A gap that does not accrue like yield is usually a MISSING TRANSACTION — booking it here would ` +
        `file it as income permanently. Find the transaction, or pass force.`;
    summary.refused = true;
    if (!dryRun) return summary; // refuse to write; surface the reason
  }

  if (!dryRun) {
    await client.query(
      `DELETE FROM transactions WHERE account_id = $1 AND source = $2 AND transaction_date = $3::date`,
      [accountId, ACCRUAL_SOURCE, bookDate]
    );
    if (Math.abs(amount) >= TOLERANCE) {
      await client.query(
        `INSERT INTO transactions
           (transaction_date, description1, amount, currency, base_amount, base_currency,
            account_id, category_id, source, accepted)
         VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, $8, TRUE)`,
        [bookDate, ACCRUAL_DESCRIPTION, amount, m.currency, baseAmount, accountId,
         m.accrual_category_id, ACCRUAL_SOURCE]
      );
    } else {
      summary.note = 'no accrual posted (< tolerance)';
    }
    summary.applied = true;
  } else if (Math.abs(amount) < TOLERANCE) {
    summary.note = 'no accrual needed (< tolerance)';
  }
  return summary;
}

async function calibrate(client, accountId, m, asOfDate, dryRun, expect = null) {
  const feed = (await client.query(
    `SELECT balance, balance_date::text AS balance_date FROM bankfeed_balances
     WHERE feed_account_external_id = $1 AND balance_date <= $2::date
     ORDER BY balance_date DESC LIMIT 1`,
    [m.external_name, asOfDate]
  )).rows[0];
  if (!feed) throw new Error(`no feed balance for account ${accountId} on/before ${asOfDate}`);

  const feedVal = Number(feed.balance);
  const expected = expectedFromFeed(m, feedVal);
  // Bounded to the window the balance is READ through — see
  // openingBalanceWindow.js. An unbounded sum here pins a number the app
  // cannot display for any account holding pre-sentinel rows.
  const sumTx = await sumWithinBalanceWindow(client, accountId);
  const newOpening = Math.round((expected - sumTx) * 100) / 100;

  const summary = {
    account_id: accountId, name: m.name, mode: 'calibrate', as_of: asOfDate,
    feed_date: feed.balance_date, feed_balance: feedVal, expected, sum_tx: sumTx,
    old_opening: Number(m.opening_balance), new_opening: newOpening, refused: false, applied: false,
  };

  // CR087 P0c — REFUSE AN APPLY THAT NO LONGER MATCHES ITS PREVIEW.
  //
  // The preview and the apply are two round trips, and the figure between them
  // is not stable: the apply path re-syncs upstream and re-ingests balances
  // (routes/bankFeed.js), so a feed row landing in that window changes
  // `expected`, and any transaction written in it changes `sumTx`. Without this
  // the owner approves one number and a different one is written — which is
  // strictly worse than no preview, because it looks verified.
  //
  // `expect` is what the preview returned. Both fields matter: `new_opening` is
  // the number approved, and `feed_date` is the observation it was computed
  // from — the same `new_opening` derived from a different feed row is a
  // coincidence, not a match.
  if (!dryRun && expect) {
    const drifted =
      Number(expect.new_opening) !== newOpening ||
      String(expect.feed_date) !== String(feed.balance_date);
    if (drifted) {
      const err = new Error(
        `the figures moved since you previewed them: ` +
        `${expect.new_opening} (feed ${expect.feed_date}) → ${newOpening} (feed ${feed.balance_date}). ` +
        `Nothing was written. Preview again.`
      );
      err.code = 'PREVIEW_STALE';
      err.summary = { ...summary, expected_by_client: { ...expect } };
      throw err;
    }
  }

  if (!dryRun) {
    // Do NOT touch opening_balance_date. `sumTx` above is computed over ALL
    // transactions with no sentinel filter, while every read filters
    // `transaction_date >= opening_balance_date` — so hard-writing '2000-01-01'
    // made this calibration internally inconsistent for any account holding
    // pre-2000 rows: the balance it pins is not the balance the app then shows.
    // Leaving the sentinel alone is strictly more correct than moving it.
    // (Fidelity Stocks carries 121 pre-2000 rows worth 47,918.98 once the CR019
    // backfill lands, and CR058's anchors add 1998-99 rows on top; a Reconcile
    // click would otherwise have silently voided ~667K of history.)
    await client.query(
      `UPDATE accounts SET opening_balance = $2 WHERE id = $1`,
      [accountId, newOpening]
    );
    summary.applied = true;
  }
  return summary;
}

module.exports = {
  reconcileToFeed, UNREALIZED_GL_CATEGORY_ID, MTM_SOURCE,
  ACCRUAL_SOURCE, ACCRUAL_MIN_APY, ACCRUAL_MAX_APY,
};
