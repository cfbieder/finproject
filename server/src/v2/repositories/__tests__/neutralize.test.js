'use strict';
/**
 * neutralize.test.js — smart securities-trade neutralization.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434 via
 * DATABASE_URL. Seeds a throwaway account + transactions, cleans up by unique
 * name — never TRUNCATE.
 *
 * Covers the two behaviours:
 *  - PAIR: an offsetting leg already exists (e.g. SPAXX redemption ↔ assigned
 *    puts) → both set to the transfer category, NO new row.
 *  - MIRROR: a lone trade → an offsetting entry is created.
 */

const repo = require('../transactions');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('transactions.neutralize (DB)', () => {
  const ACCT = 'TestNeutralizeAcct';
  let acctId;
  let categoryId;

  async function freshAccount() {
    await cleanup();
    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 0) RETURNING id`,
      [ACCT]
    );
    acctId = a.rows[0].id;
  }

  async function addTx(amount, date = '2026-06-02', category = null) {
    return (await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, category_id, source, accepted)
       VALUES ($1,'t',$2,'USD',$2,'USD',$3,$4,'bank-feed',FALSE) RETURNING id`,
      [date, amount, acctId, category]
    )).rows[0].id;
  }

  async function cleanup() {
    if (acctId) await db.query(`DELETE FROM transactions WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
    acctId = null;
  }

  beforeAll(async () => {
    categoryId = (await db.query(
      `SELECT id FROM accounts WHERE name = 'Transfer - Securities Trades' LIMIT 1`
    )).rows[0].id;
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('PAIR: existing offsetting leg → both set to transfer, no new row', async () => {
    await freshAccount();
    const buyId = await addTx(-41750);                 // assigned-puts buy
    const redemptionId = await addTx(41750, '2026-06-02', categoryId); // SPAXX redemption (already transfer)

    const before = (await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id=$1`, [acctId])).rows[0].n;
    const out = await repo.neutralize(buyId, categoryId);

    expect(out.paired).toBe(true);
    const after = (await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id=$1`, [acctId])).rows[0].n;
    expect(after).toBe(before); // NO new entry

    const rows = (await db.query(`SELECT id, category_id, accepted FROM transactions WHERE account_id=$1`, [acctId])).rows;
    expect(rows.every((r) => r.category_id === categoryId && r.accepted === true)).toBe(true);
    expect(out.offset.id).toBe(redemptionId);
  });

  test('dryRun: previews action without writing (pair vs mirror)', async () => {
    await freshAccount();
    const lone = await addTx(-500);
    const before = (await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id=$1`, [acctId])).rows[0].n;

    const planMirror = await repo.neutralize(lone, categoryId, { dryRun: true });
    expect(planMirror.action).toBe('mirror');
    expect(planMirror.dryRun).toBe(true);

    await addTx(500); // now there IS an offsetting leg
    const planPair = await repo.neutralize(lone, categoryId, { dryRun: true });
    expect(planPair.action).toBe('pair');

    const after = (await db.query(`SELECT COUNT(*)::int n FROM transactions WHERE account_id=$1`, [acctId])).rows[0].n;
    expect(after).toBe(before + 1); // only the addTx(500), nothing from dryRuns
  });

  test('MIRROR: lone trade → offsetting entry created', async () => {
    await freshAccount();
    const buyId = await addTx(-41750);

    const out = await repo.neutralize(buyId, categoryId);
    expect(out.paired).toBe(false);

    const rows = (await db.query(
      `SELECT amount, category_id, source FROM transactions WHERE account_id=$1 ORDER BY amount`, [acctId]
    )).rows;
    expect(rows).toHaveLength(2);                       // original + mirror
    expect(Number(rows[0].amount)).toBeCloseTo(-41750, 2);
    expect(Number(rows[1].amount)).toBeCloseTo(41750, 2); // mirror
    expect(rows[1].source).toBe('auto-offset');
    expect(rows.every((r) => r.category_id === categoryId)).toBe(true);
  });
});
