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

describe('budget builder — custom month weights', () => {
  const custom = (w) => ({ split_method: 'custom', split_weights: w });
  const weights = Array(12).fill(0);
  weights[2] = 3;  // March
  weights[7] = 2;  // August

  test('weights set the proportions, and an expense takes positive weights', () => {
    const { cells, method } = svc.splitLine(-500000, custom(weights), null, null);
    expect(method).toBe('custom');
    expect(cells).toEqual([
      { account_id: null, month: 3, amount: -300000 },
      { account_id: null, month: 8, amount: -200000 },
    ]);
  });

  test('each account keeps its share and the line sums exactly; the lump rule does not apply', () => {
    const allDecember = (n) => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, n];
    const grid = new Map([[1, allDecember(-2000)], [2, allDecember(-1000)]]);
    const { cells, method } = svc.splitLine(-1000, custom(weights), grid, null);
    expect(method).toBe('custom');
    expect(new Set(cells.map((c) => c.month))).toEqual(new Set([3, 8]));
    const sum = (rows) => Math.round(rows.reduce((s, c) => s + c.amount, 0) * 100) / 100;
    expect(sum(cells)).toBe(-1000);
    expect(sum(cells.filter((c) => c.account_id === 1))).toBe(-666.67);
    expect(sum(cells.filter((c) => c.account_id === 2))).toBe(-333.33);
  });
});

describe('budget builder — which line a category remembers', () => {
  const fx = { USD: { rate: 1 }, PLN: { rate: 4 } };
  const line = (category_id, currency, le_fy, policy) => ({ category_id, currency, le_fy, policy });

  test('the largest |LE| in USD wins, so a large One-off is remembered beside a small Recurring', () => {
    const [kept] = svc.policyLines([line(1, 'USD', -100, 'recurring'), line(1, 'PLN', -1000, 'one_off')], fx);
    expect(kept.policy).toBe('one_off'); // 1,000 PLN = 250 USD
  });

  test('ranks in USD, not in local units', () => {
    const [kept] = svc.policyLines([line(1, 'USD', -300, 'fixed'), line(1, 'PLN', -1000, 'one_off')], fx);
    expect(kept.policy).toBe('fixed');
  });

  test('a tie goes to the lower currency code, whichever line arrives first', () => {
    const lines = [line(1, 'USD', -250, 'fixed'), line(1, 'PLN', -1000, 'one_off')];
    expect(svc.policyLines(lines, fx)[0].currency).toBe('PLN');
    expect(svc.policyLines([...lines].reverse(), fx)[0].currency).toBe('PLN');
  });

  test('a line with no rate cannot outrank one that has it, and one per category comes back', () => {
    const kept = svc.policyLines([line(1, 'EUR', -9999, 'one_off'), line(1, 'USD', -1, 'fixed'), line(2, 'EUR', -5, 'one_off')], fx);
    expect(kept.map((l) => [l.category_id, l.currency])).toEqual([[1, 'USD'], [2, 'EUR']]);
  });
});

