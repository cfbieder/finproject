'use strict';
/**
 * budgetBuilder.test.js — CR098, next year's budget from this year's finalised Latest Estimate.
 *
 * Pure tests for the split arithmetic, then one DB-backed walk through the whole cycle on
 * self-seeded fixtures in far-future years (an LE for 2090 seeds a 2091 budget), so no real row
 * is read or touched: create → preview (a parent line blocks) → publish → un-publish → start from
 * → restore. Skip the DB half with SKIP_DB_TESTS=1.
 */

const svc = require('../budgetBuilder');
const assumpRepo = require('../../v2/repositories/forecastAssumptions');
const db = require('../../v2/db');

describe('budget builder — split arithmetic', () => {
  test('allocate sums exactly to the total, remainder on the largest cell', () => {
    const cells = svc.allocate(-100, [1, 1, 1]);
    expect(cells.reduce((a, b) => a + b, 0)).toBeCloseTo(-100, 10);
    expect(cells).toEqual([-33.34, -33.33, -33.33]);
  });

  test('a month holding ≥ 80% of |spend| takes the whole line', () => {
    const grid = new Map([[7, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1200]]]);
    const { cells, method } = svc.splitLine(-1236, { split_method: 'auto' }, grid, null);
    expect(method).toBe('lump:12');
    expect(cells).toEqual([{ account_id: 7, month: 12, amount: -1236 }]);
  });

  test('a month against the account\'s sign splits that account evenly instead of amplifying it', () => {
    const months = [-100, -100, 50, -100, -100, -100, -100, -100, -100, -100, -100, -100];
    const { cells } = svc.splitLine(-1200, { split_method: 'auto' }, new Map([[3, months]]), null);
    expect(new Set(cells.map((c) => c.amount))).toEqual(new Set([-100]));
  });

  test('no actuals and no budget → one row with no account, even months', () => {
    const { cells, source } = svc.splitLine(-120, { split_method: 'auto' }, null, null);
    expect(source).toBe('none');
    expect(cells).toHaveLength(12);
    expect(cells.every((c) => c.account_id === null && c.amount === -10)).toBe(true);
  });
});

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const P = 'CR098T';
const SCEN = `${P} Base`;
const YEAR = 2090;     // the LE's year
const TARGET = 2091;   // the budget it builds

