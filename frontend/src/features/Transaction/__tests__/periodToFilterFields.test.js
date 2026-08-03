import { describe, it, expect } from "vitest";
import { periodToFilterFields } from "../transactionUtils.js";

/**
 * Parity gate for the CR068 P1 extraction.
 *
 * `periodToFilterFields` was lifted out of TransActual's inline
 * `handlePeriodChange` so the desktop Actuals page and the mobile one build the
 * same period fields. `legacyPeriodFields` below is a VERBATIM copy of that
 * inline body as it shipped (TransActual.jsx, before the extraction) — it is the
 * reference implementation, and every case asserts the two agree.
 *
 * Keep it. If the helper is ever "simplified", this is what catches the
 * simplification changing which rows a month shows.
 */
const legacyPeriodFields = (vals) => {
  const next = {};
  next.yearEnabled = true;
  next.year = String(vals.actualYear);
  next.toYear = String(vals.toYear ?? vals.actualYear);
  // Single-month only when both endpoints are the same month AND year
  const sameYear = next.year === next.toYear;
  if (sameYear && vals.fromMonth === vals.toMonth) {
    next.monthEnabled = true;
    next.month = Number(vals.fromMonth) - 1;
    next.fromMonth = vals.fromMonth;
    next.toMonth = vals.toMonth;
  } else {
    next.monthEnabled = false;
    next.month = undefined;
    next.fromMonth = vals.fromMonth;
    next.toMonth = vals.toMonth;
  }
  return next;
};

const CASES = [
  {
    name: "a single month (Aug 2026)",
    vals: { fromMonth: "08", toMonth: "08", actualYear: 2026, toYear: 2026 },
  },
  {
    name: "a month range inside one year (Jan–Aug 2026)",
    vals: { fromMonth: "01", toMonth: "08", actualYear: 2026, toYear: 2026 },
  },
  {
    name: "a range spanning a year boundary (Nov 2025 – Feb 2026)",
    vals: { fromMonth: "11", toMonth: "02", actualYear: 2025, toYear: 2026 },
  },
  {
    name: "the boundary case: same month, DIFFERENT year (Aug 2025 – Aug 2026)",
    vals: { fromMonth: "08", toMonth: "08", actualYear: 2025, toYear: 2026 },
  },
  {
    name: "toYear omitted (falls back to actualYear)",
    vals: { fromMonth: "03", toMonth: "03", actualYear: 2026 },
  },
];

describe("periodToFilterFields", () => {
  for (const { name, vals } of CASES) {
    it(`matches the shipped inline mapping for ${name}`, () => {
      expect(periodToFilterFields(vals)).toEqual(legacyPeriodFields(vals));
    });
  }

  it("enables the single-month filter with a 0-based month index", () => {
    const fields = periodToFilterFields({
      fromMonth: "08",
      toMonth: "08",
      actualYear: 2026,
      toYear: 2026,
    });
    expect(fields.monthEnabled).toBe(true);
    expect(fields.month).toBe(7);
  });

  it("does NOT collapse the same month across different years to one month", () => {
    // Aug-2025 → Aug-2026 is a 13-month range. Treating it as "August" would
    // drop twelve months of rows, and the page would look like it worked.
    const fields = periodToFilterFields({
      fromMonth: "08",
      toMonth: "08",
      actualYear: 2025,
      toYear: 2026,
    });
    expect(fields.monthEnabled).toBe(false);
    expect(fields.month).toBeUndefined();
    expect(fields.year).toBe("2025");
    expect(fields.toYear).toBe("2026");
  });

  it("returns years as strings, which is what buildDateRangeParams parses", () => {
    const fields = periodToFilterFields({
      fromMonth: "01",
      toMonth: "12",
      actualYear: 2026,
      toYear: 2026,
    });
    expect(fields.year).toBe("2026");
    expect(fields.toYear).toBe("2026");
    expect(fields.yearEnabled).toBe(true);
  });
});
