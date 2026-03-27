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
