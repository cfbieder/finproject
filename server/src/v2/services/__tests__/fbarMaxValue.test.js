'use strict';
/**
 * fbarMaxValue.test.js — CR082 §10.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1). Seeds its own throwaway accounts and
 * cleans up by name — never TRUNCATE, and never asserts a figure borrowed from
 * prod.
 *
 * THE FIXTURE IS THE POINT. The CR's first draft made its headline gate "account
 * 18 reads 631,678.72 for 2025", which cannot run anywhere but this one prod
 * database: `server/db/ci-seed.sql` is 34 lines with four P&L accounts and ZERO
 * transactions. That is the ambient-data class `Scripts/test-fresh-db.sh` exists
 * for and that has turned `main` red five times. So the same-day in-and-out day
 * is BUILT here, with rows whose `id` order and `amount` order disagree, and the
 * assertion is that all three readings of the ledger give the one right answer.
 *
 * Each test names the wrong answer it is there to exclude, because a test that
 * only asserts the right number does not say what it is protecting.
 */

const db = require('../../db');
const {
  accountYearFigures, toUsdRoundedUp, REFUSE_CROSS_CURRENCY,
} = require('../fbarMaxValue');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('fbarMaxValue — the maximum during a calendar year (DB)', () => {
  const PREFIX = 'TestFbar';

  async function cleanup() {
    await db.query(
      `DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE $1)`,
      [`${PREFIX}%`]
    );
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${PREFIX}%`]);
  }

  async function mkAccount(suffix, { currency = 'PLN', opening = 0, floor = '1990-01-01' } = {}) {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance,
                             opening_balance_date, is_active)
       VALUES ($1, 'asset', 'balance_sheet', $2, $3, $4::date, TRUE)
       RETURNING id`,
      [`${PREFIX}_${suffix}`, currency, opening, floor]
    );
    return rows[0].id;
  }

  async function addTx(accountId, date, amount, currency = null) {
    const { rows: a } = await db.query(`SELECT currency FROM accounts WHERE id = $1`, [accountId]);
    const { rows } = await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency,
                                 account_id, source)
       VALUES ($1::date, 'fbar fixture', $2, $3, $4, 'test')
       RETURNING id`,
      [date, amount, currency || a[0].currency, accountId]
    );
    return rows[0].id;
  }

  beforeAll(cleanup);
  afterAll(async () => { await cleanup(); await db.close(); });

  test('same-day in AND out never creates a peak — the 7x class', async () => {
    const id = await mkAccount('SameDay', { opening: 5000 });
    // Ordinary activity, then one day carrying equal money in and out.
    await addTx(id, '2025-03-10', 100000);
    // Inserted big-credit FIRST so `ORDER BY id` peaks, and it is also the
    // largest `amount` so `ORDER BY (date, amount DESC)` peaks harder. Only
    // end-of-day nets them.
    await addTx(id, '2025-06-23', 4294000);
    await addTx(id, '2025-06-23', -4294000);
    await addTx(id, '2025-09-01', -20000);

    const f = await accountYearFigures(db, id, 2025);

    // 5000 + 100000 = 105000 is the real high-water mark.
    expect(f.max_native).toBe(105000);
    // The two readings this test exists to exclude:
    expect(f.max_native).not.toBe(4399000);   // 105000 + 4294000, row-ordered
    expect(f.max_native).not.toBe(4294000);
    expect(f.year_end_native).toBe(85000);
    expect(f.refused).toBe(false);
  });

  test('an account drained during the year reports its January 1 carry-in', async () => {
    const id = await mkAccount('Drained', { opening: 0 });
    await addTx(id, '2024-05-01', 1718.27);          // carried into 2025
    await addTx(id, '2025-02-01', -1000);            // in-year max is only 718.27
    const f = await accountYearFigures(db, id, 2025);

    expect(f.carry_in_native).toBe(1718.27);
    expect(f.max_native).toBe(1718.27);
    expect(f.max_on).toBe('carry-in');
    // The `Wise - USD` shape: an in-year-only max understates it.
    expect(f.max_native).not.toBe(718.27);
    expect(f.year_end_native).toBe(718.27);
  });

  test('no transactions in the year at all is a figure, never NULL and never 0', async () => {
    const id = await mkAccount('Dormant', { opening: 0 });
    await addTx(id, '2023-07-04', 4287465.44);
    const f = await accountYearFigures(db, id, 2025);

    expect(f.max_native).toBe(4287465.44);
    expect(f.year_end_native).toBe(4287465.44);
    expect(f.in_year_tx_days).toBe(0);
    expect(f.max_native).not.toBeNull();
    expect(f.max_native).not.toBe(0);
  });

  test('rows below opening_balance_date are invisible, here as everywhere', async () => {
    const id = await mkAccount('Floor', { opening: 100, floor: '2000-01-01' });
    await addTx(id, '1999-12-31', 1950.61);   // the Chase Checking shape
    await addTx(id, '2025-04-01', 50);
    const f = await accountYearFigures(db, id, 2025);

    expect(f.max_native).toBe(150);
    expect(f.max_native).not.toBe(2100.61);
  });

  test('a cross-currency row refuses the account instead of summing it', async () => {
    const id = await mkAccount('CrossCcy', { currency: 'EUR', opening: 1000 });
    await addTx(id, '2025-05-01', 500);
    await addTx(id, '2025-07-31', 41564.86, 'USD');   // the CVC Fund IX shape
    const f = await accountYearFigures(db, id, 2025);

    expect(f.refused).toBe(true);
    expect(f.refusal_reason).toBe(REFUSE_CROSS_CURRENCY);
    expect(f.refusal_detail).toMatch(/USD/);
    // Refused means "needs a typed figure" — it must not carry a number at all.
    expect(f.max_native).toBeUndefined();
  });

  test('a never-positive account reports 0, while keeping the true figure', async () => {
    const id = await mkAccount('CreditCard', { opening: -200 });
    await addTx(id, '2025-02-01', -749.6);
    const f = await accountYearFigures(db, id, 2025);

    expect(f.max_native).toBe(-200);            // truth
    expect(f.reportable_max_native).toBe(0);    // what the form carries
  });

  test('the year boundary is inclusive at both ends', async () => {
    const id = await mkAccount('Boundary', { opening: 0 });
    await addTx(id, '2025-01-01', 10);
    await addTx(id, '2025-12-31', 5);
    await addTx(id, '2026-01-01', 1000);        // must not leak in
    const f = await accountYearFigures(db, id, 2025);

    expect(f.max_native).toBe(15);
    expect(f.year_end_native).toBe(15);
  });
});

describe('toUsdRoundedUp', () => {
  test('rounds UP to the whole dollar, as the form requires', () => {
    // 631,678.72 PLN x 0.278373 = 175,842.30 -> the FORM carries 175,843.
    // Worth pinning: CR082 quotes the conversion as "$175,842" throughout, which
    // is the right conversion and the wrong form entry. Rounding up is a FinCEN
    // rule, not a display choice, and the two figures differ on every line.
    expect(toUsdRoundedUp(631678.72, 0.278373)).toBe(175843);
    expect(toUsdRoundedUp(0.01, 1)).toBe(1);
    expect(toUsdRoundedUp(0, 1.175005)).toBe(0);
  });

  test('refuses a rate that is not a positive number', () => {
    expect(() => toUsdRoundedUp(100, 0)).toThrow(/positive/);
    expect(() => toUsdRoundedUp(100, null)).toThrow(/positive/);
  });

  test('null in, null out — a missing figure is not a zero figure', () => {
    expect(toUsdRoundedUp(null, 1.2)).toBeNull();
  });
});