describe('budget builder — grid rows in Chart of Accounts order', () => {
  const tree = [
    { id: 1, name: 'Income', children: [{ id: 2, name: 'Salary', children: [] }] },
    { id: 3, name: 'Expense', children: [
      { id: 4, name: 'Car', children: [{ id: 5, name: 'Lease', children: [] }, { id: 6, name: 'Fuel', children: [] }] },
      { id: 7, name: 'Empty', children: [{ id: 8, name: 'Nothing', children: [] }] },
    ] },
  ];
  const line = (id, categoryId, annualUsd) => ({ id, categoryId, annualUsd });
  const shape = (rows) => rows.map((r) => (r.kind === 'group' ? `${r.depth}:${r.name}:${r.usd}` : `${r.depth}:#${r.lineId}`));

  test('follows the tree, not the order lines arrive in; subtotals roll up; empty groups go', () => {
    const rows = svc.groupLines(tree, [line(10, 6, -5), line(11, 5, -10), line(12, 2, 100), line(13, 5, -1)]);
    expect(shape(rows)).toEqual([
      '0:Income:100', '1:#12',
      '0:Expense:-16', '1:Car:-16', '2:#11', '2:#13', '2:#10',
    ]);
  });

  test('a parent holding its own line lists it under its header, inside its subtotal', () => {
    const rows = svc.groupLines(tree, [line(10, 4, -2), line(11, 5, -10)]);
    expect(shape(rows)).toEqual(['0:Expense:-12', '1:Car:-12', '2:#10', '2:#11']);
  });

  test('a line with no USD figure makes its subtotals unknown, not partial', () => {
    const rows = svc.groupLines(tree, [line(10, 5, null), line(11, 6, -10), line(12, 2, 100)]);
    expect(shape(rows)).toEqual(['0:Income:100', '1:#12', '0:Expense:null', '1:Car:null', '2:#10', '2:#11']);
  });

  test('a line on a category the tree lacks is listed at the end, never dropped', () => {
    const rows = svc.groupLines(tree, [line(10, 99, -3), line(11, 2, 100)]);
    expect(shape(rows)).toEqual(['0:Income:100', '1:#11', '0:Not in the Chart of Accounts:-3', '1:#10']);
  });
});

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const P = 'CR098T';
const SCEN = `${P} Base`;
const EMPTY_SCEN = `${P} Empty`; // a base scenario with no rates at all
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
    await db.query(`DELETE FROM forecast_scenarios WHERE name = ANY($1)`, [[SCEN, EMPTY_SCEN]]);
    const doc = await assumpRepo.getDoc();
    const pruned = {};
    for (const [key, field] of [['scenarios', 'Name'], ['inflation', 'Scenario'], ['FX', 'Scenario']]) {
      if (Array.isArray(doc[key])) pruned[key] = doc[key].filter((e) => !e || ![SCEN, EMPTY_SCEN].includes(e[field]));
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
    ids.mixed = await account('Mixed');
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
    await leLine('2090-05-01', ids.mixed, 'USD', -100);
    await leLine('2090-05-01', ids.mixed, 'PLN', -1000); // 250 USD at 4: this line sets what is remembered

    // An all-USD estimate, so a missing inflation rate cannot hide behind a missing FX rate.
    ids.leUsd = (await db.query(
      `INSERT INTO budget_le (budget_year, actual_through, name, status, finalized_at)
       VALUES ($1, '2090-05-31', $2, 'final', NOW()) RETURNING id`, [YEAR, `${P} LE USD`]
    )).rows[0].id;
    await db.query(
      `INSERT INTO budget_le_lines (le_id, period_month, category_id, currency, source, method, amount, base_amount)
       VALUES ($1, '2090-01-01', $2, 'USD', 'manual', 'MANUAL', -1000, -1000)`, [ids.leUsd, ids.food]
    );

    for (const name of [SCEN, EMPTY_SCEN]) {
      await db.query(
        `INSERT INTO forecast_scenarios (name, is_active, cash_sweep_low, cash_sweep_high) VALUES ($1, TRUE, 0, 0)`, [name]
      );
    }
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
  });

  test('a year can hold several open drafts, numbered apart', async () => {
    const { build } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN });
    expect(build.build_no).toBe(2);
    const open = (await svc.listSources()).builds.filter((b) => b.target_year === TARGET && b.status === 'draft');
    expect(open.map((b) => b.build_no)).toEqual([2, 1]);
    expect(open[0].source_le_id).toBe(ids.le);
    await svc.deleteDraft(build.id); // the walk below numbers its builds from v1
  });

  test('the preview carries the LE year\'s actual months as a reference, through actual_through only', async () => {
    const p = await svc.previewPublish(ids.v1);
    expect(p.priorYear).toEqual({ year: YEAR, through: '2090-06-30' });
    const food = p.lines.find((l) => l.categoryId === ids.food);
    // Jan–Jun 2090 actual: −100 a month from Bank A, plus −300 from Bank B in March; Jul–Dec not yet actual.
    expect(p.split.find((s) => s.id === food.id).priorActual)
      .toEqual([-100, -100, -400, -100, -100, -100, null, null, null, null, null, null]);
    const rent = p.lines.find((l) => l.categoryId === ids.rent);
    expect(p.split.find((s) => s.id === rent.id).priorActual.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
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

  test('month weights: refused when empty, rescale with the annual, copied, remembered, frozen on restore', async () => {
    const weights = Array(12).fill('');
    weights[2] = 60;
    weights[7] = 40;
    const { build } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: ids.v1 });
    const food = (await svc.getBuild(build.id)).lines.find((l) => l.categoryId === ids.food);

    await expect(svc.updateLine(build.id, food.id, { splitMethod: 'custom', splitWeights: Array(12).fill('') }))
      .rejects.toThrow(/at least one month/);
    await expect(svc.updateLine(build.id, food.id, { splitMethod: 'custom' })).rejects.toThrow(/at least one month/);
    await expect(svc.updateLine(build.id, food.id, { splitMethod: 'custom', splitWeights: [1, 2] })).rejects.toThrow(/all twelve/);
    await expect(svc.updateLine(build.id, food.id, { splitMethod: 'custom', splitWeights: Array(12).fill(-1) })).rejects.toThrow(/zero or more/);
    await expect(svc.updateLine(build.id, food.id, { splitMethod: 'custom', splitWeights: [0.125, ...Array(11).fill('')] })).rejects.toThrow(/two decimals/);
    await expect(svc.updateLine(build.id, food.id, { splitMethod: 'custom', splitWeights: [3, 2, ...Array(10).fill('')] }))
      .rejects.toThrow(/total 100% — these total 5%/);

    await svc.updateLine(build.id, food.id, { policy: 'fixed', fixedAmount: -500, splitMethod: 'custom', splitWeights: weights });
    const months = async (id) => {
      const p = await svc.previewPublish(id);
      const l = p.lines.find((x) => x.categoryId === ids.food);
      return p.split.find((s) => s.id === l.id).months;
    };
    let m = await months(build.id);
    expect([m[2], m[7]]).toEqual([-300, -200]);
    expect(m.reduce((a, b) => a + b, 0)).toBeCloseTo(-500, 2);

    await svc.updateLine(build.id, food.id, { fixedAmount: -1000 });
    m = await months(build.id);
    expect([m[2], m[7]]).toEqual([-600, -400]);

    const { build: copy } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: build.id });
    const copied = (await svc.getBuild(copy.id)).lines.find((l) => l.categoryId === ids.food);
    expect(copied.splitMethod).toBe('custom');
    expect(copied.splitWeights[2]).toBe(60);

    // Leaving custom clears the weights.
    await svc.updateLine(copy.id, copied.id, { splitMethod: 'even' });
    expect((await svc.getBuild(copy.id)).lines.find((l) => l.categoryId === ids.food).splitWeights).toBeNull();
    await svc.deleteDraft(copy.id);

    let p = await svc.previewPublish(build.id);
    await svc.publish(build.id, { checksum: p.checksum });
    const pol = (await db.query('SELECT split_override, split_weights FROM budget_category_policy WHERE category_id = $1', [ids.food])).rows[0];
    expect(pol.split_override).toBe('custom');
    expect(Number(pol.split_weights[7])).toBe(40);

    // A weight edit in a later draft cannot touch what this build stored.
    const cells = async () => (await db.query('SELECT month, amount FROM budget_build_cells WHERE build_id = $1 ORDER BY id', [build.id])).rows;
    const stored = await cells();
    const { build: later } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: build.id });
    const laterFood = (await svc.getBuild(later.id)).lines.find((l) => l.categoryId === ids.food);
    await svc.updateLine(later.id, laterFood.id, { splitWeights: [50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50] });
    p = await svc.previewPublish(later.id);
    await svc.publish(later.id, { checksum: p.checksum });
    p = await svc.previewPublish(build.id);
    await svc.publish(build.id, { checksum: p.checksum });
    expect(await cells()).toEqual(stored);
    const foodRows = (await rows()).filter((r) => r.category_id === ids.food);
    expect(foodRows.reduce((s, r) => s + Number(r.amount), 0)).toBeCloseTo(-1000, 2);
    expect(new Set(foodRows.map((r) => r.entry_date.slice(5, 7)))).toEqual(new Set(['03', '08']));
    await db.query('DELETE FROM budget_category_policy WHERE category_id = $1', [ids.food]);
  });

  test('a done mark: any build, no figure or token moves, and Start from copies it', async () => {
    const view = await svc.getBuild(ids.v1); // published or superseded by now: marks still allowed
    const food = view.lines.find((l) => l.categoryId === ids.food);
    expect(food.done).toBe(false);
    const before = await svc.previewPublish(ids.v1);
    await svc.setLineDone(ids.v1, food.id, true);
    expect((await svc.getBuild(ids.v1)).lines.find((l) => l.id === food.id).done).toBe(true);
    expect((await svc.previewPublish(ids.v1)).checksum).toBe(before.checksum);
    await expect(svc.setLineDone(ids.v1, food.id, 'yes')).rejects.toThrow(/true or false/);
    await expect(svc.setLineDone(ids.v1, 999999999, true)).rejects.toThrow(/Line not found/);

    const { build: copy } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: ids.v1 });
    expect((await svc.getBuild(copy.id)).lines.find((l) => l.categoryId === ids.food).done).toBe(true);
    const { build: fresh } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN });
    expect((await svc.getBuild(fresh.id)).lines.every((l) => l.done === false)).toBe(true);
    await svc.deleteDraft(copy.id);
    await svc.deleteDraft(fresh.id);
    await svc.setLineDone(ids.v1, food.id, false);
  });

  test('deleting a draft that has a copy leaves the copy whole, with no parent', async () => {
    const { build: a } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN });
    const aFood = (await svc.getBuild(a.id)).lines.find((l) => l.categoryId === ids.food);
    await svc.updateLine(a.id, aFood.id, { policy: 'fixed', fixedAmount: -111 });
    const { build: b } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: a.id });

    // Editing the copy leaves the original alone.
    const bFood = (await svc.getBuild(b.id)).lines.find((l) => l.categoryId === ids.food);
    await svc.updateLine(b.id, bFood.id, { fixedAmount: -222 });
    expect((await svc.getBuild(a.id)).lines.find((l) => l.categoryId === ids.food).annual).toBe(-111);

    await svc.deleteDraft(a.id);
    const after = await svc.getBuild(b.id);
    expect(after.build.parentBuildId).toBeNull();
    expect(after.lines.find((l) => l.categoryId === ids.food).annual).toBe(-222);
    await svc.deleteDraft(b.id);
  });

  test('line edits remember nothing; publish and restore remember the published build', async () => {
    const remembered = async (categoryId) => (await db.query(
      'SELECT policy FROM budget_category_policy WHERE category_id = $1', [categoryId]
    )).rows[0]?.policy;
    await db.query('DELETE FROM budget_category_policy WHERE category_id = $1', [ids.mixed]);

    const { build } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: ids.v1 });
    ids.oneOff = build.id;
    const mixedLine = (view, currency) => view.lines.find((l) => l.categoryId === ids.mixed && l.currency === currency);
    let view = await svc.getBuild(build.id);
    await svc.updateLine(build.id, mixedLine(view, 'PLN').id, { policy: 'one_off' });
    expect(await remembered(ids.mixed)).toBeUndefined();

    let p = await svc.previewPublish(build.id);
    await svc.publish(build.id, { checksum: p.checksum });
    expect(await remembered(ids.mixed)).toBe('one_off'); // the PLN line outranks the USD one, at 250 USD

    // v1 has both lines Recurring, and restoring it puts that back.
    p = await svc.previewPublish(ids.v1);
    await svc.publish(ids.v1, { checksum: p.checksum });
    expect(await remembered(ids.mixed)).toBe('recurring');
  });

  test('a stored build keeps its published USD and rates when the scenario moves or goes', async () => {
    const before = await svc.getBuild(ids.oneOff);
    expect(before.rates.fx.PLN.rate).toBe(4);
    const { build: draft } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: ids.oneOff });
    const draftBefore = await svc.getBuild(draft.id);

    const doc = await assumpRepo.getDoc();
    const others = (doc.FX || []).filter((e) => e.Scenario !== SCEN);
    await assumpRepo.putDoc({ FX: [...others, { Scenario: SCEN, Year: YEAR, Rates: { PLN: 8, EUR: 1 } }] });

    const after = await svc.getBuild(ids.oneOff);
    expect(after.rates.fx.PLN.rate).toBe(4);
    expect(after.usdTotal).toBe(before.usdTotal);
    expect((await svc.getBuild(draft.id)).usdTotal).not.toBe(draftBefore.usdTotal);

    // A stored month split comes back from its cells.
    const preview = await svc.previewPublish(ids.oneOff);
    const food = preview.lines.find((l) => l.categoryId === ids.food);
    const foodSplit = preview.split.find((s) => s.id === food.id);
    expect(foodSplit.splitSource).toBe('stored');
    expect(foodSplit.months.reduce((a, b) => a + b, 0)).toBeCloseTo(food.annual, 2);

    // Published before migration 085: FX from the cells, inflation unknown, and it still opens.
    await db.query('UPDATE budget_builds SET published_rates = NULL WHERE id = $1', [ids.oneOff]);
    const legacy = await svc.getBuild(ids.oneOff);
    expect(legacy.rates.inflation).toBeNull();
    expect(legacy.rates.fx.PLN).toEqual({ rate: 4, fromYear: null });
    expect(legacy.usdTotal).toBe(before.usdTotal);
    await svc.deleteDraft(draft.id);
  });

  test('a draft with no rates opens, stays editable, and refuses to publish', async () => {
    const { build } = await svc.createBuild({ sourceLeId: ids.leUsd, scenarioName: EMPTY_SCEN });
    const view = await svc.getBuild(build.id);
    const food = view.lines.find((l) => l.categoryId === ids.food);
    expect(view.rates.inflation).toBeNull();
    expect(food.annual).toBeNull();
    expect(food.annualUsd).toBeNull();
    expect(food.vsLe).toBeNull();
    expect(view.totals.USD).toBeNull();
    expect(view.usdTotal).toBeNull();

    // A null Rate is no rate, not 0%.
    const doc = await assumpRepo.getDoc();
    await assumpRepo.putDoc({ inflation: [...doc.inflation, { Scenario: EMPTY_SCEN, Year: YEAR, Rate: null }] });
    expect((await svc.getBuild(build.id)).rates.inflation).toBeNull();

    const before = await rows();
    const p = await svc.previewPublish(build.id);
    expect(p.blockers.join(' ')).toMatch(/CR098T Empty' has no inflation rate/);
    await expect(svc.publish(build.id, { checksum: p.checksum })).rejects.toThrow(/no inflation rate/);
    expect(await rows()).toEqual(before);

    // A Fixed line needs no rate, but it does need an amount.
    await svc.updateLine(build.id, food.id, { policy: 'fixed', fixedAmount: -900 });
    await expect(svc.updateLine(build.id, food.id, { fixedAmount: null })).rejects.toThrow(/needs an amount/);
    const fixed = await svc.getBuild(build.id);
    expect(fixed.usdTotal).toBe(-900);
    expect((await svc.previewPublish(build.id)).blockers).toEqual([]);
    await svc.deleteDraft(build.id);
  });

  test('compare lists every build of the year with its own total; a draft without rates shows none', async () => {
    const { build } = await svc.createBuild({ sourceLeId: ids.leUsd, scenarioName: EMPTY_SCEN });
    const { year, builds } = await svc.compareYear(String(TARGET));
    expect(year).toBe(TARGET);
    const all = (await db.query(
      'SELECT id FROM budget_builds WHERE target_year = $1 ORDER BY build_no DESC', [TARGET]
    )).rows.map((r) => r.id);
    expect(builds.map((b) => b.id)).toEqual(all);
    for (const b of builds) {
      expect(b.error).toBeUndefined();
      expect(b.usdTotal).toBe((await svc.getBuild(b.id)).usdTotal);
    }
    const noRates = builds.find((b) => b.id === build.id);
    expect(noRates.usdTotal).toBeNull();
    expect(noRates.rates.inflation).toBeNull();
    expect(builds.some((b) => b.status === 'published' && b.usdTotal != null)).toBe(true);
    await expect(svc.compareYear('x')).rejects.toMatchObject({ status: 400 });
    expect((await svc.compareYear(TARGET + 50)).builds).toEqual([]);
    await svc.deleteDraft(build.id);
  });

  test('compare lists a build refused for a known reason, but a database error fails the request', async () => {
    const real = db.query.bind(db);
    const failSecondQuery = (error) => {
      let n = 0;
      return jest.spyOn(db, 'query').mockImplementation((...args) => (++n === 2 ? Promise.reject(error) : real(...args)));
    };
    let spy = failSecondQuery(Object.assign(new Error('Build not found'), { status: 404 }));
    try {
      const { builds } = await svc.compareYear(TARGET);
      expect(builds[0].error).toBe('Build not found');
      expect(builds.slice(1).every((b) => !b.error)).toBe(true);
    } finally { spy.mockRestore(); }

    spy = failSecondQuery(new Error('relation "budget_builds" does not exist'));
    try {
      await expect(svc.compareYear(TARGET)).rejects.toThrow(/relation/);
    } finally { spy.mockRestore(); }
  });

  test('a superseded build opens and restores exactly after its scenario is gone', async () => {
    const stored = async () => (await db.query(
      `SELECT category_id, account_id, currency, month, amount FROM budget_build_cells WHERE build_id = $1 ORDER BY id`, [ids.oneOff]
    )).rows.map((c) => `${c.category_id}|${c.account_id}|${c.currency}|${c.month}|${c.amount}`).sort();
    const doc = await assumpRepo.getDoc();
    await assumpRepo.putDoc({
      inflation: (doc.inflation || []).filter((e) => e.Scenario !== SCEN),
      FX: (doc.FX || []).filter((e) => e.Scenario !== SCEN),
    });
    const p = await svc.previewPublish(ids.oneOff);
    expect(p.blockers).toEqual([]);
    await svc.publish(ids.oneOff, { checksum: p.checksum });
    const written = (await rows()).map((r) => `${r.category_id}|${r.account_id}|${r.currency}|${Number(r.entry_date.slice(5, 7))}|${r.amount}`).sort();
    expect(written).toEqual(await stored());
  });
});
