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
  describe: describeRow,
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

describe('describe — the name column the reconciliation gate cannot see', () => {
  // 🔴 This is the one defect class the subtotal check is blind to by
  // construction: it compares SUMS against the statement's printed subtotals, so
  // it validates arithmetic and never reads a description. 13 of 265 securities
  // were stored named after their own page header — Iron Mountain as
  // "st (AI) Sep 30, 2020 Total Cost Basis Un…" — with every figure correct and
  // every section tying. `securities` is written once at first sight, so the bad
  // name was permanent.
  const HEADERS = {
    'combined, no yield columns (2016)':
      'Description Quantity Price Per Unit Total Market Value Total Cost Basis Unrealized Gain/Loss',
    'combined, with yield columns':
      'Description Quantity Price Per Unit Total Market Value Total Cost Basis Unrealized Gain/Loss '
      + 'Est. Annual Income (EAI) Est.Yield (EY)',
    'single, dated column labels':
      'Description Beginning Market Value Jun 1,2016 Quantity Jun 30,2016 Price Per Unit Jun 30,2016 '
      + 'Ending Market Value Jun 30,2016 Total Cost Basis Unrealized Gain/Loss Jun 30,2016 EAI ($) / EY (%)',
    'core account, NO cost or unrealized column at all':
      'Description Beginning Market Value Dec 1, 2020 Quantity Dec 31, 2020 Price Per Unit Dec 31, 2020 '
      + 'Ending Market Value Dec 31, 2020 EAI ($) / EY (%)',
  };

  test.each(Object.entries(HEADERS))('%s is furniture, not a name', (_label, header) => {
    expect(describeRow(`${header} ACME INDL PPTYS INC COM`)).toBe('ACME INDL PPTYS INC COM');
  });

  test('🔴 the page banner survives the header — it precedes it', () => {
    // The first cut scrubbed the column header only, so the banner above it was
    // left and the tail-slice kept exactly that. Owner name included.
    const window = '1, 2016 - March 31, 2016 Account # X00-000000 A N OTHER - INDIVIDUAL '
      + 'Stocks (continued) Description Quantity Price Per Unit Total Market Value Total Cost Basis '
      + 'Unrealized Gain/Loss Common Stock (continued) ACME VANCE TX ADV GLB DIV OP COM';
    expect(describeRow(window)).toBe('ACME VANCE TX ADV GLB DIV OP COM');
  });

  test('a section heading printed before its first row is not part of the name', () => {
    // It prints WITHOUT `(continued)` the first time, so the continuation rule
    // does not cover it, and `Common Stock M MEDTRONIC PLC` was stored.
    expect(describeRow('Unrealized Gain/Loss Common Stock ACME MEDICAL PLC'))
      .toBe('ACME MEDICAL PLC');
    expect(describeRow('Unrealized Gain/Loss Exchange Traded Products E (e.g. ETF, ETN) ACME TECH ETF'))
      .toBe('ACME TECH ETF');
  });

  test('🔴 the PREVIOUS row’s uncaptured EAI/yield columns bleed into the next name', () => {
    // The numeric run captures five figures; EAI and yield trail every row and
    // are deliberately not captured, so they stay in the window the next row
    // inherits. `-$108.15` is a minus THEN a dollar sign — an alternation of
    // "dashes" or "optionally-$-prefixed number" matches neither half.
    expect(describeRow('-$108.15 $105.60 2.930% ACME MOUNTAIN INC COM')).toBe('ACME MOUNTAIN INC COM');
    expect(describeRow('- - ACME BIO INC COM USD0.0005')).toBe('ACME BIO INC COM USD0.0005');
    expect(describeRow('277.06 6.170 ACME EXCH TRD FD')).toBe('ACME EXCH TRD FD');
  });

  test('a subtotal and the figures trailing it are consumed together', () => {
    expect(describeRow('Total Core Account (1% of account holdings) $516.52 - ACME TR STOXX FD'))
      .toBe('ACME TR STOXX FD');
  });

  test('an ordinary mid-table row is returned untouched', () => {
    expect(describeRow('  ACME GROWTH FUND  ')).toBe('ACME GROWTH FUND');
  });

  test('stacked footnote flags are stripped, not just the first', () => {
    // A brokered CD carries `M B` and is CUSIP-identified in an ORDINARY section,
    // so it takes the normal path rather than the bond grammar. Stripping one
    // flag stored it as `B CARROLL CNTY TR CO MO CD …`.
    const [r] = parseRows(
      'M B ACME CNTY TR CO MO CD 5.55000% 10/18/2033 949764XN9 100,000.000 $99.890 '
      + '$99,890.00 $100,000.00 -$110.00',
      'Other', 'test', 'combined',
    );
    expect(r.symbol).toBe('949764XN9');
    expect(r.description).toBe('ACME CNTY TR CO MO CD 5.55000% 10/18/2033');
  });

  test('🔴 the name is the HEAD of the description, not the tail', () => {
    // `slice(-120)` was right only while furniture sat in FRONT of the name.
    // With the furniture cut it truncates the name itself — two CDs were stored
    // starting mid-token, on a leading space.
    const long = `ACME CNTY TR CO MO CD 5.55000% 10/18/2033 ${'X'.repeat(140)}`;
    expect(parseRows(
      `${long} (AAAX) 100.000 $50.000 $5,000.00 $4,000.00 $1,000.00`,
      'Other', 'test', 'combined',
    )[0].description).toMatch(/^ACME CNTY TR CO MO CD/);
  });
});

