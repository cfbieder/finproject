/**
 * CR076 D1 — the growth formula must have exactly ONE implementation.
 *
 * `fcbuilder-module.js` builds a valuation module's market-value series. `index.js`'s
 * convergence loop rebuilds it in order to re-solve the cash sweep, and then UPDATEs the very
 * rows the builder wrote — so the mirror wins whenever the two disagree.
 *
 * They disagreed. CR072 §8 added the pre-PeriodStart clamp to the builder so the year between a
 * module's `base_date` and PeriodStart compounds, and left `index.js` on the old formula. The
 * result on prod: `Fidelity Stocks` 2027 dividend read 27,723.71 — the average of its 2025 and
 * 2026 market values — beside a stored 2027 balance of 1,438,381. One module, one year, two
 * market values, and the whole yield series one compounding year short (−39,715 on Base).
 *
 * Nothing caught it. 834 backend tests passed throughout, because each side was internally
 * consistent and no test compared them. That is what this file is for.
 */
const { growthPctForYear } = require("../fcbuilder-common");

describe("CR076 D1 — growthPctForYear is the single growth implementation", () => {
  const inflation = [2.5, 2.5, 2.5, 3.0];
  const periodStart = 2027;

  it("treats growth_rate as a MULTIPLIER of inflation, not a rate", () => {
    // 0.8 × 2.5% = 2.0%/yr. This is the convention the whole model uses on both sides;
    // `fcbuilder-stream.js` applies the same `inflation × mult` to expense escalation.
    expect(growthPctForYear(2027, periodStart, 0.8, inflation)).toBeCloseTo(2.0, 10);
    expect(growthPctForYear(2030, periodStart, 1.0, inflation)).toBeCloseTo(3.0, 10);
  });

  it("makes the year BEFORE PeriodStart borrow the first rate — the CR072 §8 clamp", () => {
    // This is the exact line that was missing from index.js. A module based 2025 against a
    // 2027 PeriodStart has a 2026 year that must still compound; returning 0 here is what
    // shifted every yield series by one year.
    expect(growthPctForYear(2026, periodStart, 0.8, inflation)).toBeCloseTo(2.0, 10);
    expect(growthPctForYear(2025, periodStart, 0.8, inflation)).toBeCloseTo(2.0, 10);
  });

  it("returns 0 past the end of the inflation series rather than NaN", () => {
    expect(growthPctForYear(2099, periodStart, 0.8, inflation)).toBe(0);
  });

  it("returns 0 for an absent or empty inflation series rather than throwing", () => {
    // NOTE: this is deliberately NOT an endorsement of the behaviour. CR076 D7 records that a
    // missing inflation series silently yields 0% growth for the whole horizon, which — because
    // growth is a multiplier of inflation — stops every asset appreciating. That should FAIL
    // LOUD, as the FX path already does. This test pins the current contract so the fix is a
    // deliberate change and not an accident.
    expect(growthPctForYear(2027, periodStart, 0.8, [])).toBe(0);
    expect(growthPctForYear(2027, periodStart, 0.8, undefined)).toBe(0);
  });

  it("is the formula BOTH call sites use — neither re-derives it", () => {
    // The regression was two copies of one formula drifting apart, so the guard is structural:
    // if either file computes `growthPct * inflationSeries[...]` itself again, this fails.
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..");

    for (const file of ["fcbuilder-module.js", "index.js"]) {
      const src = fs.readFileSync(path.join(dir, file), "utf8");
      // Strip comments — they legitimately DESCRIBE the formula, and must be allowed to.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      expect(code).toContain("growthPctForYear");
      // No open-coded `growthPct * inflationSeries[...]` anywhere in executable code.
      expect(code).not.toMatch(/growthPct\s*\*\s*inflationSeries\s*\[/);
    }
  });
});
