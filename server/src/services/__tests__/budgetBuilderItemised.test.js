'use strict';
/**
 * budgetBuilderItemised.test.js — CR100, itemised budget-builder lines.
 *
 * A line built from described rows by month, each in its own currency, converted at the build's
 * rates. Pure tests for the conversion, then a DB walk on self-seeded fixtures in far-future years
 * (an LE for 2093 seeds a 2094 budget), apart from budgetBuilder.test.js so neither suite's policy
 * memory reaches the other. Skip the DB half with SKIP_DB_TESTS=1.
 */

const svc = require('../budgetBuilder');
const assumpRepo = require('../../v2/repositories/forecastAssumptions');
const db = require('../../v2/db');

const FX = { USD: { rate: 1 }, PLN: { rate: 4 }, EUR: { rate: 0.9 } };
const blank = () => Array(12).fill(0);
const months = (pairs) => { const m = blank(); for (const [i, v] of Object.entries(pairs)) m[i] = v; return m; };

describe('itemised lines — conversion', () => {
  test('items convert into the line currency at the build rates, rounded per month', () => {
    const items = [
      { currency: 'PLN', months: months({ 0: -500, 2: -1234.57 }) },
      { currency: 'USD', months: months({ 1: -100 }) },
      { currency: 'EUR', months: months({ 2: -50.55 }) },
    ];
    // EUR → PLN: × 4 / 0.9; 50.55 × 4.4444… = 224.6667, so March is −1,459.24.
    expect(svc.itemMonths(items, 'PLN', FX)).toEqual(months({ 0: -500, 1: -400, 2: -1459.24 }));
  });

  test('a same-currency item needs no rate; an unconvertible one makes the months unknown, not 0', () => {
    const noRates = { USD: { rate: 1 } };
    expect(svc.itemMonths([{ currency: 'PLN', months: months({ 0: -10 }) }], 'PLN', noRates)).toEqual(months({ 0: -10 }));
    expect(svc.itemMonths([{ currency: 'EUR', months: months({ 0: -10 }) }], 'PLN', noRates)).toBeNull();
  });

  test('an itemised line speaks for its category in the remembered policy, whatever the estimates', () => {
    const fx = { USD: { rate: 1 }, PLN: { rate: 4 } };
    const lines = [
      { category_id: 1, currency: 'USD', le_fy: -10000, policy: 'one_off' },
      { category_id: 1, currency: 'PLN', le_fy: -100, policy: 'itemised' },
    ];
    expect(svc.policyLines(lines, fx).map((l) => l.currency)).toEqual(['PLN']);
  });
});

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const P = 'CR100T';
const SCEN = `${P} Base`;
const SCEN_NO_EUR = `${P} No EUR`;
const YEAR = 2093;
const TARGET = 2094;