describe('bond descriptions — the column that read "BOND" 40 times', () => {
  // A bond prints its issuer BEFORE the figures and its coupon, ratings, call
  // schedule and CUSIP AFTER them. `parseBondRows` anchors on the numeric run,
  // so the name was simply never captured — it was the constant 'BOND' for every
  // bond ever parsed. 40 securities, $1,064,132 of the live portfolio, rendering
  // one repeated word. Nothing downstream reads a name, so nothing complained.
  const two = 'M B ACME INTL CAP PTE LTD NOTE 02/05/31 98,600.70 100,000.000 98.6007 98,600.70 '
    + '171.87 99,554.60 -953.90 412.50 4.125 FIXED COUPON MOODYS A3 S&P BBB+ SEMIANNUALLY '
    + 'MAKE WHOLE CUSIP: 449276AD6 '
    + 'ACME HONDA FIN CORP MTN 01/08/31 72,804.00 75,000.000 97.0720 72,804.00 '
    + '96.10 74,010.00 -1,206.00 300.00 4.000 FIXED COUPON MOODYS A1 SEMIANNUALLY CUSIP: 02665WGS4';

  test('each bond takes the issuer printed before ITS OWN figures', () => {
    const rows = parseRows(two, 'Corporate Bonds', 'test', 'combined');
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe('449276AD6');
    expect(rows[0].description).toBe('ACME INTL CAP PTE LTD NOTE 02/05/31');
    expect(rows[1].symbol).toBe('02665WGS4');
    expect(rows[1].description).toBe('ACME HONDA FIN CORP MTN 01/08/31');
  });

  test('🔴 the trailer does not become the NEXT bond’s name', () => {
    // Stopping at the numeric run leaves "412.50 4.125 FIXED COUPON MOODYS A3
    // S&P BBB+ SEMIANNUALLY MAKE WHOLE CUSIP: …" in the window the next row
    // inherits, and every bond then took its predecessor's ratings as its name.
    const [, second] = parseRows(two, 'Corporate Bonds', 'test', 'combined');
    expect(second.description).not.toMatch(/FIXED COUPON|MOODYS|S&P|SEMIANNUALLY|MAKE WHOLE/);
    expect(second.description).not.toMatch(/449276AD6/);
  });

  test('the figures are untouched by the description change', () => {
    const [first] = parseRows(two, 'Corporate Bonds', 'test', 'combined');
    expect(first.quantity).toBe(100000);
    expect(first.price).toBe(98.6007);
    expect(first.market_value).toBe(98600.70);
    expect(first.cost_basis).toBe(99554.60);   // NOT the 171.87 accrued interest
    expect(first.unrealized).toBe(-953.90);
  });

  test('a bond with no readable issuer still parses, falling back to BOND', () => {
    const bare = '9,451.20 10,000.000 94.5750 9,457.50 171.87 9,554.60 -97.10 CUSIP: 302635AE7';
    const [r] = parseRows(bare, 'Corporate Bonds', 'test', 'combined');
    expect(r.symbol).toBe('302635AE7');
    expect(r.description).toBe('BOND');
  });
});
