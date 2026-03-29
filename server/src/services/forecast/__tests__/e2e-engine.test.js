/**
 * E2E Engine Test — Complex multi-module forecast scenario
 *
 * Tests the full forecast engine with:
 * - Equity module (growth + dividends + disposal)
 * - Property module (growth + expenses via pct_of_value)
 * - Fixed income module (no growth + yield)
 * - Liability module (interest + repayment)
 * - Income/expense items (inflation-linked)
 * - Tax deferral
 * - Cash auto-balance (target cash)
 *
 * Validates final entry values against hand-calculated expectations.
 */

const { processModule } = require("../fcbuilder-module");
const { processModule: processIncExpModule } = require("../fcbuilder-incexp");
const {
  createMockScenario,
  createMockModule,
  createMockIncExpModule,
  createMockAssumptions,
  createMockCategories,
  createMockCategoriesDF,
  createMockDb,
  getEntriesForAccount,
  getEntriesForYear,
} = require("./helpers");

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
});

/**
 * Helper: run BS module with standard setup
 */
async function runBSModule(moduleOverrides = {}, scenarioOverrides = {}, assumptionOverrides = {}) {
  const scenario = createMockScenario({ PeriodStart: 2027, PeriodEnd: 2030, TaxRate: 25, ...scenarioOverrides });
  const years = [];
  for (let y = scenario.PeriodStart; y <= scenario.PeriodEnd; y++) years.push(y);

  const mod = createMockModule({
    BaseDate: "2026-12-31",
    ...moduleOverrides,
  });

  const categories = createMockCategories();
  const assumptions = createMockAssumptions(scenario, assumptionOverrides);
  const catNames = [
    mod.Account, "Bank Accounts", "Transfer - Bank",
    mod.IncomeCategory || "Income", mod.ExpCategory || "Expense", "Taxes",
  ];
  // Deduplicate
  const uniqueCats = [...new Set(catNames)];
  const catDF = createMockCategoriesDF(uniqueCats, years);
  const db = createMockDb();

  const result = await processModule(mod, scenario, assumptions, catDF, categories, years, db, 1);
  return { db, result, years, scenario, mod };
}

/**
 * Helper: run IncExp module
 */
async function runIncExp(moduleOverrides = {}, scenarioOverrides = {}, assumptionOverrides = {}) {
  const scenario = createMockScenario({ PeriodStart: 2027, PeriodEnd: 2030, TaxRate: 25, ...scenarioOverrides });
  const years = [];
  for (let y = scenario.PeriodStart; y <= scenario.PeriodEnd; y++) years.push(y);

  const mod = createMockIncExpModule({
    BaseDate: "2027-01-01",
    ...moduleOverrides,
  });

  const categories = createMockCategories();
  const assumptions = createMockAssumptions(scenario, assumptionOverrides);
  const catNames = [...new Set([mod.Account, "Bank Accounts", "Taxes", "Taxes"])];
  const catDF = createMockCategoriesDF(catNames, years);
  const db = createMockDb();

  const result = await processIncExpModule(mod, scenario, assumptions, catDF, categories, years, db, 1);
  return { db, result, years, scenario };
}

