'use strict';
/**
 * budgetCashFlow.test.js — CR104, the budget builder's Cash Flow by currency.
 *
 * Self-seeded far-future fixtures (an LE for 2094 seeds a 2095 build) with their OWN block roots,
 * injected through `roots`, so no assertion depends on dev's real accounts. Skip with SKIP_DB_TESTS=1.
 *
 *   Cash roots:   CR104T Cash (Bank USD, Bank PLN), CR104T Cards (Card USD)
 *   Investments:  CR104T Inv (Broker USD)
 *   Other:        CR104T Tax (a liability under no root)
 *
 * Balances at the LE cut-off 2094-06-30: Bank USD 1,100 · Card −40 · Broker 5,010 · Bank PLN 400.
 * A +999 on Bank USD dated 2094-08-01 is AFTER the cut-off and must not reach the opening.
 */

const svc = require('../budgetCashFlow');
const builder = require('../budgetBuilder');
const assumpRepo = require('../../v2/repositories/forecastAssumptions');
const db = require('../../v2/db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const P = 'CR104T';
const SCEN = `${P} Base`;
const YEAR = 2094;
const TARGET = 2095;
const ROOTS = { cash: [`${P} Cash`, `${P} Cards`], investments: [`${P} Inv`] };

describe('rollForward (pure)', () => {
  const blockOf = new Map([[1, 'cash'], [2, 'cash'], [3, 'investments'], [4, 'cash']]);
  const base = {
    balances: [{ id: 1, currency: 'USD', balance: 100 }, { id: 2, currency: 'USD', balance: -30 },
      { id: 3, currency: 'USD', balance: 1000 }, { id: 4, currency: 'GBP', balance: 7 }],
    blockOf,
    remainder: [],
    cells: [
      { account_id: 1, currency: 'USD', month: 1, amount: 50 },
      { account_id: 2, currency: 'USD', month: 2, amount: -200 },   // card spend leaves cash
      { account_id: 3, currency: 'USD', month: 3, amount: 25 },
      { account_id: null, currency: 'USD', month: 4, amount: -10 },
      { account_id: 9, currency: 'USD', month: 5, amount: -5 },     // an Other account
      { account_id: 1, currency: 'EUR', month: 1, amount: -1 },     // EUR line on a USD account
    ],
    accountCurrency: new Map([[1, 'USD'], [2, 'USD'], [3, 'USD'], [9, 'USD']]),
  };

  test('cards net into cash, spend through them is an outflow, and the month goes short', () => {
    const usd = svc.rollForward(base).currencies.find((c) => c.currency === 'USD');
    expect(usd.cash.opening).toMatchObject({ value: 70, source: 'estimate', balance: 70 });
    expect(usd.cash.ending.slice(0, 4)).toEqual([120, -80, -80, -90]);
    expect(usd.short).toEqual({ months: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], lowest: -90 });
    expect(usd.investments.ending[2]).toBe(1025);
    expect(usd.other.months[4]).toBe(-5);
    expect(usd.flowTotal).toBe(-140);
  });

  test('a fourth currency is listed, not modelled; a cell/account currency mismatch is listed', () => {
    const r = svc.rollForward(base);
    expect(r.currencies.map((c) => c.currency)).toEqual(['USD', 'PLN', 'EUR']);
    expect(r.notModelled).toEqual([{ currency: 'GBP', cash: 7, investments: 0 }]);
    expect(r.currencyMismatches).toEqual([{ currency: 'EUR', accountCurrency: 'USD', cells: 1, amount: -1 }]);
  });

  test('an override replaces the estimate; a transfer moves both sides exactly', () => {
    const r = svc.rollForward({ ...base, plan: [
      { kind: 'opening', currency: 'USD', block: 'cash', amount: 500 },
      { kind: 'transfer', currency: 'USD', block: 'investments', month: 2, to_currency: 'EUR', to_block: 'cash', amount: 100, to_amount: 89 },
    ] });
    const usd = r.currencies.find((c) => c.currency === 'USD');
    const eur = r.currencies.find((c) => c.currency === 'EUR');
    expect(usd.cash.opening).toMatchObject({ value: 500, source: 'override', estimate: 70 });
    expect(usd.investments.transfers[1]).toBe(-100);
    expect(eur.cash.transfers[1]).toBe(89);
    expect(eur.cash.ending[11]).toBe(88);
  });
});

