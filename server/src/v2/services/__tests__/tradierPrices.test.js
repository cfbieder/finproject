'use strict';
/**
 * tradierPrices.test.js — CR093.
 *
 * Pure logic only: symbol candidates and the disagreement report. Every symbol
 * here is real and public (they are ticker conventions, not holdings).
 */

const { symbolCandidates, disagreements, fetchDailyHistory } = require('../tradierPrices');

describe('symbolCandidates — the separator is a SLASH', () => {
  test('🔴 a class share is tried as SLASH first, then dot', () => {
    // Measured 2026-09-05: `BRK.B` and `BRK-B` return no bars and no sector from
    // Tradier; `BRK/B` returns both. The dot is the common convention across
    // market-data APIs, which is exactly why it was asserted before being tested
    // — and the assertion was wrong.
    expect(symbolCandidates('BRKB')).toEqual(['BRKB', 'BRK/B', 'BRK.B']);
  });

  test('an ordinary symbol generates no alternates', () => {
    // Without the class-letter guard, every unquotable fund costs three lookups:
    // FCNTX would be probed as FCNT/X and FCNT.X, which are not symbols.
    expect(symbolCandidates('AAPL')).toEqual(['AAPL']);
    expect(symbolCandidates('FCNTX')).toEqual(['FCNTX']);
    expect(symbolCandidates('SPY')).toEqual(['SPY']);
  });

  test('is case- and whitespace-insensitive, and refuses nothing', () => {
    expect(symbolCandidates('  brkb ')).toEqual(['BRKB', 'BRK/B', 'BRK.B']);
    expect(symbolCandidates('')).toEqual([]);
    expect(symbolCandidates(null)).toEqual([]);
  });
});

describe('disagreements — two feeds, one column', () => {
  const prior = new Map([['2026-07-06', 529.40], ['2026-07-07', 530.00], ['2026-07-08', 9.5140]]);

  test('reports a shared date where the two feeds differ beyond tolerance', () => {
    const d = disagreements(prior, [{ date: '2026-07-06', close: 530.09 }]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ date: '2026-07-06', was: 529.40, now: 530.09 });
    expect(d[0].pct).toBeCloseTo(0.130, 2);
  });

  test('an exact match is not a disagreement', () => {
    expect(disagreements(prior, [{ date: '2026-07-07', close: 530.00 }])).toEqual([]);
  });

  test('🔴 a date only ONE feed has is not a disagreement', () => {
    // Tradier reaches back to 2014 and fintable to 2026-07-06. Treating the
    // decade fintable never had as thousands of disagreements would bury the
    // real ones — which is the point of the report.
    expect(disagreements(prior, [{ date: '2014-04-17', close: 160.11 }])).toEqual([]);
  });

  test('the real spread is far wider than CR089 measured within one provider', () => {
    // CR089 found fintable's own two endpoints 0.65% apart on the same close.
    // Across providers it reaches 1.5% — which is why this is reported before
    // adoption rather than overwritten quietly.
    const d = disagreements(prior, [{ date: '2026-07-08', close: 9.6600 }]);
    expect(Math.abs(d[0].pct)).toBeGreaterThan(1.5);
  });
});

describe('fetchDailyHistory — null is "no bars", not an error', () => {
  const res = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

  test('🔴 Tradier returns history:null for an unknown symbol', async () => {
    // Treating null as an error would make an unquotable instrument
    // indistinguishable from a broken lookup, and quotability is meant to be
    // EARNED by bars actually returning.
    const bars = await fetchDailyHistory('NOPE', { start: 'a', end: 'b', token: 't', fetchImpl: () => res({ history: null }) });
    expect(bars).toEqual([]);
  });

  test('a single bar comes back as an object, not an array', async () => {
    const bars = await fetchDailyHistory('X', {
      start: 'a', end: 'b', token: 't',
      fetchImpl: () => res({ history: { day: { date: '2026-09-04', close: '506.03' } } }),
    });
    expect(bars).toEqual([{ date: '2026-09-04', close: 506.03 }]);
  });

  test('a non-ok response throws rather than returning empty', async () => {
    await expect(fetchDailyHistory('X', {
      start: 'a', end: 'b', token: 't',
      fetchImpl: () => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('bad token') }),
    })).rejects.toThrow(/tradier 401/);
  });
});
