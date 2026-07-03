'use strict';
/**
 * splitResidual.test.js — CR037 P2: split() must not leak pennies.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres via DATABASE_URL.
 * Seeds a throwaway account + transactions, cleans up by unique name — never
 * TRUNCATE.
 *
 * base_amount is distributed proportionally across the legs; independent
 * per-leg rounding used to let Σ legs drift a cent from the original, which
 * became permanent recon drift. The rounding residual now lands on leg 0.
 */

const repo = require('../transactions');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('transactions.split residual (DB)', () => {
  const ACCT = 'TestSplitResidualAcct';
  let acctId;

  async function freshAccount() {
    await cleanup();
    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'asset', 'balance_sheet', 'EUR', 0) RETURNING id`,
      [ACCT]
    );
    acctId = a.rows[0].id;
  }

  async function addTx(amount, baseAmount) {
    return (await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, source, accepted)
       VALUES ('2026-07-01','t',$1,'EUR',$2,'USD',$3,'manual',TRUE) RETURNING id`,
      [amount, baseAmount, acctId]
    )).rows[0].id;
  }

  async function baseSum() {
    return (await db.query(
      `SELECT COALESCE(SUM(base_amount),0)::numeric(20,2) s FROM transactions WHERE account_id=$1`,
      [acctId]
    )).rows[0].s;
  }

  async function cleanup() {
    if (acctId) await db.query(`DELETE FROM transactions WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
    acctId = null;
  }

  afterAll(async () => { await cleanup(); await db.close(); });

  test('3-way split with drifting ratios: Σ base_amount stays exact', async () => {
    await freshAccount();
    // 99.99 base over thirds: naive per-leg rounding sums to 100.00 (+0.01 leak)
    const id = await addTx(100.0, 99.99);

    const out = await repo.split(id, [
      { amount: 33.33 },
      { amount: 33.33 },
      { amount: 33.34 },
    ]);

    expect(out.created).toHaveLength(2);
    expect(await baseSum()).toBe('99.99');
  });

  test('adversarial 5-way micro-split: Σ base_amount stays exact', async () => {
    await freshAccount();
    const id = await addTx(0.1, 0.07);

    await repo.split(id, [
      { amount: 0.02 },
      { amount: 0.02 },
      { amount: 0.02 },
      { amount: 0.02 },
      { amount: 0.02 },
    ]);

    expect(await baseSum()).toBe('0.07');
  });

  test('rejects splits that do not sum to the original amount (400)', async () => {
    await freshAccount();
    const id = await addTx(100.0, 100.0);

    await expect(
      repo.split(id, [{ amount: 60.0 }, { amount: 30.0 }])
    ).rejects.toMatchObject({ status: 400 });

    // nothing written — the original row is untouched
    const rows = (await db.query(
      `SELECT amount FROM transactions WHERE account_id=$1`, [acctId]
    )).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBeCloseTo(100.0, 2);
  });

  test('legs still proportional where rounding allows (residual only on leg 0)', async () => {
    await freshAccount();
    const id = await addTx(100.0, 50.0);

    const out = await repo.split(id, [{ amount: 60.0 }, { amount: 40.0 }]);

    // clean ratios → no residual: 30.00 / 20.00
    expect(Number(out.updated.base_amount)).toBeCloseTo(30.0, 2);
    expect(Number(out.created[0].base_amount)).toBeCloseTo(20.0, 2);
    expect(await baseSum()).toBe('50.00');
  });
});
