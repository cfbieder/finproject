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

  // RETIRED by CR069 P2 — "1.8 Zero expense_amount falls back to expense_pct".
  //
  // The legacy `expense_pct` branch is GONE, and it was already unreachable in production:
  // migration 008 dropped the column and the engine's loader hard-coded `ExpensePct = 0`, so
  // the only thing that could exercise it was a test calling processModule directly. CR062's
  // own note called it "dead in production". The stream evaluator has three real expense
  // modes — amount, pct_of_value and a loan's derived interest — and no fourth for a column
  // that does not exist. Deleting the test with the branch is the honest pairing; keeping it
  // would mean keeping dead code alive to satisfy it.

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
// CR062 P1 — the loan module, through the REAL builder
//
// V4  the draw year carries exactly HALF a year's interest (the July-1 convention)
// V5  the whole Bank Accounts row of the CR's worked example
// V13 a non-USD loan converts at the module's FX path
// V9  a stale CR046 window / Full disposal can no longer mangle the interest
// ============================================================
describe("CR062 P1 — loan interest through the builder", () => {

  const { deriveLoanSchedule, straightLineSchedule } = require("../fcbuilder-loan");

  /** The §5.5 worked example: 400,000 drawn 2027, 5%, ending 2036. */
  const workedLoan = (overrides = {}) => {
    const { invest } = deriveLoanSchedule({
      principal: 400000, drawYear: 2027, endYear: 2036,
      baseOutstanding: 0, baseYear: 2026, horizonEnd: 2036,
      amortPct: straightLineSchedule(2027, 2036),
    });
    return {
      BaseValue: 0, BaseValueUSD: 0, MarketValue: 0, MarketValueUSD: 0,
      Growth: 0, ExpensePct: 0, expense_amount: 0,
      AccountType: "liability",
      LoanRate: 5,
      ExpCategory: "Interest Expense",
      Invest: invest,
      Dispose: [],
      ...overrides,
    };
  };

  const byYear = (db, account) => {
    const out = {};
    getEntriesForAccount(db, account).forEach((e) => { out[e.forecast_year] = e.amount; });
    return out;
  };

  test("V4 the draw year carries exactly half a year's interest", async () => {
    const { db } = await runModule(
      workedLoan(),
      { PeriodStart: 2027, PeriodEnd: 2036, TaxRate: 0 },
      { inflation: new Array(10).fill(0) }
    );

    const interest = byYear(db, "Interest Expense");

    // 5% x 400,000 = 20,000 for a full year. The draw is July 1, so 2027 pays
    // 10,000 — and it is NOT special-cased anywhere: avg(0, −400,000) is half the
    // balance. Replace the average with a spot balance and this doubles.
    expect(interest[2027]).toBeCloseTo(-10000, 2);

    // 2028 is a full year on a balance that fell mid-year:
    // 5% x avg(400,000, 355,555.60) = 5% x 377,777.80 = 18,888.89
    expect(interest[2028]).toBeCloseTo(-18888.89, 2);
    expect(interest[2029]).toBeCloseTo(-16666.67, 2);

    // Final year: the balance reaches zero, so avg(44,444.80, 0) = 22,222.40
    expect(interest[2036]).toBeCloseTo(-1111.12, 2);
  });

  test("V5 the whole Bank Accounts row of the worked example", async () => {
    // The failure class here is silently-wrong CASH, so the assertion is the cash
    // row end to end — not one interest figure. Draw year is net POSITIVE: the
    // loan releases 400,000 and costs half a year of interest.
    const { db } = await runModule(
      workedLoan(),
      { PeriodStart: 2027, PeriodEnd: 2036, TaxRate: 0 },
      { inflation: new Array(10).fill(0) }
    );

    const cash = byYear(db, "Bank Accounts");
    expect(cash[2027]).toBeCloseTo(390000, 2);        // +400,000 draw − 10,000 interest
    expect(cash[2028]).toBeCloseTo(-63333.29, 2);     // −44,444.40 principal − 18,888.89 interest
    expect(cash[2029]).toBeCloseTo(-61111.07, 2);
    expect(cash[2036]).toBeCloseTo(-45555.92, 2);     // −44,444.80 remainder − 1,111.12 interest

    // Over the loan's life the bank gives back the principal and keeps the interest.
    const totalCash = Object.values(cash).reduce((a, b) => a + b, 0);
    const totalInterest = Object.values(byYear(db, "Interest Expense")).reduce((a, b) => a + b, 0);
    expect(totalCash).toBeCloseTo(totalInterest, 2);

    // And the liability itself closes at zero — no entry is written for 0.
    const balance = byYear(db, "Test Account");
    expect(balance[2027]).toBeCloseTo(-400000, 2);
    expect(balance[2035]).toBeCloseTo(-44444.8, 2);
    expect(balance[2036]).toBeUndefined();
  });

  test("V13 a PLN loan converts to USD on the module's FX path", async () => {
    const { db } = await runModule(
      workedLoan({ Currency: "PLN" }),
      { PeriodStart: 2027, PeriodEnd: 2036, TaxRate: 0 },
      { inflation: new Array(10).fill(0), pln: new Array(10).fill(4) }
    );

    // Interest is computed on the LC balance and divided by the FX rate, so the
    // USD figures are the V4 numbers over 4. This is the class CR051's F1 guard
    // exists for — a missing rate would silently divide by 1.
    const interest = byYear(db, "Interest Expense");
    expect(interest[2027]).toBeCloseTo(-2500, 2);
    expect(interest[2028]).toBeCloseTo(-4722.22, 2);
  });

  test("V9 a stale CR046 expense window can no longer mangle the interest", async () => {
    // A module retyped Asset → Loan keeps its window dates unless the save clears
    // them, and applyWindow runs AFTER the interest branch. Without the guard this
    // zeroes 2027–2029 and halves 2030.
    const { db } = await runModule(
      workedLoan({ expense_start_date: "2030-07-01", expense_end_date: "2032-07-01" }),
      { PeriodStart: 2027, PeriodEnd: 2036, TaxRate: 0 },
      { inflation: new Array(10).fill(0) }
    );

    const interest = byYear(db, "Interest Expense");
    expect(interest[2027]).toBeCloseTo(-10000, 2);     // not 0
    expect(interest[2030]).toBeCloseTo(-14444.45, 2);  // not halved
    expect(interest[2033]).toBeCloseTo(-7777.79, 2);   // not 0
  });

  test("V9.2 a leftover expense_amount cannot re-gate a loan's interest", async () => {
    // CR041's ownership gate keys on absExpenseAmount > 0. A loan drawn mid-plan
    // has acquisitionIdx > 0, so a stale amount would halve the draw year's
    // interest a SECOND time — leaving 25% of it.
    const { db } = await runModule(
      workedLoan({ expense_amount: 12345 }),
      { PeriodStart: 2027, PeriodEnd: 2036, TaxRate: 0 },
      { inflation: new Array(10).fill(0) }
    );
    expect(byYear(db, "Interest Expense")[2027]).toBeCloseTo(-10000, 2);   // not −5,000
  });

  test("V9.3 an existing mortgage charges a full year from the base year on", async () => {
    const { invest } = deriveLoanSchedule({
      principal: 400000, drawYear: 2015, endYear: 2030,
      baseOutstanding: -250000, baseYear: 2026, horizonEnd: 2036,
      amortPct: [{ year: 2027, pct: 10 }, { year: 2028, pct: 10 }],
    });
    const { db } = await runModule(
      workedLoan({
        BaseValue: -250000, BaseValueUSD: -250000,
        MarketValue: -250000, MarketValueUSD: -250000,
        Invest: invest,
      }),
      { PeriodStart: 2027, PeriodEnd: 2036, TaxRate: 0 },
      { inflation: new Array(10).fill(0) }
    );

    // 2027 repays 40,000, so interest is 5% x avg(250,000, 210,000) = 11,500 —
    // a full year, because the loan was already outstanding at the base date.
    expect(byYear(db, "Interest Expense")[2027]).toBeCloseTo(-11500, 2);
  });
});


