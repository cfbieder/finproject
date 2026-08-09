import { describe, it, expect } from "vitest";
import { inflationRateFor, buildDeflators, toRealTerms } from "../fcRealTerms.js";

/**
 * CR076 §7 Q3 — the deflator that turns a nominal plan into today's money.
 *
 * The arithmetic is simple; the ways it can lie are not. These pin the three that matter:
 * a missing inflation series must DISABLE the view rather than silently claim 1.0, the base
 * year must be exactly 1, and years before the base year must be inflated rather than left
 * alone — otherwise the 2025 actual sits in 2025 money on a page headed "2026 dollars".
 */

const ROWS = [{ Scenario: "S", Year: 2026, Rate: 2.5 }];
const YEARS = [2025, 2026, 2027, 2028];

describe("inflationRateFor", () => {
  it("carries a declared rate forward, and backwards before the first row", () => {
    // The same step function `buildRates` walks server-side. A deflator built from a different
    // reading of these rows would disagree with the very numbers it deflates.
    expect(inflationRateFor(ROWS, "S", 2026)).toBe(2.5);
    expect(inflationRateFor(ROWS, "S", 2040)).toBe(2.5);
    expect(inflationRateFor(ROWS, "S", 2020)).toBe(2.5);
  });

  it("takes the latest row at or before the year when several are declared", () => {
    const rows = [
      { Scenario: "S", Year: 2026, Rate: 2.5 },
      { Scenario: "S", Year: 2030, Rate: 4 },
    ];
    expect(inflationRateFor(rows, "S", 2029)).toBe(2.5);
    expect(inflationRateFor(rows, "S", 2030)).toBe(4);
    expect(inflationRateFor(rows, "S", 2031)).toBe(4);
  });

  it("returns null for a scenario that declares nothing — never a default", () => {
    // CR076 D7 made this fail loud in the engine because a silent 0 is indistinguishable from a
    // real one. Here the consequence is a deflator of 1.0, which would claim nominal and real
    // are the same thing.
    expect(inflationRateFor(ROWS, "Other", 2030)).toBeNull();
    expect(inflationRateFor([], "S", 2030)).toBeNull();
    expect(inflationRateFor(null, "S", 2030)).toBeNull();
  });
});

describe("buildDeflators", () => {
  const d = () => buildDeflators({ inflationRows: ROWS, scenarioName: "S", baseYear: 2026, years: YEARS });

  it("makes the base year exactly 1", () => {
    expect(d().get(2026)).toBe(1);
  });

  it("compounds forward one year at a time", () => {
    expect(d().get(2027)).toBeCloseTo(1.025, 10);
    expect(d().get(2028)).toBeCloseTo(1.025 * 1.025, 10);
  });

  it("reaches 2.4325 at 2062 — the figure the whole feature exists to show", () => {
    const far = buildDeflators({
      inflationRows: ROWS, scenarioName: "S", baseYear: 2026,
      years: [2026, 2062],
    });
    expect(far.get(2062)).toBeCloseTo(Math.pow(1.025, 36), 8);
    // Base's live headline, in today's money.
    expect(4674650 / far.get(2062)).toBeCloseTo(1921719.27, 1);
  });

  it("INFLATES years before the base year rather than leaving them at 1", () => {
    // Otherwise the 2025 actual column sits in 2025 money on a page headed "2026 dollars".
    expect(d().get(2025)).toBeCloseTo(1 / 1.025, 10);
    expect(toRealTerms(1000, 2025, d())).toBeCloseTo(1025, 6);
  });

  it("returns null when the scenario declares no inflation, so the view can be disabled", () => {
    expect(buildDeflators({ inflationRows: ROWS, scenarioName: "Other", baseYear: 2026, years: YEARS })).toBeNull();
    expect(buildDeflators({ inflationRows: [], scenarioName: "S", baseYear: 2026, years: YEARS })).toBeNull();
  });

  it("returns null without a base year or years, rather than guessing", () => {
    expect(buildDeflators({ inflationRows: ROWS, scenarioName: "S", baseYear: null, years: YEARS })).toBeNull();
    expect(buildDeflators({ inflationRows: ROWS, scenarioName: "S", baseYear: 2026, years: [] })).toBeNull();
  });

  it("uses each year's OWN rate when the rate changes mid-plan", () => {
    const rows = [
      { Scenario: "S", Year: 2026, Rate: 2 },
      { Scenario: "S", Year: 2028, Rate: 10 },
    ];
    const m = buildDeflators({ inflationRows: rows, scenarioName: "S", baseYear: 2026, years: [2026, 2027, 2028, 2029] });
    expect(m.get(2027)).toBeCloseTo(1.02, 10);            // 2027 still at 2%
    expect(m.get(2028)).toBeCloseTo(1.02 * 1.10, 10);     // 2028 steps to 10%
    expect(m.get(2029)).toBeCloseTo(1.02 * 1.10 * 1.10, 10);
  });
});

describe("toRealTerms", () => {
  const m = buildDeflators({ inflationRows: ROWS, scenarioName: "S", baseYear: 2026, years: YEARS });

  it("divides a nominal figure by its year's deflator", () => {
    expect(toRealTerms(1025, 2027, m)).toBeCloseTo(1000, 6);
  });

  it("leaves the base year untouched", () => {
    expect(toRealTerms(1234.56, 2026, m)).toBeCloseTo(1234.56, 6);
  });

  it("passes null and blank straight through — a missing cell is not a zero", () => {
    // Turning "no data" into 0 would invent a number, which is the one thing a display
    // transform must never do.
    expect(toRealTerms(null, 2027, m)).toBeNull();
    expect(toRealTerms("", 2027, m)).toBe("");
    expect(toRealTerms(undefined, 2027, m)).toBeUndefined();
  });

  it("passes everything through when there are no deflators (view disabled)", () => {
    expect(toRealTerms(1000, 2027, null)).toBe(1000);
  });

  it("leaves a year the deflator does not cover alone rather than guessing", () => {
    expect(toRealTerms(1000, 2099, m)).toBe(1000);
  });

  it("preserves sign — a liability deflates like anything else", () => {
    expect(toRealTerms(-1025, 2027, m)).toBeCloseTo(-1000, 6);
  });
});
