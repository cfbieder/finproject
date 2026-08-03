'use strict';
/**
 * cr068.actual-entries-filters.test.js — CR068 P2.
 *
 * /budget/actual-entries backs the Actuals page's totals tiles. It was SENT
 * description / valueFrom / valueTo / currency and read none of them, so the
 * tile counted rows the table below it had filtered out — and its LIMIT
 * truncated silently, so a wide period reported a total that was simply short.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); seeds its own throwaway account +
 * category and cleans up by name — never TRUNCATE.
 */

const { makeApp, request } = require('./_httpApp');
const router = require('../budget');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/budget', router);
const req = (m, p) => request(app, m, `/budget${p}`);

dbDescribe('GET /budget/actual-entries — filters + truncation (DB)', () => {
  const ACCT = 'CR068 Test Account';
  const CAT = 'CR068 Test Category';
  const FROM = '2026-03-01';
  const TO = '2026-04-01'; // exclusive upper bound
  let acctId;
  let catId;

  async function cleanup() {
    await db.query(
      `DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE name = $1)`,
      [ACCT]
    );
    await db.query(`DELETE FROM accounts WHERE name IN ($1, $2)`, [ACCT, CAT]);
  }

  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await cleanup();

    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'asset', 'balance_sheet', 'PLN', 0) RETURNING id`,
      [ACCT]
    );
    acctId = a.rows[0].id;

    const c = await db.query(
      `INSERT INTO accounts (name, account_type, section)
       VALUES ($1, 'expense', 'profit_loss') RETURNING id`,
      [CAT]
    );
    catId = c.rows[0].id;

    // Four rows in March 2026 — deliberately mixed currency, so a total that
    // adds local amounts across them is visibly not a base total.
    const rows = [
      ['2026-03-01', -100.00, 'PLN', -25.00, 'BIEDRONKA WARSZAWA'],
      ['2026-03-02', -5.90, 'PLN', -1.48, 'ZDROFIT WILANOW'],
      ['2026-03-03', -116.23, 'EUR', -133.49, 'ONEBILL MYBOX'],
      ['2026-03-04', -346.00, 'PLN', -86.50, 'ZWROTOD PRZELEW'],
    ];
    for (const [date, amount, ccy, base, desc] of rows) {
      await db.query(
        `INSERT INTO transactions
           (transaction_date, description1, amount, currency, base_amount, base_currency,
            account_id, category_id, source, accepted)
         VALUES ($1, $2, $3, $4, $5, 'USD', $6, $7, 'manual', TRUE)`,
        [date, desc, amount, ccy, base, acctId, catId]
      );
    }
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  const q = (extra = '') =>
    `/actual-entries?fromDate=${FROM}&toDate=${TO}&account=${encodeURIComponent(ACCT)}${extra}`;

  test('baseline: returns all four rows, untruncated', async () => {
    const r = await req('GET', q());
    expect(r.status).toBe(200);
    expect(r.body.entries).toHaveLength(4);
    expect(r.body.truncated).toBe(false);
  });

  test('Description1 is populated (the column is description1, not description)', async () => {
    const r = await req('GET', q());
    const descs = r.body.entries.map((e) => e.Description1).sort();
    expect(descs).toEqual([
      'BIEDRONKA WARSZAWA',
      'ONEBILL MYBOX',
      'ZDROFIT WILANOW',
      'ZWROTOD PRZELEW',
    ]);
  });

  test('description narrows the result, case-insensitively', async () => {
    const r = await req('GET', q('&description=biedronka'));
    expect(r.body.entries).toHaveLength(1);
    expect(r.body.entries[0].Description1).toBe('BIEDRONKA WARSZAWA');
  });

  test('valueFrom / valueTo bound the LOCAL amount', async () => {
    // Amounts are -100.00, -5.90, -116.23, -346.00. The bounds are on the signed
    // amount, not its magnitude: >= -110 keeps the two nearest zero.
    const from = await req('GET', q('&valueFrom=-110'));
    expect(from.body.entries).toHaveLength(2);
    expect(from.body.entries.every((e) => e.Amount >= -110)).toBe(true);

    // <= -100 keeps the three largest outflows, -100.00 included (inclusive).
    const to = await req('GET', q('&valueTo=-100'));
    expect(to.body.entries).toHaveLength(3);
    expect(to.body.entries.every((e) => e.Amount <= -100)).toBe(true);
  });

  test('currency filters to one currency', async () => {
    const r = await req('GET', q('&currency=EUR'));
    expect(r.body.entries).toHaveLength(1);
    expect(r.body.entries[0].Currency.trim()).toBe('EUR');
  });

  test('filters compose rather than overriding each other', async () => {
    const r = await req('GET', q('&currency=PLN&valueTo=-100'));
    expect(r.body.entries).toHaveLength(2);
    expect(
      r.body.entries.every((e) => e.Currency.trim() === 'PLN' && e.Amount <= -100)
    ).toBe(true);
  });

  test('truncated is TRUE when the limit is hit, and the rows are still capped', async () => {
    const r = await req('GET', q('&limit=2'));
    expect(r.body.entries).toHaveLength(2);
    expect(r.body.truncated).toBe(true);
  });

  test('truncated is FALSE when the limit exactly equals the row count', async () => {
    // The off-by-one that a naive `rows.length === limit` check gets wrong.
    const r = await req('GET', q('&limit=4'));
    expect(r.body.entries).toHaveLength(4);
    expect(r.body.truncated).toBe(false);
  });

  test('BaseAmount is returned, so a caller can total in base', async () => {
    const r = await req('GET', q());
    const base = r.body.entries.reduce((sum, e) => sum + e.BaseAmount, 0);
    expect(base).toBeCloseTo(-246.47, 2);

    // The defect this CR exists to stop: adding LOCAL amounts across currencies.
    const local = r.body.entries.reduce((sum, e) => sum + e.Amount, 0);
    expect(local).toBeCloseTo(-568.13, 2);
    expect(local).not.toBeCloseTo(base, 2);
  });
});