// ============================================================
// CR062 P0 — an expense is CASH OUT on a liability too
//
// `expenseValues[i] = isLiability ? val : -val` did not correct a sign, it
// INVERTED one. Prod stores liabilities as NEGATIVE market value, so
// `pct_of_value` already yields a positive `val` by double negation and the
// inflation path yields a positive `compounded` unconditionally — the ternary
// then handed both back positive, i.e. an expense that CREDITS the bank line.
//
// Falsified against the unfixed builder first: both tests read +25,000 / +25,625
// where they now read negative. Dormant in prod (all 15 modules on a liability
// account carry expense_amount = 0.00), which is why nothing had ever seen it —
// and why a Loan module, whose whole point is an interest charge, is the first
// thing that would have hit it.
// ============================================================
describe("CR062 P0 — liability expense sign", () => {

  const LIABILITY = {
    BaseValue: -500000, BaseValueUSD: -500000,
    MarketValue: -500000, MarketValueUSD: -500000,
    Growth: 0, ExpensePct: 0,
    AccountType: "liability",
    ExpCategory: "Interest Expense",
    Dispose: [],
  };

  test("P0.1 pct_of_value on a negative balance charges, not credits", async () => {
    const { db } = await runModule(
      { ...LIABILITY, expense_amount: 25000, expense_growth_method: "pct_of_value" },
      { PeriodStart: 2026, PeriodEnd: 2028, TaxRate: 0 },
      { inflation: [0, 0, 0] }
    );

    const byYear = {};
    getEntriesForAccount(db, "Interest Expense").forEach((e) => { byYear[e.forecast_year] = e.amount; });

    // 25,000 / 500,000 = 5% of a 500,000 average balance, as CASH OUT.
    expect(byYear[2026]).toBeCloseTo(-25000, 2);
    expect(byYear[2027]).toBeCloseTo(-25000, 2);

    // The expense must also LEAVE the bank line, not arrive on it. This is the
    // assertion the defect actually broke: the expense row alone could be read
    // as a display convention, cash cannot.
    const cash = {};
    getEntriesForAccount(db, "Bank Accounts").forEach((e) => { cash[e.forecast_year] = e.amount; });
    expect(cash[2026]).toBeCloseTo(-25000, 2);
  });

  test("P0.2 inflation mode on a negative balance charges, not credits", async () => {
    const { db } = await runModule(
      { ...LIABILITY, expense_amount: 25000, expense_growth_method: "inflation" },
      { PeriodStart: 2026, PeriodEnd: 2028, TaxRate: 0 },
      { inflation: [2.5, 2.5, 2.5] }
    );

    const byYear = {};
    getEntriesForAccount(db, "Interest Expense").forEach((e) => { byYear[e.forecast_year] = e.amount; });

    expect(byYear[2026]).toBeCloseTo(-25625, 2);        // 25,000 × 1.025
    expect(byYear[2027]).toBeCloseTo(-26265.625, 2);    // 25,000 × 1.025²
  });

  test("P0.3 the asset side is untouched", async () => {
    const { db } = await runModule({
      BaseValue: 500000, BaseValueUSD: 500000,
      MarketValue: 500000, MarketValueUSD: 500000,
      Growth: 0, ExpensePct: 0,
      AccountType: "asset",
      expense_amount: 25000, expense_growth_method: "inflation",
      ExpCategory: "Property Costs",
      Dispose: [],
    }, { PeriodStart: 2026, PeriodEnd: 2028, TaxRate: 0 }, { inflation: [2.5, 2.5, 2.5] });

    const byYear = {};
    getEntriesForAccount(db, "Property Costs").forEach((e) => { byYear[e.forecast_year] = e.amount; });
    expect(byYear[2026]).toBeCloseTo(-25625, 2);
  });

  // RETIRED by CR069 P2 — "P0.4 the zero-MV fallback charges too" asserted the sign of the
  // THIRD branch of the old expense ternary, reached only through the legacy pct path above.
  // The sign question it protected is now structural rather than conditional: a stream's
  // amount is a magnitude and `direction` applies the sign exactly once, so the
  // liability-credited-instead-of-charged defect CR062 P0 fixed cannot be expressed. Asserted
  // directly in fcbuilder-stream.test.js ("an expense on a LIABILITY is still cash OUT").

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
      { ...owned, income_start_date: "2028-07-01" },
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
    // The window moves WHEN the stream runs, never how much. A full year inside the window
    // is exactly what an unwindowed module shows that year — no re-basing.
    const gated = await runModule({ ...owned, income_start_date: "2028-07-01" }, { TaxRate: 0 });
    const plain = await runModule({ ...owned }, { TaxRate: 0 });

    const g = byYear(gated.db, "Rental Income");
    const p = byYear(plain.db, "Rental Income");
    expect(g[2029]).toBeCloseTo(p[2029], 6); // full year
    expect(g[2030]).toBeCloseTo(p[2030], 6);
    // ...and the start year itself is a half year (July 1) — see W8.
    expect(g[2028]).toBeCloseTo(p[2028] / 2, 6);
  });

  test("W3 income stops after the window closes", async () => {
    const { db } = await runModule(
      { ...owned, income_end_date: "2028-07-01" },
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
      { ...owned, income_amount: 0, expense_amount: 5000, expense_start_date: "2029-07-01" },
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
      { ...owned, income_start_date: "2028-07-01" },
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
        income_start_date: "2027-07-01",
      },
      { TaxRate: 0 }
    );
    const inc = byYear(db, "Rental Income");

    expect(inc[2027]).toBeUndefined();
    expect(inc[2028]).toBeUndefined();
    expect(inc[2029]).toBeGreaterThan(0); // acquisition year — halved by CR041
    expect(inc[2030]).toBeGreaterThan(inc[2029]);
  });

  test("W8 the first and last year are half years (the July-1 convention)", async () => {
    // The owner picks a YEAR; it is stored as July 1, so the stream runs for half of its
    // first and last year — the same half-year rule the engine already applies to an
    // acquisition year and to a Full disposal's year.
    const windowed = await runModule(
      { ...owned, income_start_date: "2028-07-01", income_end_date: "2030-07-01" },
      { TaxRate: 0 }
    );
    const plain = await runModule({ ...owned }, { TaxRate: 0 });

    const w = byYear(windowed.db, "Rental Income");
    const p = byYear(plain.db, "Rental Income");

    expect(w[2028]).toBeCloseTo(p[2028] / 2, 6); // first year — half
    expect(w[2029]).toBeCloseTo(p[2029], 6);     // full year in between
    expect(w[2030]).toBeCloseTo(p[2030] / 2, 6); // last year — half
  });

  test("W9 a single-year window is halved once, not twice", async () => {
    const windowed = await runModule(
      { ...owned, income_start_date: "2029-07-01", income_end_date: "2029-07-01" },
      { TaxRate: 0 }
    );
    const plain = await runModule({ ...owned }, { TaxRate: 0 });

    const w = byYear(windowed.db, "Rental Income");
    const p = byYear(plain.db, "Rental Income");

    expect(w[2028]).toBeUndefined();
    expect(w[2029]).toBeCloseTo(p[2029] / 2, 6); // half, not a quarter
    expect(w[2030]).toBeUndefined();
  });

  test("W10 the acquisition year is not halved twice when the window opens in it", async () => {
    // CR041 halves the acquisition year; CR046 halves the window's first year. When they
    // are the same year, halving both would leave 25% of a year's rent.
    const both = await runModule(
      {
        ...owned,
        BaseValue: 0, BaseValueUSD: 0, MarketValue: 0, MarketValueUSD: 0,
        Invest: [{ Date: "2029-06-01", Amount: 150000, Flag: "OneTime" }],
        income_start_date: "2029-07-01", // same year as the purchase
      },
      { TaxRate: 0 }
    );
    const ownershipOnly = await runModule(
      {
        ...owned,
        BaseValue: 0, BaseValueUSD: 0, MarketValue: 0, MarketValueUSD: 0,
        Invest: [{ Date: "2029-06-01", Amount: 150000, Flag: "OneTime" }],
      },
      { TaxRate: 0 }
    );

    const b = byYear(both.db, "Rental Income");
    const o = byYear(ownershipOnly.db, "Rental Income");

    // Already halved once by the window ⇒ CR041 must not halve it again.
    expect(b[2029]).toBeCloseTo(o[2029], 6);
    expect(b[2030]).toBeCloseTo(o[2030], 6);
  });
});

