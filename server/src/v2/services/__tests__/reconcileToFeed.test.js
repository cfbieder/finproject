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
