/**
 * Test Helpers — Mock factories for forecast engine tests
 *
 * Creates mock objects that match the v1-format interfaces expected by
 * processModule (fcbuilder-module.js) and processModule (fcbuilder-incexp.js)
 * without requiring a database connection.
 */

const dfd = require("danfojs-node");

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
  return {
    id: 1,
    Name: "Test Module",
    Account: "Test Account",
    BaseDate: "2025-12-31",
    BaseValue: 1000,
    BaseValueUSD: 1000,
    MarketValue: 1200,
    MarketValueUSD: 1200,
    Currency: "USD",
    Growth: 5, // growth rate multiplier applied to inflation
    ExpensePct: 0,
    ExpCategory: "Test Expense",
    IncomeCategory: "Test Income",
    IncomePct: [],
    Invest: [],
    Dispose: [],
    Comment: "test",
    Matched: true,
    AccountType: "asset",
    expense_amount: 0,
    ...overrides,
  };
}

/**
 * Creates a mock income/expense module matching v1-format fields
 */
function createMockIncExpModule(overrides = {}) {
  return {
    id: 1,
    Name: "Test IncExp",
    Account: "Test Category",
    BaseValue: -500,
    BaseValueUSD: -500,
    Currency: "USD",
    Growth: 1, // inflation multiplier
    Comment: "test",
    Matched: true,
    Changes: [],
    ...overrides,
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

  return new dfd.DataFrame(data, { index: years });
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
  const matrix = categoryNames.map(() => new Array(columns.length).fill(0));
  const df = new dfd.DataFrame(matrix, { columns, index: categoryNames });
  df.config.setMaxRow(1000);
  return df;
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