describe("CR047 — Income-only tax rate override", () => {
  // United Beverages: the dividend arrives already taxed in Poland, so the only
  // incremental US tax on the INCOME is ~3%. But a future sale of the business is still a
  // normal capital gain at the scenario rate. `tax_rate_override` alone could not say
  // that — it moves both.
  const ub = {
    BaseValue: 100000, BaseValueUSD: 100000,
    MarketValue: 200000, MarketValueUSD: 200000, // 100k embedded gain
    Growth: 0, ExpensePct: 0,
    IncomePct: [], Invest: [],
    IncomeCategory: "UB Income",
    ExpCategory: "Prop Costs",
    expense_amount: 0,
    income_amount: 10000,
  };

  const taxByYear = (db) => {
    const out = {};
    for (const e of getEntriesForAccount(db, "Taxes")) out[e.forecast_year] = e.amount;
    return out;
  };

  test("X1 income is taxed at the income rate while gains keep the scenario rate", async () => {
    const dispose = [{ Date: "2028-06-01", Amount: 200000, Flag: "OneTime" }];

    // Baseline: the same module with NO income at all — so its tax is PURELY the capital
    // gain on the 2028 disposal. That isolates the number the override must not move.
    const gainsOnly = await runModule(
      { ...ub, income_amount: 0, Dispose: dispose },
      { TaxRate: 25 }
    );
    const split = await runModule(
      { ...ub, Dispose: dispose, income_tax_rate_override: 3 },
      { TaxRate: 25 }
    );
    const plain = await runModule({ ...ub, Dispose: dispose }, { TaxRate: 25 });

    const g = taxByYear(gainsOnly.db);
    const x = taxByYear(split.db);
    const p = taxByYear(plain.db);

    // The 3% override must cut the income tax to 3/25 of what the scenario rate charged.
    expect(x[2027]).toBeCloseTo(p[2027] * (3 / 25), 6);
    expect(x[2027]).toBeGreaterThan(p[2027]); // both negative — the split pays less

    // ...and the capital-gains tax is untouched: the disposal-year charge, once the
    // income component is stripped out, is exactly the gains-only module's charge.
    const incomeTaxIn2029 = x[2029] - g[2029];
    const plainIncomeTaxIn2029 = p[2029] - g[2029];
    expect(incomeTaxIn2029).toBeCloseTo(plainIncomeTaxIn2029 * (3 / 25), 6);
    expect(g[2029]).toBeLessThan(0); // the gain really was taxed — the test is not vacuous
  });

  test("X2 a 0% income override is a real rate, not 'unset'", async () => {
    const { db } = await runModule({ ...ub, income_tax_rate_override: 0 }, { TaxRate: 25 });
    const tax = taxByYear(db);
    // No disposal, no gain — and income is now untaxed, so there is no tax at all.
    expect(Object.keys(tax)).toHaveLength(0);
  });

  test("X3 it falls back to tax_rate_override, then to the scenario rate", async () => {
    // income override NULL + module override 10 ⇒ income taxed at 10 (today's behavior).
    const moduleOverride = await runModule({ ...ub, tax_rate_override: 10 }, { TaxRate: 25 });
    const explicit = await runModule({ ...ub, income_tax_rate_override: 10 }, { TaxRate: 25 });
    expect(taxByYear(moduleOverride.db)).toEqual(taxByYear(explicit.db));

    // both NULL ⇒ the scenario rate.
    const scenarioRate = await runModule({ ...ub }, { TaxRate: 25 });
    const asScenario = await runModule({ ...ub, income_tax_rate_override: 25 }, { TaxRate: 25 });
    expect(taxByYear(scenarioRate.db)).toEqual(taxByYear(asScenario.db));
  });

  test("X4 no override ⇒ byte-identical to before (every existing module)", async () => {
    const before = await runModule({ ...ub, tax_rate_override: 12 }, { TaxRate: 25 });
    const after = await runModule(
      { ...ub, tax_rate_override: 12, income_tax_rate_override: null },
      { TaxRate: 25 }
    );
    expect(after.db.insertedEntries).toEqual(before.db.insertedEntries);
  });


});

