'use strict';
/**
 * CR064 P8 — the base year is summed in USD, not in whatever currency each module uses.
 *
 * `getBaseYearValues` summed `income_amount` / `expense_amount` raw, in each module's own
 * currency, into a figure every consumer reads as USD. Measured on prod 2026-08-02,
 * `2026 Base` reported 500,000 of UB income and 55,000 of Barkeria income — both PLN — as
 * dollars: about **+400,000 USD** of base-year income that does not exist.
 *
 * It was never only a display defect. `index.js` folds this base-year net cash flow into
 * the CASH SWEEP's opening cash, so the sweep opened that much richer and stayed there for
 * the whole horizon — the CR049 §1 failure mode, in the very function CR049 created so the
 * base year would have one source.
 *
 * The DB and the FX helper are mocked: what is under test is the conversion, not SQL.
 */

jest.mock('../../../v2/db', () => ({ query: jest.fn() }));
jest.mock('../fcbuilder-setup', () => ({ baseYearFxRate: jest.fn() }));
jest.mock('../../../v2/repositories', () => ({ forecast: {} }));
jest.mock('../../../v2/services/forecastVariants', () => ({ assertNotVariant: jest.fn() }));

const db = require('../../../v2/db');
const { baseYearFxRate } = require('../fcbuilder-setup');
const { getBaseYearValues } = require('../crud');

/** Route the three queries getBaseYearValues runs, in order. */
function mockQueries({ modules = [], incexp = [], scenarioName = '2026 Base' }) {
  db.query.mockImplementation((sql) => {
    if (/FROM forecast_modules/.test(sql)) return Promise.resolve({ rows: modules });
    if (/FROM forecast_income_expense/.test(sql)) return Promise.resolve({ rows: incexp });
    if (/FROM forecast_scenarios/.test(sql)) return Promise.resolve({ rows: [{ name: scenarioName }] });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  baseYearFxRate.mockImplementation(async (_scenario, ccy) => {
    const rates = { PLN: 3.9, EUR: 0.86 };
    if (rates[ccy]) return rates[ccy];
    throw new Error(`No valid base-year FX rate for ${ccy}`);
  });
});

test('a PLN income is converted, not counted as dollars', async () => {
  // United Beverages as prod holds it today.
  mockQueries({ modules: [{ label: 'UB Income', type: 'income', currency: 'PLN', amount: '500000' }] });
  const values = await getBaseYearValues(47, 2026);
  expect(values['UB Income']).toBeCloseTo(500000 / 3.9, 2);   // 128,205 — not 500,000
  expect(values['UB Income']).not.toBeCloseTo(500000, 0);
});

test('a EUR income is converted at its own rate', async () => {
  mockQueries({ modules: [{ label: 'Dividend Income', type: 'income', currency: 'EUR', amount: '2000' }] });
  const values = await getBaseYearValues(47, 2026);
  expect(values['Dividend Income']).toBeCloseTo(2000 / 0.86, 2); // 2,326 — MORE than typed
});

test('a USD module is untouched — the common case must not move', async () => {
  mockQueries({ modules: [{ label: 'Interest Income', type: 'income', currency: 'USD', amount: '46000' }] });
  const values = await getBaseYearValues(47, 2026);
  expect(values['Interest Income']).toBe(46000);
});

test('modules on ONE line in DIFFERENT currencies each convert at their own rate', async () => {
  // The four properties share one expense line: adding 20,000 PLN to 10,000 EUR as
  // digits — the old behaviour — is 30,000 of nothing.
  mockQueries({ modules: [
    { label: 'Property Costs', type: 'expense', currency: 'PLN', amount: '-20000' },
    { label: 'Property Costs', type: 'expense', currency: 'EUR', amount: '-10000' },
  ] });
  const values = await getBaseYearValues(47, 2026);
  expect(values['Property Costs']).toBeCloseTo(-20000 / 3.9 + -10000 / 0.86, 2);
  expect(Math.round(values['Property Costs'])).not.toBe(-30000);
});

test('a missing currency defaults to USD rather than throwing', async () => {
  mockQueries({ modules: [{ label: 'Other', type: 'income', currency: null, amount: '1000' }] });
  await expect(getBaseYearValues(47, 2026)).resolves.toEqual({ Other: 1000 });
});

test('a currency with no rate FAILS LOUD — it must not fall back to unconverted', async () => {
  // Reverting to the raw amount is the defect this test exists to prevent, so the
  // CR051 F1 behaviour is inherited deliberately.
  mockQueries({ modules: [{ label: 'Odd', type: 'income', currency: 'GBP', amount: '1000' }] });
  await expect(getBaseYearValues(47, 2026)).rejects.toThrow(/No valid base-year FX rate for GBP/);
});

test('the rate is resolved once per currency, not once per row', async () => {
  mockQueries({ modules: [
    { label: 'A', type: 'income', currency: 'PLN', amount: '100' },
    { label: 'B', type: 'income', currency: 'PLN', amount: '200' },
    { label: 'C', type: 'income', currency: 'EUR', amount: '300' },
  ] });
  await getBaseYearValues(47, 2026);
  expect(baseYearFxRate).toHaveBeenCalledTimes(2);
});

test('income/expense items contribute their USD twin, not the local amount', async () => {
  mockQueries({ incexp: [{ label: 'Living Expenses', amount: '-127372' }] });
  const values = await getBaseYearValues(47, 2026);
  expect(values['Living Expenses']).toBe(-127372);
});

test('zero rows are dropped, so a line with nothing in it does not appear', async () => {
  mockQueries({ modules: [{ label: 'Empty', type: 'income', currency: 'PLN', amount: '0' }] });
  await expect(getBaseYearValues(47, 2026)).resolves.toEqual({});
});
