'use strict';
/**
 * tradierDividends.test.js — CR093 §5b. No network, no database: the payload
 * shape and the trailing-twelve-month rule, on invented rows.
 */

const { parseDividends, trailingTwelveMonths } = require('../tradierDividends');

const table = (rows) => ([{ request: 'ZZZ', results: [{ tables: { cash_dividends: rows } }] }]);

describe('parseDividends — the payload is null at three levels', () => {
  test('🔴 a results entry whose table is NULL must not end the search', () => {
    // QQQ and SPY each return two `results`, the FIRST with cash_dividends:null.
    // Reading results[0] reports both as paying nothing.
    const json = [{
      request: 'QQQ',
      results: [
        { type: 'Stock', tables: { cash_dividends: null } },
        { type: 'Stock', tables: { cash_dividends: [{ ex_date: '2026-06-22', cash_amount: 0.81349, dividend_type: 'CD', frequency: 4 }] } },
      ],
    }];
    expect(parseDividends(json)).toHaveLength(1);
  });

  test('an empty or malformed payload yields nothing rather than throwing', () => {
    expect(parseDividends(null)).toEqual([]);
    expect(parseDividends([{ request: 'X', results: null }])).toEqual([]);
    expect(parseDividends(table(null))).toEqual([]);
  });

  test('a zero or negative amount is not a payment', () => {
    expect(parseDividends(table([
      { ex_date: '2026-01-01', cash_amount: 0, dividend_type: 'CD' },
      { ex_date: '2026-02-01', cash_amount: -1, dividend_type: 'CD' },
    ]))).toEqual([]);
  });

  test('🔴 an unknown distribution type is an ERROR, not a silent skip', () => {
    // A sixth type quietly joining the yield is exactly the failure this guards.
    expect(() => parseDividends(table([
      { ex_date: '2026-01-01', cash_amount: 1, dividend_type: 'ZZ' },
    ]))).toThrow(/unknown dividend_type "ZZ"/);
  });
});

describe('trailingTwelveMonths — a capital gain is not a yield', () => {
  const rows = [
    { ex_date: '2026-08-10', cash_amount: 1.69, dividend_type: 'CD' },
    { ex_date: '2026-05-08', cash_amount: 1.69, dividend_type: 'CD' },
    { ex_date: '2026-02-09', cash_amount: 1.68, dividend_type: 'CD' },
    { ex_date: '2025-11-09', cash_amount: 1.68, dividend_type: 'CD' },
    { ex_date: '2025-12-20', cash_amount: 4.00, dividend_type: 'LT' },
    { ex_date: '2025-12-20', cash_amount: 0.50, dividend_type: 'ST' },
    // Outside the window — a year and a day back.
    { ex_date: '2025-08-11', cash_amount: 1.62, dividend_type: 'CD' },
  ];

  test('🔴 only CASH DIVIDENDS count toward the yield', () => {
    // DGRW carries CD, SC, LT and ST at once. Summing them lets one year-end
    // turnover distribution present itself as a permanent income rate — and it
    // would look entirely plausible.
    const t = trailingTwelveMonths(rows, '2026-09-05');
    expect(t.income).toBeCloseTo(6.74, 6);
  });

  test('what was excluded is REPORTED, not dropped — the money is real', () => {
    const t = trailingTwelveMonths(rows, '2026-09-05');
    expect(t.excluded).toBeCloseTo(4.5, 6);
    expect(t.excluded_types).toEqual(['LT', 'ST']);
  });

  test('the window is twelve months back from the as-of date, exclusive', () => {
    const t = trailingTwelveMonths(rows, '2026-09-05');
    expect(t.from).toBe('2025-09-05');
    // The 2025-08-11 payment is outside it and must not be counted.
    expect(t.income).toBeLessThan(6.74 + 1.62);
  });

  test('a future-dated row is not counted before it happens', () => {
    const t = trailingTwelveMonths(
      [{ ex_date: '2027-01-01', cash_amount: 9, dividend_type: 'CD' }], '2026-09-05',
    );
    expect(t.income).toBe(0);
  });

  test('no distributions at all is a measured ZERO, not an absence', () => {
    const t = trailingTwelveMonths([], '2026-09-05');
    expect(t.income).toBe(0);
    expect(t.excluded_types).toEqual([]);
  });
});
