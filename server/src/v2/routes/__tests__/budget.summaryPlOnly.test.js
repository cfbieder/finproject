'use strict';
/**
 * A budget is P&L only (owner, 2026-09-14).
 *
 * The account on a budget line records where the money is expected to land; it is not
 * a budget dimension. So a budget row with NO category is not budget, and an account
 * filter must not narrow the budget side. `/budget/summary` (the Budget Worksheet)
 * counted every row — −224,315.52 of 2026 budget against the P&L −137,526.81 — and
 * filtered budget by account. DB-backed; self-seeding in 1979, cleaned up by tag.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../budget');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/budget', router);
const req = (m, p, b) => request(app, m, `/budget${p}`, b);

const TAG = 'WSPL';
const YEAR = 1979;

dbDescribe('budget summaries count P&L categories only (DB)', () => {
  const ids = {};

  async function cleanup() {
    await db.query(`DELETE FROM budget_entries WHERE description LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
  }

  const budget = (categoryId, amount) => db.query(
    `INSERT INTO budget_entries
       (entry_date, description, amount, currency, base_amount, base_currency,
        category_id, account_id, budget_year)
     VALUES (make_date($1, 3, 1), $2, $3, 'USD', $3, 'USD', $4, $5, $1)`,
    [YEAR, `${TAG} b`, amount, categoryId, ids.bank]
  );

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();
    const account = async (name, type, section) => (await db.query(
      `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
       VALUES ($1, $2, $3, FALSE, 'USD', TRUE) RETURNING id`,
      [name, type, section]
    )).rows[0].id;
    ids.alpha = await account(`${TAG} Alpha`, 'expense', 'profit_loss');
    ids.bank = await account(`${TAG} Bank`, 'asset', 'balance_sheet');
    await budget(ids.alpha, -100); // a P&L budget line, expected to be paid from the bank
    await budget(null, -900);      // no category: not budget
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  const march = async (query) => {
    const r = await req('GET', `/summary?budgetYear=${YEAR}&actualYear=${YEAR}${query}`);
    expect(r.status).toBe(200);
    return r.body.budgetByMonth['3'];
  };

  test('🔴 a budget row with no category is not counted', async () => {
    expect(await march('')).toBeCloseTo(-100, 2);
  });

  test('the account filter does not narrow the budget — the account is not a budget dimension', async () => {
    expect(await march(`&accounts=${encodeURIComponent(`${TAG} Bank`)}`)).toBeCloseTo(-100, 2);
    expect(await march(`&accounts=${encodeURIComponent(`${TAG} Nowhere`)}`)).toBeCloseTo(-100, 2);
  });

  test('the category filter still narrows the budget', async () => {
    expect(await march(`&categories=${encodeURIComponent(`${TAG} Alpha`)}`)).toBeCloseTo(-100, 2);
    expect(await march(`&categories=${encodeURIComponent(`${TAG} Other`)}`)).toBeUndefined();
  });

  test('/entries/summary/by-month excludes category-less rows too', async () => {
    const r = await req('GET', `/entries/summary/by-month?year=${YEAR}`);
    expect(r.status).toBe(200);
    const mar = r.body.data.find((m) => String(m.month).slice(0, 7) === `${YEAR}-03`);
    expect(Number(mar.total_amount)).toBeCloseTo(-100, 2);
    expect(mar.entry_count).toBe(1);
  });
});
