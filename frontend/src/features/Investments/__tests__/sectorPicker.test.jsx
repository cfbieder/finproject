/**
 * sectorPicker.test.jsx — CR093 P1.
 *
 * The 100% rule is the whole safety of hand-classification: a set summing to 90%
 * stores a fund at 90% of its own value and under-reports it forever, while
 * looking perfectly well-formed. It is enforced in the API and again here, so a
 * wrong total cannot even be submitted.
 */

import { describe, test, expect } from "vitest";
import { sumPct, SECTOR_LABEL } from "../sectorWeights.js";

describe("sumPct", () => {
  test("adds the rows", () => {
    expect(sumPct([{ pct: 60 }, { pct: 40 }])).toBe(100);
  });

  test("🔴 a partial set does NOT read as complete", () => {
    // The dangerous case: 90% looks like a filled-in form.
    expect(sumPct([{ pct: 60 }, { pct: 30 }])).toBe(90);
  });

  test("tolerates the tenth-of-a-percent the inputs allow", () => {
    // 33.3 x 3 = 99.89999… in float; rounding to a tenth is what the step allows.
    expect(sumPct([{ pct: 33.3 }, { pct: 33.3 }, { pct: 33.4 }])).toBe(100);
  });

  test("blank and non-numeric rows count as zero rather than NaN", () => {
    // A NaN total would make the Save button's comparison false in a way that
    // reads as "not 100%" for the wrong reason.
    expect(sumPct([{ pct: 100 }, { pct: "" }, { pct: "abc" }])).toBe(100);
  });

  test("an empty set is zero, not 100", () => {
    expect(sumPct([])).toBe(0);
  });
});

describe("SECTOR_LABEL", () => {
  test("carries exactly the eleven the API and the DB CHECK allow", () => {
    // Drift here would offer the owner a sector the database refuses, and the
    // save would fail at the constraint with nothing useful to say.
    expect(Object.keys(SECTOR_LABEL)).toHaveLength(11);
    expect(Object.keys(SECTOR_LABEL)).toEqual(expect.arrayContaining([
      "technology", "financial_services", "healthcare", "consumer_cyclical",
      "consumer_defensive", "industrials", "energy", "utilities",
      "realestate", "basic_materials", "communication_services",
    ]));
  });
});
