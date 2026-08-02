'use strict';
/**
 * reconcileToFeed.test.js — CR023 source-aware reconciliation engine.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434 via
 * DATABASE_URL. Each test seeds its own throwaway account + mapping +
 * bankfeed_balances row (so the 'mtm' month-end backfill never calls the
 * network) and cleans up by unique name/uuid — never TRUNCATE.
 */

const { reconcileToFeed, UNREALIZED_GL_CATEGORY_ID, MTM_SOURCE } = require('../reconcileToFeed');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('reconcileToFeed (DB)', () => {
  const ACCT = 'TestReconcileAcct';
  const UUID = 'test-reconcile-uuid';
  const MONTH_END = '2026-05-31'; // a real month-end → engine targets it directly
  let acctId;

  async function freshAccount({ type = 'asset', currency = 'USD', opening = 0, mode = 'calibrate', bff = false, feedSign = null }) {
    await cleanup();
    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, $2, 'balance_sheet', $3, $4) RETURNING id`,
      [ACCT, type, currency, opening]
    );
    acctId = a.rows[0].id;
    await db.query(
      `INSERT INTO account_source_mappings
         (account_id, source, external_name, ignored, reconcile_mode, balance_from_feed, feed_sign)
       VALUES ($1, 'bank-feed', $2, FALSE, $3, $4, $5)`,
      [acctId, UUID, mode, bff, feedSign]
    );
  }

  async function seedFeed(balance, date = MONTH_END, currency = 'USD') {
    await db.query(
      `INSERT INTO bankfeed_balances (feed_account_external_id, balance, currency, balance_date, source)
       VALUES ($1, $2, $3, $4, 'fintable')
       ON CONFLICT (feed_account_external_id, balance_date, source)
       DO UPDATE SET balance = EXCLUDED.balance`,
      [UUID, balance, currency, date]
    );
  }

  // ── Stale-feed guard ─────────────────────────────────────────────────────
  // A month-end mark is only as good as the feed being CURRENT on that date.
  // Twice in 2026 it was not, and each time the mark silently pinned the
  // account to a stale number. Both incidents are reproduced below; each fails
  // against the pre-guard code, which wrote the mark regardless.

  test('REFUSES to mark when the feed has no balance dated month-end (the Bond 2026-05-31 case)', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm', bff: true });
    // computed = 1650 vs feed 1700 → MTM 50, only 2.9% of feed, so the
    // IMPLAUSIBILITY guard cannot be what blocks this. Isolating the stale
    // guard matters: an earlier draft used a 41% mark and passed even with the
    // stale check disabled — it was testing the wrong guard entirely.
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-10', 650, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]);
    // The month-end row has not arrived yet — Bond's was fetched four days late.
    // The engine would otherwise fall back to this earlier date's balance and
    // pin month-end to it, leaving a constant offset that the NEXT month's mark
    // inherits as its base.
    await seedFeed(1700, '2026-05-27');

    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.stale_feed).toBe(true);
    expect(out.stale_reason).toMatch(/no balance dated 2026-05-31/);
    expect(out.applied).toBe(false);

    const rows = (await db.query(
      `SELECT COUNT(*)::int AS n FROM transactions WHERE account_id = $1 AND source = $2`,
      [acctId, MTM_SOURCE]
    )).rows[0];
    expect(rows.n).toBe(0);
  });

  test('REFUSES to mark when the feed sat flat for three days (the Stocks/IRA 2026-06-30 case)', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm', bff: true });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-10', 650, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]);
    // All four Fidelity feeds went flat 06-28 -> 06-30 when one connection
    // stalled. A security-holding account does not sit still for three days,
    // so an identical balance across three observations is a stalled feed.
    await seedFeed(1700, '2026-05-29');
    await seedFeed(1700, '2026-05-30');
    await seedFeed(1700, MONTH_END);

    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.stale_feed).toBe(true);
    expect(out.stale_reason).toMatch(/unchanged across/);
    expect(out.applied).toBe(false);
  });

  test('a MOVING feed is not stale — three different balances mark normally', async () => {
    // Guards the guard: if this failed, the check would be blocking every
    // month-end and the two tests above would prove nothing.
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm', bff: true });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-10', 500, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]);
    await seedFeed(1650, '2026-05-29');
    await seedFeed(1680, '2026-05-30');
    await seedFeed(1700, MONTH_END);

    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.stale_feed).toBe(false);
    expect(out.mtm_amount).toBeCloseTo(200, 2);
  });

  test('force overrides the stale guard — deliberate, not accidental', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm', bff: true });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-10', 650, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]);
    await seedFeed(1700, '2026-05-27');

    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false, force: true });
    expect(out.stale_feed).toBe(true);   // still REPORTED
    expect(out.applied).toBe(true);      // but not blocked
  });

  async function cleanup() {
    if (acctId) await db.query(`DELETE FROM transactions WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM bankfeed_balances WHERE feed_account_external_id = $1`, [UUID]);
    await db.query(`DELETE FROM account_source_mappings WHERE external_name = $1`, [UUID]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
    await db.query(`DELETE FROM exchange_rates WHERE from_currency = 'XTS' AND source = 'test'`);
    acctId = null;
  }

  afterAll(async () => { await cleanup(); await db.close(); });

  test("mtm: posts feed−computed as a cat-88 'mtm' entry dated month-end; gain is positive", async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm', bff: true });
    // one real tx of +500 → computed at month-end = 1500; feed = 1700 → MTM gain +200
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-10', 500, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]);
    await seedFeed(1700);

    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.mode).toBe('mtm');
    expect(out.month_end).toBe(MONTH_END);
    expect(out.mtm_amount).toBeCloseTo(200, 2);
    expect(out.removed_read_override).toBe(true);

    const rows = (await db.query(
      `SELECT amount, category_id, source, transaction_date::text AS d, accepted
       FROM transactions WHERE account_id = $1 AND source = $2`, [acctId, MTM_SOURCE])).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBeCloseTo(200, 2);
    expect(rows[0].category_id).toBe(UNREALIZED_GL_CATEGORY_ID);
    expect(rows[0].d).toBe(MONTH_END);
    expect(rows[0].accepted).toBe(true);

    // read-override removed
    const m = (await db.query(`SELECT balance_from_feed FROM account_source_mappings WHERE external_name=$1`, [UUID])).rows[0];
    expect(m.balance_from_feed).toBe(false);

    // computed at month-end now equals feed
    const comp = (await db.query(
      `SELECT a.opening_balance + COALESCE(
         (SELECT SUM(amount) FROM transactions t WHERE t.account_id=a.id AND t.transaction_date<=$2::date), 0) AS c
       FROM accounts a WHERE a.id=$1`, [acctId, MONTH_END])).rows[0];
    expect(Number(comp.c)).toBeCloseTo(1700, 2);
  });

  test('mtm: idempotent — re-running yields a single entry, same amount', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 0, mode: 'mtm', bff: true });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-05', 10000, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]);
    await seedFeed(10350); // mtm = 350 = ~3.4% of feed (under the guard threshold)

    await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });

    const rows = (await db.query(
      `SELECT amount FROM transactions WHERE account_id = $1 AND source = $2`, [acctId, MTM_SOURCE])).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBeCloseTo(350, 2); // 10350 - (0 + 10000)
  });

  test('calibrate: re-anchors opening_balance = expected − Σtx (asset)', async () => {
    await freshAccount({ type: 'asset', currency: 'PLN', opening: 999, mode: 'calibrate' });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-15', 300, 'PLN', $1, 'pocketsmith', TRUE)`, [acctId]);
    await seedFeed(800, MONTH_END, 'PLN');

    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.mode).toBe('calibrate');
    expect(out.new_opening).toBeCloseTo(500, 2); // 800 - 300
    const a = (await db.query(`SELECT opening_balance FROM accounts WHERE id=$1`, [acctId])).rows[0];
    expect(Number(a.opening_balance)).toBeCloseTo(500, 2);
    // no mtm row written for a calibrate account
    const n = (await db.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE account_id=$1 AND source=$2`, [acctId, MTM_SOURCE])).rows[0];
    expect(n.n).toBe(0);
  });

  test('calibrate: does NOT move opening_balance_date, and pre-sentinel rows stay visible', async () => {
    // Regression: calibrate used to hard-write opening_balance_date='2000-01-01'
    // while computing sumTx over ALL transactions with no sentinel filter. For
    // any account holding pre-2000 rows that is self-contradictory — it pins a
    // balance the app then does not show, because every read filters on the
    // sentinel. Fidelity Stocks acquires 121 pre-2000 rows (47,918.98) with the
    // CR019 backfill and more with CR058's 1998-99 anchors, so a Reconcile click
    // would have silently voided ~667K of history.
    await freshAccount({ type: 'asset', currency: 'PLN', opening: 0, mode: 'calibrate' });
    await db.query(
      `UPDATE accounts SET opening_balance_date = '1990-01-01' WHERE id = $1`, [acctId]);
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('1998-06-30', 100, 'PLN', $1, 'pocketsmith', TRUE),
              ('2026-05-15', 300, 'PLN', $1, 'pocketsmith', TRUE)`, [acctId]);
    await seedFeed(800, MONTH_END, 'PLN');

    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    // sumTx spans both rows (400), so the anchor is 800 − 400 = 400.
    expect(out.sum_tx).toBeCloseTo(400, 2);
    expect(out.new_opening).toBeCloseTo(400, 2);

    const a = (await db.query(
      `SELECT opening_balance, opening_balance_date::text AS d FROM accounts WHERE id=$1`,
      [acctId])).rows[0];
    expect(a.d).toBe('1990-01-01'); // untouched — the whole point

    // And the balance the app shows must equal the balance calibrate pinned.
    const shown = (await db.query(
      `SELECT (a.opening_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t
                WHERE t.account_id = a.id
                  AND t.transaction_date >= a.opening_balance_date), 0)) AS bal
         FROM accounts a WHERE a.id = $1`, [acctId])).rows[0];
    expect(Number(shown.bal)).toBeCloseTo(800, 2);
  });

  test('calibrate: liability reconciles against −feed', async () => {
    await freshAccount({ type: 'liability', currency: 'PLN', opening: 0, mode: 'calibrate' });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-15', -100, 'PLN', $1, 'pocketsmith', TRUE)`, [acctId]);
    await seedFeed(700, MONTH_END, 'PLN'); // bank reports +700 owed

    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.expected).toBeCloseTo(-700, 2);
    expect(out.new_opening).toBeCloseTo(-600, 2); // -700 - (-100)
  });

  test('calibrate: liability with feed_sign=+1 (Plaid/US card) reconciles against +feed', async () => {
    // Plaid/SnapTrade reports a credit card NEGATIVE (matching fin), so the feed
    // sign must NOT be flipped — feed_sign=+1 overrides the liability heuristic.
    await freshAccount({ type: 'liability', currency: 'USD', opening: 0, mode: 'calibrate', feedSign: 1 });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-15', -100, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]);
    await seedFeed(-700); // bank reports -700 owed (Plaid convention)

    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.expected).toBeCloseTo(-700, 2);   // +feed, NOT +700
    expect(out.new_opening).toBeCloseTo(-600, 2); // -700 - (-100)
  });

  test('dryRun writes nothing', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 0, mode: 'mtm', bff: true });
    await seedFeed(500);
    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: true });
    expect(out.applied).toBe(false);
    const n = (await db.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE account_id=$1`, [acctId])).rows[0];
    expect(n.n).toBe(0);
    const m = (await db.query(`SELECT balance_from_feed FROM account_source_mappings WHERE external_name=$1`, [UUID])).rows[0];
    expect(m.balance_from_feed).toBe(true); // not flipped on dry-run
  });

  test('guard: implausible MTM (>15% of feed) is flagged and blocked unless forced', async () => {
    // opening 0, no tx → computed 0; feed 1000 → mtm = 1000 = 100% of feed.
    await freshAccount({ type: 'asset', currency: 'USD', opening: 0, mode: 'mtm', bff: true });
    await seedFeed(1000);

    // dry-run: flagged, not applied
    const dry = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: true });
    expect(dry.implausible).toBe(true);
    expect(dry.implausible_pct).toBeGreaterThan(0.15);

    // apply without force: refused (nothing written)
    const blocked = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    expect(blocked.applied).toBe(false);
    expect(blocked.note).toMatch(/implausible/i);
    let n = (await db.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE account_id=$1 AND source=$2`, [acctId, MTM_SOURCE])).rows[0];
    expect(n.n).toBe(0);

    // apply with force: written
    const forced = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false, force: true });
    expect(forced.applied).toBe(true);
    n = (await db.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE account_id=$1 AND source=$2`, [acctId, MTM_SOURCE])).rows[0];
    expect(n.n).toBe(1);
  });

  test('guard: a normal-sized MTM (<15%) is not flagged', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm', bff: true });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-10', 9000, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]); // computed 10000
    await seedFeed(10500); // mtm = 500 = ~4.8% of feed
    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: true });
    expect(out.implausible).toBe(false);
    expect(out.mtm_amount).toBeCloseTo(500, 2);
  });

  test('mtm on a non-USD account converts base_amount via the FX table', async () => {
    await freshAccount({ type: 'asset', currency: 'XTS', opening: 1000, mode: 'mtm', bff: false });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-10', 9000, 'XTS', $1, 'pocketsmith', TRUE)`, [acctId]); // computed 10000
    await seedFeed(10500, MONTH_END, 'XTS'); // mtm = 500 XTS (4.8% < guard)
    await db.query(
      `INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_date, source)
       VALUES ('XTS','USD',2,$1,'test')
       ON CONFLICT (from_currency,to_currency,rate_date) DO UPDATE SET rate = EXCLUDED.rate`, [MONTH_END]);

    const out = await reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.mtm_amount).toBeCloseTo(500, 2);
    expect(out.base_amount).toBeCloseTo(1000, 2); // 500 XTS * 2 = 1000 USD
    const row = (await db.query(
      `SELECT amount, base_amount, currency, base_currency FROM transactions WHERE account_id=$1 AND source=$2`,
      [acctId, MTM_SOURCE])).rows[0];
    expect(Number(row.amount)).toBeCloseTo(500, 2);
    expect(row.currency).toBe('XTS');
    expect(Number(row.base_amount)).toBeCloseTo(1000, 2);
    expect(row.base_currency).toBe('USD');
  });

  test('mtm on a non-USD account with NO FX rate throws a clear error', async () => {
    await freshAccount({ type: 'asset', currency: 'XTS', opening: 1000, mode: 'mtm', bff: false });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-10', 9000, 'XTS', $1, 'pocketsmith', TRUE)`, [acctId]); // mtm = 500, needs a rate
    await seedFeed(10500, MONTH_END, 'XTS');
    await db.query(`DELETE FROM exchange_rates WHERE from_currency='XTS'`); // ensure no rate
    await expect(reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: false })).rejects.toThrow(/exchange rate/i);
  });

  // ── CR065 §11: a balance may only mark a day it could actually contain ──────
  //
  // The feed labels a balance with the date it was SYNCED, and it syncs in the
  // small hours — so the row dated D was taken before D traded. Marking against
  // it is marking to a day that had not happened yet. On prod this booked
  // Fidelity Stocks -44,600.45 for 2026-07-31 against a balance synced 01:48 that
  // morning, leaving the account 24,352.57 below the custodian.
  async function seedFeedSynced(balance, date, syncedAt) {
    await db.query(
      `INSERT INTO bankfeed_balances (feed_account_external_id, balance, currency, balance_date, source, source_synced_at)
       VALUES ($1, $2, 'USD', $3, 'fintable', $4)
       ON CONFLICT (feed_account_external_id, balance_date, source)
       DO UPDATE SET balance = EXCLUDED.balance, source_synced_at = EXCLUDED.source_synced_at`,
      [UUID, balance, date, syncedAt]
    );
  }

  test('guard: a balance synced BEFORE the booking day ended is refused, not booked', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm', bff: false });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-03-10', 9000, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]);
    // Labelled for month-end, but taken at 01:48 THAT MORNING — it cannot contain
    // the day it is named after. Both existing guards see a row dated 03-31 and
    // three moving balances, and pass it.
    await seedFeedSynced(10500, '2026-03-31', '2026-03-31T01:48:00Z');

    const out = await reconcileToFeed(acctId, { bookDate: '2026-03-31', dryRun: false });
    expect(out.stale_feed).toBe(true);
    expect(out.stale_reason).toMatch(/synced on 2026-03-31.*cannot contain/s);
    expect(out.applied).toBeFalsy();
    const rows = (await db.query(
      `SELECT 1 FROM transactions WHERE account_id=$1 AND source=$2`, [acctId, MTM_SOURCE])).rows;
    expect(rows).toHaveLength(0);                       // nothing written
  });

  test('balanceDate: mark against a LATER observation while dating the entry at month-end', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm', bff: false });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-03-10', 9000, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]);
    await seedFeedSynced(10500, '2026-03-31', '2026-03-31T01:48:00Z'); // pre-dates the day
    await seedFeedSynced(10800, '2026-04-02', '2026-04-02T00:05:00Z'); // the one that contains it

    const out = await reconcileToFeed(acctId, {
      bookDate: '2026-03-31', balanceDate: '2026-04-02', dryRun: false,
    });
    expect(out.stale_feed).toBe(false);
    expect(out.feed_balance).toBeCloseTo(10800, 2);     // marked against the later observation
    expect(out.mtm_amount).toBeCloseTo(800, 2);
    const rows = (await db.query(
      `SELECT transaction_date::text AS d FROM transactions WHERE account_id=$1 AND source=$2`,
      [acctId, MTM_SOURCE])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].d).toBe('2026-03-31');               // …but dated at month-end
  });

  test('mtm: bookDate overrides the month-end snap (books verbatim on the chosen date)', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm', bff: false });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-03-10', 9000, 'USD', $1, 'pocketsmith', TRUE)`, [acctId]); // computed by Q1-end = 10000
    await seedFeed(10500, '2026-03-31'); // feed snapshot at Q1 end (cached → no network backfill)

    const out = await reconcileToFeed(acctId, { bookDate: '2026-03-31', dryRun: false });
    expect(out.month_end).toBe('2026-03-31'); // used verbatim, not snapped
    expect(out.mtm_amount).toBeCloseTo(500, 2);
    const rows = (await db.query(
      `SELECT transaction_date::text AS d FROM transactions WHERE account_id=$1 AND source=$2`,
      [acctId, MTM_SOURCE])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].d).toBe('2026-03-31');
  });

  test('ignored mapping throws; missing mapping throws', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 0, mode: 'mtm', bff: true });
    await seedFeed(100);
    await db.query(`UPDATE account_source_mappings SET ignored=TRUE WHERE external_name=$1`, [UUID]);
    await expect(reconcileToFeed(acctId, { asOf: MONTH_END, dryRun: true })).rejects.toThrow(/ignored/i);
    await expect(reconcileToFeed(999999999, { asOf: MONTH_END, dryRun: true })).rejects.toThrow(/no bank-feed mapping/i);
  });
});