dbDescribe('budget builder — the cycle (DB)', () => {
  const ids = {};

  async function cleanup() {
    await db.query(`DELETE FROM budget_build_publishes WHERE target_year = $1`, [TARGET]);
    await db.query(`DELETE FROM budget_builds WHERE target_year = $1`, [TARGET]);
    await db.query(`DELETE FROM budget_entries WHERE budget_year IN ($1, $2)`, [YEAR, TARGET]);
    await db.query(`DELETE FROM budget_fx_rates WHERE year = $1`, [TARGET]);
    await db.query(`DELETE FROM budget_versions WHERE budget_year = $1`, [TARGET]);
    await db.query(`DELETE FROM budget_le WHERE budget_year = $1`, [YEAR]);
    await db.query(`DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE $1)`, [`${P} %`]);
    await db.query(`DELETE FROM budget_category_policy WHERE category_id IN (SELECT id FROM accounts WHERE name LIKE $1)`, [`${P} %`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1 AND parent_id IS NOT NULL`, [`${P} %`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${P} %`]);
    await db.query(`DELETE FROM forecast_scenarios WHERE name = $1`, [SCEN]);
    const doc = await assumpRepo.getDoc();
    const pruned = {};
    for (const [key, field] of [['scenarios', 'Name'], ['inflation', 'Scenario'], ['FX', 'Scenario']]) {
      if (Array.isArray(doc[key])) pruned[key] = doc[key].filter((e) => !e || e[field] !== SCEN);
    }
    await assumpRepo.putDoc(pruned);
  }

  const account = async (name, { section = 'profit_loss', type = 'expense', currency = 'USD', parent = null } = {}) =>
    (await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance, parent_id)
       VALUES ($1, $2, $3, $4, 0, $5) RETURNING id`, [`${P} ${name}`, type, section, currency, parent]
    )).rows[0].id;
  const tx = (date, amount, currency, accountId, categoryId) => db.query(
    `INSERT INTO transactions (transaction_date, description1, amount, currency, base_amount, base_currency, account_id, category_id, source, accepted)
     VALUES ($1, 't', $2, $3, $2, 'USD', $4, $5, 'manual', TRUE)`, [date, amount, currency, accountId, categoryId]
  );
  const leLine = (month, categoryId, currency, amount) => db.query(
    `INSERT INTO budget_le_lines (le_id, period_month, category_id, currency, source, method, amount, base_amount)
     VALUES ($1, $2, $3, $4, 'manual', 'MANUAL', $5, $5)`, [ids.le, month, categoryId, currency, amount]
  );
  const rows = async () => (await db.query(
    `SELECT * FROM budget_entries WHERE budget_year = $1 ORDER BY id`, [TARGET]
  )).rows;

  beforeAll(async () => {
    await cleanup();
    ids.food = await account('Food');
    ids.rent = await account('Rent PLN', { currency: 'PLN' });
    ids.parent = await account('Kids');
    ids.child = await account('Kids School', { parent: ids.parent });
    ids.bankA = await account('Bank A', { section: 'balance_sheet', type: 'asset' });
    ids.bankB = await account('Bank B', { section: 'balance_sheet', type: 'asset' });
    ids.bankPln = await account('Bank PLN', { section: 'balance_sheet', type: 'asset', currency: 'PLN' });

    // Window = Jul 2089 – Jun 2090 (the LE is actual through 2090-06-30).
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(2089, 6 + m, 15)).toISOString().slice(0, 10);
      await tx(d, -100, 'USD', ids.bankA, ids.food);           // 1,200 from A, every month
    }
    await tx('2090-03-10', -300, 'USD', ids.bankB, ids.food);  //   300 from B, once
    await tx('2089-12-05', -1200, 'PLN', ids.bankPln, ids.rent); // an annual PLN payment

    ids.le = (await db.query(
      `INSERT INTO budget_le (budget_year, actual_through, name, status, finalized_at)
       VALUES ($1, '2090-06-30', $2, 'final', NOW()) RETURNING id`, [YEAR, `${P} LE`]
    )).rows[0].id;
    await leLine('2090-01-01', ids.food, 'USD', -1000);
    await leLine('2090-07-01', ids.food, 'USD', -500);
    await leLine('2090-12-01', ids.rent, 'PLN', -1200);
    await leLine('2090-05-01', ids.parent, 'USD', -50);

    await db.query(
      `INSERT INTO forecast_scenarios (name, is_active, cash_sweep_low, cash_sweep_high) VALUES ($1, TRUE, 0, 0)`, [SCEN]
    );
    const doc = await assumpRepo.getDoc();
    await assumpRepo.putDoc({
      scenarios: [...(doc.scenarios || []), { Name: SCEN, IsActive: true, PeriodStart: 2092, PeriodEnd: 2100 }],
      inflation: [...(doc.inflation || []), { Scenario: SCEN, Year: YEAR, Rate: 3 }],
      FX: [...(doc.FX || []), { Scenario: SCEN, Year: YEAR, Rates: { PLN: 4, EUR: 1 } }],
    });

    // The target year already holds one hand-entered row, in no version.
    await db.query(
      `INSERT INTO budget_entries (entry_date, description, amount, currency, base_amount, base_currency, category_id, budget_year)
       VALUES ('2091-02-01', 'instalment', -25, 'USD', -25, 'USD', $1, $2)`, [ids.food, TARGET]
    );
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('create: one line per (category, currency), rates carried forward from the LE year', async () => {
    const { build } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN });
    ids.v1 = build.id;
    const view = await svc.getBuild(build.id);
    expect(view.build.targetYear).toBe(TARGET);
    expect(view.rates.inflation).toEqual({ rate: 3, fromYear: YEAR });
    expect(view.rates.fx.PLN).toEqual({ rate: 4, fromYear: YEAR });
    const food = view.lines.find((l) => l.categoryId === ids.food);
    expect(food.leFy).toBe(-1500);
    expect(food.annual).toBe(-1545); // Recurring: −1,500 × 1.03
    await expect(svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN })).rejects.toThrow(/already an open draft/);
  });

  test('a parent-category line blocks publish until it is zero', async () => {
    const p = await svc.previewPublish(ids.v1);
    expect(p.blockers.join(' ')).toMatch(/Kids \(USD\) is a parent category/);
    await expect(svc.publish(ids.v1, { checksum: p.checksum })).rejects.toThrow(/parent-category/);
    const parentLine = p.lines.find((l) => l.categoryId === ids.parent);
    await svc.updateLine(ids.v1, parentLine.id, { policy: 'one_off' });
  });

  test('publish replaces the year: one version, the split, the FX rates', async () => {
    const before = await rows();
    let p = await svc.previewPublish(ids.v1);
    expect(p.blockers).toEqual([]);
    expect(p.current.count).toBe(1);
    await expect(svc.publish(ids.v1, { checksum: 'stale' })).rejects.toThrow(/changed since the preview/);
    await svc.publish(ids.v1, { checksum: p.checksum });

    const after = await rows();
    expect(after.some((r) => r.id === before[0].id)).toBe(false);
    expect(new Set(after.map((r) => r.version_id)).size).toBe(1);

    const food = after.filter((r) => r.category_id === ids.food);
    const sum = (rs) => Math.round(rs.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
    expect(sum(food)).toBe(-1545);
    expect(sum(food.filter((r) => r.account_id === ids.bankA))).toBe(-1236); // 1,200 of 1,500 = 80%
    expect(sum(food.filter((r) => r.account_id === ids.bankB))).toBe(-309);

    const rent = after.filter((r) => r.category_id === ids.rent);
    expect(rent).toHaveLength(1);                                   // an annual payment: one month
    expect(rent[0].entry_date).toBe('2091-12-01');
    expect(Number(rent[0].amount)).toBe(-1236);                     // −1,200 × 1.03, in PLN
    expect(Number(rent[0].base_amount)).toBe(-309);                 // ÷ 4 PLN per USD

    const fx = (await db.query(`SELECT rate FROM budget_fx_rates WHERE year = $1 AND currency = 'PLN'`, [TARGET])).rows;
    expect(fx).toHaveLength(12);
    expect(fx.every((r) => Number(r.rate) === 4)).toBe(true);
  });

  test('un-publish restores the year exactly, and removes what publish created', async () => {
    await svc.unpublish(ids.v1);
    const back = await rows();
    expect(back).toHaveLength(1);
    expect(back[0].description).toBe('instalment');
    expect(back[0].version_id).toBeNull();
    expect((await db.query(`SELECT 1 FROM budget_versions WHERE budget_year = $1`, [TARGET])).rows).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM budget_fx_rates WHERE year = $1`, [TARGET])).rows).toHaveLength(0);
  });

  test('start from, publish v2, then restore v1 exactly', async () => {
    let p = await svc.previewPublish(ids.v1);
    await svc.publish(ids.v1, { checksum: p.checksum });
    const v1 = (await rows()).map((r) => `${r.category_id}|${r.account_id}|${r.entry_date}|${r.amount}`).sort();

    const { build: b2 } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: ids.v1 });
    const v2 = await svc.getBuild(b2.id);
    expect(v2.lines.find((l) => l.categoryId === ids.parent).policy).toBe('one_off'); // carried
    const food = v2.lines.find((l) => l.categoryId === ids.food);
    await svc.updateLine(b2.id, food.id, { policy: 'fixed', fixedAmount: -600 });
    p = await svc.previewPublish(b2.id);
    await svc.publish(b2.id, { checksum: p.checksum });
    const foodNow = (await rows()).filter((r) => r.category_id === ids.food);
    expect(foodNow.reduce((s, r) => s + Number(r.amount), 0)).toBeCloseTo(-600, 2);

    p = await svc.previewPublish(ids.v1);
    await svc.publish(ids.v1, { checksum: p.checksum });
    const restored = (await rows()).map((r) => `${r.category_id}|${r.account_id}|${r.entry_date}|${r.amount}`).sort();
    expect(restored).toEqual(v1);
    const statuses = (await db.query(
      `SELECT build_no, status FROM budget_builds WHERE target_year = $1 ORDER BY build_no`, [TARGET]
    )).rows;
    expect(statuses).toEqual([{ build_no: 1, status: 'published' }, { build_no: 2, status: 'superseded' }]);
    ids.v2 = b2.id;
    ids.v1Rows = v1;
  });

  test('un-publish walks the stack back: v2 live again, then v1, then the pre-builder budget', async () => {
    const status = async () => Object.fromEntries((await db.query(
      `SELECT build_no, status FROM budget_builds WHERE target_year = $1`, [TARGET]
    )).rows.map((r) => [r.build_no, r.status]));
    const foodSum = async () => (await rows()).filter((r) => r.category_id === ids.food)
      .reduce((s, r) => s + Number(r.amount), 0);

    await expect(svc.unpublish(ids.v2)).rejects.toThrow(/Only the live build/);
    expect((await svc.unpublish(ids.v1)).live).toBe(2);           // undoes the restore
    expect(await status()).toEqual({ 1: 'unpublished', 2: 'published' });
    expect(await foodSum()).toBeCloseTo(-600, 2);

    expect((await svc.unpublish(ids.v2)).live).toBe(1);           // undoes v2
    expect(await status()).toEqual({ 1: 'published', 2: 'unpublished' });
    expect((await rows()).map((r) => `${r.category_id}|${r.account_id}|${r.entry_date}|${r.amount}`).sort())
      .toEqual(ids.v1Rows);

    expect((await svc.unpublish(ids.v1)).live).toBeNull();        // undoes v1's first publish
    const back = await rows();
    expect(back).toHaveLength(1);
    expect(back[0].description).toBe('instalment');
    expect((await db.query(`SELECT 1 FROM budget_versions WHERE budget_year = $1`, [TARGET])).rows).toHaveLength(0);
  });

  test('a line edit between preview and confirm is refused, not published', async () => {
    const { build: b3 } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: ids.v1 });
    ids.v3 = b3.id;
    let p = await svc.previewPublish(b3.id);
    const food = p.lines.find((l) => l.categoryId === ids.food);
    await svc.updateLine(b3.id, food.id, { policy: 'fixed', fixedAmount: -700 });
    await expect(svc.publish(b3.id, { checksum: p.checksum })).rejects.toThrow(/changed since the preview/);
    p = await svc.previewPublish(b3.id);
    await svc.publish(b3.id, { checksum: p.checksum });
  });

  test('an edit after publish makes un-publish refuse', async () => {
    await db.query(`UPDATE budget_entries SET note = 'hand edit' WHERE id = (SELECT MIN(id) FROM budget_entries WHERE budget_year = $1)`, [TARGET]);
    await expect(svc.unpublish(ids.v3)).rejects.toThrow(/edited after this publish/);
  });
});