dbDescribe('Cash flow by currency (DB)', () => {
  const ids = {};
  const cleanup = async () => {
    await db.query('DELETE FROM budget_builds WHERE target_year = $1', [TARGET]);
    await db.query('DELETE FROM budget_le WHERE budget_year = $1', [YEAR]);
    await db.query('DELETE FROM transactions WHERE description1 = $1', [`${P} txn`]);
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [SCEN]);
    await db.query('DELETE FROM budget_category_policy WHERE category_id IN (SELECT id FROM accounts WHERE name LIKE $1)', [`${P} %`]);
    for (let i = 0; i < 3; i++) {
      await db.query(`DELETE FROM accounts a WHERE a.name LIKE $1
        AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id)`, [`${P} %`]);
    }
    const doc = await assumpRepo.getDoc();
    const pruned = {};
    for (const [key, field] of [['scenarios', 'Name'], ['inflation', 'Scenario'], ['FX', 'Scenario']]) {
      if (Array.isArray(doc[key])) pruned[key] = doc[key].filter((e) => !e || e[field] !== SCEN);
    }
    await assumpRepo.putDoc(pruned);
  };
  const account = async (name, { type, section, currency = 'USD', parent = null, opening = 0 }) => (await db.query(
    `INSERT INTO accounts (name, account_type, section, currency, opening_balance, opening_balance_date, parent_id)
     VALUES ($1, $2, $3, $4, $5, '2094-01-01', $6) RETURNING id`, [`${P} ${name}`, type, section, currency, opening, parent]
  )).rows[0].id;
  const bs = (name, opts) => account(name, { section: 'balance_sheet', type: 'asset', ...opts });
  const pl = (name, type = 'expense') => account(name, { section: 'profit_loss', type });
  const txn = (accountId, categoryId, date, amount, currency = 'USD') => db.query(
    `INSERT INTO transactions (account_id, category_id, transaction_date, amount, currency, description1)
     VALUES ($1, $2, $3, $4, $5, $6)`, [accountId, categoryId, date, amount, currency, `${P} txn`]
  );
  const leLine = (categoryId, month, amount, currency = 'USD') => db.query(
    `INSERT INTO budget_le_lines (le_id, period_month, category_id, currency, source, method, amount, base_amount)
     VALUES ($1, $2, $3, $4, 'manual', 'MANUAL', $5, $5)`, [ids.le, month, categoryId, currency, amount]
  );
  const flow = () => svc.cashFlow(ids.build, { roots: ROOTS });
  const cur = (r, c) => r.currencies.find((x) => x.currency === c);

  beforeAll(async () => {
    await cleanup();
    ids.cash = await bs('Cash', {});
    ids.bankUsd = await bs('Bank USD', { parent: ids.cash, opening: 1000 });
    ids.bankPln = await bs('Bank PLN', { parent: ids.cash, currency: 'PLN', opening: 400 });
    ids.cards = await bs('Cards', { type: 'liability' });
    ids.card = await bs('Card USD', { type: 'liability', parent: ids.cards });
    ids.inv = await bs('Inv', {});
    ids.broker = await bs('Broker USD', { parent: ids.inv, opening: 5000 });
    ids.tax = await bs('Tax', { type: 'liability' });
    ids.salary = await pl('Salary', 'income');
    ids.rent = await pl('Rent');
    ids.coupon = await pl('Coupon', 'income');
    ids.tips = await pl('Tips');
    ids.taxPay = await pl('Tax Pay');

    await txn(ids.bankUsd, ids.salary, '2094-03-15', 100);
    await txn(ids.card, ids.rent, '2094-04-10', -40);
    await txn(ids.broker, ids.coupon, '2094-05-05', 10);
    await txn(ids.tax, ids.taxPay, '2094-02-10', -50);
    await txn(ids.bankUsd, ids.salary, '2094-08-01', 999); // after the cut-off

    ids.le = (await db.query(
      `INSERT INTO budget_le (budget_year, actual_through, name, status, finalized_at)
       VALUES ($1, '2094-06-30', $2, 'final', NOW()) RETURNING id`, [YEAR, `${P} LE`]
    )).rows[0].id;
    await leLine(ids.salary, '2094-03-01', 100);
    await leLine(ids.salary, '2094-09-01', 300);  // remainder → Bank USD (cash)
    await leLine(ids.rent, '2094-04-01', -40);
    await leLine(ids.rent, '2094-10-01', -60);    // remainder → Card (cash)
    await leLine(ids.coupon, '2094-05-01', 10);
    await leLine(ids.coupon, '2094-11-01', 20);   // remainder → Broker (investments)
    await leLine(ids.tips, '2094-12-01', -5);     // no actuals → Unassigned
    await leLine(ids.taxPay, '2094-02-01', -50);

    await db.query(
      'INSERT INTO forecast_scenarios (name, is_active, cash_sweep_low, cash_sweep_high) VALUES ($1, TRUE, 0, 0)', [SCEN]
    );
    const doc = await assumpRepo.getDoc();
    await assumpRepo.putDoc({
      scenarios: [...(doc.scenarios || []), { Name: SCEN, IsActive: true, PeriodStart: 2096, PeriodEnd: 2098 }],
      inflation: [...(doc.inflation || []), { Scenario: SCEN, Year: YEAR, Rate: 0 }],
      FX: [...(doc.FX || []), { Scenario: SCEN, Year: YEAR, Rates: { PLN: 4, EUR: 0.8 } }],
    });
    // 0% inflation: Salary 400 (lump, March), Rent −100 (lump, April), Coupon 30 (lump, May),
    // Tips −5 (even, no account), Tax Pay −50 (lump, February, an Other account).
    ids.build = (await builder.createBuild({ sourceLeId: ids.le, scenarioName: SCEN })).build.id;
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('opening = balances at the LE cut-off + the LE months after it, placed by block', async () => {
    const r = await flow();
    expect(r.snapshot.asOf).toBe('2094-06-30');
    const usd = cur(r, 'USD');
    // 1,100 + (−40) = 1,060 balance (the +999 after the cut-off is out); +300 −60 remainder; −5 unassigned
    expect(usd.cash.opening).toMatchObject({ value: 1295, source: 'estimate', balance: 1060, remainder: 240, remainderUnassigned: -5 });
    expect(usd.investments.opening).toMatchObject({ value: 5030, balance: 5010, remainder: 20 });
    expect(cur(r, 'PLN').cash.opening.value).toBe(400);
  });

  test('the roll-forward, the Other row, and the reconciliation against the build', async () => {
    const r = await flow();
    const usd = cur(r, 'USD');
    expect(usd.cash.inflows[2]).toBe(400);
    expect(usd.cash.outflows[3]).toBe(-100);
    expect(usd.cash.year.unassigned).toBe(-5);
    expect(usd.cash.year.closing).toBe(1590);          // 1,295 + 400 − 100 − 5
    expect(usd.investments.year.closing).toBe(5060);   // 5,030 + 30
    expect(usd.other.months[1]).toBe(-50);
    const view = await builder.getBuild(ids.build);
    expect(view.totals.USD).toBe(275);
    expect(usd.flowTotal).toBe(275);
    expect(usd.reconciled).toBe(true);
    // per month, opening + flows = ending
    let run = usd.cash.opening.value;
    for (let m = 0; m < 12; m++) {
      run = Math.round((run + usd.cash.inflows[m] + usd.cash.outflows[m] + usd.cash.unassigned[m] + usd.cash.transfers[m]) * 100) / 100;
      expect(usd.cash.ending[m]).toBe(run);
    }
    expect(usd.short).toBeNull();
    expect(r.unassignedLines).toBe(12);
  });

  test('an opening override flags the short months', async () => {
    await svc.savePlan(ids.build, { openings: [{ currency: 'USD', block: 'cash', amount: 0 }] });
    const usd = cur(await flow(), 'USD');
    expect(usd.cash.opening).toMatchObject({ value: 0, source: 'override', estimate: 1295 });
    expect(usd.short).toEqual({ months: [1, 2], lowest: -0.8 }); // Tips −0.38, −0.42 before March's salary
  });

  test('a transfer at the build’s rate moves both sides to the cent', async () => {
    await svc.savePlan(ids.build, { transfers: [
      { month: 6, fromCurrency: 'PLN', fromBlock: 'cash', toCurrency: 'USD', toBlock: 'cash', amount: 100 },
      { month: 7, fromCurrency: 'USD', fromBlock: 'investments', toCurrency: 'USD', toBlock: 'cash', amount: '1000.50' },
    ] });
    const r = await flow();
    expect(r.plan.transfers.map((t) => [t.rate, t.toAmount])).toEqual([[0.25, 25], [1, 1000.5]]);
    expect(cur(r, 'PLN').cash.transfers[5]).toBe(-100);
    expect(cur(r, 'USD').cash.transfers[5]).toBe(25);
    expect(cur(r, 'USD').investments.transfers[6]).toBe(-1000.5);
    expect(cur(r, 'USD').cash.year.transfers).toBe(1025.5);
    expect(r.plan.openings).toEqual([{ currency: 'USD', block: 'cash', amount: 0 }]); // untouched
  });

  test('bad input is refused, never coerced', async () => {
    const bad = (body) => svc.savePlan(ids.build, body).catch((e) => e.status);
    expect(await bad({ openings: [{ currency: 'USD', block: 'cash', amount: '1,000' }] })).toBe(400);
    expect(await bad({ openings: [{ currency: 'USD', block: 'cash', amount: 1.005 }] })).toBe(400);
    expect(await bad({ openings: [{ currency: 'GBP', block: 'cash', amount: 1 }] })).toBe(400);
    expect(await bad({ transfers: [{ month: 1, fromCurrency: 'USD', fromBlock: 'cash', toCurrency: 'USD', toBlock: 'cash', amount: 5 }] })).toBe(400);
    expect(await bad({ transfers: [{ month: 13, fromCurrency: 'USD', fromBlock: 'cash', toCurrency: 'PLN', toBlock: 'cash', amount: 5 }] })).toBe(400);
    expect(await bad({ transfers: [{ month: 1, fromCurrency: 'USD', fromBlock: 'cash', toCurrency: 'PLN', toBlock: 'cash', amount: -5 }] })).toBe(400);
    expect(await bad({})).toBe(400);
  });

  test('a missing root fails loudly', async () => {
    await expect(svc.cashFlow(ids.build, { roots: { ...ROOTS, investments: [`${P} Nowhere`] } }))
      .rejects.toMatchObject({ status: 500, message: expect.stringContaining(`'${P} Nowhere' not found`) });
  });

  test('a stored build’s plan is read-only; a same-year build started from it copies the plan', async () => {
    await db.query(`UPDATE budget_builds SET status = 'published' WHERE id = $1`, [ids.build]);
    expect(await svc.savePlan(ids.build, { openings: [] }).catch((e) => e.status)).toBe(409);
    const { build } = await builder.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: ids.build });
    const r = await svc.cashFlow(build.id, { roots: ROOTS });
    expect(r.plan.openings).toEqual([{ currency: 'USD', block: 'cash', amount: 0 }]);
    expect(r.plan.transfers).toHaveLength(2);
    expect(r.build.editable).toBe(true);
  });
});
