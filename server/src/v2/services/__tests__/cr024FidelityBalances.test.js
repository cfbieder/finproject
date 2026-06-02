/**
 * CR024 Phase 1 — balance-sheet read-override (DB integration).
 *
 * Exercises the ACTUAL production fetcher (reports.js `_fetchAccountBalances`)
 * against dev Postgres on :5434 (skip with SKIP_DB_TESTS=1). A balance_from_feed
 * account returns its feed_balances snapshot for as-of dates with coverage, and
 * falls back to opening_balance+Σtx for earlier (pre-coverage) dates. Everything
 * created is torn down by a unique account name / feed UUID. No db mocks here.
 *
 * The ingestBalances unit test (mocked client+db) lives in cr024IngestBalances.test.js
 * — kept in a separate file so its file-wide jest.mock('../../db') can't leak the
 * mock into this real-DB block.
 */

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('balance-sheet read-override (DB)', () => {
  const db = require('../../db');
  const reports = require('../../routes/reports');
  const fetchAccountBalances = reports._fetchAccountBalances;

  const ACCT = 'CR024_TEST_FEED_ACCT';
  const UUID = 'cr024-test-feed-uuid';
  let acctId;

  async function cleanup() {
    await db.query(`DELETE FROM transactions WHERE source = 'test-cr024'`);
    await db.query(`DELETE FROM bankfeed_balances WHERE feed_account_external_id = $1`, [UUID]);
    await db.query(`DELETE FROM account_source_mappings WHERE external_name = $1`, [UUID]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
  }

  beforeAll(async () => {
    await cleanup();
    acctId = (await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance, opening_balance_date, is_active)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 1000, '2020-01-01', TRUE) RETURNING id`,
      [ACCT]
    )).rows[0].id;

    // additive component: +500 booked 2026-04-10 → additive balance = 1500
    await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, account_id, source, accepted)
       VALUES ('2026-04-10', 'cr024 test tx', 500, 'USD', $1, 'test-cr024', TRUE)`,
      [acctId]
    );

    await db.query(
      `INSERT INTO account_source_mappings (source, external_name, account_id, ignored, balance_from_feed, trade_treatment)
       VALUES ('bank-feed', $1, $2, TRUE, TRUE, 'offset')`,
      [UUID, acctId]
    );

    // feed snapshot exists only from 2026-06-01
    await db.query(
      `INSERT INTO bankfeed_balances (feed_account_external_id, balance, currency, balance_date, source)
       VALUES ($1, 9999.99, 'USD', '2026-06-01', 'fintable')`,
      [UUID]
    );
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('as-of on/after the feed snapshot → feed balance (override), not the additive sum', async () => {
    const balances = await fetchAccountBalances('2026-06-02');
    expect(balances[ACCT]).toBeDefined();
    const [currency, balance] = balances[ACCT];
    expect(currency).toBe('USD');
    expect(balance).toBeCloseTo(9999.99, 2); // feed value, NOT 1500 additive
  });

  test('as-of before any feed snapshot → additive fallback (opening + Σtx ≤ date)', async () => {
    const balances = await fetchAccountBalances('2026-05-01');
    const [, balance] = balances[ACCT];
    expect(balance).toBeCloseTo(1500, 2); // 1000 opening + 500 tx; no feed ≤ 2026-05-01
  });

  test('as-of before the booked tx → opening only', async () => {
    const balances = await fetchAccountBalances('2026-03-01');
    const [, balance] = balances[ACCT];
    expect(balance).toBeCloseTo(1000, 2); // opening only; tx is 2026-04-10
  });
});
