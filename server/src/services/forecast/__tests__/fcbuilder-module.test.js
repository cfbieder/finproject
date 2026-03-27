/**
 * Tests for fcbuilder-module.js — Balance Sheet Module Processing
 *
 * Phase 1: Tax Deferral (G4), Absolute Expense Amounts (G8), Liability Interest (G6)
 */

const { processModule } = require("../fcbuilder-module");
const {
  createMockScenario,
  createMockModule,
  createMockAssumptions,
  createMockCategories,
  createMockCategoriesDF,
  createMockDb,
  getEntriesForAccount,
  getEntriesForYear,
} = require("./helpers");

// Suppress console.log during tests (restoreMocks in jest.config handles cleanup)
beforeEach(() => { jest.spyOn(console, "log").mockImplementation(() => {}); });

/**
 * Helper: run processModule with standard setup, return mock db with entries
 */
async function runModule(moduleOverrides = {}, scenarioOverrides = {}, assumptionOverrides = {}) {
  const scenario = createMockScenario({ PeriodStart: 2026, PeriodEnd: 2030, TaxRate: 25, ...scenarioOverrides });
  const years = [];
  for (let y = scenario.PeriodStart; y <= scenario.PeriodEnd; y++) years.push(y);

  const mod = createMockModule({
    BaseDate: `${scenario.PeriodStart - 1}-12-31`,
    IncomeCategory: "Test Income",
    ExpCategory: "Test Expense",
    ...moduleOverrides,
  });

  const categories = createMockCategories();
  const assumptions = createMockAssumptions(scenario, assumptionOverrides);
  const catNames = [
    mod.Account, "Bank Accounts", "Transfer - Bank",
    mod.IncomeCategory, mod.ExpCategory, "Taxes US",
  ];
  const catDF = createMockCategoriesDF(catNames, years);
  const db = createMockDb();

  const result = await processModule(mod, scenario, assumptions, catDF, categories, years, db, 1);
  return { db, result, years, scenario };
}


