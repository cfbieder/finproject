'use strict';
/**
 * createTransaction.test.js — CR025 `accepted` default on repo.create().
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434.
 */

const repo = require('../transactions');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('transactions.create accepted default (DB)', () => {
  const ACCT = 'TestCreateAcct';
  let acctId;
  const made = [];

  beforeAll(async () => {
    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1,'asset','balance_sheet','USD',0) RETURNING id`, [ACCT]);
    acctId = a.rows[0].id;
  });
  afterAll(async () => {
    if (made.length) await db.query(`DELETE FROM transactions WHERE id = ANY($1)`, [made]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
    await db.close();
  });

  const mk = (over) => repo.create({ transaction_date: '2026-06-05', amount: 10, account_id: acctId, ...over })
    .then((r) => { made.push(r.id); return r; });

  test("source='manual' defaults accepted=TRUE", async () => {
    const r = await mk({ source: 'manual' });
    expect(r.accepted).toBe(true);
    expect(r.source).toBe('manual');
  });

  test("non-manual source defaults accepted=FALSE", async () => {
    const r = await mk({ source: 'bank-feed' });
    expect(r.accepted).toBe(false);
  });

  test('explicit accepted is honoured', async () => {
    const r = await mk({ source: 'manual', accepted: false });
    expect(r.accepted).toBe(false);
  });
});
