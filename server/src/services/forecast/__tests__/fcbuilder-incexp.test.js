/**
 * Tests for fcbuilder-incexp.js — Income/Expense Module Processing
 *
 * Phase 1: Tax Deferral (G4)
 */

const { processModule } = require("../fcbuilder-incexp");
const {
  createMockScenario,
  createMockIncExpModule,
  createMockAssumptions,
  createMockCategories,
  createMockCategoriesDF,
  createMockDb,
  getEntriesForAccount,
} = require("./helpers");

beforeEach(() => { jest.spyOn(console, "log").mockImplementation(() => {}); });

/**
 * Helper: run incexp processModule with standard setup
 */
async function runIncExp(moduleOverrides = {}, scenarioOverrides = {}) {
  const scenario = createMockScenario({ PeriodStart: 2026, PeriodEnd: 2030, TaxRate: 25, ...scenarioOverrides });
  const years = [];
  for (let y = scenario.PeriodStart; y <= scenario.PeriodEnd; y++) years.push(y);

  const mod = createMockIncExpModule(moduleOverrides);
  const categories = createMockCategories();
  const assumptions = createMockAssumptions(scenario);

  const catNames = [mod.Account, "Taxes", "Bank Accounts"];
  const catDF = createMockCategoriesDF(catNames, years);
  const db = createMockDb();

  const result = await processModule(mod, scenario, assumptions, catDF, categories, years, db, 1);
  return { db, result, years };
}


describe("G4 — Income/Expense Tax Deferral", () => {

  test("1.14 Income tax is deferred one year", async () => {
    const { db } = await runIncExp({
      Account: "Rental Income",
      BaseValue: 100, // positive = income → taxable
      BaseValueUSD: 100,
      Growth: 1,
    });

    const taxEntries = getEntriesForAccount(db, "Taxes");
    const taxByYear = {};
    taxEntries.forEach((e) => { taxByYear[e.forecast_year] = (taxByYear[e.forecast_year] || 0) + e.amount; });

    // Income in 2026 → tax in 2027
    expect(taxByYear[2026]).toBeUndefined();
    expect(taxByYear[2027]).toBeDefined();
    expect(taxByYear[2027]).toBeLessThan(0);
  });

  test("1.15 No tax on expense items (negative values)", async () => {
    const { db } = await runIncExp({
      Account: "Living Expenses",
      BaseValue: -500, // negative = expense → no tax
      BaseValueUSD: -500,
      Growth: 1,
    });

    const taxEntries = getEntriesForAccount(db, "Taxes");
    // All tax values should be zero (no entries for zero amounts)
    expect(taxEntries.length).toBe(0);
  });

  test("Tax on final year income stays in final year", async () => {
    const { db } = await runIncExp({
      Account: "Rental Income",
      BaseValue: 100,
      BaseValueUSD: 100,
      Growth: 1,
    });

    const taxEntries = getEntriesForAccount(db, "Taxes");
    const taxByYear = {};
    taxEntries.forEach((e) => { taxByYear[e.forecast_year] = (taxByYear[e.forecast_year] || 0) + e.amount; });

    // 2030 income can't defer to 2031, so tax stays in 2030
    expect(taxByYear[2030]).toBeDefined();
    expect(taxByYear[2030]).toBeLessThan(0);
  });

  test("Tax amount is correct (25% of income, deferred)", async () => {
    const { db } = await runIncExp({
      Account: "Rental Income",
      BaseValue: 200,
      BaseValueUSD: 200,
      Growth: 0, // no inflation growth so value stays constant
    }, { TaxRate: 25 });

    const taxEntries = getEntriesForAccount(db, "Taxes");
    const taxByYear = {};
    taxEntries.forEach((e) => { taxByYear[e.forecast_year] = (taxByYear[e.forecast_year] || 0) + e.amount; });

    // Income = 200 each year, tax = -50 deferred by 1 year
    // Year 2027 should have tax from 2026 income = -50
    expect(taxByYear[2027]).toBeCloseTo(-50, 1);
  });
});