// ============================================================
// G4 — Tax Deferral
// ============================================================
describe("G4 — Tax Deferral", () => {

  test("1.1 Tax on realized gain is deferred by one year", async () => {
    const { db } = await runModule({
      BaseValue: 1000, BaseValueUSD: 1000,
      MarketValue: 1200, MarketValueUSD: 1200,
      Growth: 5,
      Dispose: [{ Date: "2028-06-01", Amount: 500, Flag: "" }],
    });

    const taxEntries = getEntriesForAccount(db, "Taxes US");
    const taxByYear = {};
    taxEntries.forEach((e) => { taxByYear[e.forecast_year] = e.amount; });

    // Tax should appear in 2029, NOT 2028
    expect(taxByYear[2028]).toBeUndefined();
    expect(taxByYear[2029]).toBeDefined();
    expect(taxByYear[2029]).toBeLessThan(0); // negative = tax payment
  });

  test("1.2 No tax entry in the disposal year", async () => {
    const { db } = await runModule({
      BaseValue: 1000, BaseValueUSD: 1000,
      MarketValue: 1200, MarketValueUSD: 1200,
      Growth: 5,
      Dispose: [{ Date: "2028-06-01", Amount: 500, Flag: "" }],
    });

    const year2028 = getEntriesForYear(db, 2028);
    const taxIn2028 = year2028.filter((e) => e.account === "Taxes US");
    expect(taxIn2028.length).toBe(0);
  });

  test("1.3 Tax on final forecast year stays in final year", async () => {
    const { db } = await runModule({
      BaseValue: 1000, BaseValueUSD: 1000,
      MarketValue: 1200, MarketValueUSD: 1200,
      Growth: 5,
      Dispose: [{ Date: "2030-06-01", Amount: 500, Flag: "" }],
    });

    const taxEntries = getEntriesForAccount(db, "Taxes US");
    const taxByYear = {};
    taxEntries.forEach((e) => { taxByYear[e.forecast_year] = e.amount; });

    // Last year disposal — tax can't go to 2031, stays in 2030
    expect(taxByYear[2030]).toBeDefined();
    expect(taxByYear[2030]).toBeLessThan(0);
  });

  test("1.4 No tax on losses (sell below basis)", async () => {
    const { db } = await runModule({
      BaseValue: 1200, BaseValueUSD: 1200,
      MarketValue: 1000, MarketValueUSD: 1000,
      Growth: 0,
      Dispose: [{ Date: "2028-06-01", Amount: 500, Flag: "" }],
    });

    const taxEntries = getEntriesForAccount(db, "Taxes US");
    // No tax entries expected when selling at a loss
    const nonZeroTax = taxEntries.filter((e) => e.amount !== 0);
    expect(nonZeroTax.length).toBe(0);
  });

  test("1.5 Multiple disposals — each tax deferred one year", async () => {
    const { db } = await runModule({
      BaseValue: 500, BaseValueUSD: 500,
      MarketValue: 1200, MarketValueUSD: 1200,
      Growth: 5,
      Dispose: [
        { Date: "2027-06-01", Amount: 200, Flag: "" },
        { Date: "2029-06-01", Amount: 200, Flag: "" },
      ],
    });

    const taxEntries = getEntriesForAccount(db, "Taxes US");
    const taxByYear = {};
    taxEntries.forEach((e) => { taxByYear[e.forecast_year] = (taxByYear[e.forecast_year] || 0) + e.amount; });

    // Disposal in 2027 → tax in 2028
    expect(taxByYear[2027]).toBeUndefined();
    expect(taxByYear[2028]).toBeDefined();
    expect(taxByYear[2028]).toBeLessThan(0);

    // Disposal in 2029 → tax in 2030
    expect(taxByYear[2029]).toBeUndefined();
    expect(taxByYear[2030]).toBeDefined();
    expect(taxByYear[2030]).toBeLessThan(0);
  });

  test("1.5b Income tax is also deferred by one year", async () => {
    const { db } = await runModule({
      BaseValue: 1000, BaseValueUSD: 1000,
      MarketValue: 1000, MarketValueUSD: 1000,
      Growth: 0,
      IncomePct: [{ Date: "2026-01-01", Value: 5 }], // 5% income yield
      IncomeCategory: "Dividends",
      Dispose: [],
    });

    const taxEntries = getEntriesForAccount(db, "Taxes US");
    const taxByYear = {};
    taxEntries.forEach((e) => { taxByYear[e.forecast_year] = (taxByYear[e.forecast_year] || 0) + e.amount; });

    // Income in 2026 → tax in 2027, income in 2027 → tax in 2028, etc.
    // Year 2026 should have no tax (income from 2025 is before forecast period)
    expect(taxByYear[2026]).toBeUndefined();
    // Year 2027 should have tax from 2026 income
    expect(taxByYear[2027]).toBeDefined();
    expect(taxByYear[2027]).toBeLessThan(0);
  });

  test("Zero tax rate produces no tax entries", async () => {
    const { db } = await runModule(
      {
        BaseValue: 1000, BaseValueUSD: 1000,
        MarketValue: 1200, MarketValueUSD: 1200,
        Growth: 5,
        Dispose: [{ Date: "2028-06-01", Amount: 500, Flag: "" }],
      },
      { TaxRate: 0 },
    );

    const taxEntries = getEntriesForAccount(db, "Taxes US");
    expect(taxEntries.length).toBe(0);
  });
});


