/**
 * CR064 P6 — income growth and income steps (fcbuilder-module.js).
 *
 * A module's recurring income had exactly two modes, mutually exclusive:
 *
 *   amount mode  (no IncomePct rows)  income_amount compounded at EXACTLY inflation
 *   yield  mode  (any IncomePct row)  avg(market value) × (inflation + spread)
 *
 * The second wins on a single row and discards income_amount entirely. CR003 built
 * IncomePct as a deposit interest rate, which is right for Fidelity Fixed Income and
 * wrong for a business — a company's profit is not a percentage of its own valuation,
 * so there was no way to say "300,000 growing at half of inflation, plus 10,000 more
 * from 2027".
 *
 * These tests pin the two new controls, and — first — that a module with neither is
 * unchanged, because that is what lets migration 053 ship dormant.
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
} = require("./helpers");

beforeEach(() => { jest.spyOn(console, "log").mockImplementation(() => {}); });

/** PeriodStart 2027 (base year 2026) at a flat 2.5%, matching the owner's worked example. */
async function runIncome(moduleOverrides = {}, { inflation = 2.5 } = {}) {
  const scenario = createMockScenario({ PeriodStart: 2027, PeriodEnd: 2033, TaxRate: 0 });
  const years = [];
  for (let y = scenario.PeriodStart; y <= scenario.PeriodEnd; y++) years.push(y);

  const mod = createMockModule({
    BaseDate: `${scenario.PeriodStart - 1}-12-31`,
    IncomeCategory: "Business Income",
    ExpCategory: "Business Expense",
    // A value is required for CR041's ownership gate to treat the module as owned in
    // the base year (MV 0 reads as "not acquired yet" and zeroes the stream). It is held
    // FLAT at Growth 0 so that anything amount-mode income does cannot be coming from it
    // — the yield-mode tests below vary it deliberately.
    BaseValue: 1000000, BaseValueUSD: 1000000,
    MarketValue: 1000000, MarketValueUSD: 1000000, Growth: 0,
    ...moduleOverrides,
  });

  const categories = createMockCategories();
  const assumptions = createMockAssumptions(scenario, {
    inflation: new Array(years.length).fill(inflation),
  });
  const catDF = createMockCategoriesDF(
    [mod.Account, "Bank Accounts", "Transfer - Bank", mod.IncomeCategory, mod.ExpCategory, "Taxes"],
    years
  );
  const db = createMockDb();
  await processModule(mod, scenario, assumptions, catDF, categories, years, db, 1);

  const byYear = {};
  for (const e of getEntriesForAccount(db, "Business Income")) byYear[e.forecast_year] = e.amount;
  return byYear;
}

describe("dormancy — a module with neither control is byte-for-byte unchanged", () => {
  test("income still compounds at exactly inflation", async () => {
    const income = await runIncome({ IncomeAmount: 300000, income_amount: 300000 });
    // 300,000 × 1.025^n — what the engine produced before CR064 existed.
    expect(income[2027]).toBeCloseTo(307500, 2);
    expect(income[2028]).toBeCloseTo(315187.5, 2);
    expect(income[2029]).toBeCloseTo(323067.19, 2);
  });

  test("an explicit multiplier of 1 is identical to leaving it blank", async () => {
    const blank = await runIncome({ income_amount: 300000 });
    const one = await runIncome({ income_amount: 300000, IncomeGrowth: 1 });
    expect(one).toEqual(blank);
  });

  test("an empty step schedule changes nothing", async () => {
    const none = await runIncome({ income_amount: 300000 });
    const empty = await runIncome({ income_amount: 300000, IncomeSteps: [] });
    expect(empty).toEqual(none);
  });
});

describe("income growth multiplier", () => {
  test("0 = flat in nominal terms", async () => {
    const income = await runIncome({ income_amount: 300000, IncomeGrowth: 0 });
    expect(income[2027]).toBeCloseTo(300000, 2);
    expect(income[2031]).toBeCloseTo(300000, 2);
  });

  test("0.5 = half of inflation", async () => {
    const income = await runIncome({ income_amount: 300000, IncomeGrowth: 0.5 });
    expect(income[2027]).toBeCloseTo(300000 * 1.0125, 2);
    expect(income[2028]).toBeCloseTo(300000 * 1.0125 ** 2, 2);
  });

  test("2 = twice inflation", async () => {
    const income = await runIncome({ income_amount: 300000, IncomeGrowth: 2 });
    expect(income[2027]).toBeCloseTo(300000 * 1.05, 2);
    expect(income[2028]).toBeCloseTo(300000 * 1.05 ** 2, 2);
  });

  test("a negative multiplier shrinks the stream — a business in decline", async () => {
    const income = await runIncome({ income_amount: 300000, IncomeGrowth: -1 });
    expect(income[2027]).toBeCloseTo(300000 * 0.975, 2);
    expect(income[2028]).toBeCloseTo(300000 * 0.975 ** 2, 2);
  });
});

