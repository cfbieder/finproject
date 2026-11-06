'use strict';
/**
 * income.db.test.js — CR103 D6/D8, DB-backed (skip with SKIP_DB_TESTS=1).
 * Every identifier is INVENTED — the repo commits no real financial data.
 *
 * 🔴 The prod parity check could NOT see this: prod's dividends were reloaded on the day it ran, so
 * min(today, dividends_as_of) was today and the anchored window equalled the old one. Here the load
 * is two months stale, as it was before the reload (2026-09-05 against 2026-11-06).
 */
const db = require('../../v2/db');
const { buildIncome } = require('../income');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('CR103 buildIncome: the dividend window ends at the load date (DB)', () => {
  let acctId; let secId; let snapId;
  const TICKER = 'ZZCR103';

  beforeAll(async () => {
    acctId = (await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ('CR103 Income Test','asset','balance_sheet','USD',0) RETURNING id`)).rows[0].id;
    secId = (await db.query(
      `INSERT INTO securities (ticker, name, asset_class, price_basis, dividends_as_of)
       VALUES ($1,'ZZ MONTHLY PAYER','equity','per_share','2026-09-05') RETURNING id`, [TICKER])).rows[0].id;
    // Twelve monthly payments, ex-dated the 5th, 2025-10-05 … 2026-09-05, $1 each.
    for (let i = 0; i < 12; i += 1) {
      const d = new Date(Date.UTC(2025, 9 + i, 5)).toISOString().slice(0, 10);
      await db.query(
        `INSERT INTO security_dividends (security_id, ex_date, pay_date, cash_amount, dividend_type, source)
         VALUES ($1,$2,$2::date + 12,1,'CD','test')`, [secId, d]);
    }
    snapId = (await db.query(
      `INSERT INTO security_position_snapshots (account_id, polled_on, source, status, raw)
       VALUES ($1,'2026-11-05','bank-feed','fetched','{}'::jsonb) RETURNING id`, [acctId])).rows[0].id;
    await db.query(
      `INSERT INTO security_positions (snapshot_id, account_id, security_id, quantity, price, price_source, market_value)
       VALUES ($1,$2,$3,100,10,'custodian',1000)`, [snapId, acctId, secId]);
  });

  afterAll(async () => {
    await db.query('DELETE FROM security_positions WHERE snapshot_id = $1', [snapId]);
    await db.query('DELETE FROM security_position_snapshots WHERE id = $1', [snapId]);
    await db.query('DELETE FROM security_dividends WHERE security_id = $1', [secId]);
    await db.query('DELETE FROM securities WHERE id = $1', [secId]);
    await db.query('DELETE FROM accounts WHERE id = $1', [acctId]);
  });

  test('🔴 a stale load still gives twelve payments, not ten (D6/D8)', async () => {
    const d = await buildIncome({ asOf: '2026-11-06', year: 2027 });
    const acct = d.accounts.find((a) => a.account_id === acctId);
    const h = acct.estimated.holdings.find((x) => x.security_id === secId);
    // Ending today would hold 2025-12-05 … 2026-09-05: ten payments, $10/share.
    expect(h.ttm_per_share).toBe(12);
    expect(h.total).toBe(1200);
    const row = d.budget.rows.find((r) => r.account_id === acctId);
    expect(row).toMatchObject({ basis: 'distribution_stock', category: 'dividend', total: 1200 });
    // Pay dates are the 17th of each month, one per month: an even shape.
    expect(row.months).toEqual(Array(12).fill(100));
  });

  test('the page is told how old the load is', async () => {
    const d = await buildIncome({ asOf: '2026-11-06' });
    // The oldest held load, which on a shared dev database is at most this one.
    expect(d.dividends_as_of <= '2026-09-05').toBe(true);
    expect(d.dividends_age_days).toBeGreaterThanOrEqual(62);
  });
});
