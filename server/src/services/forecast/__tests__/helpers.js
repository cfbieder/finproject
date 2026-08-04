/**
 * Test Helpers — Mock factories for forecast engine tests
 *
 * Creates mock objects that match the v1-format interfaces expected by
 * processModule (fcbuilder-module.js) and processModule (fcbuilder-incexp.js)
 * without requiring a database connection.
 */

const { LabelFrame } = require("../frame");

/**
 * Creates a mock scenario config matching FCAssump format
 */
function createMockScenario(overrides = {}) {
  return {
    Name: "Test_Scenario",
    PeriodStart: 2026,
    PeriodEnd: 2030,
    TaxRate: 25,
    ...overrides,
  };
}

/**
 * Creates a mock BS module matching v1-format fields
 */
function createMockModule(overrides = {}) {
  // CR069 P2 — the builder reads STREAMS. This helper keeps the pre-CR069 inputs
  // (ExpCategory/IncomeCategory + expense_amount/income_amount/IncomePct/LoanRate) and
  // translates them, so every engine test written against the column-pair model goes on
  // asserting the same behaviour through the new path. A test may also pass `Streams`
  // directly to exercise something the old shape could not express.
  const {
    ExpCategory = "Test Expense", IncomeCategory = "Test Income",
    expense_amount = 0, income_amount = 0, IncomePct = [], IncomeSteps = [],
    expense_growth_method, IncomeGrowth, income_tax_rate_override,
    expense_start_date, expense_end_date, income_start_date, income_end_date,
    Streams, ...rest
  } = overrides;

  const mkChanges = (pct, steps, direction) => [
    ...pct.filter((p) => p.Date).map((p) => ({
      change_date: p.Date, amount: p.Value ?? p.Amount ?? 0, flag: 'Spread %',
    })),
    ...steps.filter((st) => st.Date).map((st) => ({
      change_date: st.Date,
      amount: direction === 'expense' ? -(st.Amount ?? 0) : (st.Amount ?? 0),
      flag: 'Fixed $',
    })),
  ];

  const derived = [];
  const isLoan = rest.LoanRate != null;
  if (isLoan || expense_amount !== 0 || ExpCategory) {
    derived.push({
      direction: 'expense',
      mode: isLoan ? 'derived' : (expense_growth_method === 'pct_of_value' ? 'pct_of_value' : 'amount'),
      lineName: ExpCategory, fc_line_id: null,
      amount: Math.abs(expense_amount), amount_usd: null, growth_mult: null,
      start_date: isLoan ? null : (expense_start_date ?? null),
      end_date: isLoan ? null : (expense_end_date ?? null),
      tax_rate_override: null, changes: [],
    });
  }
  if (income_amount !== 0 || IncomePct.length || IncomeSteps.length || IncomeCategory) {
    derived.push({
      direction: 'income',
      mode: IncomePct.length ? 'yield' : 'amount',
      lineName: IncomeCategory, fc_line_id: null,
      amount: Math.abs(income_amount), amount_usd: null,
      growth_mult: IncomeGrowth ?? null,
      start_date: income_start_date ?? null, end_date: income_end_date ?? null,
      tax_rate_override: income_tax_rate_override ?? null,
      changes: mkChanges(IncomePct, IncomeSteps, 'income'),
    });
  }

  return {
    id: 1,
    Name: "Test Module",
    Account: "Test Account",
    HasValuation: true,
    BaseDate: "2025-12-31",
    BaseValue: 1000,
    BaseValueUSD: 1000,
    MarketValue: 1200,
    MarketValueUSD: 1200,
    Currency: "USD",
    Growth: 5, // growth rate multiplier applied to inflation
    Invest: [],
    Dispose: [],
    Comment: "test",
    Matched: true,
    AccountType: "asset",
    // Kept on the object though the builder no longer reads them: the tests use them to name
    // the rows of the category frame they hand in.
    ExpCategory, IncomeCategory,
    Streams: Streams ?? derived,
    ...rest,
  };
}

/**
 * Creates a mock income/expense module matching v1-format fields
 */
