'use strict';
/**
 * parseFidelityHoldings.test.js — CR061 P2.
 *
 * ⚠️ Synthetic text only. The statements are real financial data and are
 * gitignored (`Samples/Fidelity/`); the SHAPES here are real, the figures are
 * invented. The corpus check lives in the script itself, which reports how many
 * account-statements reconcile.
 *
 * What these pin is the decision logic, because every defect this parser has had
 * was a silent mis-read rather than a crash: a column shifted by one, a
 * continuation page dropped, a subtotal compared against the wrong month. Each
 * produced a plausible number.
 */

const {
  num,
  parseRows,
} = require('../parse-fidelity-holdings');

describe('num — absence is not zero', () => {
  test('parses both the $-prefixed and bare forms', () => {
    // Fidelity prints `$` only on the first row of a group, so one table
    // contains both and neither may be treated as the anomaly.
    expect(num('$7,146.46', 'x')).toBe(7146.46);
    expect(num('7,146.46', 'x')).toBe(7146.46);
    expect(num('-$1,546.44', 'x')).toBe(-1546.44);
  });

  test('"not applicable" and "-" are NULL, never 0', () => {
    // A money-market sweep has no cost basis. Returning 0 would make its whole
    // market value look like gain — the fabricated-$1.28M construction CR058
    // §12.9 records.
    expect(num('not applicable', 'x')).toBeNull();
    expect(num('-', 'x')).toBeNull();
  });

  test('an unparseable value throws rather than defaulting', () => {
    expect(() => num('about $500', 'ctx')).toThrow(/non-numeric/);
    expect(() => num(null, 'ctx')).toThrow(/missing number/);
  });
});

describe('parseRows — the two column layouts', () => {
  // COMBINED: Description | Quantity | Price | Market Value | Cost | Unrealized
  const combined = 'M ACME GROWTH FUND (AAAX) 100.000 $50.000 $5,000.00 $4,000.00 $1,000.00';
  // SINGLE: adds a BEGINNING market value before Quantity.
  const single = 'ACME GROWTH FUND (AAAX) $4,900.00 100.000 $50.0000 $5,000.00 $4,000.00 $1,000.00';

  test('the combined layout maps quantity/price/value in order', () => {
    const [r] = parseRows(combined, 'Stock Funds', 'test', 'combined');
    expect(r).toMatchObject({
      symbol: 'AAAX', quantity: 100, price: 50, market_value: 5000,
      cost_basis: 4000, unrealized: 1000,
    });
  });

  test('🔴 the single layout skips the BEGINNING value — reading it shifts every column', () => {
    const [r] = parseRows(single, 'Stock Funds', 'test', 'single');
    // Read as the combined layout, quantity would be 4900 and market value 50 —
    // which is exactly how a $4,496.85 sweep once reported as `1`.
    expect(r.quantity).toBe(100);
    expect(r.price).toBe(50);
    expect(r.market_value).toBe(5000);
  });

  test('the same row read under the WRONG layout produces a plausible lie', () => {
    // Pinned deliberately: this is what the subtotal check exists to catch, and
    // nothing about the result looks malformed.
    const [wrong] = parseRows(single, 'Stock Funds', 'test', 'combined');
    expect(wrong.quantity).toBe(4900);      // the beginning value
    expect(wrong.market_value).toBe(50);    // the price
  });

  test('a CUSIP-identified row in a NON-bond section still parses', () => {
    const row = '949764XN9 100,000.000 $99.890 $99,890.00 $100,000.00 -$110.00';
    const [r] = parseRows(row, 'Other', 'test', 'combined');
    expect(r.symbol).toBe('949764XN9');
    expect(r.market_value).toBe(99890);
  });

  test('🔴 a bond row has an ACCRUED INTEREST column, and its CUSIP comes AFTER', () => {
    // Two differences at once from every other section. Read with the ordinary
    // mapping, the accrued interest (171.87) would be booked as cost basis and
    // the real cost as the gain — every figure after the market value wrong.
    const bond = 'M B FS KKR CAP CORP NOTE 02/01/25 9,451.20 10,000.000 94.5750 9,457.50 '
      + '171.87 9,554.60 -97.10 412.50 4.125 FIXED COUPON MOODYS Baa3 CUSIP: 302635AE7';
    const [r] = parseRows(bond, 'Corporate Bonds', 'test', 'combined');
    expect(r.symbol).toBe('302635AE7');
    expect(r.quantity).toBe(10000);
    expect(r.price).toBe(94.575);
    expect(r.market_value).toBe(9457.50);
    expect(r.cost_basis).toBe(9554.60);      // NOT the accrued interest
    expect(r.unrealized).toBe(-97.10);
  });

  test('accrued interest is not stored anywhere — it is not part of the position', () => {
    const bond = 'M B ACME NOTE 9,451.20 10,000.000 94.5750 9,457.50 171.87 9,554.60 -97.10 '
      + 'CUSIP: 302635AE7';
    const [r] = parseRows(bond, 'Corporate Bonds', 'test', 'combined');
    // Interest earned and not yet paid is not value held, and the statement's
    // own section subtotal excludes it — so carrying it would break the check.
    expect(Object.values(r)).not.toContain(171.87);
  });

  test('the core-account CASH sweep is a position, and is layout-aware', () => {
    const cashCombined = 'CASH 8,930.750 $1.000 $8,930.75 not applicable not applicable - -';
    const [c1] = parseRows(cashCombined, 'Core Account', 'test', 'combined');
    expect(c1.market_value).toBe(8930.75);
    // Omitting it would make every account miss its total by exactly the sweep.
    expect(c1.cost_basis).toBeNull();

    const cashSingle = 'CASH $5,657.24 4,496.850 $1.0000 $4,496.85 not applicable not applicable';
    const [c2] = parseRows(cashSingle, 'Core Account', 'test', 'single');
    expect(c2.market_value).toBe(4496.85);
  });

  test('a money-market fund\'s 7-day-yield clause does not break the row', () => {
    // The clause sits BETWEEN the ticker and the figures; a permissive gap here
    // would let the scan wander into the next row.
    const row = 'FIDELITY GOVERNMENT CASH RESERVES (FDRXX) -- 7-day yield: 0.06% 516.520 $1.000 $516.52 not applicable not applicable';
    const [r] = parseRows(row, 'Core Account', 'test', 'combined');
    expect(r.symbol).toBe('FDRXX');
    expect(r.market_value).toBe(516.52);
  });

  test('subtotal furniture is not mistaken for a position', () => {
    const withTotal = 'M ACME GROWTH FUND (AAAX) 100.000 $50.000 $5,000.00 $4,000.00 $1,000.00 '
      + 'Total Stock Funds (12% of account holdings) $5,000.00 $4,000.00 $1,000.00';
    const rows = parseRows(withTotal, 'Stock Funds', 'test', 'combined');
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('AAAX');
  });
});
