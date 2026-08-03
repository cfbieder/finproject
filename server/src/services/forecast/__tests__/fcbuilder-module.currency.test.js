/**
 * CR064 P13 — a module labelled USD whose two value columns disagree (fcbuilder-module.js).
 *
 * The production defect these pin, in full:
 *
 *   `PLN Credit Cards` linked to account 65 — a PARENT ROLLUP over four PKO cards, which
 *   holds no transactions of its own and was itself labelled USD. The module inherited
 *   that label while its `market_value` was populated in PLN (−24,542.66, within 413 of
 *   the account's own ledger at the module's base date). `market_value_usd` was right:
 *   −6,832.01.
 *
 * The engine consults the FX assumptions only when `Currency !== "USD"`, so the branch
 * never ran, `fxrates` kept its `fill(1)`, and every forecast year posted the PLN figure
 * to a USD balance sheet. The `MarketValueUSD` override lands on index 0 — the base-date
 * year, 2025, which is not even an output column when PeriodStart is 2027 — so the one
 * correct year was invisible and all 36 wrong ones were not. `2026 Base` and
 * `2026 Downside` each carried 18,250 of liability that does not exist.
 *
 * Two things are pinned here, and the second is the one that matters: that a correctly
 * labelled module CONVERTS, and that a mislabelled one now REFUSES rather than quietly
 * posting the local amount.
 */

const { processModule, computeModule } = require("../fcbuilder-module");
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

/**
 * Mirrors the production shape exactly: base date 2025-12-31, PeriodStart 2027, PLN at
 * 3.9. The base date being a year BEFORE the first output column is not incidental — it
 * is what hid the defect, so the fixture keeps it.
 */
function fixture(moduleOverrides = {}) {
  const scenario = createMockScenario({ PeriodStart: 2027, PeriodEnd: 2031, TaxRate: 0 });
  const years = [];
  for (let y = scenario.PeriodStart; y <= scenario.PeriodEnd; y++) years.push(y);

  const mod = createMockModule({
    Name: "PLN Credit Cards",
    Account: "PLN Credit Cards",
    AccountType: "liability",
    BaseDate: "2025-12-31",
    Growth: 0,           // isolate currency: the balance must not move for any other reason
    ExpensePct: 0,
    expense_amount: 0,
    income_amount: 0,
    ...moduleOverrides,
  });

  const categories = createMockCategories();
  const assumptions = createMockAssumptions(scenario, {
    inflation: new Array(years.length).fill(2.5),
    pln: new Array(years.length).fill(3.9),
  });
  const catDF = createMockCategoriesDF(
    [mod.Account, "Bank Accounts", "Transfer - Bank", mod.IncomeCategory, mod.ExpCategory, "Taxes"],
    years
  );

  return { scenario, years, mod, categories, assumptions, catDF };
}

/** The prod row, correctly labelled. */
const PLN_CARDS = {
  Currency: "PLN",
  BaseValue: -24542.66, BaseValueUSD: -6832.01,
  MarketValue: -24542.66, MarketValueUSD: -6832.01,
};

describe("CR064 P13 — module currency integrity", () => {
  it("converts a correctly labelled PLN module at the scenario's FX rate", async () => {
    const { scenario, years, mod, categories, assumptions, catDF } = fixture(PLN_CARDS);
    const db = createMockDb();
    await processModule(mod, scenario, assumptions, catDF, categories, years, db, 1);

    const posted = getEntriesForAccount(db, "PLN Credit Cards");
    // −24,542.66 PLN ÷ 3.9 — the number the balance sheet should have carried all along.
    for (const entry of posted) {
      expect(entry.amount).toBeCloseTo(-6292.99, 2);
    }
    // And emphatically NOT the local amount, which is what shipped.
    for (const entry of posted) {
      expect(Math.abs(entry.amount - -24542.66)).toBeGreaterThan(1000);
    }
  });

  it("refuses the production row as it actually stood — USD label over PLN values", () => {
    const { scenario, years, mod, categories, assumptions, catDF } = fixture({
      ...PLN_CARDS,
      Currency: "USD",   // the single wrong field
    });

    expect(() =>
      computeModule(mod, scenario, assumptions, catDF, categories, years, 1)
    ).toThrow(/marked USD but its local and USD values disagree/);
  });

  it("refuses when only the base values disagree", () => {
    const { scenario, years, mod, categories, assumptions, catDF } = fixture({
      Currency: "USD",
      BaseValue: -24542.66, BaseValueUSD: -6832.01,
      MarketValue: -6832.01, MarketValueUSD: -6832.01,
    });

    expect(() =>
      computeModule(mod, scenario, assumptions, catDF, categories, years, 1)
    ).toThrow(/marked USD but its local and USD values disagree/);
  });

  it("leaves an honest USD module alone — this is what keeps the guard dormant", async () => {
    const { scenario, years, mod, categories, assumptions, catDF } = fixture({
      Currency: "USD",
      BaseValue: -27186.62, BaseValueUSD: -27186.62,
      MarketValue: -27186.62, MarketValueUSD: -27186.62,
    });
    const db = createMockDb();
    await processModule(mod, scenario, assumptions, catDF, categories, years, db, 1);

    const posted = getEntriesForAccount(db, "PLN Credit Cards");
    expect(posted.length).toBeGreaterThan(0);
    for (const entry of posted) {
      expect(entry.amount).toBeCloseTo(-27186.62, 2);
    }
  });

  it("tolerates a rounding-cent gap, so numeric(15,2) drift cannot break generation", () => {
    const { scenario, years, mod, categories, assumptions, catDF } = fixture({
      Currency: "USD",
      BaseValue: -27186.62, BaseValueUSD: -27186.62,
      MarketValue: -27186.62, MarketValueUSD: -27186.61,   // one cent
    });

    expect(() =>
      computeModule(mod, scenario, assumptions, catDF, categories, years, 1)
    ).not.toThrow();
  });
});