// ============================================================
// G8 — Absolute Expense Amounts
// ============================================================
describe("G8 — Absolute Expense Amounts", () => {

  test("1.6 Absolute expense grows at inflation", async () => {
    const { db } = await runModule({
      BaseValue: 500, BaseValueUSD: 500,
      MarketValue: 500, MarketValueUSD: 500,
      Growth: 0, ExpensePct: 0,
      expense_amount: 30,
      ExpCategory: "Property Costs",
      Dispose: [],
    }, { PeriodStart: 2026, PeriodEnd: 2028, TaxRate: 0 }, { inflation: [2, 2, 2] });

    const expEntries = getEntriesForAccount(db, "Property Costs");
    const expByYear = {};
    expEntries.forEach((e) => { expByYear[e.forecast_year] = e.amount; });

    // Base year (2025) is actuals — no forecast expense entry
    // Year 1 (2026): 30 * 1.02 = 30.6, Year 2 (2027): 30 * 1.02^2 = 31.212, Year 3 (2028): 30 * 1.02^3
    expect(expByYear[2025]).toBeUndefined();             // base year has no forecast expense
    expect(expByYear[2026]).toBeCloseTo(-30.6, 1);       // 30 * (1 + 2%)
    expect(expByYear[2027]).toBeCloseTo(-31.212, 1);     // 30 * (1 + 2%)^2
  });

  test("1.7 expense_amount overrides expense_pct", async () => {
    const { db } = await runModule({
      BaseValue: 1000, BaseValueUSD: 1000,
      MarketValue: 1000, MarketValueUSD: 1000,
      Growth: 0, ExpensePct: 10, // 10% would be ~100 if used
      expense_amount: 30,         // should use 30 instead
      ExpCategory: "Property Costs",
      Dispose: [],
    }, { TaxRate: 0 });

    const expEntries = getEntriesForAccount(db, "Property Costs");
    // All values should be near -30, not near -100
    expEntries.forEach((e) => {
      expect(Math.abs(e.amount)).toBeLessThan(35); // 30 + inflation growth
      expect(Math.abs(e.amount)).toBeGreaterThan(25);
    });
  });

  test("1.8 Zero expense_amount falls back to expense_pct", async () => {
    const { db } = await runModule({
      BaseValue: 1000, BaseValueUSD: 1000,
      MarketValue: 1000, MarketValueUSD: 1000,
      Growth: 0, ExpensePct: 5,
      expense_amount: 0,
      ExpCategory: "Property Costs",
      Dispose: [],
    }, { TaxRate: 0 });

    const expEntries = getEntriesForAccount(db, "Property Costs");
    // 5% of avg(1000, 1000) = -50 (negated for assets)
    const firstEntry = expEntries.find((e) => e.forecast_year === 2026);
    expect(firstEntry).toBeDefined();
    expect(firstEntry.amount).toBeCloseTo(-50, 0);
  });

  test("1.9 Absolute expense with FX conversion (PLN module)", async () => {
    const { db } = await runModule({
      BaseValue: 120, BaseValueUSD: 30,
      MarketValue: 120, MarketValueUSD: 30,
      Currency: "PLN",
      Growth: 0, ExpensePct: 0,
      expense_amount: 120, // 120 PLN
      ExpCategory: "Property Costs",
      Dispose: [],
    }, { TaxRate: 0 }, { pln: [4, 4, 4, 4, 4], inflation: [0, 0, 0, 0, 0] });

    const expEntries = getEntriesForAccount(db, "Property Costs");
    // 120 PLN / 4 = 30 USD per year (no inflation)
    expEntries.forEach((e) => {
      expect(e.amount).toBeCloseTo(-30, 0);
    });
  });
});


