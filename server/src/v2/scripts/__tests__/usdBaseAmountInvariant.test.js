'use strict';
/**
 * usdBaseAmountInvariant.test.js
 *
 * `base_currency` is USD, so for a USD row the conversion is the identity:
 *
 *     currency = 'USD'  ⇒  base_amount = amount
 *
 * That is provable, not merely expected — which is what makes it worth
 * asserting in a test rather than trusting to review.
 *
 * It went unguarded until 2026-07-29, and the gap was not theoretical.
 * `fix-ps-transfer-signs.js` sign-corrected nine Fidelity rows with
 * `UPDATE transactions SET amount = ...` and never touched `base_amount`, so
 * every one of them shipped to prod half-fixed. Nothing caught it for a day:
 * the Balance Sheet and Balance Trends read `amount` and were correct, while
 * `refreshFromActuals` (seeding forecast `base_value_usd`), Cash Flow USD mode,
 * budget summaries and category totals all read `base_amount` and saw the money
 * flowing the wrong way — 1,504,114.38 of divergence on Fidelity Stocks alone.
 *
 * Two kinds of test, because a scan alone would be vacuous on a database that
 * happens to contain no violations:
 *   1. the checker FIRES on a deliberately-broken row (proves it can fail);
 *   2. the live database is clean (proves it currently holds).
 *
 * The injection tests assert on the INJECTED ROW'S ID, never on a count and
 * never on "it resolves" — those would pass or fail according to whatever else
 * the database happens to contain, which is the ambient-data trap that turned
 * this repo's CI red for four consecutive runs in July 2026.
 */

const { Pool } = require('pg');
const { assertUsdInvariant } = require('../fix-ps-transfer-signs');

const TEST_DB_URL = process.env.DATABASE_URL;
const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('USD invariant: base_amount = amount', () => {
  let pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DB_URL });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  /** Insert one row inside an open transaction, return its id. */
  async function inject(client, amount, baseAmount, currency, tag) {
    const { rows: acct } = await client.query(
      `SELECT id FROM accounts WHERE section = 'balance_sheet' LIMIT 1`
    );
    const { rows } = await client.query(
      `INSERT INTO transactions (transaction_date, amount, base_amount, currency, account_id, description1, source)
       VALUES ('2020-01-01', $1, $2, $3, $4, $5, 'manual') RETURNING id`,
      [amount, baseAmount, currency, acct[0].id, tag]
    );
    return Number(rows[0].id); // pg returns bigint as a string
  }

  /**
   * The violating ids the checker reports, or [] when it passes. Read off
   * `err.violatingIds` rather than scraped from the message, which truncates
   * its display at 12 rows.
   */
  async function violations(client) {
    try {
      await assertUsdInvariant(client);
      return [];
    } catch (err) {
      return err.violatingIds;
    }
  }

  test('the checker FIRES on a USD row whose base_amount carries the wrong sign', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Exactly the shape the real defect had: amount corrected, base_amount
      // left carrying the old sign.
      const id = await inject(client, -1234.56, 1234.56, 'USD', '_usd_invariant_test_');
      expect(await violations(client)).toContain(id);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('a zero-amount row does NOT trip it — 0 = 0 holds trivially and proves nothing', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = await inject(client, 0, 0, 'USD', '_usd_invariant_zero_');
      expect(await violations(client)).not.toContain(id);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('a non-USD row is out of scope — its base_amount legitimately differs', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = await inject(client, -1000.0, -250.0, 'PLN', '_usd_invariant_pln_');
      expect(await violations(client)).not.toContain(id);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('the live database holds the invariant', async () => {
    const client = await pool.connect();
    try {
      await expect(assertUsdInvariant(client)).resolves.toBeUndefined();
    } finally {
      client.release();
    }
  });
});