describe("CR051 — foreign-currency income/expense conversion", () => {
  // Local runner that lets a test set the per-year FX/inflation series (createMockAssumptions
  // keys them as PLN / EUR / Inflation columns, i.e. categories[2] / categories[3] / categories[1]).
  async function runFx(moduleOverrides, assumpOverrides = {}, scenarioOverrides = {}) {
    const scenario = createMockScenario({ PeriodStart: 2026, PeriodEnd: 2030, TaxRate: 25, ...scenarioOverrides });
    const years = [];
    for (let y = scenario.PeriodStart; y <= scenario.PeriodEnd; y++) years.push(y);
    const mod = createMockIncExpModule(moduleOverrides);
    const categories = createMockCategories();
    const assumptions = createMockAssumptions(scenario, assumpOverrides);
    const catDF = createMockCategoriesDF([mod.Account, "Taxes", "Bank Accounts"], years);
    const db = createMockDb();
    const result = await processModule(mod, scenario, assumptions, catDF, categories, years, db, 1);
    return { db, result, years };
  }

  test("a PLN expense books at native ÷ FX rate (not native)", async () => {
    // -400 PLN each year, no inflation growth, PLN rate = 4 ⇒ -100 USD each year.
    const { db } = await runFx(
      { Account: "Living Expenses", Currency: "PLN", BaseValue: -400, BaseValueUSD: -400, Growth: 0 },
      { pln: [4, 4, 4, 4, 4] }
    );
    const rows = getEntriesForAccount(db, "Living Expenses");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.amount).toBeCloseTo(-100, 2); // -400 / 4, NOT -400
  });

  test("inflation is applied in native currency BEFORE the FX conversion", async () => {
    // 10% inflation, Growth 1 ⇒ native inflates each year; FX doubles 4→8 in year 1.
    // If inflation were applied post-conversion the year-1 USD would ignore the native compounding.
    const { db } = await runFx(
      { Account: "Living Expenses", Currency: "PLN", BaseValue: -100, BaseValueUSD: -100, Growth: 1 },
      { inflation: [10, 10, 10, 10, 10], pln: [4, 8, 8, 8, 8] }
    );
    const rows = getEntriesForAccount(db, "Living Expenses");
    // year 0: native -100*(1.10) = -110 ; /4 = -27.5
    expect(rows[0].amount).toBeCloseTo(-27.5, 2);
    // year 1: native -110*(1.10) = -121 (inflated in PLN) ; /8 (new rate) = -15.125
    expect(rows[1].amount).toBeCloseTo(-15.125, 2);
  });

  test("F1 — a zero FX rate for a currency in use fails loud (no Infinity)", async () => {
    await expect(
      runFx(
        { Account: "Living Expenses", Currency: "PLN", BaseValue: -400, BaseValueUSD: -400, Growth: 0 },
        { pln: [4, 4, 0, 4, 4] } // 2028 has no rate
      )
    ).rejects.toThrow(/no valid FX rate for 2028/);
  });

  test("F1 — a currency with no FX assumption column fails loud (no silent 1:1)", async () => {
    await expect(
      runFx({ Account: "Living Expenses", Currency: "GBP", BaseValue: -400, BaseValueUSD: -400, Growth: 0 })
    ).rejects.toThrow(/no.*FX - GBP.*assumption/);
  });

  test("a USD line is unaffected by the guard (1:1, no throw)", async () => {
    const { db } = await runFx(
      { Account: "Living Expenses", Currency: "USD", BaseValue: -400, BaseValueUSD: -400, Growth: 0 },
      { pln: [0, 0, 0, 0, 0] } // zero PLN rate must not matter for a USD line
    );
    const rows = getEntriesForAccount(db, "Living Expenses");
    for (const r of rows) expect(r.amount).toBeCloseTo(-400, 2);
  });
});