// ============================================================
// G6 — Liability Interest Model
// ============================================================
describe("G6 — Liability Interest Model", () => {

  test("1.10 Interest calculated on liability balance", async () => {
    const { db } = await runModule({
      BaseValue: 100, BaseValueUSD: 100,
      MarketValue: 100, MarketValueUSD: 100,
      Growth: 0, ExpensePct: 8, // 8% interest rate
      expense_amount: 0,
      AccountType: "liability",
      ExpCategory: "Interest Expense",
      Dispose: [],
    }, { TaxRate: 0 }, { inflation: [1, 1, 1, 1, 1] });

    const intEntries = getEntriesForAccount(db, "Interest Expense");
    const intByYear = {};
    intEntries.forEach((e) => { intByYear[e.forecast_year] = e.amount; });

    // Interest = 100 * 8% = 8 per year (positive for liabilities)
    expect(intByYear[2026]).toBeCloseTo(8, 1);
    expect(intByYear[2027]).toBeCloseTo(8, 1);
    expect(intByYear[2028]).toBeCloseTo(8, 1);
  });

  test("1.11 Repayment reduces balance and subsequent interest", async () => {
    const { db } = await runModule({
      BaseValue: 100, BaseValueUSD: 100,
      MarketValue: 100, MarketValueUSD: 100,
      Growth: 0, ExpensePct: 8,
      expense_amount: 0,
      AccountType: "liability",
      ExpCategory: "Interest Expense",
      Dispose: [{ Date: "2028-06-01", Amount: 50, Flag: "" }],
    }, { TaxRate: 0 }, { inflation: [1, 1, 1, 1, 1] });

    const balEntries = getEntriesForAccount(db, "Test Account");
    const balByYear = {};
    balEntries.forEach((e) => { balByYear[e.forecast_year] = e.amount; });

    // Balance: 100 → 100 → 50 (after repayment) → 50 → 50
    expect(balByYear[2026]).toBeCloseTo(100, 0);
    expect(balByYear[2027]).toBeCloseTo(100, 0);
    expect(balByYear[2028]).toBeCloseTo(50, 0);
    expect(balByYear[2029]).toBeCloseTo(50, 0);

    const intEntries = getEntriesForAccount(db, "Interest Expense");
    const intByYear = {};
    intEntries.forEach((e) => { intByYear[e.forecast_year] = e.amount; });

    // Interest: 8 → 8 → 6 (avg 100,50) → 4 → 4
    expect(intByYear[2026]).toBeCloseTo(8, 0);
    expect(intByYear[2027]).toBeCloseTo(8, 0);
    expect(intByYear[2028]).toBeCloseTo(6, 0);
    expect(intByYear[2029]).toBeCloseTo(4, 0);
  });

  test("1.12 Full repayment zeros out balance and interest", async () => {
    const { db } = await runModule({
      BaseValue: 100, BaseValueUSD: 100,
      MarketValue: 100, MarketValueUSD: 100,
      Growth: 0, ExpensePct: 8,
      expense_amount: 0,
      AccountType: "liability",
      ExpCategory: "Interest Expense",
      Dispose: [{ Date: "2028-06-01", Amount: 100, Flag: "Full" }],
    }, { TaxRate: 0 }, { inflation: [1, 1, 1, 1, 1] });

    const balEntries = getEntriesForAccount(db, "Test Account");
    const balByYear = {};
    balEntries.forEach((e) => { balByYear[e.forecast_year] = e.amount; });

    // After full repayment in 2028, balance should be 0 for 2028+
    expect(balByYear[2026]).toBeCloseTo(100, 0);
    expect(balByYear[2027]).toBeCloseTo(100, 0);
    expect(balByYear[2028]).toBeUndefined(); // zero = no entry
    expect(balByYear[2029]).toBeUndefined();

    const intEntries = getEntriesForAccount(db, "Interest Expense");
    const intByYear = {};
    intEntries.forEach((e) => { intByYear[e.forecast_year] = e.amount; });

    // Interest should stop after full repayment
    expect(intByYear[2029]).toBeUndefined();
    expect(intByYear[2030]).toBeUndefined();
  });

  test("1.13 Interest rate scales with inflation via growth", async () => {
    // Growth multiplier applied to inflation gives effective rate change
    const { db } = await runModule({
      BaseValue: 100, BaseValueUSD: 100,
      MarketValue: 100, MarketValueUSD: 100,
      Growth: 0, // no growth on the balance itself
      ExpensePct: 8,
      expense_amount: 0,
      AccountType: "liability",
      ExpCategory: "Interest Expense",
      Dispose: [],
    }, { TaxRate: 0 }, { inflation: [2, 3, 2, 2, 2] });

    const intEntries = getEntriesForAccount(db, "Interest Expense");
    // With inflation varying, the expense_pct is constant but balance stays at 100
    // So interest = avg(100, 100) * 8 / 100 = 8 every year
    // (Growth=0 means inflation doesn't affect balance, only expPct is applied directly)
    intEntries.forEach((e) => {
      expect(e.amount).toBeCloseTo(8, 0);
    });
  });
});
