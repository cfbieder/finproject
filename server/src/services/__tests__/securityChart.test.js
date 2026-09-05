'use strict';
/**
 * securityChart.test.js — CR093 §5.
 *
 * ⚠️ NO DATABASE. EMA, MACD and rebasing are arithmetic, and roadmap issue #26
 * is what happens when a test of arithmetic is written against a builder that
 * reads whatever the portfolio holds: green on a fresh database, red on real
 * data. Every series here is invented.
 */

const {
  ema, macd, rebase, buildSeries, windowStart, PERIODS,
} = require('../securityChart');

describe('ema — the warm-up is null, not a value', () => {
  test('is undefined until the seed period has passed', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    // ⚠️ Not 0 and not the first value. A warm-up point rendered as a real one
    // draws an indicator that starts from a number nobody computed.
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBeCloseTo(2, 10);         // seeded with the SMA of 1,2,3
  });

  test('a series shorter than the period yields nothing at all', () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });

  test('after seeding it is the standard recursion, k = 2/(n+1)', () => {
    const out = ema([1, 2, 3, 4], 3);
    // seed 2 at index 2, then 4×0.5 + 2×0.5 = 3
    expect(out[3]).toBeCloseTo(3, 10);
  });

  test('a flat series has a flat EMA — no drift from the seeding', () => {
    const out = ema(new Array(50).fill(7), 12);
    expect(out[49]).toBeCloseTo(7, 10);
  });
});

describe('macd 12/26/9', () => {
  const rising = Array.from({ length: 120 }, (_, i) => 100 + i);

  test('🔴 emits NOTHING until the slow EMA and then the signal have seeded', () => {
    const out = macd(rising);
    // The MACD line needs 26 bars; the signal needs 9 more ON TOP of it. A chart
    // drawn over a 1M window without a lead-in would be almost entirely this.
    expect(out[24].macd).toBeNull();
    expect(out[25].macd).not.toBeNull();
    expect(out[32].signal).toBeNull();
    expect(out[33].signal).not.toBeNull();
  });

  test('🔴 the signal line is seeded from the first DEFINED macd value', () => {
    // Seeding the signal EMA from index 0 would average nulls-as-zeros into its
    // own seed, dragging the whole line toward zero and shifting every crossover.
    // On a steadily rising series MACD is positive and constant, so the signal
    // must converge to the same constant rather than approach it from 0.
    const out = macd(rising);
    const last = out[out.length - 1];
    expect(last.signal).toBeCloseTo(last.macd, 6);
    expect(last.histogram).toBeCloseTo(0, 6);
  });

  test('a flat series gives macd 0 — a fast and slow EMA of the same number', () => {
    const out = macd(new Array(80).fill(50));
    expect(out[79].macd).toBeCloseTo(0, 10);
    expect(out[79].histogram).toBeCloseTo(0, 10);
  });

  test('a falling series gives a negative macd', () => {
    const out = macd(Array.from({ length: 80 }, (_, i) => 200 - i));
    expect(out[79].macd).toBeLessThan(0);
  });

  test('too short a series yields all nulls rather than throwing', () => {
    const out = macd([1, 2, 3]);
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.macd === null)).toBe(true);
  });
});

describe('rebase — why an overlay is possible at all', () => {
  test('the first point becomes 100 and the rest are relative to it', () => {
    expect(rebase([50, 75, 25])).toEqual([100, 150, 50]);
  });

  test('🔴 a $534 index and a $25 holding become comparable', () => {
    // On one price axis the holding is a flat line along the bottom. Both series
    // start at 100 and it is the SHAPES that compare — the only comparison a
    // level series supports.
    const index = rebase([534, 560.7]);
    const holding = rebase([25, 26.25]);
    expect(index[1]).toBeCloseTo(105, 6);
    expect(holding[1]).toBeCloseTo(105, 6);
  });

  test('an all-null series does not divide by anything', () => {
    expect(rebase([null, null])).toEqual([null, null]);
  });
});

describe('buildSeries — the display window and the lead-in', () => {
  // 200 bars ending 2026-09-04, one per weekday-ish; the dates only need to sort.
  const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 86400e3).toISOString().slice(0, 10);
  const bars = Array.from({ length: 200 }, (_, i) => ({ d: day(i), close: 100 + i * 0.5 }));

  test('🔴 the MACD lead-in is computed and then thrown away', () => {
    // The window opens at bar 150, so the indicator has 150 bars of run-up and
    // every returned point is a real value rather than warm-up.
    const r = buildSeries(bars, bars[150].d, []);
    expect(r.series[0].d).toBe(bars[150].d);
    expect(r.macd_lead_bars).toBe(150);
    expect(r.macd_complete).toBe(true);
    expect(r.macd[0].signal).not.toBeNull();
  });

  test('a window with no run-up says so rather than drawing warm-up as signal', () => {
    const short = bars.slice(0, 40);
    const r = buildSeries(short, short[0].d, []);
    expect(r.macd_lead_bars).toBe(0);
    expect(r.macd_complete).toBe(false);
    expect(r.macd[0].macd).toBeNull();
  });

  test('the subject series is rebased from the FIRST VISIBLE bar, not the lead-in', () => {
    const r = buildSeries(bars, bars[150].d, []);
    expect(r.series[0].rebased).toBeCloseTo(100, 6);
  });

  test('price change is measured across the visible window only', () => {
    const r = buildSeries(bars, bars[150].d, []);
    expect(r.price_change.from_close).toBeCloseTo(bars[150].close, 6);
    expect(r.price_change.to_close).toBeCloseTo(bars[199].close, 6);
    expect(r.price_change.pct).toBeCloseTo(
      (bars[199].close - bars[150].close) / bars[150].close, 10,
    );
  });

  test('🔴 an overlay is rebased over its OWN bars inside the same window', () => {
    // A market holiday one side does not observe would otherwise shift the
    // overlay's base date and tilt the whole comparison.
    const overlay = bars
      .filter((b, i) => i !== 151)                       // a holiday the index took
      .map((b) => ({ d: b.d, close: b.close * 4 }));     // and a 4× price level
    const r = buildSeries(bars, bars[150].d, [{ key: 'SPY', label: 'S&P 500 (SPY)', bars: overlay }]);
    expect(r.overlays[0].series[0].rebased).toBeCloseTo(100, 6);
    // Same shape at 4× the price: the rebased end point matches the subject's.
    expect(r.overlays[0].series.at(-1).rebased)
      .toBeCloseTo(r.series.at(-1).rebased, 6);
  });

  test('a window that contains no bars returns null rather than an empty chart', () => {
    expect(buildSeries(bars, '2099-01-01', [])).toBeNull();
  });
});

describe('windowStart', () => {
  test('subtracts calendar months', () => {
    expect(windowStart('2026-09-04', 12)).toBe('2025-09-04');
    expect(windowStart('2026-09-04', 60)).toBe('2021-09-04');
  });

  test('MAX has no start at all', () => {
    expect(windowStart('2026-09-04', null)).toBeNull();
  });

  test('every offered period is one of the two shapes', () => {
    expect(PERIODS.map((p) => p.key)).toEqual(['1M', '3M', '6M', '1Y', '3Y', '5Y', 'MAX']);
    expect(PERIODS.filter((p) => p.months === null)).toHaveLength(1);
  });
});