describe("CR046 W11 — base-year window and the base-year income tax", () => {
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

  test("W11 a window opening in the base year halves the base-year INCOME TAX too", async () => {
    // The base-year income tax is deferred into Period 1 and used to be computed from the
    // raw income_amount — so a stream starting in the base year booked half a year of income
    // and paid tax on a full one. Wrong under any convention.
    const halfBaseYear = await runModule(
      { ...owned, income_start_date: "2025-07-01" }, // 2025 IS the base year here
      { TaxRate: 25 }
    );
    const fullBaseYear = await runModule({ ...owned }, { TaxRate: 25 }); // blank ⇒ full

    const h = byYear(halfBaseYear.db, "Taxes");
    const f = byYear(fullBaseYear.db, "Taxes");

    // Period 1 (2026) carries the deferred base-year income tax and nothing else here.
    expect(h[2026]).toBeCloseTo(f[2026] / 2, 6);
    expect(f[2026]).toBeLessThan(0); // not vacuous — the base year really was taxed
  });
});

/**
 * CR072 §8 — the budget year grows too.
 *
 * A valuation module's axis starts at its `base_date`, which on 90 of prod's 110 modules is two
 * years before PeriodStart (2025-12-31 against a 2027 start). Growth used to be gated on
 * `idx = year − periodStart >= 0`, so every year in that gap got ZERO growth: the asset sat flat
 * through the budget year and then grew once. There is no budget for a balance-sheet item to fill
 * that gap with, so the only honest value for it is a projected one.
 *
 * Nothing in the 811-test suite covered this, which is why it survived. These pin it.
 */
