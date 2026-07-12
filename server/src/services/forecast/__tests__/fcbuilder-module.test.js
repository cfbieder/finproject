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
    mod.IncomeCategory, mod.ExpCategory, "Taxes",
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

    const taxEntries = getEntriesForAccount(db, "Taxes");
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
    const taxIn2028 = year2028.filter((e) => e.account === "Taxes");
    expect(taxIn2028.length).toBe(0);
  });

  test("1.3 Tax on final forecast year stays in final year", async () => {
    const { db } = await runModule({
      BaseValue: 1000, BaseValueUSD: 1000,
      MarketValue: 1200, MarketValueUSD: 1200,
      Growth: 5,
      Dispose: [{ Date: "2030-06-01", Amount: 500, Flag: "" }],
    });

    const taxEntries = getEntriesForAccount(db, "Taxes");
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

    const taxEntries = getEntriesForAccount(db, "Taxes");
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

    const taxEntries = getEntriesForAccount(db, "Taxes");
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

    const taxEntries = getEntriesForAccount(db, "Taxes");
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

    const taxEntries = getEntriesForAccount(db, "Taxes");
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

    // expense_amount = 30 is Base Year value
    // Period 1 (2026): 30 * 1.02 = 30.6, Period 2 (2027): 30 * 1.02^2 = 31.212
    expect(expByYear[2025]).toBeUndefined();
    expect(expByYear[2026]).toBeCloseTo(-30.6, 1);       // Period 1: base * (1+2%)
    expect(expByYear[2027]).toBeCloseTo(-31.212, 1);     // Period 2: base * (1+2%)^2
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


// ============================================================
// Phase 2B-5 — Engine Update (FC Lines + Growth Methods)
// ============================================================
describe("Phase 2B-5 — Engine Update", () => {

  test("T5.1 Inflation growth method", async () => {
    // expense_amount = 1000, expense_growth_method = 'inflation', inflation = 3%, 3-year forecast
    const { db } = await runModule({
      BaseValue: 500000, BaseValueUSD: 500000,
      MarketValue: 500000, MarketValueUSD: 500000,
      Growth: 0, ExpensePct: 0,
      expense_amount: 1000,
      expense_growth_method: 'inflation',
      ExpCategory: "Prop Costs",
      Dispose: [],
    }, { PeriodStart: 2026, PeriodEnd: 2028, TaxRate: 0 }, { inflation: [3, 3, 3] });

    const expEntries = getEntriesForAccount(db, "Prop Costs");
    const expByYear = {};
    expEntries.forEach((e) => { expByYear[e.forecast_year] = e.amount; });

    // expense_amount = 1000 is Base Year value
    // Period 1 (2026): 1000 * 1.03 = 1030
    // Period 2 (2027): 1000 * 1.03^2 = 1060.9
    // Period 3 (2028): 1000 * 1.03^3 = 1092.727
    expect(expByYear[2026]).toBeCloseTo(-1030, 0);
    expect(expByYear[2027]).toBeCloseTo(-1060.9, 0);
    expect(expByYear[2028]).toBeCloseTo(-1092.727, 0);
  });

  test("T5.2 Pct of value growth method", async () => {
    // expense_amount = 1000, expense_growth_method = 'pct_of_value', market_value = 100000, MV grows 5%/yr
    // derived_pct = 1000 / 100000 = 1%
    const { db } = await runModule({
      BaseValue: 100000, BaseValueUSD: 100000,
      MarketValue: 100000, MarketValueUSD: 100000,
      Growth: 1, // growth multiplier applied to inflation
      ExpensePct: 0,
      expense_amount: 1000,
      expense_growth_method: 'pct_of_value',
      ExpCategory: "Prop Costs",
      Dispose: [],
    }, { PeriodStart: 2026, PeriodEnd: 2028, TaxRate: 0 }, { inflation: [5, 5, 5] });

    const expEntries = getEntriesForAccount(db, "Prop Costs");
    const expByYear = {};
    expEntries.forEach((e) => { expByYear[e.forecast_year] = e.amount; });

    // derived_pct = 1000 / 100000 = 0.01 (1%)
    // Growth = 1 * 5% = 5% MV growth per year
    // Period 1 (2026): MV[1] = 105K, avg(100K,105K) = 102.5K, 1% = 1025
    // Period 2 (2027): MV[2] = 110.25K, avg(105K,110.25K) = 107.625K, 1% = 1076.25
    expect(expByYear[2026]).toBeCloseTo(-1025, 0);
    expect(expByYear[2027]).toBeCloseTo(-1076.25, 0);
  });

  test("T5.3 No expense when expense_fc_line_id NULL", async () => {
    const { db } = await runModule({
      BaseValue: 100000, BaseValueUSD: 100000,
      MarketValue: 100000, MarketValueUSD: 100000,
      Growth: 0, ExpensePct: 0,
      expense_amount: 0,
      expense_fc_line_id: null,
      ExpCategory: "Prop Costs",
      Dispose: [],
    }, { TaxRate: 0 });

    const expEntries = getEntriesForAccount(db, "Prop Costs");
    expect(expEntries.length).toBe(0);
  });

  test("T5.4 Entry label from FC Line name (expense)", async () => {
    // Module with expense_fc_line_id pointing to a line named "Prop Costs - PM4"
    // The FC Line name resolution happens in index.js (sets ExpCategory from fcLineNameMap),
    // so in tests we simulate this by setting ExpCategory to the resolved name
    const { db } = await runModule({
      BaseValue: 100000, BaseValueUSD: 100000,
      MarketValue: 100000, MarketValueUSD: 100000,
      Growth: 0, ExpensePct: 0,
      expense_amount: 500,
      expense_growth_method: 'inflation',
      expense_fc_line_id: 42, // simulated fc_line_id
      ExpCategory: "Prop Costs - PM4", // resolved name (done by index.js in production)
      Dispose: [],
    }, { TaxRate: 0 });

    // Entries should be labeled with the FC Line name
    const entries = getEntriesForAccount(db, "Prop Costs - PM4");
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((e) => {
      expect(e.account).toBe("Prop Costs - PM4");
    });
  });

  test("T5.5 Income label from FC Line name", async () => {
    // Module with income_fc_line_id resolved to "Rental Income - PM4"
    const { db } = await runModule({
      BaseValue: 100000, BaseValueUSD: 100000,
      MarketValue: 100000, MarketValueUSD: 100000,
      Growth: 0, ExpensePct: 0,
      expense_amount: 0,
      income_fc_line_id: 43,
      IncomeCategory: "Rental Income - PM4", // resolved name
      IncomePct: [{ Date: "2026-01-01", Value: 5 }],
      Dispose: [],
    }, { TaxRate: 0 });

    const incEntries = getEntriesForAccount(db, "Rental Income - PM4");
    expect(incEntries.length).toBeGreaterThan(0);
    incEntries.forEach((e) => {
      expect(e.account).toBe("Rental Income - PM4");
    });
  });

  test("T5.6 Pct of value with zero market value falls back to inflation", async () => {
    // expense_amount = 1000, market_value = 0 → derivedPct = 0 → fallback to inflation
    // CR041: base-year Invest establishes ownership from the start (a never-owned
    // module no longer generates expenses at all — see the CR041 block below)
    const { db } = await runModule({
      BaseValue: 0, BaseValueUSD: 0,
      MarketValue: 0, MarketValueUSD: 0,
      Growth: 0, ExpensePct: 0,
      expense_amount: 1000,
      expense_growth_method: 'pct_of_value',
      ExpCategory: "Prop Costs",
      Invest: [{ Date: "2025-06-01", Amount: 100000, Flag: "OneTime" }],
      Dispose: [],
    }, { PeriodStart: 2026, PeriodEnd: 2028, TaxRate: 0 }, { inflation: [3, 3, 3] });

    const expEntries = getEntriesForAccount(db, "Prop Costs");
    const expByYear = {};
    expEntries.forEach((e) => { expByYear[e.forecast_year] = e.amount; });

    // Base = 1000, Period 1 = 1000 * 1.03 = 1030, Period 2 = 1000 * 1.03^2 = 1060.9
    expect(expByYear[2026]).toBeCloseTo(-1030, 0);
    expect(expByYear[2027]).toBeCloseTo(-1060.9, 0);
  });
});


// ============================================================
// CR041 — Ownership-gated expenses/income
// (module acquired mid-plan: zero before acquisition, 50% in the
//  acquisition year, mirroring the Full-disposal treatment)
// ============================================================
describe("CR041 — Ownership-gated expenses/income", () => {

  // Scenario 2026–2030, BaseDate 2025-12-31 → base year 2025, purchase 2027
  const purchase = { Date: "2027-06-01", Amount: 150000, Flag: "OneTime" };

  test("C1 Expenses start at acquisition: zero before, 50% in purchase year, full after", async () => {
    const { db } = await runModule({
      BaseValue: 0, BaseValueUSD: 0,
      MarketValue: 0, MarketValueUSD: 0,
      Growth: 0, ExpensePct: 0,
      expense_amount: 1000,
      ExpCategory: "Prop Costs",
      Invest: [purchase],
    }, { TaxRate: 0 }, { inflation: [2, 2, 2, 2, 2] });

    const expByYear = {};
    getEntriesForAccount(db, "Prop Costs").forEach((e) => { expByYear[e.forecast_year] = e.amount; });

    expect(expByYear[2026]).toBeUndefined();                 // pre-purchase: no expense
    expect(expByYear[2027]).toBeCloseTo(-520.2, 1);          // 50% of 1000 * 1.02^2
    expect(expByYear[2028]).toBeCloseTo(-1061.2, 1);         // full 1000 * 1.02^3
    expect(expByYear[2029]).toBeCloseTo(-1082.4, 1);
  });

  test("C2 income_amount gated + no Period-1 base-income tax; deferred tax starts after acquisition", async () => {
    const { db } = await runModule({
      BaseValue: 0, BaseValueUSD: 0,
      MarketValue: 0, MarketValueUSD: 0,
      Growth: 0, ExpensePct: 0,
      income_amount: 1000,
      IncomeCategory: "Rental Income",
      Invest: [purchase],
    }, { TaxRate: 25 }, { inflation: [2, 2, 2, 2, 2] });

    const incByYear = {};
    getEntriesForAccount(db, "Rental Income").forEach((e) => { incByYear[e.forecast_year] = e.amount; });
    const taxByYear = {};
    getEntriesForAccount(db, "Taxes").forEach((e) => { taxByYear[e.forecast_year] = e.amount; });

    expect(incByYear[2026]).toBeUndefined();                 // pre-purchase: no income
    expect(incByYear[2027]).toBeCloseTo(520.2, 1);           // 50% of 1000 * 1.02^2
    expect(incByYear[2028]).toBeCloseTo(1061.2, 1);          // full
    expect(taxByYear[2026]).toBeUndefined();                 // no base-year income → no Period-1 tax
    expect(taxByYear[2027]).toBeUndefined();
    expect(taxByYear[2028]).toBeCloseTo(-130.1, 1);          // 25% of 2027 income, deferred a year
  });

  test("C3 Yield-spread income is NOT gated (avg-MV already halves the purchase year)", async () => {
    const { db } = await runModule({
      BaseValue: 0, BaseValueUSD: 0,
      MarketValue: 0, MarketValueUSD: 0,
      Growth: 0, ExpensePct: 0,
      IncomePct: [{ Date: "2025-12-31", Value: 3 }],
      IncomeCategory: "Rental Income",
      Invest: [purchase],
    }, { TaxRate: 0 }, { inflation: [0, 0, 0, 0, 0] });

    const incByYear = {};
    getEntriesForAccount(db, "Rental Income").forEach((e) => { incByYear[e.forecast_year] = e.amount; });

    expect(incByYear[2026]).toBeUndefined();                 // yield on avg MV 0
    expect(incByYear[2027]).toBeCloseTo(2250, 0);            // 3% of avg(0, 150000) — natural half, not quartered
    expect(incByYear[2028]).toBeCloseTo(4500, 0);            // 3% of 150000
  });

  test("C4 Purchase then Full disposal: costs run acquisition-half → full → disposal-half → zero", async () => {
    const { db } = await runModule({
      BaseValue: 0, BaseValueUSD: 0,
      MarketValue: 0, MarketValueUSD: 0,
      Growth: 0, ExpensePct: 0,
      expense_amount: 1000,
      ExpCategory: "Prop Costs",
      Invest: [purchase],
      Dispose: [{ Date: "2029-06-01", Amount: 0, Flag: "Full" }],
    }, { TaxRate: 0 }, { inflation: [0, 0, 0, 0, 0] });

    const expByYear = {};
    getEntriesForAccount(db, "Prop Costs").forEach((e) => { expByYear[e.forecast_year] = e.amount; });

    expect(expByYear[2026]).toBeUndefined();
    expect(expByYear[2027]).toBeCloseTo(-500, 0);            // acquisition half
    expect(expByYear[2028]).toBeCloseTo(-1000, 0);           // full ownership year
    expect(expByYear[2029]).toBeCloseTo(-500, 0);            // disposal half
    expect(expByYear[2030]).toBeUndefined();                 // post-disposal
  });

  test("C5 Never-owned module (MV 0, no invest) generates no expense/income at all", async () => {
    const { db } = await runModule({
      BaseValue: 0, BaseValueUSD: 0,
      MarketValue: 0, MarketValueUSD: 0,
      Growth: 0, ExpensePct: 0,
      expense_amount: 1000,
      income_amount: 500,
      ExpCategory: "Prop Costs",
      IncomeCategory: "Rental Income",
    }, { TaxRate: 25 });

    expect(getEntriesForAccount(db, "Prop Costs")).toHaveLength(0);
    expect(getEntriesForAccount(db, "Rental Income")).toHaveLength(0);
    expect(getEntriesForAccount(db, "Taxes")).toHaveLength(0);
  });

  test("C6 Base-year invest = owned from start: full expenses, no proration", async () => {
    const { db } = await runModule({
      BaseValue: 0, BaseValueUSD: 0,
      MarketValue: 0, MarketValueUSD: 0,
      Growth: 0, ExpensePct: 0,
      expense_amount: 1000,
      ExpCategory: "Prop Costs",
      Invest: [{ Date: "2025-06-01", Amount: 150000, Flag: "OneTime" }],
    }, { TaxRate: 0 }, { inflation: [0, 0, 0, 0, 0] });

    const expByYear = {};
    getEntriesForAccount(db, "Prop Costs").forEach((e) => { expByYear[e.forecast_year] = e.amount; });

    expect(expByYear[2026]).toBeCloseTo(-1000, 0);           // no gating, no halving
    expect(expByYear[2027]).toBeCloseTo(-1000, 0);
  });

  test("C7 Same-year buy + Full dispose compounds both halvings (25%)", async () => {
    const { db } = await runModule({
      BaseValue: 0, BaseValueUSD: 0,
      MarketValue: 0, MarketValueUSD: 0,
      Growth: 0, ExpensePct: 0,
      expense_amount: 1000,
      ExpCategory: "Prop Costs",
      Invest: [purchase],
      Dispose: [{ Date: "2027-06-01", Amount: 0, Flag: "Full" }],
    }, { TaxRate: 0 }, { inflation: [0, 0, 0, 0, 0] });

    const expByYear = {};
    getEntriesForAccount(db, "Prop Costs").forEach((e) => { expByYear[e.forecast_year] = e.amount; });

    expect(expByYear[2026]).toBeUndefined();
    expect(expByYear[2027]).toBeCloseTo(-250, 0);            // 50% acquisition × 50% disposal
    expect(expByYear[2028]).toBeUndefined();
  });
});

describe("CR046 — Income/expense start & end window", () => {
  // Scenario 2026–2030, BaseDate 2025-12-31 → base year 2025.
  // The asset is owned from the start (MV 100000), so CR041's ownership gate never fires:
  // the only thing that can delay a stream here is the CR046 window.
  const owned = {
    BaseValue: 100000, BaseValueUSD: 100000,
    MarketValue: 100000, MarketValueUSD: 100000,
    Growth: 0, ExpensePct: 0,
    IncomePct: [], Invest: [], Dispose: [],
    IncomeCategory: "Rental Income",
    ExpCategory: "Prop Costs",
    expense_amount: 0,
    income_amount: 10000,
  };

  const byYear = (db, account) => {
    const out = {};
    for (const e of getEntriesForAccount(db, account)) out[e.forecast_year] = e.amount;
    return out;
  };

  test("W1 income starts in the year the window opens, not the base year", async () => {
    // "I own this flat today and start renting it in 2028."
    const { db } = await runModule(
      { ...owned, income_start_date: "2028-01-01" },
      { TaxRate: 0 }
    );
    const inc = byYear(db, "Rental Income");

    expect(inc[2026]).toBeUndefined(); // zero cells are not written as entries
    expect(inc[2027]).toBeUndefined();
    expect(inc[2028]).toBeGreaterThan(0);
    expect(inc[2029]).toBeGreaterThan(0);
    expect(inc[2030]).toBeGreaterThan(0);
  });

  test("W2 the amount is still a base-year figure compounded at inflation", async () => {
    // The window moves WHEN the stream runs, never how much. 2028's rent is what it would
    // have been in 2028 anyway — the same number an unwindowed module shows that year.
    const gated = await runModule({ ...owned, income_start_date: "2028-01-01" }, { TaxRate: 0 });
    const plain = await runModule({ ...owned }, { TaxRate: 0 });

    const g = byYear(gated.db, "Rental Income");
    const p = byYear(plain.db, "Rental Income");
    expect(g[2028]).toBeCloseTo(p[2028], 6);
    expect(g[2030]).toBeCloseTo(p[2030], 6);
  });

  test("W3 income stops after the window closes", async () => {
    const { db } = await runModule(
      { ...owned, income_end_date: "2028-12-31" },
      { TaxRate: 0 }
    );
    const inc = byYear(db, "Rental Income");

    expect(inc[2027]).toBeGreaterThan(0);
    expect(inc[2028]).toBeGreaterThan(0);
    expect(inc[2029]).toBeUndefined();
    expect(inc[2030]).toBeUndefined();
  });

  test("W4 the same window bounds the expense stream", async () => {
    const { db } = await runModule(
      { ...owned, income_amount: 0, expense_amount: 5000, expense_start_date: "2029-01-01" },
      { TaxRate: 0 }
    );
    const exp = byYear(db, "Prop Costs");

    expect(exp[2027]).toBeUndefined();
    expect(exp[2028]).toBeUndefined();
    expect(exp[2029]).toBeLessThan(0);
    expect(exp[2030]).toBeLessThan(0);
  });

  test("W5 no window ⇒ byte-identical to before (every existing module)", async () => {
    const before = await runModule({ ...owned, expense_amount: 5000 }, { TaxRate: 25 });
    const after = await runModule(
      { ...owned, expense_amount: 5000, income_start_date: null, income_end_date: null,
        expense_start_date: null, expense_end_date: null },
      { TaxRate: 25 }
    );
    expect(after.db.insertedEntries).toEqual(before.db.insertedEntries);
  });

  test("W6 rent that has not started is not taxed in the base year", async () => {
    // The base-year income tax is deferred into Period 1. Rent starting in 2028 earns
    // nothing in the base year, so there is nothing to defer.
    const { db } = await runModule(
      { ...owned, income_start_date: "2028-01-01" },
      { TaxRate: 25 }
    );
    const tax = byYear(db, "Taxes");

    // 2026 (Period 1) would carry the base-year income tax if the window were ignored.
    expect(tax[2026]).toBeUndefined();
    // The first taxed year is the one after income actually starts.
    expect(tax[2029]).toBeLessThan(0);
  });

  test("W7 ownership still wins — you cannot rent what you do not own yet", async () => {
    // Bought in 2029, but the window says rent starts 2027. Nothing before the purchase.
    const { db } = await runModule(
      {
        ...owned,
        BaseValue: 0, BaseValueUSD: 0, MarketValue: 0, MarketValueUSD: 0,
        Invest: [{ Date: "2029-06-01", Amount: 150000, Flag: "OneTime" }],
        income_start_date: "2027-01-01",
      },
      { TaxRate: 0 }
    );
    const inc = byYear(db, "Rental Income");

    expect(inc[2027]).toBeUndefined();
    expect(inc[2028]).toBeUndefined();
    expect(inc[2029]).toBeGreaterThan(0); // acquisition year — halved by CR041
    expect(inc[2030]).toBeGreaterThan(inc[2029]);
  });
});
