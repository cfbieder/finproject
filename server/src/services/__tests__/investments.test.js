'use strict';
/**
 * investments.test.js — CR090 P1.
 *
 * The pure summaries: unrealized G/L with its coverage bands, and the freshness
 * that decides what the page is allowed to claim. Every one of these guards a
 * number that would otherwise be confidently wrong.
 */

const {
  summariseUnrealized,
  summariseFreshness,
  RESIDUAL_NOISE_FLOOR,
} = require('../investments');

const pos = (over = {}) => ({
  market_value: '1000', cost_basis: '800', price_basis: 'per_share',
  price_source: 'custodian', ...over,
});

describe('summariseUnrealized', () => {
  test('sums the covered positions rather than differencing the totals', () => {
    const r = summariseUnrealized([pos(), pos({ market_value: '500', cost_basis: '400' })]);
    expect(r.unrealized).toBe('300.00');
    expect(r.cost_basis).toBe('1200.00');
    expect(r.covered_positions).toBe(2);
  });

  test('🔴 a position with no basis is EXCLUDED, not counted as zero cost', () => {
    // Counting it as zero cost would report the whole market value as gain.
    // CR058 §12.9 records that exact construction producing a fabricated $1.28M.
    const r = summariseUnrealized([pos(), pos({ market_value: '5000', cost_basis: null })]);
    expect(r.unrealized).toBe('200.00');   // only the covered position
    expect(r.covered_positions).toBe(1);
    // ...and coverage tells the reader the figure describes a minority of value.
    expect(r.coverage).toBeCloseTo(1000 / 6000);
    expect(r.band).toBe('insufficient');
  });

  test('a ZERO basis is "none by nature", not a 100% gain', () => {
    // Money-market and core cash carry market value with no basis. Treating 0 as
    // a real cost would make every dollar of it look like profit, and would
    // divide by zero for the percentage.
    const r = summariseUnrealized([pos({ market_value: '900', cost_basis: '0' })]);
    expect(r.unrealized).toBeNull();
    expect(r.covered_positions).toBe(0);
  });

  test('🔴 a par-held instrument is excluded — its zero gain is structural, not measured', () => {
    // Found by READING THE RENDERED PAGE, not by a test. An account holding only
    // a money-market sweep reported "unrealized $0.00, 100% covered", which
    // claims a measurement nobody made: a fund bought and held at par cannot
    // have a market gain. Excluded, the account correctly reports no basis.
    const r = summariseUnrealized([
      pos({ market_value: '70725.56', cost_basis: '70725.56', price_basis: 'par' }),
    ]);
    expect(r.unrealized).toBeNull();
    expect(r.covered_positions).toBe(0);
    expect(r.coverage).toBe(0);
  });

  test('a par position does not dilute a real account\'s coverage figure', () => {
    const r = summariseUnrealized([
      pos({ market_value: '1000', cost_basis: '800' }),
      pos({ market_value: '1000', cost_basis: '1000', price_basis: 'par' }),
    ]);
    expect(r.unrealized).toBe('200.00');
    // The par half is not "covered" — and coverage says so rather than claiming
    // the whole account was measured.
    expect(r.coverage).toBeCloseTo(0.5);
    expect(r.band).toBe('partial');
  });

  test('coverage is a share of VALUE, not of position count', () => {
    // Nine tiny covered positions and one huge uncovered one is not 90% covered.
    const many = Array.from({ length: 9 }, () => pos({ market_value: '10', cost_basis: '5' }));
    const r = summariseUnrealized([...many, pos({ market_value: '9910', cost_basis: null })]);
    expect(r.covered_positions).toBe(9);
    expect(r.coverage).toBeLessThan(0.01);
    expect(r.band).toBe('insufficient');
  });

  test('the bands mirror CR056 so the owner reads one instrument', () => {
    const band = (coveredMv, uncoveredMv) => summariseUnrealized([
      pos({ market_value: String(coveredMv), cost_basis: '1' }),
      pos({ market_value: String(uncoveredMv), cost_basis: null }),
    ]).band;
    expect(band(95, 5)).toBe('full');           // >= 90%
    expect(band(70, 30)).toBe('partial');       // 50-90%
    expect(band(20, 80)).toBe('insufficient');  // < 50%
  });

  test('an account with nothing covered reports null, never 0.00', () => {
    const r = summariseUnrealized([pos({ cost_basis: null })]);
    expect(r.unrealized).toBeNull();
    expect(r.unrealized_pct).toBeNull();
    // 0.00 would read as "flat"; null reads as "not known", which is the truth.
  });

  test('a loss is reported as a loss', () => {
    const r = summariseUnrealized([pos({ market_value: '700', cost_basis: '1000' })]);
    expect(r.unrealized).toBe('-300.00');
    expect(r.unrealized_pct).toBeCloseTo(-0.3);
  });

  test('the cost + unrealized = market value identity is NOT assumed', () => {
    // An account holding a money-market fund breaks it every day. CR058 §12.9
    // pins a test to that fact precisely so nobody "fixes" it into an assertion.
    const r = summariseUnrealized([pos(), pos({ market_value: '5000', cost_basis: null })]);
    const impliedTotal = Number(r.cost_basis) + Number(r.unrealized);
    expect(impliedTotal).not.toBe(6000);
  });
});

describe('summariseFreshness', () => {
  test('quotable share is weighted by value, not by count', () => {
    const r = summariseFreshness([
      pos({ market_value: '100', price_basis: 'per_share' }),
      pos({ market_value: '900', price_basis: 'per_1_face' }),
    ]);
    expect(r.quotable_share).toBeCloseTo(0.1);
  });

  test('🔴 an account with no quotable position says so as a FACT, not a warning', () => {
    // A bond-and-cash account has no market quote by nature and always will.
    // As a warning it would fire forever and suppress the all-clear — CR074's
    // rule that a rule which cannot NOT fire carries no information.
    const r = summariseFreshness([
      pos({ market_value: '500', price_basis: 'per_1_face' }),
      pos({ market_value: '500', price_basis: 'par' }),
    ]);
    expect(r.unquotable_by_nature).toBe(true);
    expect(r.quotable_share).toBe(0);
  });

  test('a partly quotable account is not "unquotable by nature"', () => {
    const r = summariseFreshness([
      pos({ market_value: '500', price_basis: 'per_share' }),
      pos({ market_value: '500', price_basis: 'per_1_face' }),
    ]);
    expect(r.unquotable_by_nature).toBe(false);
  });

  test('an empty account is not claimed to be unquotable', () => {
    // No positions is not evidence about pricing; it is absence of evidence.
    expect(summariseFreshness([]).unquotable_by_nature).toBe(false);
  });

  test('value is attributed to the price source that produced it', () => {
    const r = summariseFreshness([
      pos({ market_value: '600', price_source: 'custodian' }),
      pos({ market_value: '400', price_source: 'quote' }),
    ]);
    expect(r.value_by_price_source).toEqual({ custodian: '600.00', quote: '400.00' });
  });
});

describe('the residual noise floor', () => {
  test('sits far above the measured tie and far below the real gap', () => {
    // Measured on the live feed once both halves come from one capture: four
    // accounts tie within 0.0139–0.50, and Fidelity Options is ~31,563 short
    // because fintable does not report option contracts.
    expect(RESIDUAL_NOISE_FLOOR).toBeGreaterThan(0.5);
    expect(RESIDUAL_NOISE_FLOOR).toBeLessThan(100);
  });
});