describe("CR072 §8 — years between base_date and PeriodStart", () => {
  const GAP = { PeriodStart: 2028, PeriodEnd: 2032, TaxRate: 25 };

  test("the budget year grows instead of sitting flat", async () => {
    // base_date 2026-12-31, PeriodStart 2028 — 2027 is the gap year.
    const { db } = await runModule(
      { BaseDate: "2026-12-31", MarketValue: 1000, BaseValue: 1000,
        MarketValueUSD: 1000, BaseValueUSD: 1000, Growth: 1, Matched: true },
      GAP
    );
    const rows = getEntriesForAccount(db, "Test Account");
    const byYear = Object.fromEntries(rows.map((r) => [r.forecast_year, Number(r.amount)]));

    // Entries begin at PeriodStart − 1, so 2027 is both the first emitted year and the GAP year.
    // It used to sit at exactly the base value; it now carries one period of growth.
    // (That the base year itself does not grow is pinned by the next test, where base = PS − 1
    // and is therefore emitted.)
    expect(byYear[2027]).toBeGreaterThan(1000);
    // ...and the horizon compounds on from the grown figure, not from the base value.
    expect(byYear[2028]).toBeGreaterThan(byYear[2027]);
  });

  test("a module based at PeriodStart − 1 is unaffected — there is no gap to fill", async () => {
    const { db } = await runModule(
      { BaseDate: "2027-12-31", MarketValue: 1000, BaseValue: 1000,
        MarketValueUSD: 1000, BaseValueUSD: 1000, Growth: 1, Matched: true },
      GAP
    );
    const rows = getEntriesForAccount(db, "Test Account");
    const byYear = Object.fromEntries(rows.map((r) => [r.forecast_year, Number(r.amount)]));
    expect(byYear[2027]).toBeCloseTo(1000, 2);   // base year, observed
  });

  test("zero growth stays zero — the fix must not invent a rate", async () => {
    const { db } = await runModule(
      { BaseDate: "2026-12-31", MarketValue: 1000, BaseValue: 1000,
        MarketValueUSD: 1000, BaseValueUSD: 1000, Growth: 0, Matched: true },
      GAP
    );
    const rows = getEntriesForAccount(db, "Test Account");
    const byYear = Object.fromEntries(rows.map((r) => [r.forecast_year, Number(r.amount)]));
    expect(byYear[2027]).toBeCloseTo(1000, 2);
    expect(byYear[2028]).toBeCloseTo(1000, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// CR076 D4 — the base year's income tax is charged on the BUDGET, not the typed amount.
//
// CR075 made year −1 the budget, but this block went on taxing `stream.amount`. On prod
// `UB Income` carried 500,000 PLN typed (128,205 USD at 3.9) against a 2026 budget of
// 192,266 USD, so the income and the tax on it came from different sources — the exact
// divergence CR075 §1 named and only half closed. 14,734 of tax at 23%.
//
// The budget is USD (`base_amount`), so this tax is accumulated in USD rather than
// converted out of local currency.
// ─────────────────────────────────────────────────────────────────────────────────────
describe("CR076 D4 — base-year income tax follows the budget", () => {
  const incomeModule = {
    BaseValue: 1000, BaseValueUSD: 1000,
    MarketValue: 1000, MarketValueUSD: 1000,
    Growth: 0, ExpensePct: 0,
    income_amount: 100,                       // the TYPED figure
    IncomeCategory: "Test Income",
  };
  const taxOf = (db) => {
    const byYear = {};
    getEntriesForAccount(db, "Taxes").forEach((e) => { byYear[e.forecast_year] = e.amount; });
    return byYear;
  };

  test("with a budget on the line, the budget figure is taxed — not the typed amount", async () => {
    const { db } = await runModule(incomeModule, {
      TaxRate: 25,
      BaseYearBudgetByLine: { "Test Income": 400 },   // 4× the typed 100
      BaseYearIncomeClaimants: { "Test Income": 1 },
    }, { inflation: [0, 0, 0, 0, 0] });

    // Base-year tax is deferred to PeriodStart: 25% of the BUDGET's 400, not of 100.
    expect(taxOf(db)[2026]).toBeCloseTo(-100, 2);
  });

  test("with NO budget on the line, it falls back to the typed amount", async () => {
    // R9 already reports a module implying base-year money the budget does not carry, so the
    // gap stays visible rather than becoming silently untaxed.
    const { db } = await runModule(incomeModule, {
      TaxRate: 25,
      BaseYearBudgetByLine: { "Some Other Line": 999 },
      BaseYearIncomeClaimants: {},
    }, { inflation: [0, 0, 0, 0, 0] });

    expect(taxOf(db)[2026]).toBeCloseTo(-25, 2);     // 25% of the typed 100
  });

  test("a line claimed by two income streams is split, not counted twice", async () => {
    // The budget is per LINE and this tax is per STREAM. Both live claimants are exclusive
    // today, so this is a guard against a future shared line rather than a live case.
    const { db } = await runModule(incomeModule, {
      TaxRate: 25,
      BaseYearBudgetByLine: { "Test Income": 400 },
      BaseYearIncomeClaimants: { "Test Income": 2 },
    }, { inflation: [0, 0, 0, 0, 0] });

    expect(taxOf(db)[2026]).toBeCloseTo(-50, 2);     // 25% of 400/2
  });

  test("the stream's own tax override still wins over the scenario rate", async () => {
    // D4 changes the BASE the tax is charged on, never which rate applies.
    const { db } = await runModule(
      { ...incomeModule, income_tax_rate_override: 10 },
      {
        TaxRate: 25,
        BaseYearBudgetByLine: { "Test Income": 400 },
        BaseYearIncomeClaimants: { "Test Income": 1 },
      },
      { inflation: [0, 0, 0, 0, 0] }
    );

    expect(taxOf(db)[2026]).toBeCloseTo(-40, 2);     // 10% of 400
  });
});
