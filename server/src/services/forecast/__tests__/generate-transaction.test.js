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
    await db.query('DELETE FROM forecast_income_expense WHERE name = $1', ['CR043 Tx Item']);
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

    await db.query(
      `INSERT INTO forecast_income_expense
         (scenario_id, account_id, name, base_value, base_value_usd, growth_rate, setup_status)
       VALUES ($1, $2, 'CR043 Tx Item', 100000, 100000, 0, 'included')`,
      [scenarioId, acct.id]
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
    const seedFromNextBuild = async () => {
      computeCashSweepIterative.mockClear();
      const r = await generateForecast(NAME);
      expect(r.success).toBe(true);
      return computeCashSweepIterative.mock.calls[0][0].startingCash;
    };

    await db.query(
      `UPDATE forecast_income_expense SET setup_status = 'exclude' WHERE name = 'CR043 Tx Item'`
    );
    const withoutItem = await seedFromNextBuild();

    await db.query(
      `UPDATE forecast_income_expense SET setup_status = 'included' WHERE name = 'CR043 Tx Item'`
    );
    const withItem = await seedFromNextBuild();

    // The item is +100,000 of BaseYear budget NCF; pre-fix both builds opened on
    // the identical ledger balance and this difference was 0.
    expect(withItem - withoutItem).toBeCloseTo(100000, 2);
  });
});
