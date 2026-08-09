/**
 * fcRealTerms.js — CR076 §7 Q3: what the plan is worth in TODAY's money.
 *
 * Every figure the forecast produces is NOMINAL, and nothing on any surface says so. At the
 * scenario inflation of 2.5%, 2026 → 2062 is a **2.43× factor** — so Base's headline 4,674,650 is
 * about **1,921,600** of today's purchasing power. For a plan whose whole point is a 2062 number,
 * that gap is the largest distance between what the model computes and what it communicates.
 *
 * It is also what the owner has been deciding all along: `Social Security` at full CPI vs 0.25,
 * `Purchases` at 0.5, `Retirement Home`'s 200,000 dated 2052 — every one of those is a real-terms
 * question answered against a display that could only show nominal.
 *
 * PURE, and deliberately so: this is arithmetic over the assumptions the engine already used, not
 * a second opinion about them. It reads the SAME step-function series `fcbuilder-setup.buildRates`
 * walks — a rate declared for a year carries forward until the next row — because a deflator built
 * from a different reading of the same rows would silently disagree with the numbers it deflates.
 */

/**
 * The inflation rate in effect for `year` in `scenarioName`, as a percent.
 *
 * Mirrors `buildRates`/`rateAtYear` server-side: rows are a step function, and a year before the
 * first row keeps that row's rate (the same backwards-carry the engine applies).
 *
 * Returns null when the scenario declares nothing — the caller must NOT substitute a default.
 * CR076 D7 made a missing inflation rate fail loud in the engine precisely because a silent 0 is
 * indistinguishable from a real one, and a deflator of 1.0 would quietly claim that nominal and
 * real are the same thing.
 */
export function inflationRateFor(inflationRows, scenarioName, year) {
  if (!Array.isArray(inflationRows)) return null;
  const mine = inflationRows
    .filter((r) => r && r.Scenario === scenarioName && Number.isFinite(Number(r.Rate)))
    .sort((a, b) => Number(a.Year) - Number(b.Year));
  if (!mine.length) return null;

  let rate = Number(mine[0].Rate);
  for (const row of mine) {
    if (Number(row.Year) <= Number(year)) rate = Number(row.Rate);
    else break;
  }
  return rate;
}

/**
 * Deflators keyed by year: **divide a nominal figure by its year's deflator** to express it in
 * `baseYear` money.
 *
 * The base year is PeriodStart − 1 — the budget year, which is what the owner means by "today".
 * Its deflator is exactly 1.
 *
 * Years BEFORE the base year get a deflator below 1, which INFLATES them. That is not a special
 * case bolted on: it is the same product read in the other direction, and it is what makes the
 * 2025 actual column comparable with everything to its right. Leaving it at 1 would have the
 * actual sitting in 2025 money on a page claiming to be in 2026 money — a small lie, and exactly
 * the kind this whole exercise exists to remove.
 *
 * Returns null when the scenario has no inflation, so the caller can disable the toggle rather
 * than render a deflator that means nothing.
 *
 * @returns {Map<number, number>|null} year → divisor
 */
export function buildDeflators({ inflationRows, scenarioName, baseYear, years }) {
  // `Number(null)` is 0 and `Number('')` is 0, both of which pass `Number.isFinite` — so a
  // missing base year would silently anchor the whole series on year ZERO and produce deflators
  // of ~10^300. Rejected explicitly before the coercion. (Found by the test, not by review.)
  if (baseYear == null || baseYear === "") return null;
  const base = Number(baseYear);
  if (!Number.isFinite(base) || !Array.isArray(years) || years.length === 0) return null;
  if (inflationRateFor(inflationRows, scenarioName, base) == null) return null;

  const wanted = [...new Set(years.map(Number))].filter(Number.isFinite).sort((a, b) => a - b);
  if (!wanted.length) return null;

  const out = new Map([[base, 1]]);
  const lo = Math.min(base, wanted[0]);
  const hi = Math.max(base, wanted[wanted.length - 1]);

  // Forward from the base year: each year multiplies in ITS OWN rate.
  let factor = 1;
  for (let y = base + 1; y <= hi; y++) {
    const rate = inflationRateFor(inflationRows, scenarioName, y) ?? 0;
    factor *= 1 + rate / 100;
    out.set(y, factor);
  }
  // Backwards from the base year, dividing by the rate of the year being stepped OUT of, so the
  // two directions are one continuous product rather than two conventions.
  factor = 1;
  for (let y = base - 1; y >= lo; y--) {
    const rate = inflationRateFor(inflationRows, scenarioName, y + 1) ?? 0;
    factor /= 1 + rate / 100;
    out.set(y, factor);
  }
  return out;
}

/**
 * Express one nominal figure in base-year money. Non-numbers pass through untouched — a null cell
 * is "no data", and turning it into 0 would invent a number.
 */
export function toRealTerms(value, year, deflators) {
  if (!deflators) return value;
  const n = Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) return value;
  const d = deflators.get(Number(year));
  if (!Number.isFinite(d) || d === 0) return value;
  return n / d;
}
