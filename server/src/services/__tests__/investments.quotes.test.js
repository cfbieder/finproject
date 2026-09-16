'use strict';
/**
 * investments.quotes.test.js — CR090 P2. The overlay arithmetic.
 *
 * Every test here guards a figure that would otherwise be confidently wrong on
 * a page about $3.8M:
 *   - the custodian balance stays the account total, and the overlay is stated
 *     as a DIFFERENCE, so the $33K of unreported option contracts survives it;
 *   - freshness is the STALEST quote, never the newest;
 *   - an account with nothing quotable reports zero positions and null figures,
 *     so the page can grey the panel rather than render a Δ of 0.00 — which
 *     reads as "the market didn't move".
 */

const { summariseQuotes, summariseCashShare } = require('../investments');

const pos = (over = {}) => ({
  quantity: '10',
  market_value: '1000',
  price: '100',
  price_basis: 'per_share',
  price_source: 'custodian',
  quote_price: null,
  quote_at: null,
  ...over,
});

const quoted = (price, at, over = {}) =>
  pos({ quote_price: String(price), quote_at: at, ...over });

describe('summariseQuotes', () => {
  test('a quoted position moves the total by its own difference only', () => {
    // 10 × 104.50 = 1,045 against a custodian 1,000.
    const r = summariseQuotes([quoted(104.5, '2026-09-15T19:59:59Z')], { custodianBalance: '1000' });
    expect(r.quoted_positions).toBe(1);
    expect(r.quoted_at_custodian).toBe('1000.00');
    expect(r.quoted_live).toBe('1045.00');
    expect(r.delta).toBe('45.00');
    expect(r.live_adjusted_total).toBe('1045.00');
  });

  test('🔴 the residual survives the overlay — the account total is not rebuilt from rows', () => {
    // Fidelity Options' shape: positions sum to less than the custodian balance
    // because option contracts are never reported. live_adjusted must be
    // balance + delta, NOT the sum of the priced rows.
    const r = summariseQuotes([quoted(110, '2026-09-15T19:59:59Z')], { custodianBalance: '34081' });
    expect(r.delta).toBe('100.00');          // 10 × 110 − 1,000
    expect(r.live_adjusted_total).toBe('34181.00');  // 33,081 residual intact
  });

  test('🔴 freshness is the STALEST quote on the account, not the newest', () => {
    const r = summariseQuotes([
      quoted(101, '2026-09-15T19:59:59Z'),
      quoted(102, '2026-09-15T14:02:00Z'),
    ], { custodianBalance: '2000' });
    expect(r.oldest_quote_at).toBe('2026-09-15T14:02:00Z');
  });

  test('coverage is a share of VALUE, and the unquoted rest keeps its custodian price', () => {
    const r = summariseQuotes([
      quoted(110, '2026-09-15T19:59:59Z'),                    // 1,000 custodian
      pos({ market_value: '3000', price_basis: 'per_100_face' }), // a bond, never quoted
    ], { custodianBalance: '4000' });
    expect(r.coverage).toBeCloseTo(0.25);
    expect(r.delta).toBe('100.00');            // only the quoted row contributes
    expect(r.live_adjusted_total).toBe('4100.00');
  });

  test('🔴 nothing quotable gives null figures, never a zero delta', () => {
    const r = summariseQuotes([
      pos({ market_value: '5000', price_basis: 'par' }),
      pos({ market_value: '3000', price_basis: 'per_100_face' }),
    ], { custodianBalance: '8000' });
    expect(r.quoted_positions).toBe(0);
    expect(r.delta).toBeNull();
    expect(r.live_adjusted_total).toBeNull();
    expect(r.coverage).toBe(0);
  });

  test('🔴 a quote on a non per-share row is ignored by the arithmetic too', () => {
    // The SQL gates on per_share, and so does this: a bond's 99.89 multiplied
    // by 100,000 of face is the $25M shape CR061 §5 exists for.
    const r = summariseQuotes([
      quoted(99.89, '2026-09-15T19:59:59Z', { price_basis: 'per_100_face', quantity: '100000', market_value: '99890' }),
    ], { custodianBalance: '99890' });
    expect(r.quoted_positions).toBe(0);
    expect(r.live_adjusted_total).toBeNull();
  });

  test('a zero or unusable quote price is not treated as a price', () => {
    const r = summariseQuotes([quoted(0, '2026-09-15T19:59:59Z')], { custodianBalance: '1000' });
    expect(r.quoted_positions).toBe(0);
  });

  test('with no custodian balance (a back-dated snapshot) the delta still stands alone', () => {
    const r = summariseQuotes([quoted(104.5, '2026-09-15T19:59:59Z')], { custodianBalance: null });
    expect(r.delta).toBe('45.00');
    expect(r.live_adjusted_total).toBeNull();
  });
});

describe('summariseCashShare', () => {
  test('counts money market by its class', () => {
    const r = summariseCashShare([
      pos({ market_value: '1000', asset_class: 'equity' }),
      pos({ market_value: '1000', asset_class: 'mmf', price_basis: 'par' }),
    ]);
    expect(r.cash_share).toBeCloseTo(0.5);
    expect(r.cash_value).toBe('1000.00');
  });

  test('🔴 a par-held instrument counts even when its class is unknown', () => {
    // CR061 §6.4 resolves a par-priced instrument to `unknown` deliberately —
    // we can see HOW it is priced without knowing WHAT it is, and $86,309 of
    // live positions sit there. Reading the class alone would report the
    // cash-management account as holding no cash.
    const r = summariseCashShare([pos({ market_value: '5000', asset_class: 'unknown', price_basis: 'par' })]);
    expect(r.cash_share).toBe(1);
  });

  test('an empty account is zero, not a division by zero', () => {
    expect(summariseCashShare([])).toEqual({ cash_value: '0.00', cash_share: 0 });
  });
});
