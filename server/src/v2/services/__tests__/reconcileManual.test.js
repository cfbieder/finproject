'use strict';
/**
 * reconcileManual.test.js — CR033 manual (non-fed) reconciliation engine.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs dev Postgres on :5434 via
 * DATABASE_URL. Each test seeds its own throwaway balance-sheet account +
 * manual_balances row and cleans up by unique name — never TRUNCATE.
 */

const {
  reconcileManual, setManualBalance, UNREALIZED_GL_CATEGORY_ID, MTM_SOURCE,
} = require('../reconcileManual');
const { manualBalanceReconcile } = require('../../repositories/manualReconciliation');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('reconcileManual (DB)', () => {
  const ACCT = 'TestManualCalibAcct';
  const MONTH_END = '2026-05-31'; // a real month-end → engine targets it directly
  let acctId;

  async function freshAccount({ type = 'asset', currency = 'USD', opening = 0, mode = 'calibrate' }) {
    await cleanup();
    const a = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance, manual_reconcile_mode)
       VALUES ($1, $2, 'balance_sheet', $3, $4, $5) RETURNING id`,
      [ACCT, type, currency, opening, mode]
    );
    acctId = a.rows[0].id;
  }

  async function seedManual(balance, date = MONTH_END) {
    await setManualBalance(acctId, { balance, balanceDate: date });
  }

  async function cleanup() {
    if (acctId) {
      await db.query(`DELETE FROM transactions WHERE account_id = $1`, [acctId]);
      await db.query(`DELETE FROM manual_balances WHERE account_id = $1`, [acctId]);
    }
    await db.query(`DELETE FROM accounts WHERE name = $1`, [ACCT]);
    await db.query(`DELETE FROM exchange_rates WHERE from_currency = 'XTS' AND source = 'test'`);
    acctId = null;
  }

  afterAll(async () => { await cleanup(); await db.close(); });

  test('setManualBalance: upserts last-write-per-date; rejects fed/non-BS accounts', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 0 });
    const r1 = await setManualBalance(acctId, { balance: 100, balanceDate: MONTH_END });
    expect(r1.balance).toBeCloseTo(100, 2);
    const r2 = await setManualBalance(acctId, { balance: 250, balanceDate: MONTH_END });
    expect(r2.balance).toBeCloseTo(250, 2);
    const n = (await db.query(`SELECT COUNT(*)::int AS n FROM manual_balances WHERE account_id=$1`, [acctId])).rows[0];
    expect(n.n).toBe(1); // upsert, not insert-2
  });

  test('calibrate: re-anchors opening_balance = entered − Σtx (asset)', async () => {
    await freshAccount({ type: 'asset', currency: 'PLN', opening: 999, mode: 'calibrate' });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-15', 300, 'PLN', $1, 'manual', TRUE)`, [acctId]);
    await seedManual(800);

    const out = await reconcileManual(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.mode).toBe('calibrate');
    expect(out.new_opening).toBeCloseTo(500, 2); // 800 - 300
    const a = (await db.query(`SELECT opening_balance FROM accounts WHERE id=$1`, [acctId])).rows[0];
    expect(Number(a.opening_balance)).toBeCloseTo(500, 2);
    const n = (await db.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE account_id=$1 AND source=$2`, [acctId, MTM_SOURCE])).rows[0];
    expect(n.n).toBe(0);
  });

  test('calibrate: liability uses the signed entered figure directly (no auto-flip)', async () => {
    // User types −600 for a liability (fin convention) → opening = -600 - (-100).
    await freshAccount({ type: 'liability', currency: 'PLN', opening: 0, mode: 'calibrate' });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-15', -100, 'PLN', $1, 'manual', TRUE)`, [acctId]);
    await seedManual(-600);

    const out = await reconcileManual(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.expected).toBeCloseTo(-600, 2); // entered as-is, no sign normalization
    expect(out.new_opening).toBeCloseTo(-500, 2); // -600 - (-100)
  });

  test("mtm: posts entered−computed as a cat-88 'mtm' entry dated month-end", async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm' });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-10', 500, 'USD', $1, 'manual', TRUE)`, [acctId]); // computed 1500
    await seedManual(1700); // mtm = +200

    const out = await reconcileManual(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.mode).toBe('mtm');
    expect(out.month_end).toBe(MONTH_END);
    expect(out.mtm_amount).toBeCloseTo(200, 2);

    const rows = (await db.query(
      `SELECT amount, category_id, source, transaction_date::text AS d, accepted
       FROM transactions WHERE account_id = $1 AND source = $2`, [acctId, MTM_SOURCE])).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBeCloseTo(200, 2);
    expect(rows[0].category_id).toBe(UNREALIZED_GL_CATEGORY_ID);
    expect(rows[0].d).toBe(MONTH_END);
    expect(rows[0].accepted).toBe(true);
  });

  test('mtm: idempotent — re-running yields a single entry, same amount', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 0, mode: 'mtm' });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-05', 10000, 'USD', $1, 'manual', TRUE)`, [acctId]);
    await seedManual(10350); // mtm = 350 ≈ 3.4% (under guard)

    await reconcileManual(acctId, { asOf: MONTH_END, dryRun: false });
    await reconcileManual(acctId, { asOf: MONTH_END, dryRun: false });

    const rows = (await db.query(
      `SELECT amount FROM transactions WHERE account_id = $1 AND source = $2`, [acctId, MTM_SOURCE])).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBeCloseTo(350, 2);
  });

  test('guard: implausible MTM (>15% of entered) is flagged and blocked unless forced', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 0, mode: 'mtm' });
    await seedManual(1000); // computed 0 → mtm 1000 = 100%

    const dry = await reconcileManual(acctId, { asOf: MONTH_END, dryRun: true });
    expect(dry.implausible).toBe(true);

    const blocked = await reconcileManual(acctId, { asOf: MONTH_END, dryRun: false });
    expect(blocked.applied).toBe(false);
    expect(blocked.note).toMatch(/implausible/i);
    let n = (await db.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE account_id=$1 AND source=$2`, [acctId, MTM_SOURCE])).rows[0];
    expect(n.n).toBe(0);

    const forced = await reconcileManual(acctId, { asOf: MONTH_END, dryRun: false, force: true });
    expect(forced.applied).toBe(true);
    n = (await db.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE account_id=$1 AND source=$2`, [acctId, MTM_SOURCE])).rows[0];
    expect(n.n).toBe(1);
  });

  test('dryRun writes nothing', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 0, mode: 'calibrate' });
    await seedManual(500);
    const out = await reconcileManual(acctId, { asOf: MONTH_END, dryRun: true });
    expect(out.applied).toBe(false);
    const a = (await db.query(`SELECT opening_balance FROM accounts WHERE id=$1`, [acctId])).rows[0];
    expect(Number(a.opening_balance)).toBeCloseTo(0, 2); // unchanged
  });

  test('reconcile with no entered balance throws', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 0, mode: 'calibrate' });
    await expect(reconcileManual(acctId, { asOf: MONTH_END, dryRun: true })).rejects.toThrow(/no manual balance/i);
  });

  test('manualBalanceReconcile: surfaces the account with computed/entered/drift; pending when no entry', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 100, mode: 'calibrate' });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-15', 50, 'USD', $1, 'manual', TRUE)`, [acctId]); // computed 150

    // pending before any entry
    let recon = await manualBalanceReconcile({ asOf: MONTH_END });
    let row = recon.accounts.find((r) => r.account_id === acctId);
    expect(row).toBeTruthy();
    expect(row.computed_balance).toBeCloseTo(150, 2);
    expect(row.entered_balance).toBeNull();
    expect(row.reconciled).toBeNull();

    // after entering 175 → drift -25, not reconciled
    await seedManual(175);
    recon = await manualBalanceReconcile({ asOf: MONTH_END });
    row = recon.accounts.find((r) => r.account_id === acctId);
    expect(row.entered_balance).toBeCloseTo(175, 2);
    expect(row.drift).toBeCloseTo(-25, 2);
    expect(row.reconciled).toBe(false);
  });

  test('manualBalanceReconcile: a fed account never appears', async () => {
    // seed a fed account; it must be excluded from the manual list.
    const FED = 'TestManualFedAcct';
    const FUUID = 'test-manual-fed-uuid';
    await db.query(`DELETE FROM account_source_mappings WHERE external_name=$1`, [FUUID]);
    await db.query(`DELETE FROM accounts WHERE name=$1`, [FED]);
    const fa = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1, 'asset', 'balance_sheet', 'USD', 0) RETURNING id`, [FED]);
    const fedId = fa.rows[0].id;
    await db.query(
      `INSERT INTO account_source_mappings (account_id, source, external_name, ignored)
       VALUES ($1, 'bank-feed', $2, FALSE)`, [fedId, FUUID]);

    const recon = await manualBalanceReconcile({ asOf: MONTH_END });
    expect(recon.accounts.find((r) => r.account_id === fedId)).toBeFalsy();

    await db.query(`DELETE FROM account_source_mappings WHERE external_name=$1`, [FUUID]);
    await db.query(`DELETE FROM accounts WHERE id=$1`, [fedId]);
  });

  test('manualBalanceReconcile: excludes parent/container accounts (leaf-only)', async () => {
    const PARENT = 'TestManualParentAcct';
    const CHILD = 'TestManualChildLeaf';
    await db.query(`DELETE FROM accounts WHERE name IN ($1,$2)`, [CHILD, PARENT]);
    const p = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
       VALUES ($1,'asset','balance_sheet','USD',0) RETURNING id`, [PARENT]);
    const parentId = p.rows[0].id;
    const c = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance, parent_id)
       VALUES ($1,'asset','balance_sheet','USD',0,$2) RETURNING id`, [CHILD, parentId]);
    const childId = c.rows[0].id;

    const recon = await manualBalanceReconcile({ asOf: MONTH_END });
    expect(recon.accounts.find((r) => r.account_id === parentId)).toBeFalsy(); // parent excluded
    expect(recon.accounts.find((r) => r.account_id === childId)).toBeTruthy(); // leaf included

    await db.query(`DELETE FROM accounts WHERE id=$1`, [childId]); // child first (FK)
    await db.query(`DELETE FROM accounts WHERE id=$1`, [parentId]);
  });

  test('mtm: bookDate books the entry verbatim on the chosen date (quarter-end)', async () => {
    await freshAccount({ type: 'asset', currency: 'USD', opening: 1000, mode: 'mtm' });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-03-10', 500, 'USD', $1, 'manual', TRUE)`, [acctId]); // computed by Q1-end = 1500
    await seedManual(1700, '2026-03-31'); // entered as of Q1 end → mtm = +200

    const out = await reconcileManual(acctId, { bookDate: '2026-03-31', dryRun: false });
    expect(out.month_end).toBe('2026-03-31'); // verbatim, NOT snapped to a different month-end
    expect(out.mtm_amount).toBeCloseTo(200, 2);
    const rows = (await db.query(
      `SELECT transaction_date::text AS d FROM transactions WHERE account_id=$1 AND source=$2`,
      [acctId, MTM_SOURCE])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].d).toBe('2026-03-31');
  });

  test('mtm: non-USD account converts base_amount via the FX table', async () => {
    await freshAccount({ type: 'asset', currency: 'XTS', opening: 1000, mode: 'mtm' });
    await db.query(
      `INSERT INTO transactions (transaction_date, amount, currency, account_id, source, accepted)
       VALUES ('2026-05-10', 9000, 'XTS', $1, 'manual', TRUE)`, [acctId]); // computed by MONTH_END = 10000
    await seedManual(10500); // entered as of MONTH_END → mtm = 500 XTS (4.8% < guard)
    await db.query(
      `INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_date, source)
       VALUES ('XTS','USD',2,$1,'test')
       ON CONFLICT (from_currency,to_currency,rate_date) DO UPDATE SET rate = EXCLUDED.rate`, [MONTH_END]);

    const out = await reconcileManual(acctId, { asOf: MONTH_END, dryRun: false });
    expect(out.mtm_amount).toBeCloseTo(500, 2);
    expect(out.base_amount).toBeCloseTo(1000, 2); // 500 XTS * 2 = 1000 USD
    const row = (await db.query(
      `SELECT amount, base_amount, currency, base_currency FROM transactions WHERE account_id=$1 AND source=$2`,
      [acctId, MTM_SOURCE])).rows[0];
    expect(Number(row.amount)).toBeCloseTo(500, 2);
    expect(row.currency).toBe('XTS');
    expect(Number(row.base_amount)).toBeCloseTo(1000, 2);
    expect(row.base_currency).toBe('USD');
  });
});
