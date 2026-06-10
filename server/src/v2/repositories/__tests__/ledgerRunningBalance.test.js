'use strict';
/**
 * ledgerRunningBalance.test.js — per-row running balance for the ledger view.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434 via
 * DATABASE_URL. Seeds a throwaway account + transactions, cleans up by unique
 * name — never TRUNCATE.
 *
 * Guards the CR023 tie-out: findLedgerWithRunningBalance must seed at the
 * account's opening_balance (not 0) and carry the full pre-window history
 * forward, so the newest row equals opening_balance + Σ all tx — the same
 * figure the Balance Calibration page computes — under any date filter or
 * pagination limit.
 */

const repo = require('../transactions');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('transactions.findLedgerWithRunningBalance (DB)', () => {
  const ACCT = 'TestLedgerRunningBalAcct';
  const OPENING = 1000;
  let acctId;

  async function addTx(amount, date) {
    return (await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, source, accepted)
       VALUES ($1,'t',$2,'PLN',$2,'PLN',$3,'bank-feed',TRUE) RETURNING id`,
      [date, amount, acctId]
    )).rows[0].id;
  }

  async function cleanup() {
    if (acctId) await db.query(`DELETE FROM transactions WHERE account_id = $1`, [acctId]);
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
    acctId = null;
  }

  beforeAll(async () => {
    await cleanup();
    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'asset', 'balance_sheet', 'PLN', $2) RETURNING id`,
      [ACCT, OPENING]
    );
    acctId = a.rows[0].id;
    // 2024: +100, 2025: -300, 2026: +50, +200 → cumulative 1000,1100,800,850,1050
    await addTx(100, '2024-03-01');
    await addTx(-300, '2025-07-01');
    await addTx(50, '2026-02-01');
    await addTx(200, '2026-05-01');
  });

  afterAll(async () => { await cleanup(); await db.close(); });

  test('seeds at opening_balance; newest row = opening + Σ all tx', async () => {
    const rows = await repo.findLedgerWithRunningBalance({ accountName: ACCT });
    // Returned newest-first
    expect(rows.map((r) => Number(r.amount))).toEqual([200, 50, -300, 100]);
    const bal = rows.map((r) => Number(r.running_balance));
    expect(bal).toEqual([1050, 850, 800, 1100]); // running balance per row
    // Newest row ties out to opening_balance + Σ all tx (the calibration figure)
    expect(bal[0]).toBe(OPENING + 100 - 300 + 50 + 200);
  });

  test('date filter carries pre-window history forward (not reset to 0)', async () => {
    const rows = await repo.findLedgerWithRunningBalance({
      accountName: ACCT, startDate: '2026-01-01', endDate: '2026-12-31',
    });
    // Only the two 2026 rows show, but their balances include 2024/2025 history
    expect(rows.map((r) => Number(r.amount))).toEqual([200, 50]);
    expect(rows.map((r) => Number(r.running_balance))).toEqual([1050, 850]);
  });

  test('limit truncates oldest rows but newest row balance is unchanged', async () => {
    const rows = await repo.findLedgerWithRunningBalance({ accountName: ACCT, limit: 2 });
    expect(rows).toHaveLength(2);
    // Newest two rows; balances still reflect full history before them
    expect(rows.map((r) => Number(r.running_balance))).toEqual([1050, 850]);
  });

  test('unknown account returns no rows', async () => {
    const rows = await repo.findLedgerWithRunningBalance({ accountName: 'NoSuchAccountXYZ' });
    expect(rows).toEqual([]);
  });
});