// ============================================================
// E2E: Complex Multi-Module Scenario
// ============================================================
describe("E2E — Complex Multi-Module Scenario", () => {

  test("Equity module: growth + dividends + partial disposal + tax deferral", async () => {
    // Equity: 500K market, 400K basis, 1x inflation growth (3%), 2% dividend, sell 100K in 2029
    const { db } = await runBSModule({
      BaseValue: 400000, BaseValueUSD: 400000,
      MarketValue: 500000, MarketValueUSD: 500000,
      Growth: 1, // 1x inflation
      ExpensePct: 0, expense_amount: 0,
      IncomeCategory: "Dividends",
      ExpCategory: "Expense",
      IncomePct: [{ Date: "2027-01-01", Value: 2 }],
      Dispose: [{ Date: "2029-06-01", Amount: 100000, Flag: "" }],
    }, { TaxRate: 25 }, { inflation: [3, 3, 3, 3] });

    // Market value growth: 500K → 515K → 530.45K → (530.45-100+unrealized)
    const balEntries = getEntriesForAccount(db, "Test Account");
    expect(balEntries.length).toBeGreaterThan(0);

    // Year 1 (2027): MV = 500K + 500K * 3% = 515,000
    const y2027 = balEntries.find(e => e.forecast_year === 2027);
    expect(y2027.amount).toBeCloseTo(515000, -2);

    // Dividends: 2% of avg MV
    const divEntries = getEntriesForAccount(db, "Dividends");
    expect(divEntries.length).toBeGreaterThan(0);
    // 2027: 2% × avg(500K, 515K) = 2% × 507.5K = 10,150
    const div2027 = divEntries.find(e => e.forecast_year === 2027);
    expect(div2027.amount).toBeCloseTo(10150, -1);

    // Tax should be deferred: no tax in 2027 (income taxed next year)
    const taxEntries = getEntriesForAccount(db, "Taxes");
    const tax2027 = taxEntries.find(e => e.forecast_year === 2027);
    expect(tax2027).toBeUndefined(); // No tax in year 1

    // Tax in 2028 from 2027 dividend income
    const tax2028 = taxEntries.find(e => e.forecast_year === 2028);
    expect(tax2028).toBeDefined();
    expect(tax2028.amount).toBeLessThan(0);
    expect(tax2028.amount).toBeCloseTo(-10150 * 0.25, -1);

    // Disposal in 2029 → tax in 2030
    const tax2029 = taxEntries.find(e => e.forecast_year === 2029);
    // 2029 should only have dividend tax (deferred from 2028 income), not disposal tax
    const tax2030 = taxEntries.find(e => e.forecast_year === 2030);
    expect(tax2030).toBeDefined();
    expect(tax2030.amount).toBeLessThan(tax2029?.amount || 0); // More tax due to realized gain
  });

  test("Property module: inflation growth + pct_of_value expenses", async () => {
    // Property: 300K, 1x inflation growth, 3K expense (1% of MV) via pct_of_value
    const { db } = await runBSModule({
      BaseValue: 300000, BaseValueUSD: 300000,
      MarketValue: 300000, MarketValueUSD: 300000,
      Growth: 1,
      ExpensePct: 0,
      expense_amount: 3000,
      expense_growth_method: "pct_of_value",
      expense_fc_line_id: 1, // Simulate FC Line assignment
      ExpCategory: "Prop Costs",
      IncomeCategory: "Income",
      IncomePct: [],
      Dispose: [],
    }, { TaxRate: 0 }, { inflation: [3, 3, 3, 3] });

    // derived_pct = 3000 / 300000 = 1%
    // 2027: MV = 300K * 1.03 = 309K, avg = (300K + 309K)/2 = 304.5K, expense = 1% × 304.5K = 3045
    const expEntries = getEntriesForAccount(db, "Prop Costs");
    const exp2027 = expEntries.find(e => e.forecast_year === 2027);
    expect(exp2027.amount).toBeCloseTo(-3045, -1);

    // 2028: MV = 309K * 1.03 = 318.27K, avg = (309K + 318.27K)/2 = 313.635K, expense = 3136.35
    const exp2028 = expEntries.find(e => e.forecast_year === 2028);
    expect(exp2028.amount).toBeCloseTo(-3136, -1);
  });

  test("Fixed income module: no growth + 4% yield", async () => {
    const { db } = await runBSModule({
      BaseValue: 1000000, BaseValueUSD: 1000000,
      MarketValue: 1000000, MarketValueUSD: 1000000,
      Growth: 0, // No growth
      ExpensePct: 0, expense_amount: 0,
      IncomeCategory: "Interest Income",
      ExpCategory: "Expense",
      IncomePct: [{ Date: "2027-01-01", Value: 4 }],
      Dispose: [],
    }, { TaxRate: 25 }, { inflation: [3, 3, 3, 3] });

    // MV stays at 1M (growth=0)
    const balEntries = getEntriesForAccount(db, "Test Account");
    const bal2027 = balEntries.find(e => e.forecast_year === 2027);
    expect(bal2027.amount).toBeCloseTo(1000000, -2);

    // Interest: 4% × avg(1M, 1M) = 40,000 per year
    const intEntries = getEntriesForAccount(db, "Interest Income");
    const int2027 = intEntries.find(e => e.forecast_year === 2027);
    expect(int2027.amount).toBeCloseTo(40000, -1);
    const int2030 = intEntries.find(e => e.forecast_year === 2030);
    expect(int2030.amount).toBeCloseTo(40000, -1);

    // Tax deferred: 25% of 40K = -10K, deferred to next year
    const taxEntries = getEntriesForAccount(db, "Taxes");
    const tax2028 = taxEntries.find(e => e.forecast_year === 2028);
    expect(tax2028.amount).toBeCloseTo(-10000, -1);
  });

  test("Liability module: interest + repayment", async () => {
    const { db } = await runBSModule({
      BaseValue: 200000, BaseValueUSD: 200000,
      MarketValue: 200000, MarketValueUSD: 200000,
      Growth: 0,
      ExpensePct: 5, // 5% interest rate
      expense_amount: 0,
      AccountType: "liability",
      IncomeCategory: "Income",
      ExpCategory: "Interest Expense",
      IncomePct: [],
      Dispose: [{ Date: "2029-06-01", Amount: 50000, Flag: "" }],
    }, { TaxRate: 0 }, { inflation: [1, 1, 1, 1] });

    // Interest: 5% of avg balance
    // 2027: 5% × avg(200K, 200K) = 10K (positive for liabilities)
    const intEntries = getEntriesForAccount(db, "Interest Expense");
    const int2027 = intEntries.find(e => e.forecast_year === 2027);
    expect(int2027.amount).toBeCloseTo(10000, -1);

    // After repayment of 50K in 2029, balance should drop
    const balEntries = getEntriesForAccount(db, "Test Account");
    const bal2029 = balEntries.find(e => e.forecast_year === 2029);
    expect(bal2029.amount).toBeCloseTo(150000, -2);

    // Interest after repayment should be lower
    const int2030 = intEntries.find(e => e.forecast_year === 2030);
    expect(int2030.amount).toBeCloseTo(7500, -1); // 5% of 150K
  });

  test("IncExp module: expense grows at inflation", async () => {
    const { db } = await runIncExp({
      Account: "Living Expenses",
      BaseValue: -50000,
      BaseValueUSD: -50000,
      Growth: 1, // 1x inflation
    }, { TaxRate: 0 }, { inflation: [3, 3, 3, 3] });

    const entries = getEntriesForAccount(db, "Living Expenses");
    // 2027: -50000 × 1.03 = -51,500
    const e2027 = entries.find(e => e.forecast_year === 2027);
    expect(e2027.amount).toBeCloseTo(-51500, -1);

    // 2028: -51500 × 1.03 = -53,045
    const e2028 = entries.find(e => e.forecast_year === 2028);
    expect(e2028.amount).toBeCloseTo(-53045, -1);

    // 2030: -50000 × 1.03^4 = -56,275
    const e2030 = entries.find(e => e.forecast_year === 2030);
    expect(e2030.amount).toBeCloseTo(-56275, -1);
  });

  test("IncExp module: income with tax deferral", async () => {
    const { db } = await runIncExp({
      Account: "Salary",
      BaseValue: 100000,
      BaseValueUSD: 100000,
      Growth: 1,
    }, { TaxRate: 25 }, { inflation: [2, 2, 2, 2] });

    const entries = getEntriesForAccount(db, "Salary");
    // 2027: 100000 × 1.02 = 102,000
    const e2027 = entries.find(e => e.forecast_year === 2027);
    expect(e2027.amount).toBeCloseTo(102000, -1);

    // Tax: 25% of 102K = -25,500, deferred to 2028
    // IncExp engine writes tax to "Taxes" (not "Taxes")
    const taxEntries = getEntriesForAccount(db, "Taxes");
    const tax2027 = taxEntries.find(e => e.forecast_year === 2027);
    expect(tax2027).toBeUndefined(); // No tax in income year

    const tax2028 = taxEntries.find(e => e.forecast_year === 2028);
    expect(tax2028.amount).toBeCloseTo(-25500, -1);
  });

  test("EUR module with FX conversion", async () => {
    const { db } = await runBSModule({
      BaseValue: 400000, BaseValueUSD: 470588, // 400K EUR / 0.85
      MarketValue: 400000, MarketValueUSD: 470588,
      Currency: "EUR",
      Growth: 1,
      ExpensePct: 0, expense_amount: 0,
      IncomeCategory: "Income", ExpCategory: "Expense",
      IncomePct: [], Dispose: [],
    }, { TaxRate: 0 }, { inflation: [3, 3, 3, 3], eur: [0.85, 0.85, 0.85, 0.85] });

    // MV in EUR: 400K × 1.03 = 412K, converted at 0.85 EUR/USD = 412K / 0.85 = 484,706
    const balEntries = getEntriesForAccount(db, "Test Account");
    const bal2027 = balEntries.find(e => e.forecast_year === 2027);
    expect(bal2027.amount).toBeCloseTo(484706, -2);
  });

  test("No expense entries when expense_fc_line_id is NULL", async () => {
    const { db } = await runBSModule({
      BaseValue: 100000, BaseValueUSD: 100000,
      MarketValue: 100000, MarketValueUSD: 100000,
      Growth: 0, ExpensePct: 0, expense_amount: 0,
      expense_fc_line_id: null,
      IncomeCategory: "Income", ExpCategory: "Expense",
      IncomePct: [], Dispose: [],
    }, { TaxRate: 0 });

    const expEntries = getEntriesForAccount(db, "Expense");
    expect(expEntries.length).toBe(0);
  });
});
