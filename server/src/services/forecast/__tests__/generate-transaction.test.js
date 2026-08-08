'use strict';
/**
 * generate-transaction.test.js — CR043 1.3: generateForecast atomicity + lock.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1); needs Postgres via DATABASE_URL.
 * Seeds a throwaway scenario + one income/expense item and cleans up by unique
 * name — never TRUNCATE. loadScenarioConfig is mocked so the shared
 * forecast_assumptions document is never touched; computeCashSweepIterative is
 * wrapped so a failure can be injected mid-build.
 */

jest.mock('../fcbuilder-setup', () => ({ loadScenarioConfig: jest.fn() }));
jest.mock('../cash-sweep', () => {
  const actual = jest.requireActual('../cash-sweep');
  return { ...actual, computeCashSweepIterative: jest.fn(actual.computeCashSweepIterative) };
});

const { loadScenarioConfig } = require('../fcbuilder-setup');
const { computeCashSweepIterative } = require('../cash-sweep');
const { generateForecast } = require('..');
const db = require('../../../v2/db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('generateForecast transactionality (DB)', () => {
  const NAME = 'CR043TxTestScenario';
  let scenarioId;
  let accountName;
  let createdBankAnchor = false;

  const entriesState = async () => {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(ROUND(amount::numeric, 2)), 0)::text AS total
       FROM forecast_entries WHERE scenario_id = $1`,
      [scenarioId]
    );
    return r.rows[0];
  };

  async function cleanup() {
    await db.query('DELETE FROM forecast_modules WHERE name = $1', ['CR043 Tx Item']);
    await db.query('DELETE FROM forecast_scenarios WHERE name = $1', [NAME]);
  }

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await cleanup();

    // Engine N9 anchor: generateForecast's sweep (exercised via the sweep band
    // below) throws unless a COA account named 'Bank Accounts' exists. Dev/prod
    // always have it; CI's ci-seed.sql does not — create a throwaway one when
    // absent and remove it in afterAll (never touch a pre-existing real one).
    const existingBank = await db.query("SELECT 1 FROM accounts WHERE name = 'Bank Accounts' LIMIT 1");
    if (existingBank.rows.length === 0) {
      await db.query(
        `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
         VALUES ('Bank Accounts', 'asset', 'balance_sheet', FALSE, 'USD', TRUE)`
      );
      createdBankAnchor = true;
    }

    // Sweep band set so the sweep path (the failure-injection point) runs.
    scenarioId = (await db.query(
      `INSERT INTO forecast_scenarios (name, cash_sweep_low, cash_sweep_high)
       VALUES ($1, 10000, 50000) RETURNING id`,
      [NAME]
    )).rows[0].id;

    // Any real account works as the item's label, as long as it doesn't collide
    // with the engine's fixed category names (that collision crashes the danfo
    // index — pre-existing engine behavior, not under test here).
    const acct = (await db.query(
      `SELECT id, name FROM accounts
       WHERE parent_id IS NOT NULL AND name NOT IN ('Bank Accounts', 'Transfer - Bank', 'Taxes')
       ORDER BY id LIMIT 1`
    )).rows[0];
    accountName = acct.name;

    // CR069 P2 — an income/expense item is a module with no valuation and one stream.
    const itemId = (await db.query(
      `INSERT INTO forecast_modules
         (scenario_id, account_id, name, has_valuation, base_value, base_value_usd,
          market_value, market_value_usd, growth_rate, setup_status)
       VALUES ($1, $2, 'CR043 Tx Item', FALSE, 0, 0, 0, 0, 0, 'included') RETURNING id`,
      [scenarioId, acct.id]
    )).rows[0].id;
    await db.query(
      `INSERT INTO forecast_streams (module_id, direction, mode, amount, amount_usd, growth_mult)
       VALUES ($1, 'income', 'amount', 100000, 100000, 0)`,
      [itemId]
    );

    loadScenarioConfig.mockResolvedValue({
      scenario: { Name: NAME, PeriodStart: 2027, PeriodEnd: 2029, TaxRate: 0 },
      categories: ['Year', 'Inflation', 'PLN', 'EUR', 'Bank Accounts'],
      inflationRates: [2, 2, 2],
      fxratesPLN: [4, 4, 4],
      fxratesEUR: [0.9, 0.9, 0.9],
      taxRate: 0,
      years: [2027, 2028, 2029],
    });
  });

  afterAll(async () => {
    await cleanup();
    if (createdBankAnchor) {
      await db.query("DELETE FROM accounts WHERE name = 'Bank Accounts'");
    }
    await db.close();
  });

  test('happy path: builds entries and a rebuild replaces them cleanly', async () => {
    const first = await generateForecast(NAME);
    expect(first.success).toBe(true);
    expect(first.entriesCreated).toBeGreaterThan(0);

    const afterFirst = await entriesState();
    expect(afterFirst.n).toBeGreaterThan(0);

    const second = await generateForecast(NAME);
    expect(second.success).toBe(true);
    expect(second.deletedCount).toBe(afterFirst.n);
    expect(await entriesState()).toEqual(afterFirst);
  });

  test('mid-build failure rolls back to the previous entries (not empty/partial)', async () => {
    const before = await entriesState();
    expect(before.n).toBeGreaterThan(0);

    computeCashSweepIterative.mockImplementationOnce(() => {
      throw new Error('injected mid-build failure');
    });

    const result = await generateForecast(NAME);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/injected mid-build failure/);

    // Pre-CR043 the DELETE had already autocommitted, leaving 0 entries here.
    expect(await entriesState()).toEqual(before);
  });

  test('concurrent builds of the same scenario serialize instead of interleaving', async () => {
    const single = await generateForecast(NAME);
    expect(single.success).toBe(true);
    const expected = await entriesState();

    const [a, b] = await Promise.all([generateForecast(NAME), generateForecast(NAME)]);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);

    // The advisory lock makes the loser wait for the winner's COMMIT, so the
    // second build deletes exactly one full build's entries and the final set
    // equals a single clean run (pre-CR043 this interleaved: duplicate or
    // missing entries depending on timing).
    expect([a.deletedCount, b.deletedCount].sort()).toEqual(
      [expected.n, expected.n]
    );
    expect(await entriesState()).toEqual(expected);
  });

  // CR045 Phase 1b. The sweep iterates PeriodStart…PeriodEnd, so the BaseYear
  // (PeriodStart - 1) is never visited: its cash flow has to reach the sweep
  // through the opening balance or not at all. It used to be written to
  // cashDeltaByYear[baseYear], which nothing ever read — so the sweep opened on
  // the stale ledger balance and held the band against a figure a whole year of
  // cash flow too high.
  //
  // Asserted as a *difference* between two builds rather than an absolute: the
  // ledger's own bank balance differs between dev and CI, but the BaseYear's
  // effect on the seed must be exactly the item's value either way.
  test("BaseYear cash flow lands in the sweep's opening cash", async () => {
    // The behaviour is unchanged and still the point; only the LEVER moved. CR075 made year -1
    // the BUDGET, so the base-year figure is driven by budget entries rather than by a module's
    // setup_status, which the budget knows nothing about.
    const seedFromNextBuild = async () => {
      computeCashSweepIterative.mockClear();
      const r = await generateForecast(NAME);
      expect(r.success).toBe(true);
      return computeCashSweepIterative.mock.calls[0][0].startingCash;
    };

    const line = (await db.query(
      `INSERT INTO fc_lines (name, line_type) VALUES ('CR043 Tx Line', 'bs_module_income')
       ON CONFLICT (name) DO UPDATE SET line_type = EXCLUDED.line_type RETURNING id`
    )).rows[0].id;
    const cat = (await db.query(
      `SELECT id FROM accounts WHERE section = 'profit_loss' AND parent_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = accounts.id)
       ORDER BY id LIMIT 1`
    )).rows[0].id;
    await db.query('INSERT INTO fc_line_categories (fc_line_id, category_id) VALUES ($1, $2)',
      [line, cat]);

    const baseYear = (await loadScenarioConfig(NAME)).scenario.PeriodStart - 1;

    try {
      const withoutItem = await seedFromNextBuild();

      await db.query(
        `INSERT INTO budget_entries (entry_date, description, amount, currency, base_amount,
                                     category_id, budget_year)
         VALUES (make_date($1, 6, 1), 'CR043 base year', 100000, 'USD', 100000, $2, $1)`,
        [baseYear, cat]
      );
      const withItem = await seedFromNextBuild();

      // Asserted as a DIFFERENCE between two builds, not an absolute: the ledger's own bank
      // balance differs between dev and CI, but the base year's effect on the seed must be
      // exactly the budgeted amount either way. Pre-CR045 both builds opened on the identical
      // ledger balance and this difference was 0 — the sweep held its band against a figure a
      // whole year of cash flow too high.
      expect(withItem - withoutItem).toBeCloseTo(100000, 2);
    } finally {
      await db.query(`DELETE FROM budget_entries WHERE description = 'CR043 base year'`);
      await db.query('DELETE FROM fc_line_categories WHERE fc_line_id = $1', [line]);
      await db.query('DELETE FROM fc_lines WHERE id = $1', [line]);
    }
  });

  // CR048 A1. Yield income is a % of market value, and the sweep changes market value —
  // but the income↔sweep convergence only ever re-based the PRIMARY. A backup the sweep
  // drained kept paying dividends on its full pre-sweep balance: ~2% on money that was
  // gone, in exactly the years the plan was short.
  test("a sweep-drained BACKUP's yield income falls with its balance", async () => {
    const acct = (await db.query(
      `SELECT id FROM accounts WHERE parent_id IS NOT NULL
       AND name NOT IN ('Bank Accounts', 'Transfer - Bank', 'Taxes') ORDER BY id LIMIT 1`
    )).rows[0];
    const line = (await db.query(
      `INSERT INTO fc_lines (name, line_type) VALUES ('CR048 Yield Line', 'bs_module_income')
       ON CONFLICT (name) DO UPDATE SET line_type = EXCLUDED.line_type RETURNING id`
    )).rows[0];

    // Primary: priority 1, empty — nothing to drain, no yield. Its emptiness forces the
    // cascade straight into the backup.
    const primaryId = (await db.query(
      `INSERT INTO forecast_modules
         (has_valuation, scenario_id, account_id, name, setup_status, base_date, market_value, market_value_usd,
          base_value, base_value_usd, growth_rate, cash_sweep_priority)
       VALUES (TRUE, $1, $2, 'CR048 Primary', 'complete', '2026-12-31', 0, 0, 0, 0, 0, 1) RETURNING id`,
      [scenarioId, acct.id]
    )).rows[0].id;

    // Backup: priority 2, $500k of stock yielding inflation + 5%, flat growth.
    const backupId = (await db.query(
      `INSERT INTO forecast_modules
         (has_valuation, scenario_id, account_id, name, setup_status, base_date, market_value, market_value_usd,
          base_value, base_value_usd, growth_rate, cash_sweep_priority)
       VALUES (TRUE, $1, $2, 'CR048 Backup Stocks', 'complete', '2026-12-31', 500000, 500000,
               500000, 500000, 0, 2) RETURNING id`,
      [scenarioId, acct.id]
    )).rows[0].id;
    // CR069 P2 — a yield schedule is Spread % rows on a yield-mode income stream.
    const backupStream = (await db.query(
      `INSERT INTO forecast_streams (module_id, direction, mode, amount, fc_line_id)
       VALUES ($1, 'income', 'yield', 0, $2)
       RETURNING id`,
      [backupId, line.id]
    )).rows[0].id;
    await db.query(
      `INSERT INTO forecast_stream_changes (stream_id, change_date, amount, flag)
       VALUES ($1, '2027-01-01', 5, 'Spread %')`,
      [backupStream]
    );

    // A heavy recurring outflow so the sweep must liquidate the backup in year one.
    //
    // Raised from 600,000 by CR075: the base year is the BUDGET now, so this scenario opens on
    // the real 2026 budget rather than on its own modules, and 600,000/yr no longer emptied the
    // backup by 2028 (its 2028 income came out at 8,288 instead of ~0). The INVARIANT under test
    // is unchanged and the thresholds below are untouched — the fixture just has to be decisively
    // short for "drained" to mean drained. Deliberately not softened into "income falls a bit":
    // the bug this catches produced a FLAT 35,000 every year, and a threshold that tolerates
    // 8,288 would also tolerate a partial regression.
    const drainId = (await db.query(
      `INSERT INTO forecast_modules
         (scenario_id, account_id, name, has_valuation, base_value, base_value_usd,
          market_value, market_value_usd, growth_rate, setup_status)
       VALUES ($1, $2, 'CR048 Drain', FALSE, 0, 0, 0, 0, 0, 'included') RETURNING id`,
      [scenarioId, acct.id]
    )).rows[0].id;
    await db.query(
      `INSERT INTO forecast_streams (module_id, direction, mode, amount, amount_usd, growth_mult)
       VALUES ($1, 'expense', 'amount', 2000000, 2000000, 0)`,
      [drainId]
    );

    try {
      const result = await generateForecast(NAME);
      if (!result.success) console.error('CR048 A1 test — engine error:', result.error);
      expect(result.success).toBe(true);

      const inc = {};
      const rows = (await db.query(
        `SELECT forecast_year, amount FROM forecast_entries
         WHERE scenario_id = $1 AND module = 'CR048 Backup Stocks' AND account = 'CR048 Yield Line'
         ORDER BY forecast_year`,
        [scenarioId]
      )).rows;
      for (const r of rows) inc[r.forecast_year] = parseFloat(r.amount);

      // Undrained, the backup would pay (2% inflation + 5%) × 500k = 35k flat every year —
      // which is exactly what the pre-CR048 engine produced, because the convergence loop
      // never looked at backups at all. Drained in 2027, its income must collapse.
      expect(inc[2027]).toBeLessThan(30000); // drain year: avg of full and empty balance
      expect(Math.abs(inc[2028] || 0)).toBeLessThan(2000); // empty: essentially nothing
      expect(Math.abs(inc[2029] || 0)).toBeLessThan(2000);
    } finally {
      await db.query('DELETE FROM forecast_modules WHERE id = $1', [drainId]);
      await db.query('DELETE FROM forecast_modules WHERE id IN ($1, $2)', [primaryId, backupId]);
      await db.query("DELETE FROM fc_lines WHERE name = 'CR048 Yield Line'");
      await generateForecast(NAME); // leave the scenario as the earlier tests expect it
    }
  });
});
