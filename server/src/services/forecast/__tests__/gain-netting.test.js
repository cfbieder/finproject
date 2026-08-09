'use strict';
/**
 * CR076 D6 — a capital LOSS offsets a capital GAIN realized in the same year.
 *
 * `fcbuilder-module` taxes `realizedGainUSD > 0` and drops anything negative, per module, with no
 * netting and no carry-forward. Live in all five prod scenarios in 2026: `SP - Panorama Mar 4`
 * disposes at a gain and is taxed, while `SP - Sea Senses` disposes at a LOSS on the same day and
 * the loss is worth nothing.
 *
 * The netting is a SCENARIO-level pass in `index.js`, because an offset is a fact about two
 * modules at once. These tests pin the bucketing rules it applies — the part with real judgement
 * in it — rather than re-testing the engine around them.
 *
 * The rule under test, restated:
 *   offset(year, rate) = min(Σ gains at that rate, Σ losses at that rate)
 *   credit             = offset × rate, booked the FOLLOWING year, capped at the horizon
 */

/** The netting rule, extracted verbatim in shape from `index.js`'s scenario pass. */
function netGains(moduleGains, { periodEnd, firstYear }) {
  const byYearRate = new Map();
  for (const g of moduleGains) {
    if (!g || !Number.isFinite(g.gainsRatePct) || g.gainsRatePct === 0) continue;
    for (let i = 0; i < g.realizedGainUSD.length; i++) {
      const v = Number(g.realizedGainUSD[i]) || 0;
      if (v === 0) continue;
      const key = `${g.startyear + i}|${g.gainsRatePct}`;
      const bucket = byYearRate.get(key) || { gains: 0, losses: 0 };
      if (v > 0) bucket.gains += v; else bucket.losses += -v;
      byYearRate.set(key, bucket);
    }
  }
  const out = [];
  for (const [key, { gains, losses }] of byYearRate) {
    const offset = Math.min(gains, losses);
    if (!(offset > 0)) continue;
    const [yearStr, rateStr] = key.split('|');
    const payYear = Math.min(Number(yearStr) + 1, periodEnd);
    if (payYear < firstYear) continue;
    out.push({ payYear, rate: Number(rateStr), credit: offset * (Number(rateStr) / 100) });
  }
  return out.sort((a, b) => a.payYear - b.payYear || a.rate - b.rate);
}

const OPTS = { periodEnd: 2062, firstYear: 2027 };
const mod = (startyear, gains, gainsRatePct) => ({ startyear, realizedGainUSD: gains, gainsRatePct });

describe('CR076 D6 — same-year capital-loss netting', () => {
  test('a loss offsets a same-year gain at the same rate, deferred one year', () => {
    // The prod case: Panorama Mar 4 gains, Sea Senses loses, both 2026, both at the scenario rate.
    const out = netGains([mod(2026, [40000], 30), mod(2026, [-21000], 30)], OPTS);
    expect(out).toEqual([{ payYear: 2027, rate: 30, credit: 6300 }]);   // 21,000 × 30%
  });

  test('the offset is capped by the SMALLER side — a loss bigger than the gain is not a refund', () => {
    // Relief cannot exceed the tax actually charged. Without the cap this would invent money.
    const out = netGains([mod(2026, [10000], 30), mod(2026, [-90000], 30)], OPTS);
    expect(out).toEqual([{ payYear: 2027, rate: 30, credit: 3000 }]);   // 10,000, not 90,000
  });

  test('a loss with NO same-year gain relieves nothing', () => {
    // `OCME`'s 2045 loss. Real tax rules would carry it forward; that is a separate decision.
    expect(netGains([mod(2045, [-56000], 30)], OPTS)).toEqual([]);
  });

  test('losses do NOT cross years', () => {
    const out = netGains([mod(2030, [-50000], 30), mod(2031, [50000], 30)], OPTS);
    expect(out).toEqual([]);
  });

  test('rates are bucketed — like relieves like', () => {
    // The one real ambiguity. Netting a gain taxed at 23% against a loss that would have
    // relieved 30% would invent a number, so each rate settles against itself.
    const out = netGains([
      mod(2030, [100000], 23),   // gain at 23
      mod(2030, [-100000], 30),  // loss at 30 — different bucket, no relief either way
    ], OPTS);
    expect(out).toEqual([]);
  });

  test('a 0%-rate module neither pays nor absorbs relief', () => {
    // `US - Nokomis` carries an explicit 0% override. Its gain is untaxed, so a loss must not
    // be consumed against it — that would destroy relief the owner is entitled to elsewhere.
    const out = netGains([
      mod(2030, [500000], 0),     // untaxed gain
      mod(2030, [-40000], 30),    // real loss at 30 — must survive for a 30% gain
      mod(2030, [60000], 30),
    ], OPTS);
    expect(out).toEqual([{ payYear: 2031, rate: 30, credit: 12000 }]);   // 40,000 × 30%
  });

  test('relief in the final year is booked in that year, not past the horizon', () => {
    const out = netGains([mod(2062, [10000], 30), mod(2062, [-10000], 30)], { ...OPTS });
    expect(out).toEqual([{ payYear: 2062, rate: 30, credit: 3000 }]);
  });

  test('several rates in one year each settle independently', () => {
    const out = netGains([
      mod(2030, [80000], 23), mod(2030, [-30000], 23),
      mod(2030, [50000], 30), mod(2030, [-70000], 30),
    ], OPTS);
    expect(out).toEqual([
      { payYear: 2031, rate: 23, credit: 6900 },    // 30,000 × 23%
      { payYear: 2031, rate: 30, credit: 15000 },   // capped at the 50,000 gain
    ]);
  });
});