describe("income steps", () => {
  // The worked example the owner approved, to the rounding shown in the preview.
  test("a step applies in FULL in its year, on top of the inflated base", async () => {
    const income = await runIncome({
      income_amount: 300000,
      IncomeSteps: [{ Date: "2027-01-01", Amount: 10000 }],
    });
    expect(income[2027]).toBeCloseTo(317500, 0);   // 307,500 + 10,000
  });

  test("and keeps its real value afterwards, rather than eroding", async () => {
    const income = await runIncome({
      income_amount: 300000,
      IncomeSteps: [{ Date: "2027-01-01", Amount: 10000 }],
    });
    expect(income[2028]).toBeCloseTo(325437.5, 0); // 315,187.50 + 10,250
    expect(income[2029]).toBeCloseTo(333573.44, 0); // 323,067.19 + 10,506.25
  });

  test("a step before its year does nothing", async () => {
    const income = await runIncome({
      income_amount: 300000,
      IncomeSteps: [{ Date: "2030-01-01", Amount: 10000 }],
    });
    expect(income[2029]).toBeCloseTo(323067.19, 2); // base only
    expect(income[2030]).toBeCloseTo(331143.87 + 10000, 0); // 300,000 × 1.025⁴ + the step
  });

  test("steps accumulate, and a negative one is a step down", async () => {
    const income = await runIncome({
      income_amount: 300000,
      IncomeSteps: [
        { Date: "2027-01-01", Amount: 10000 },
        { Date: "2029-01-01", Amount: -25000 },
      ],
    });
    // 2029: base 323,067.19 + step1 grown two years 10,506.25 − step2 25,000
    expect(income[2029]).toBeCloseTo(308573.44, 0);
  });

  test("steps track the stream's own growth rate, not inflation separately", async () => {
    // With the multiplier at 0 the stream is flat in nominal terms, so the step is too —
    // one income line cannot have two growth rates and still be explainable.
    const income = await runIncome({
      income_amount: 300000,
      IncomeGrowth: 0,
      IncomeSteps: [{ Date: "2027-01-01", Amount: 10000 }],
    });
    expect(income[2027]).toBeCloseTo(310000, 2);
    expect(income[2031]).toBeCloseTo(310000, 2);
  });

  test("a step alone drives the stream when there is no base amount", async () => {
    // A business that earns nothing today and starts in 2029.
    const income = await runIncome({
      income_amount: 0,
      IncomeSteps: [{ Date: "2029-01-01", Amount: 50000 }],
    });
    expect(income[2028] ?? 0).toBeCloseTo(0, 2);
    expect(income[2029]).toBeCloseTo(50000, 2);
    expect(income[2030]).toBeCloseTo(51250, 2);
  });

  test("a zero-amount step is ignored rather than pinning the stream", async () => {
    const withZero = await runIncome({
      income_amount: 300000,
      IncomeSteps: [{ Date: "2028-01-01", Amount: 0 }],
    });
    const without = await runIncome({ income_amount: 300000 });
    expect(withZero).toEqual(without);
  });
});

describe("yield mode is untouched by either control", () => {
  // The mode the owner is actually in today on all six income modules. Neither the
  // multiplier nor the steps may leak into it: it discards income_amount, so anything
  // attached to the amount has to be discarded with it.
  const YIELD = { IncomePct: [{ Date: "2027-01-01", Value: -0.5 }] };

  test("income stays avg(market value) × (inflation + spread)", async () => {
    const income = await runIncome({
      income_amount: 192266,
      MarketValue: 1000000, MarketValueUSD: 1000000,
      BaseValue: 1000000, BaseValueUSD: 1000000,
      ...YIELD,
    });
    // Flat market value ⇒ avg = 1,000,000; effective yield = 2.5 − 0.5 = 2%.
    expect(income[2027]).toBeCloseTo(20000, 2);
  });

  test("adding a growth multiplier and steps does not change a yield-mode module", async () => {
    const base = {
      income_amount: 192266,
      MarketValue: 1000000, MarketValueUSD: 1000000,
      BaseValue: 1000000, BaseValueUSD: 1000000,
      ...YIELD,
    };
    const plain = await runIncome(base);
    const decorated = await runIncome({
      ...base,
      IncomeGrowth: 0,
      IncomeSteps: [{ Date: "2027-01-01", Amount: 999999 }],
    });
    expect(decorated).toEqual(plain);
  });
});
