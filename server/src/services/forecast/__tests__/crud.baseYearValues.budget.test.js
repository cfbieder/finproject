'use strict';
/**
 * CR075 — the base year IS THE BUDGET.
 *
 * Owner, 2026-08-07: *"forecast year −2 = ACTUAL, forecast year −1 = BUDGET, forecast year 0 =
 * start forecast."* `getBaseYearValues` used to derive year −1 from the modules' STREAMS instead,
 * summing each stream's typed `amount`, and it was never the budget:
 *
 *   - a YIELD stream's amount is 0 by construction (the card hides the box; the yield is a rate),
 *     so `CVC Dividend`, `Dividend Income` and `Interest Income` — 129,000 of budgeted investment
 *     income over 3.3M of market value — contributed nothing;
 *   - an AMOUNT stream's typed figure is not a budget either: `UB Income` carried 128,205 against
 *     a budget of 192,266.
 *
 * Income was understated by 193,071 and the net by 152,802, and `index.js` folds that into the
 * cash sweep's OPENING CASH, which the sweep pins to its band every year — so the error rode all
 * 36 forecast years. Owner-found by reading the Review's 2026 column against the budget.
 *
 * ── This file REPLACES `crud.baseYearValues.currency.test.js` ────────────────────────────────
 *
 * That file pinned CR064 P8's per-currency conversion: `getBaseYearValues` once summed PLN and
 * EUR amounts as though they were dollars, ~+400,000 of base-year income that did not exist.
 * Those tests are gone because **the conversion is gone** — `budget_entries.base_amount` is
 * already USD, so there is no rate to apply and no `baseYearFxRate` to throw. The bug class is
 * not fixed here, it is structurally unreachable, and the test below that names it is what keeps
 * that true if anyone reintroduces a conversion.
 */

jest.mock('../../../v2/db', () => ({ query: jest.fn() }));
jest.mock('../fcbuilder-setup', () => ({ baseYearFxRate: jest.fn() }));
jest.mock('../../../v2/repositories', () => ({ forecast: {} }));
jest.mock('../../../v2/services/forecastVariants', () => ({ assertNotVariant: jest.fn() }));

const db = require('../../../v2/db');
const { baseYearFxRate } = require('../fcbuilder-setup');
const { getBaseYearValues } = require('../crud');

/** The one query the function now runs, returning {label, amount} straight from the budget. */
const mockBudget = (rows) => {
  db.query.mockReset();
  db.query.mockImplementation((sql) => {
    if (/budget_entries/.test(sql)) return Promise.resolve({ rows });
    return Promise.resolve({ rows: [] });
  });
};

beforeEach(() => {
  baseYearFxRate.mockReset();
});

describe('CR075 — getBaseYearValues reads the budget', () => {
  test('each FC line carries its budget total, signed as the budget stores it', async () => {
    mockBudget([
      { label: 'Interest Income', amount: '46000.00' },
      { label: 'UB Income', amount: '192265.63' },
      { label: 'Living Expenses', amount: '-136805.00' },
    ]);
    const v = await getBaseYearValues(1, 2026);
    expect(v).toEqual({
      'Interest Income': 46000,
      'UB Income': 192265.63,
      'Living Expenses': -136805,
    });
  });

  test('a YIELD-driven line appears — the defect that started this', async () => {
    // Under the stream-derived version these three were 0, because a yield stream's typed
    // amount is 0 by construction. They are ordinary budget rows here; nothing special is
    // needed to make them work, which is the point of changing the source rather than adding
    // a fourth branch to the old query.
    mockBudget([
      { label: 'CVC Dividend', amount: '41000.00' },
      { label: 'Dividend Income', amount: '42000.04' },
      { label: 'Interest Income', amount: '45999.76' },
    ]);
    const v = await getBaseYearValues(1, 2026);
    expect(Object.values(v).reduce((a, b) => a + b, 0)).toBeCloseTo(128999.8, 2);
  });

  test('NO currency conversion happens — base_amount is already USD (the CR064 P8 class)', async () => {
    // The predecessor summed each module's amount in ITS OWN currency into a figure read as
    // USD: 500,000 PLN of UB income counted as $500,000, ~+400,000 that did not exist, folded
    // into the sweep's opening cash for the whole horizon. `base_amount` is the USD column, so
    // there is nothing left to convert. If this assertion ever fails, a conversion has been
    // reintroduced and that bug is reachable again.
    mockBudget([{ label: 'UB Income', amount: '192265.63' }]);
    const v = await getBaseYearValues(1, 2026);
    expect(v['UB Income']).toBeCloseTo(192265.63, 2);
    expect(baseYearFxRate).not.toHaveBeenCalled();
  });

  test('a zero line is dropped, so an unbudgeted line is ABSENT rather than a zero row', async () => {
    mockBudget([
      { label: 'Rental Income', amount: '0' },
      { label: 'Travel', amount: '-91805.00' },
    ]);
    const v = await getBaseYearValues(1, 2026);
    expect('Rental Income' in v).toBe(false);
    expect(v.Travel).toBe(-91805);
  });

  test('no base year ⇒ NOTHING, rather than a guess', async () => {
    // The caller could not resolve PeriodStart. There is no budget year to read, and the old
    // code's fallback silently summed with no window filter and labelled the result one year.
    mockBudget([{ label: 'Travel', amount: '-91805.00' }]);
    const v = await getBaseYearValues(1, null);
    expect(v).toEqual({});
    expect(db.query).not.toHaveBeenCalled();
  });

  test('the budget year is the parameter, not a constant', async () => {
    mockBudget([{ label: 'Travel', amount: '-1.00' }]);
    await getBaseYearValues(1, 2029);
    expect(db.query.mock.calls[0][1]).toEqual([2029]);
  });

  test('two rows on one label sum, so several leaves under a line roll up', async () => {
    mockBudget([
      { label: 'Property Costs', amount: '-40000.00' },
      { label: 'Property Costs', amount: '-24690.00' },
    ]);
    const v = await getBaseYearValues(1, 2026);
    expect(v['Property Costs']).toBeCloseTo(-64690, 2);
  });
});
