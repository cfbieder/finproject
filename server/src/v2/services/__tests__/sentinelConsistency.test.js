'use strict';
/**
 * sentinelConsistency.test.js
 *
 * Every balance in fin is read as
 *
 *     opening_balance + SUM(amount) WHERE transaction_date >= opening_balance_date
 *
 * so `opening_balance_date` is a floor: rows before it are invisible. Anything
 * that COMPUTES an opening_balance must therefore sum over the same window it
 * will later be read through, or it pins a number the app cannot display.
 *
 * Two defects, both live on prod when these tests were written:
 *
 *   1. reconcileToFeed.calibrate / .mtm and reconcileManual.calibrate summed
 *      `WHERE account_id = $1` with NO date bounds — neither the sentinel floor
 *      nor a `<= today` ceiling. On prod, Chase Checking holds one row dated
 *      1999-12-31 worth 1,950.61 that sits BELOW its 2000-01-01 sentinel, so a
 *      Reconcile click would pin opening_balance 1,950.61 too low and the
 *      displayed balance would land 1,950.61 UNDER the feed it just reconciled
 *      to. Silent, and invisible to any check that only looks at the feed.
 *
 *   2. Migration 022 moved every account off the 2000-01-01 sentinel and set
 *      the column DEFAULT to 1990-01-01 — but `accounts.create()` hard-codes
 *      '2000-01-01', so every account created since has RE-INTRODUCED the
 *      sentinel the migration removed. Nine on prod carry it.
 *
 * These are written to fail against the pre-fix code: each asserts the
 * relationship that was broken, not merely that the code runs.
 */

const { Pool } = require('pg');
const { sumWithinBalanceWindow } = require('../openingBalanceWindow');

const TEST_DB_URL = process.env.DATABASE_URL;
const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const SENTINEL_PREFIX = '_sentinel_test_';

dbDescribe('opening_balance_date consistency', () => {
  let pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DB_URL });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  /** The canonical read: what every report and the Balance Sheet actually show. */
  async function displayedBalance(client, accountId) {
    const { rows } = await client.query(
      `SELECT (a.opening_balance + COALESCE((
                SELECT SUM(t.amount) FROM transactions t
                 WHERE t.account_id = a.id
                   AND t.transaction_date >= a.opening_balance_date
                   AND t.transaction_date <= CURRENT_DATE), 0)) AS bal
         FROM accounts a WHERE a.id = $1`,
      [accountId]
    );
    return Number(rows[0].bal);
  }

  test('a sum used to pin opening_balance must respect the sentinel floor', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: acct } = await client.query(
        `INSERT INTO accounts (name, account_type, section, currency, opening_balance, opening_balance_date)
         VALUES ($1,'asset','balance_sheet','USD',0,'2000-01-01') RETURNING id`,
        [`${SENTINEL_PREFIX}floor`]
      );
      const id = acct[0].id;

      // One row BELOW the sentinel (invisible to reads) and one above.
      await client.query(
        `INSERT INTO transactions (transaction_date, amount, base_amount, currency, account_id, description1, source)
         VALUES ('1999-12-31', 1950.61, 1950.61, 'USD', $1, '${SENTINEL_PREFIX}pre', 'manual'),
                ('2020-01-01', 1000.00, 1000.00, 'USD', $1, '${SENTINEL_PREFIX}post', 'manual')`,
        [id]
      );

      // The unbounded form is what all five sites used before 2026-07-30.
      const unbounded = Number((await client.query(
        `SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE account_id = $1`, [id]
      )).rows[0].s);
      // The real helper the production paths now call.
      const bounded = await sumWithinBalanceWindow(client, id);

      // The two differ by exactly the hidden row — this is the bug's shape.
      expect(unbounded - bounded).toBeCloseTo(1950.61, 2);

      // Calibrating to an expected balance of 5000 using each sum in turn:
      const EXPECTED = 5000;
      for (const [label, sum] of [['bounded', bounded], ['unbounded', unbounded]]) {
        await client.query(`UPDATE accounts SET opening_balance = $2 WHERE id = $1`,
          [id, Math.round((EXPECTED - sum) * 100) / 100]);
        const shown = await displayedBalance(client, id);
        if (label === 'bounded') {
          // Correct: what the app displays is what we pinned.
          expect(shown).toBeCloseTo(EXPECTED, 2);
        } else {
          // The defect: pinned to 5000, displays 1,950.61 short.
          expect(shown).toBeCloseTo(EXPECTED - 1950.61, 2);
        }
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('accounts.create() must not re-introduce the 2000-01-01 sentinel', async () => {
    // Migration 022 migrated every account off 2000-01-01 AND set the column
    // default to 1990-01-01. A create path that hard-codes the old value undoes
    // the migration one account at a time.
    // `accounts.create()` writes through its OWN pool, so it commits regardless
    // of any transaction opened here — the row must be cleaned up explicitly,
    // both before (in case an earlier run died mid-test) and after.
    const accounts = require('../../repositories/accounts');
    const name = `${SENTINEL_PREFIX}create`;
    await pool.query(`DELETE FROM accounts WHERE name = $1`, [name]);
    let created;
    try {
      created = await accounts.create({ name, account_type: 'asset', section: 'balance_sheet' });
      expect(created.opening_balance_date).not.toBeNull();
      const iso = new Date(created.opening_balance_date).toISOString().slice(0, 10);
      expect({ opening_balance_date: iso }).toEqual({ opening_balance_date: '1990-01-01' });
    } finally {
      await pool.query(`DELETE FROM accounts WHERE name = $1`, [name]);
    }
  });

  test('a future-dated row is excluded too — the ceiling matters as much as the floor', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: acct } = await client.query(
        `INSERT INTO accounts (name, account_type, section, currency, opening_balance, opening_balance_date)
         VALUES ($1,'asset','balance_sheet','USD',0,'1990-01-01') RETURNING id`,
        [`${SENTINEL_PREFIX}ceiling`]
      );
      const id = acct[0].id;
      await client.query(
        `INSERT INTO transactions (transaction_date, amount, base_amount, currency, account_id, description1, source)
         VALUES (CURRENT_DATE - 1, 500.00, 500.00, 'USD', $1, '${SENTINEL_PREFIX}past', 'manual'),
                (CURRENT_DATE + 30, 777.00, 777.00, 'USD', $1, '${SENTINEL_PREFIX}future', 'manual')`,
        [id]
      );
      // Only the past row counts — the displayed balance cannot see the future one.
      expect(await sumWithinBalanceWindow(client, id)).toBeCloseTo(500, 2);
      // …and an explicit as-of narrows it further.
      const yesterday = (await client.query(`SELECT (CURRENT_DATE - 2)::text d`)).rows[0].d;
      expect(await sumWithinBalanceWindow(client, id, yesterday)).toBeCloseTo(0, 2);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('the column default itself is 1990-01-01, as migration 022 set it', async () => {
    const { rows } = await pool.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'accounts' AND column_name = 'opening_balance_date'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].column_default).toMatch(/1990-01-01/);
  });
});