dbDescribe('itemised lines — the cycle (DB)', () => {
  const ids = {};

  async function cleanup() {
    await db.query('DELETE FROM budget_build_publishes WHERE target_year = $1', [TARGET]);
    await db.query('DELETE FROM budget_builds WHERE target_year = $1', [TARGET]);
    await db.query('DELETE FROM budget_entries WHERE budget_year IN ($1, $2)', [YEAR, TARGET]);
    await db.query('DELETE FROM budget_fx_rates WHERE year = $1', [TARGET]);
    await db.query('DELETE FROM budget_versions WHERE budget_year = $1', [TARGET]);
    await db.query('DELETE FROM budget_le WHERE budget_year = $1', [YEAR]);
    await db.query('DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE $1)', [`${P} %`]);
    await db.query('DELETE FROM budget_category_policy WHERE category_id IN (SELECT id FROM accounts WHERE name LIKE $1)', [`${P} %`]);
    await db.query('DELETE FROM accounts WHERE name LIKE $1 AND parent_id IS NOT NULL', [`${P} %`]);
    await db.query('DELETE FROM accounts WHERE name LIKE $1', [`${P} %`]);
    await db.query('DELETE FROM forecast_scenarios WHERE name = ANY($1)', [[SCEN, SCEN_NO_EUR]]);
    const doc = await assumpRepo.getDoc();
    const pruned = {};
    for (const [key, field] of [['scenarios', 'Name'], ['inflation', 'Scenario'], ['FX', 'Scenario']]) {
      if (Array.isArray(doc[key])) pruned[key] = doc[key].filter((e) => !e || ![SCEN, SCEN_NO_EUR].includes(e[field]));
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
  const leLine = (categoryId, currency, amount) => db.query(
    `INSERT INTO budget_le_lines (le_id, period_month, category_id, currency, source, method, amount, base_amount)
     VALUES ($1, '2093-03-01', $2, $3, 'manual', 'MANUAL', $4, $4)`, [ids.le, categoryId, currency, amount]
  );
  const lineOf = (view, categoryId, currency) =>
    view.lines.find((l) => l.categoryId === categoryId && l.currency === currency);
  const trips = () => ({
    items: [
      { description: 'Lisbon flights', currency: 'PLN', months: months({ 0: 500, 2: 1234.57 }) },
      { description: 'NYC flights', currency: 'USD', months: months({ 1: '100' }) },
      { description: 'Rome flights', currency: 'EUR', months: months({ 2: 50.55 }) },
    ],
  });
  const expected = months({ 0: -500, 1: -400, 2: -1459.24 });
  const publish = async (id) => svc.publish(id, { checksum: (await svc.previewPublish(id)).checksum });

  beforeAll(async () => {
    await cleanup();
    ids.travel = await account('Travel');
    ids.fees = await account('Fees', { type: 'income' });
    ids.parent = await account('Kids');
    ids.child = await account('Kids School', { parent: ids.parent });
    ids.bank1 = await account('Bank 1', { section: 'balance_sheet', type: 'asset', currency: 'PLN' });
    ids.bank2 = await account('Bank 2', { section: 'balance_sheet', type: 'asset', currency: 'PLN' });

    // Window = Jul 2092 – Jun 2093: two PLN accounts every month, so the split is multi-account.
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(2092, 6 + m, 15)).toISOString().slice(0, 10);
      await tx(d, -100, 'PLN', ids.bank1, ids.travel);
      await tx(d, -37, 'PLN', ids.bank2, ids.travel);
    }
    ids.le = (await db.query(
      `INSERT INTO budget_le (budget_year, actual_through, name, status, finalized_at)
       VALUES ($1, '2093-06-30', $2, 'final', NOW()) RETURNING id`, [YEAR, `${P} LE`]
    )).rows[0].id;
    await leLine(ids.travel, 'PLN', -1644);   //   411 USD at 4
    await leLine(ids.travel, 'USD', -10000);  // the larger estimate: must NOT win the remembered policy
    await leLine(ids.parent, 'USD', -50);
    await leLine(ids.fees, 'USD', 100);
    // Further estimates of the same year, for the copy paths: a new EUR line; USD only; Travel excluded.
    const mkLe = async (name, through, rows, excludedIds = []) => {   // one LE per (year, cut-off)
      const id = (await db.query(
        `INSERT INTO budget_le (budget_year, actual_through, name, status, finalized_at, excluded_category_ids)
         VALUES ($1, $2, $3, 'final', NOW(), $4) RETURNING id`, [YEAR, through, `${P} ${name}`, excludedIds]
      )).rows[0].id;
      for (const [cat, cur, amt] of rows) {
        await db.query(
          `INSERT INTO budget_le_lines (le_id, period_month, category_id, currency, source, method, amount, base_amount)
           VALUES ($1, '2093-03-01', $2, $3, 'manual', 'MANUAL', $4, $4)`, [id, cat, cur, amt]
        );
      }
      return id;
    };
    ids.leEur = await mkLe('LE EUR', '2093-05-31', [[ids.travel, 'PLN', -1644], [ids.travel, 'USD', -10000], [ids.travel, 'EUR', -50]]);
    ids.leUsdOnly = await mkLe('LE USD only', '2093-04-30', [[ids.travel, 'USD', -10000]]);
    ids.leExcl = await mkLe('LE excluding Travel', '2093-03-31', [[ids.travel, 'PLN', -1644], [ids.fees, 'USD', 100]], [ids.travel]);

    for (const name of [SCEN, SCEN_NO_EUR]) {
      await db.query(
        'INSERT INTO forecast_scenarios (name, is_active, cash_sweep_low, cash_sweep_high) VALUES ($1, TRUE, 0, 0)', [name]
      );
    }
    const doc = await assumpRepo.getDoc();
    await assumpRepo.putDoc({
      scenarios: [...(doc.scenarios || []),
        { Name: SCEN, IsActive: true, PeriodStart: 2095, PeriodEnd: 2100 },
        { Name: SCEN_NO_EUR, IsActive: true, PeriodStart: 2095, PeriodEnd: 2100 }],
      inflation: [...(doc.inflation || []), { Scenario: SCEN, Year: YEAR, Rate: 3 }, { Scenario: SCEN_NO_EUR, Year: YEAR, Rate: 3 }],
      FX: [...(doc.FX || []),
        { Scenario: SCEN, Year: YEAR, Rates: { PLN: 4, EUR: 0.9 } },
        { Scenario: SCEN_NO_EUR, Year: YEAR, Rates: { PLN: 4 } }],
    });
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('saving items: converted months and annual, rows stored signed, siblings One-off with done cleared', async () => {
    const { build } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN });
    ids.v1 = build.id;
    let view = await svc.getBuild(build.id);
    const pln = lineOf(view, ids.travel, 'PLN');
    const usd = lineOf(view, ids.travel, 'USD');
    await svc.setLineDone(build.id, usd.id, true);
    // The parent-category line would block every publish below; it is not what this suite tests.
    await svc.updateLine(build.id, lineOf(view, ids.parent, 'USD').id, { policy: 'one_off' });

    const { setOneOff } = await svc.setLineItems(build.id, pln.id, trips());
    expect(setOneOff).toEqual([{ lineId: usd.id, currency: 'USD' }]);
    view = await svc.getBuild(build.id);
    const line = lineOf(view, ids.travel, 'PLN');
    expect(line.policy).toBe('itemised');
    expect(line.itemMonths).toEqual(expected);
    expect(line.annual).toBe(-2359.24);
    // Typed positive on an expense line: stored negative, as the line's own sign.
    expect(line.items[0]).toEqual({ description: 'Lisbon flights', currency: 'PLN', months: months({ 0: -500, 2: -1234.57 }) });
    const sib = lineOf(view, ids.travel, 'USD');
    expect([sib.policy, sib.done, sib.annual]).toEqual(['one_off', false, 0]);
    ids.plnLine = pln.id;
    ids.usdLine = usd.id;
  });

  test('the preview splits the converted months over both accounts, landing every month to the cent', async () => {
    const p = await svc.previewPublish(ids.v1);
    const s = p.split.find((x) => x.id === ids.plnLine);
    expect(s.months).toEqual(expected);
    expect(s.accounts.length).toBe(2);
    expect(p.reference[ids.plnLine].priorActual.slice(0, 6)).toEqual(Array(6).fill(-137));
    expect(p.reference[ids.plnLine].thisYearMonths).toEqual(blank());
  });

  test('bad input is refused with a reason, never coerced', async () => {
    const put = (body, lineId = ids.plnLine) => svc.setLineItems(ids.v1, lineId, body);
    const item = (over) => ({ items: [{ description: 'x', currency: 'PLN', months: months({ 0: 1 }), ...over }] });
    await expect(put({ items: [] })).rejects.toThrow(/at least one item/);
    await expect(put(item({ description: '  ' }))).rejects.toThrow(/needs a description/);
    await expect(put(item({ description: 'x'.repeat(201) }))).rejects.toThrow(/200 characters/);
    await expect(put(item({ currency: 'GBP' }))).rejects.toThrow(/currency must be/);
    await expect(put(item({ months: Array(11).fill(0) }))).rejects.toThrow(/twelve months/);
    await expect(put(item({ months: months({ 0: 1.005 }) }))).rejects.toThrow(/two decimals/);
    await expect(put(item({ months: months({ 0: '12abc' }) }))).rejects.toThrow(/not an amount/);
    await expect(put(item({ months: months({ 0: '1e15' }) }))).rejects.toThrow(/not an amount/);
    await expect(put(item({ months: months({ 0: 1e15 }) }))).rejects.toThrow(/too large/);
    // On an income line a typed negative cannot sit beside a positive.
    const fees = lineOf(await svc.getBuild(ids.v1), ids.fees, 'USD').id;
    await expect(put(item({ currency: 'USD', months: months({ 0: 5, 1: -5 }) }), fees)).rejects.toThrow(/both signs/);
    await expect(put(item({ months: blank() }))).rejects.toThrow(/an amount/);
    await expect(put({ items: Array.from({ length: 101 }, () => item().items[0]) })).rejects.toThrow(/At most 100/);
    const view = await svc.getBuild(ids.v1);
    await expect(put(item(), lineOf(view, ids.parent, 'USD').id)).rejects.toThrow(/parent category/);
    // D6: one itemised line per category.
    await expect(put(item(), ids.usdLine)).rejects.toThrow(/Already itemised on the PLN line/);
    // Nothing above changed the rows.
    expect(lineOf(await svc.getBuild(ids.v1), ids.travel, 'PLN').annual).toBe(-2359.24);
  });

  test('a re-opened expense line (rows shown negative) takes a new positive row', async () => {
    const view = await svc.getBuild(ids.v1);
    const saved = lineOf(view, ids.travel, 'PLN').items;
    await svc.setLineItems(ids.v1, ids.plnLine, {
      items: [...saved, { description: 'Extra', currency: 'PLN', months: months({ 11: '10' }) }],
    });
    const after = lineOf(await svc.getBuild(ids.v1), ids.travel, 'PLN');
    expect(after.itemMonths[11]).toBe(-10);
    expect(after.annual).toBe(-2369.24);
    await svc.setLineItems(ids.v1, ids.plnLine, trips());
  });

  test('an itemised line is edited only through its items', async () => {
    await expect(svc.updateLine(ids.v1, ids.usdLine, { policy: 'itemised' })).rejects.toThrow(/saving its items/);
    await expect(svc.updateLine(ids.v1, ids.plnLine, { fixedAmount: -5 })).rejects.toThrow(/come from its items/);
    await expect(svc.updateLine(ids.v1, ids.plnLine, { splitMethod: 'even' })).rejects.toThrow(/come from its items/);
  });

  test('a preview token goes stale when an item amount changes', async () => {
    const before = (await svc.previewPublish(ids.v1)).checksum;
    const body = trips();
    body.items[0].months[0] = 501;
    await svc.setLineItems(ids.v1, ids.plnLine, body);
    await expect(svc.publish(ids.v1, { checksum: before })).rejects.toThrow(/changed since the preview/);
    await svc.setLineItems(ids.v1, ids.plnLine, trips());
  });

  test('Start from copies the rows; the copy is edited on its own', async () => {
    const { build } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: ids.v1 });
    const copy = lineOf(await svc.getBuild(build.id), ids.travel, 'PLN');
    expect(copy.policy).toBe('itemised');
    expect(copy.itemMonths).toEqual(expected);
    expect(lineOf(await svc.getBuild(build.id), ids.travel, 'USD').policy).toBe('one_off');
    await svc.setLineItems(build.id, copy.id, { items: [{ description: 'one', currency: 'PLN', months: months({ 5: 10 }) }] });
    expect(lineOf(await svc.getBuild(ids.v1), ids.travel, 'PLN').annual).toBe(-2359.24);
    await svc.deleteDraft(build.id); // its rows go with it
    expect((await db.query('SELECT 1 FROM budget_build_line_items WHERE line_id = $1', [copy.id])).rowCount).toBe(0);
  });

  test('Start from with a newer estimate: a new currency line is a One-off sibling; a line the estimate lacks is kept', async () => {
    let res = await svc.createBuild({ sourceLeId: ids.leEur, scenarioName: SCEN, parentBuildId: ids.v1 });
    let view = await svc.getBuild(res.build.id);
    expect(res.notices).toEqual([]);
    expect(lineOf(view, ids.travel, 'EUR').policy).toBe('one_off');
    expect(lineOf(view, ids.travel, 'PLN').itemMonths).toEqual(expected);
    await svc.deleteDraft(res.build.id);

    res = await svc.createBuild({ sourceLeId: ids.leUsdOnly, scenarioName: SCEN, parentBuildId: ids.v1 });
    view = await svc.getBuild(res.build.id);
    const kept = lineOf(view, ids.travel, 'PLN');
    expect([kept.policy, kept.leFy, kept.annual]).toEqual(['itemised', 0, -2359.24]);
    expect(res.dropped.filter((d) => d.category_id === ids.travel)).toEqual([]);
    await svc.deleteDraft(res.build.id);
  });

  test('a scenario rate change moves a draft\'s itemised figure', async () => {
    const doc = await assumpRepo.getDoc();
    const fx = doc.FX.map((e) => (e.Scenario === SCEN ? { ...e, Rates: { PLN: 4, EUR: 0.8 } } : e));
    await assumpRepo.putDoc({ FX: fx });
    // EUR → PLN at 4 / 0.8 = 5: March = −(1,234.57 + 252.75) = −1,487.32.
    expect(lineOf(await svc.getBuild(ids.v1), ids.travel, 'PLN').itemMonths[2]).toBe(-1487.32);
    await assumpRepo.putDoc({ FX: doc.FX });
  });

  test('a missing rate names the item currency, in the preview and at publish; the reference rows survive', async () => {
    const { build } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN_NO_EUR, parentBuildId: ids.v1 });
    const p = await svc.previewPublish(build.id);
    const line = lineOf(p, ids.travel, 'PLN');
    expect(line.annual).toBeNull();
    expect(line.itemsUnconvertible).toEqual(['EUR']);
    expect(p.blockers.join(' ')).toMatch(/has an item in EUR/);
    expect(p.reference[line.id].priorActual[0]).toBe(-137);
    await expect(svc.publish(build.id, { checksum: p.checksum })).rejects.toThrow(/has an item in EUR/);
    await svc.deleteDraft(build.id);
  });

  test('publish remembers the itemised line; a new draft copies its rows, the larger sibling starts One-off', async () => {
    const res = await publish(ids.v1);
    expect(res.written).toBeGreaterThan(0);
    const pol = (await db.query('SELECT * FROM budget_category_policy WHERE category_id = $1', [ids.travel])).rows[0];
    expect([pol.policy, pol.items_line_id]).toEqual(['itemised', ids.plnLine]);

    const { build, notices } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN });
    ids.v2 = build.id;
    expect(notices).toEqual([]);
    const view = await svc.getBuild(build.id);
    const pln = lineOf(view, ids.travel, 'PLN');
    expect(pln.policy).toBe('itemised');
    expect(pln.items.map((i) => i.months)).toEqual(lineOf(await svc.getBuild(ids.v1), ids.travel, 'PLN').items.map((i) => i.months));
    expect(lineOf(view, ids.travel, 'USD').policy).toBe('one_off');
  });

  test('memory: the remembered currency the estimate lacks is created at 0; an excluded category is not carried', async () => {
    let res = await svc.createBuild({ sourceLeId: ids.leUsdOnly, scenarioName: SCEN });
    let view = await svc.getBuild(res.build.id);
    const pln = lineOf(view, ids.travel, 'PLN');
    expect([pln.policy, pln.leFy, pln.annual]).toEqual(['itemised', 0, -2359.24]);
    expect(lineOf(view, ids.travel, 'USD').policy).toBe('one_off');
    expect(res.notices).toEqual([]);
    await svc.deleteDraft(res.build.id);

    res = await svc.createBuild({ sourceLeId: ids.leExcl, scenarioName: SCEN });
    view = await svc.getBuild(res.build.id);
    expect(view.lines.filter((l) => l.categoryId === ids.travel)).toEqual([]);
    expect(res.notices).toEqual([`${P} Travel was itemised, but this estimate excludes it — its items were not carried`]);
    await svc.deleteDraft(res.build.id);
  });

  test('leaving Itemised for One-off deletes the rows', async () => {
    const { build } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN, parentBuildId: ids.v1 });
    const pln = lineOf(await svc.getBuild(build.id), ids.travel, 'PLN');
    await svc.updateLine(build.id, pln.id, { policy: 'one_off' });
    expect((await db.query('SELECT 1 FROM budget_build_line_items WHERE line_id = $1', [pln.id])).rowCount).toBe(0);
    expect(lineOf(await svc.getBuild(build.id), ids.travel, 'PLN').annual).toBe(0);
    await svc.deleteDraft(build.id);
  });

  test('leaving Itemised for Fixed starts at the itemised figure and deletes the rows', async () => {
    const pln = lineOf(await svc.getBuild(ids.v2), ids.travel, 'PLN');
    await svc.updateLine(ids.v2, pln.id, { policy: 'fixed' });
    const after = lineOf(await svc.getBuild(ids.v2), ids.travel, 'PLN');
    expect([after.policy, after.fixedAmount, after.annual, after.items]).toEqual(['fixed', -2359.24, -2359.24, null]);
    expect((await db.query('SELECT 1 FROM budget_build_line_items WHERE line_id = $1', [pln.id])).rowCount).toBe(0);
  });

  test('republishing without an itemised line clears the pointer; un-publish points memory back at the live build', async () => {
    await svc.updateLine(ids.v2, lineOf(await svc.getBuild(ids.v2), ids.parent, 'USD').id, { policy: 'one_off' });
    await publish(ids.v2);
    let pol = (await db.query('SELECT * FROM budget_category_policy WHERE category_id = $1', [ids.travel])).rows[0];
    // No itemised line: the larger estimate (the One-off USD line) speaks for the category again.
    expect([pol.policy, pol.items_line_id]).toEqual(['one_off', null]);
    await svc.unpublish(ids.v2);
    pol = (await db.query('SELECT * FROM budget_category_policy WHERE category_id = $1', [ids.travel])).rows[0];
    expect([pol.policy, pol.items_line_id]).toEqual(['itemised', ids.plnLine]);
  });

  test('a remembered itemised policy with no rows starts One-off, with a notice', async () => {
    await db.query('UPDATE budget_category_policy SET items_line_id = NULL WHERE category_id = $1', [ids.travel]);
    const { build, notices } = await svc.createBuild({ sourceLeId: ids.le, scenarioName: SCEN });
    const view = await svc.getBuild(build.id);
    expect(lineOf(view, ids.travel, 'PLN').policy).toBe('one_off');
    expect(lineOf(view, ids.travel, 'USD').policy).toBe('one_off');
    expect(notices).toEqual([`${P} Travel was itemised but its rows were not found — it starts as One-off`]);
    await svc.deleteDraft(build.id);
  });
});