function createMockIncExpModule(overrides = {}) {
  // CR069 P2 — an income/expense item IS a module now: has_valuation false, one stream.
  // The helper keeps its old name and its old inputs (BaseValue signed, Growth as an
  // inflation multiplier, Changes in the source flag vocabulary) and translates, so the
  // engine tests written against the item model keep asserting the same behaviour through
  // the new path — which is the point of them.
  const { BaseValue = -500, BaseValueUSD, Growth = 1, Changes = [], Account = "Test Category", ...rest } = overrides;
  const direction = BaseValue >= 0 ? "income" : "expense";
  return {
    id: 1,
    Name: "Test IncExp",
    Account,
    HasValuation: false,
    BaseDate: null,
    BaseValue: 0, BaseValueUSD: 0, MarketValue: 0, MarketValueUSD: 0,
    Currency: "USD",
    Growth: 0,
    Comment: "test",
    Matched: true,
    Invest: [], Dispose: [],
    Streams: [{
      direction,
      mode: "amount",
      lineName: Account,
      fc_line_id: null,
      amount: Math.abs(BaseValue),
      amount_usd: Math.abs(BaseValueUSD ?? BaseValue),
      growth_mult: Growth,
      start_date: null, end_date: null, tax_rate_override: null,
      // Money flags flip into the direction frame; rate flags carry through (migration 057).
      changes: Changes.map((c) => ({
        change_date: c.Date,
        amount: (c.Flag === "Fixed $" || c.Flag === "One-Off $") && direction === "expense"
          ? -c.Amount : c.Amount,
        flag: c.Flag,
      })),
    }],
    ...rest,
  };
}

/**
 * Creates a danfo.js DataFrame for assumptions
 * Columns: Inflation, PLN, EUR  (indexed by years)
 */
function createMockAssumptions(scenario, overrides = {}) {
  const periodStart = scenario.PeriodStart;
  const periodEnd = scenario.PeriodEnd;
  const yearsCount = periodEnd - periodStart + 1;
  const years = [];
  for (let i = 0; i < yearsCount; i++) {
    years.push(periodStart + i);
  }

  const defaultInflation = new Array(yearsCount).fill(2); // 2% default
  const defaultPLN = new Array(yearsCount).fill(4);       // 4 PLN/USD
  const defaultEUR = new Array(yearsCount).fill(0.9);     // 0.9 EUR/USD

  const data = {
    Inflation: overrides.inflation || defaultInflation,
    PLN: overrides.pln || defaultPLN,
    EUR: overrides.eur || defaultEUR,
  };

  return LabelFrame.fromColumns(data, { index: years });
}

/**
 * Creates a categories array matching FCAssump.category format
 */
function createMockCategories() {
  return ["Year", "Inflation", "PLN", "EUR", "Bank Accounts"];
}

/**
 * Creates a zeros DataFrame for categories (matches what index.js builds)
 */
function createMockCategoriesDF(categoryNames, years) {
  const columns = [years[0] - 1, ...years];
  return LabelFrame.zeros(categoryNames, columns);
}

/**
 * Creates a mock db object that captures inserted entries
 */
function createMockDb() {
  const insertedEntries = [];

  return {
    insertedEntries,
    query: (typeof jest !== "undefined" ? jest.fn : (fn) => fn)(async (sql, params) => {
      // Capture INSERT calls
      if (sql.trim().startsWith("INSERT")) {
        // Parse params into entries (6 params per entry)
        for (let i = 0; i < params.length; i += 6) {
          insertedEntries.push({
            scenario_id: params[i],
            forecast_year: params[i + 1],
            amount: params[i + 2],
            account: params[i + 3],
            module: params[i + 4],
            comment: params[i + 5],
          });
        }
        return { rowCount: params.length / 6 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

/**
 * Extracts entries for a specific account from the mock db
 */
function getEntriesForAccount(mockDb, accountName) {
  return mockDb.insertedEntries
    .filter((e) => e.account === accountName)
    .sort((a, b) => a.forecast_year - b.forecast_year);
}

/**
 * Extracts entries for a specific year from the mock db
 */
function getEntriesForYear(mockDb, year) {
  return mockDb.insertedEntries.filter((e) => e.forecast_year === year);
}

module.exports = {
  createMockScenario,
  createMockModule,
  createMockIncExpModule,
  createMockAssumptions,
  createMockCategories,
  createMockCategoriesDF,
  createMockDb,
  getEntriesForAccount,
  getEntriesForYear,
};
