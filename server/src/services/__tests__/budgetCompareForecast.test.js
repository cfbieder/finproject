'use strict';
/**
 * budgetCompareForecast.test.js — CR102, a budget build against a forecast scenario's year.
 *
 * Self-seeded far-future fixtures (an LE for 2096 seeds a 2097 build; forecast entries for 2097):
 * own forecast lines and mapping, a base scenario and a variant. Assertions read only the seeded
 * lines, since the service lists every forecast line. Skip with SKIP_DB_TESTS=1.
 */

const svc = require('../budgetCompareForecast');
const builder = require('../budgetBuilder');
const assumpRepo = require('../../v2/repositories/forecastAssumptions');
const db = require('../../v2/db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const P = 'CR102T';
const SCEN = `${P} Base`;
const VAR = `${P} Crash`;
const YEAR = 2096;
const TARGET = 2097;

dbDescribe('Compare Forecast (DB)', () => {
  const ids = {};
  const cleanup = async () => {
    await db.query('DELETE FROM budget_builds WHERE target_year = $1', [TARGET]);
    await db.query('DELETE FROM budget_le WHERE budget_year = $1', [YEAR]);
    await db.query('DELETE FROM forecast_entries WHERE scenario_id IN (SELECT id FROM forecast_scenarios WHERE name = ANY($1))', [[SCEN, VAR]]);
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [VAR]);
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [SCEN]);
    await db.query('DELETE FROM fc_line_categories WHERE fc_line_id IN (SELECT id FROM fc_lines WHERE name LIKE $1)', [`${P} %`]);
    await db.query('DELETE FROM fc_lines WHERE name LIKE $1', [`${P} %`]);
    await db.query('DELETE FROM budget_category_policy WHERE category_id IN (SELECT id FROM accounts WHERE name LIKE $1)', [`${P} %`]);
    await db.query('DELETE FROM accounts WHERE name LIKE $1 AND parent_id IS NOT NULL', [`${P} %`]);
    await db.query('DELETE FROM accounts WHERE name LIKE $1', [`${P} %`]);
    const doc = await assumpRepo.getDoc();
    const pruned = {};
    for (const [key, field] of [['scenarios', 'Name'], ['inflation', 'Scenario'], ['FX', 'Scenario']]) {
      if (Array.isArray(doc[key])) pruned[key] = doc[key].filter((e) => !e || ![SCEN, VAR].includes(e[field]));
    }
    await assumpRepo.putDoc(pruned);
  };
  const account = async (name, { type = 'expense', parent = null } = {}) => (await db.query(
    `INSERT INTO accounts (name, account_type, section, currency, opening_balance, parent_id)
     VALUES ($1, $2, 'profit_loss', 'USD', 0, $3) RETURNING id`, [`${P} ${name}`, type, parent]
  )).rows[0].id;
  const fcLine = async (name, type, order) => (await db.query(
    'INSERT INTO fc_lines (name, line_type, display_order) VALUES ($1, $2, $3) RETURNING id', [`${P} ${name}`, type, order]
  )).rows[0].id;
  const map = (lineId, categoryId) => db.query('INSERT INTO fc_line_categories (fc_line_id, category_id) VALUES ($1, $2)', [lineId, categoryId]);
  const leLine = (categoryId, currency, amount) => db.query(
    `INSERT INTO budget_le_lines (le_id, period_month, category_id, currency, source, method, amount, base_amount)
     VALUES ($1, '2096-03-01', $2, $3, 'manual', 'MANUAL', $4, $4)`, [ids.le, categoryId, currency, amount]
  );
  const entry = (scenarioId, account, amount) => db.query(
    'INSERT INTO forecast_entries (scenario_id, forecast_year, account, amount) VALUES ($1, $2, $3, $4)', [scenarioId, TARGET, account, amount]
  );
  const line = (r, name) => [...r.income, ...r.expense].find((l) => l.name === `${P} ${name}`);

  beforeAll(async () => {
    await cleanup();
    ids.travel = await account('Travel');
    ids.food = await account('Food');
    ids.fees = await account('Fees', { type: 'income' });
    ids.stray = await account('Stray');
    ids.lTravel = await fcLine('Travel', 'forecast_expense', 9001);
    ids.lFood = await fcLine('Food', 'forecast_expense', 9002);
    ids.lFees = await fcLine('Fees', 'forecast_income', 9003);
    ids.lEngine = await fcLine('Engine', 'bs_module_income', 9004); // nothing mapped: budget "—"
    await map(ids.lTravel, ids.travel);
    await map(ids.lFood, ids.food);
    await map(ids.lFees, ids.fees);

    ids.le = (await db.query(
      `INSERT INTO budget_le (budget_year, actual_through, name, status, finalized_at)
       VALUES ($1, '2096-06-30', $2, 'final', NOW()) RETURNING id`, [YEAR, `${P} LE`]
    )).rows[0].id;
    await leLine(ids.travel, 'PLN', -4000);   // 1,000 USD at 4
    await leLine(ids.travel, 'USD', -500);
    await leLine(ids.food, 'USD', -2000);
    await leLine(ids.fees, 'USD', 300);
    await leLine(ids.stray, 'USD', -100);     // on no forecast line

    ids.scen = (await db.query(
      'INSERT INTO forecast_scenarios (name, is_active, cash_sweep_low, cash_sweep_high) VALUES ($1, TRUE, 0, 0) RETURNING id', [SCEN]
    )).rows[0].id;
    ids.var = (await db.query(
      'INSERT INTO forecast_scenarios (name, is_active, cash_sweep_low, cash_sweep_high, parent_scenario_id) VALUES ($1, TRUE, 0, 0, $2) RETURNING id', [VAR, ids.scen]
    )).rows[0].id;
    const doc = await assumpRepo.getDoc();
    await assumpRepo.putDoc({
      scenarios: [...(doc.scenarios || []), { Name: SCEN, IsActive: true, PeriodStart: 2098, PeriodEnd: 2100 }],
      inflation: [...(doc.inflation || []), { Scenario: SCEN, Year: YEAR, Rate: 0 }, { Scenario: VAR, Year: YEAR, Rate: 0 }],
      FX: [...(doc.FX || []), { Scenario: SCEN, Year: YEAR, Rates: { PLN: 4, EUR: 1 } }, { Scenario: VAR, Year: YEAR, Rates: { PLN: 5, EUR: 1 } }],
    });
    // Two entries on Travel (summed), one on Fees, one on the unmapped engine line, and a transfer leg.
    await entry(ids.scen, `${P} Travel`, -1200);
    await entry(ids.scen, `${P} Travel`, -100);
    await entry(ids.scen, `${P} Fees`, 250);
    await entry(ids.scen, `${P} Engine`, 77);
    await entry(ids.scen, 'Transfer - Bank', -999);
    await entry(ids.var, `${P} Travel`, -3000);

    const { build } = await builder.createBuild({ sourceLeId: ids.le, scenarioName: SCEN });
    ids.build = build.id; // all Recurring at 0% inflation: budget = LE
  });
  afterAll(async () => { await cleanup(); await db.close(); });

  test('per line: budget and LE from the build at its rates, forecast from the entries', async () => {
    const r = await svc.compareForecast(ids.build);
    expect(r.scenario).toMatchObject({ name: SCEN, isVariant: false, generatedForYear: true });
    const travel = line(r, 'Travel');
    expect([travel.budget, travel.le, travel.forecast]).toEqual([-1500, -1500, -1300]);
    expect(travel.categories.map((c) => c.currency).sort()).toEqual(['PLN', 'USD']);
    expect([line(r, 'Food').forecast, line(r, 'Fees').budget, line(r, 'Fees').forecast]).toEqual([0, 300, 250]);
    expect(r.options.map((o) => o.name)).toEqual([SCEN, VAR]);
    expect(r.rates.differ).toBe(false);
  });

  test('a line with nothing mapped shows no budget or LE, but its forecast', async () => {
    const r = await svc.compareForecast(ids.build);
    expect(line(r, 'Engine')).toMatchObject({ budget: null, le: null, forecast: 77, noMapping: true });
  });

  test('a category on no forecast line is named, and the totals reconcile (residual 0)', async () => {
    const r = await svc.compareForecast(ids.build);
    expect(r.notInForecast.categories.map((c) => c.name)).toEqual([`${P} Stray`]);
    expect(r.notInForecast.budget).toBe(-100);
    expect(r.residual).toEqual({ budget: 0, le: 0 });
    const view = await builder.getBuild(ids.build);
    // The build's own total equals what the modal accounts for; the transfer leg is not P&L.
    expect(r.totals.net.budget).toBe(view.usdTotal);
  });

  test('a variant reads its own entries and its own rates', async () => {
    const r = await svc.compareForecast(ids.build, { scenario: VAR });
    expect(line(r, 'Travel').forecast).toBe(-3000);
    expect(line(r, 'Fees').forecast).toBe(0);
    expect(r.rates).toMatchObject({ forecast: { PLN: 5 }, build: { PLN: 4 }, differ: true });
  });

  test('a leaf under two forecast lines shows as a residual, not a silent double', async () => {
    const parent = await account('Spain');
    const leaf = await account('Spain water', { parent });
    const lA = await fcLine('Spain A', 'forecast_expense', 9005);
    const lB = await fcLine('Spain B', 'forecast_expense', 9006);
    await map(lA, parent);
    await map(lB, leaf); // the leaf now resolves to both lines
    await leLine(leaf, 'USD', -50);
    const { build } = await builder.createBuild({ sourceLeId: ids.le, scenarioName: SCEN });
    const r = await svc.compareForecast(build.id);
    expect(r.residual.budget).toBe(50);
    await builder.deleteDraft(build.id);
    await db.query('DELETE FROM fc_line_categories WHERE fc_line_id = ANY($1)', [[lA, lB]]);
    await db.query('DELETE FROM budget_le_lines WHERE category_id = $1', [leaf]);
  });

  test('a scenario with nothing for the year has no forecast figures, not zeros; an unknown one is a 404', async () => {
    await db.query('DELETE FROM forecast_entries WHERE scenario_id = $1', [ids.var]);
    const r = await svc.compareForecast(ids.build, { scenario: VAR });
    expect(r.scenario.generatedForYear).toBe(false);
    expect(line(r, 'Travel').forecast).toBeNull();
    expect(r.totals.net.forecast).toBeNull();
    await expect(svc.compareForecast(ids.build, { scenario: 'nope' })).rejects.toMatchObject({ status: 404 });
  });
});
