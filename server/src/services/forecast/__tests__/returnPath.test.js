'use strict';
/**
 * returnPath.test.js — CR099: a per-year return path on a forecast module.
 *
 * Pure tests for `moduleGrowthSeries`, then one DB-backed build on a self-seeded scenario:
 *   - the §3 worked example to the cent (−50 then +15 × 5 on 1,000,000);
 *   - the CR076 D1 parity: the convergence loop rebuilds a sweep-ranked module's value to strike
 *     its yield, so the crash-year dividend must be struck on the CRASHED value. A loop that skips
 *     the path pays the dividend on the uncrashed one;
 *   - a row the engine cannot apply is ignored and reported.
 *
 * loadScenarioConfig is mocked so the shared forecast_assumptions document is never touched.
 * DB half skipped with SKIP_DB_TESTS=1.
 */

jest.mock('../fcbuilder-setup', () => ({
  ...jest.requireActual('../fcbuilder-setup'),
  loadScenarioConfig: jest.fn(),
}));

const { loadScenarioConfig } = require('../fcbuilder-setup');
const { moduleGrowthSeries, growthPctForYear } = require('../fcbuilder-common');

describe('CR099 — moduleGrowthSeries', () => {
  const inflation = [3, 3, 3, 3];   // PeriodStart 2027 … 2030
  const mod = (over = {}) => ({ HasValuation: true, Growth: 1, LoanRate: null, Returns: [], ...over });

  test('no rows: exactly growthPctForYear, and the base year never grows', () => {
    const s = moduleGrowthSeries(mod(), 2025, 6, 2027, inflation, 2.5);
    expect(s[0]).toBe(0);
    for (let i = 1; i < 6; i++) expect(s[i]).toBe(growthPctForYear(2025 + i, 2027, 1, inflation, 2.5));
  });

  test('a row replaces Growth × inflation for its year only, including the pre-period year', () => {
    const s = moduleGrowthSeries(mod({ Returns: [{ year: 2026, pct: -10 }, { year: 2028, pct: 15 }] }), 2025, 6, 2027, inflation, 2.5);
    expect(s).toEqual([0, -10, 3, 15, 3, 3]);
  });

  test('a row on the base year does nothing', () => {
    expect(moduleGrowthSeries(mod({ Returns: [{ year: 2025, pct: -50 }] }), 2025, 3, 2027, inflation)[0]).toBe(0);
  });

  test('a loan and a flow module ignore the path', () => {
    const rows = [{ year: 2027, pct: -50 }];
    expect(moduleGrowthSeries(mod({ LoanRate: 5, Growth: 0, Returns: rows }), 2025, 3, 2027, inflation)[2]).toBe(0);
    expect(moduleGrowthSeries(mod({ HasValuation: false, Returns: rows }), 2025, 3, 2027, inflation)[2]).toBe(0);
  });
});

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('CR099 — a return path through a full build (DB)', () => {
  const db = require('../../../v2/db');
  const { generateForecast } = require('..');
  const NAME = 'CR099ReturnPathScenario';
  const P = 'CR099T';
  const ids = {};
  let createdBankAnchor = false;

  async function cleanup() {
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [NAME]);
    await db.query('DELETE FROM fc_lines WHERE name = $1', [`${P} Dividends`]);
    await db.query('DELETE FROM accounts WHERE name LIKE $1', [`${P} %`]);
  }

  const account = async (name) => (await db.query(
    `INSERT INTO accounts (name, account_type, section, currency, opening_balance)
     VALUES ($1, 'asset', 'balance_sheet', 'USD', 0) RETURNING id`, [`${P} ${name}`]
  )).rows[0].id;

  const module = async (name, accountId, { sweep = false } = {}) => (await db.query(
    `INSERT INTO forecast_modules
       (scenario_id, account_id, name, module_type, currency, base_date, base_value, base_value_usd,
        market_value, market_value_usd, growth_rate, setup_status, has_valuation,
        cash_sweep_target, cash_sweep_priority)
     VALUES ($1, $2, $3, 'Stocks', 'USD', '2025-12-31', 1000000, 1000000, 1000000, 1000000, 1,
             'included', TRUE, $4, $5) RETURNING id`,
    [ids.scenario, accountId, name, sweep, sweep ? 1 : null]
  )).rows[0].id;

  const path = (moduleId, rows) => Promise.all(rows.map(([year, pct]) => db.query(
    'INSERT INTO forecast_module_returns (module_id, year, pct) VALUES ($1, $2, $3)', [moduleId, year, pct]
  )));

  const series = async (moduleName, accountName) => {
    const { rows } = await db.query(
      `SELECT forecast_year, SUM(amount)::float AS v FROM forecast_entries
        WHERE scenario_id = $1 AND module = $2 AND account = $3 GROUP BY 1 ORDER BY 1`,
      [ids.scenario, moduleName, accountName]
    );
    return new Map(rows.map((r) => [Number(r.forecast_year), r.v]));
  };

  const CRASH = [[2027, -50], [2028, 15], [2029, 15], [2030, 15], [2031, 15], [2032, 15]];

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await cleanup();
    if (!(await db.query("SELECT 1 FROM accounts WHERE name = 'Bank Accounts' LIMIT 1")).rows.length) {
      await db.query(
        `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
         VALUES ('Bank Accounts', 'asset', 'balance_sheet', FALSE, 'USD', TRUE)`
      );
      createdBankAnchor = true;
    }
    // A band the cash never leaves, so the sweep moves no value and stored value = built value.
    ids.scenario = (await db.query(
      `INSERT INTO forecast_scenarios (name, cash_sweep_low, cash_sweep_high)
       VALUES ($1, -1000000000, 1000000000) RETURNING id`, [NAME]
    )).rows[0].id;
    ids.line = (await db.query(
      `INSERT INTO fc_lines (name, line_type) VALUES ($1, 'bs_module_income') RETURNING id`, [`${P} Dividends`]
    )).rows[0].id;

    ids.crash = await module('CR099 Crash', await account('Crash'));
    await path(ids.crash, CRASH);

    ids.swept = await module('CR099 Swept', await account('Swept'), { sweep: true });
    await path(ids.swept, CRASH);
    await db.query(
      `INSERT INTO forecast_streams (module_id, direction, fc_line_id, mode, amount, amount_usd)
       VALUES ($1, 'income', $2, 'yield', 0, 0)`, [ids.swept, ids.line]
    );

    ids.badRow = await module('CR099 Base Row', await account('Base Row'));
    await path(ids.badRow, [[2025, -50]]);   // the base year: written past the API, as a stale row would be

    loadScenarioConfig.mockResolvedValue({
      scenario: { Name: NAME, PeriodStart: 2027, PeriodEnd: 2032, TaxRate: 0 },
      categories: ['Year', 'Inflation', 'PLN', 'EUR', 'Bank Accounts'],
      inflationRates: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
      fxratesPLN: [4, 4, 4, 4, 4, 4],
      fxratesEUR: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
      taxRate: 0,
      years: [2027, 2028, 2029, 2030, 2031, 2032],
    });
    ids.result = await generateForecast(NAME);
  });

  afterAll(async () => {
    await cleanup();
    if (createdBankAnchor) await db.query("DELETE FROM accounts WHERE name = 'Bank Accounts'");
    await db.close();
  });

  test('the worked example: −50 in 2027, then +15 a year, to the cent', async () => {
    expect(ids.result.success).toBe(true);
    const mv = await series('CR099 Crash', `${P} Crash`);
    expect(mv.get(2026)).toBeCloseTo(1035000, 2);       // the pre-period year still grows
    expect(mv.get(2027)).toBeCloseTo(517500, 2);
    expect(mv.get(2032)).toBeCloseTo(1040877.34, 2);
  });

  test('the convergence loop strikes the crash-year yield on the crashed value (CR076 D1)', async () => {
    const mv = await series('CR099 Swept', `${P} Swept`);
    const div = await series('CR099 Swept', `${P} Dividends`);
    expect(mv.get(2027)).toBeCloseTo(517500, 2);
    // Yield with no spread = inflation, on the AVERAGE of the year's opening and closing value.
    expect(div.get(2027)).toBeCloseTo(0.035 * (mv.get(2026) + mv.get(2027)) / 2, 2);
    expect(div.get(2027)).toBeCloseTo(27168.75, 2);
  });

  test('a row the engine cannot apply is ignored, and the build says so', async () => {
    const mv = await series('CR099 Base Row', `${P} Base Row`);
    expect(mv.get(2026)).toBeCloseTo(1035000, 2);
    expect(ids.result.stats?.returnWarnings ?? ids.result.returnWarnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ module: 'CR099 Base Row', year: 2025 })])
    );
  });
});
