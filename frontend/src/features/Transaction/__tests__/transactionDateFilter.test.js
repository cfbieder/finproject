// Pinned BEFORE any Date is constructed, and for the same reason as
// transactionEditDate.test.js: the runner is UTC, where the buggy
// `new Date("2025-12-01")` also yields the 1st, so every assertion below passes
// against the defect it exists to catch. The bug only exists west of UTC.
// (via globalThis — `process` is not a browser global.)
globalThis.process.env.TZ = "America/New_York";

import { describe, it, expect } from "vitest";
import { getDateRangeBounds, isEntryInDateRange } from "../transactionUtils.js";

/**
 * Owner-found (2026-07-31): filtering Transactions to December 2025 on
 * Tax Reserve - US showed "No transactions match current filters" while the KPI
 * tile above it read (55,000.00). The API served the row — the page's own
 * client-side period filter dropped it.
 *
 * `parseEntryDate` is a bare `new Date("2025-12-01")`, which the spec parses as
 * UTC midnight; TransActual then bucketed it by LOCAL calendar parts
 * (`Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())`), shifting every row
 * back one day west of UTC. So the window was off by a day in both directions:
 * 1-Dec fell out of a December filter, 1-Jan-2026 fell in. The KPI tile is a
 * server-side totals call and never passed through this filter, which is why the
 * two disagreed.
 *
 * The fix compares date-only ISO strings, which order lexicographically — no
 * parse, hence no timezone.
 */

const DEC_2025 = { year: "2025", toYear: "2025", fromMonth: "12", toMonth: "12" };

describe("period filter — timezone", () => {
  it("stands west of UTC, or it proves nothing", () => {
    // Guard on the guard: fails loudly rather than going quietly green in UTC.
    expect(new Date("2025-12-01").getDate()).toBe(30);
  });
});

describe("getDateRangeBounds", () => {
  it("is half-open: first of the from-month, first of the month AFTER to-month", () => {
    expect(getDateRangeBounds(DEC_2025)).toEqual({
      start: "2025-12-01",
      end: "2026-01-01",
    });
  });

  it("rolls the year on a December to-month", () => {
    expect(getDateRangeBounds({ year: "2024", toYear: "2024", fromMonth: "01", toMonth: "12" }))
      .toEqual({ start: "2024-01-01", end: "2025-01-01" });
  });

  it("spans multiple years", () => {
    expect(getDateRangeBounds({ year: "2023", toYear: "2025", fromMonth: "03", toMonth: "06" }))
      .toEqual({ start: "2023-03-01", end: "2025-07-01" });
  });

  it("falls back to the from-year when toYear is absent", () => {
    expect(getDateRangeBounds({ year: "2025", fromMonth: "05", toMonth: "05" }))
      .toEqual({ start: "2025-05-01", end: "2025-06-01" });
  });

  it("yields no bounds — not a year-zero range — when the year is unusable", () => {
    expect(getDateRangeBounds({ year: "", fromMonth: "01", toMonth: "12" }))
      .toEqual({ start: null, end: null });
  });
});

describe("isEntryInDateRange", () => {
  const bounds = getDateRangeBounds(DEC_2025);

  it("keeps a row dated the FIRST of the from-month — the reported defect", () => {
    // transaction 22667: 2025-12-01, -55,000.00, Tax Reserve - US.
    expect(isEntryInDateRange({ Date: "2025-12-01" }, bounds)).toBe(true);
  });

  it("excludes the first of the month AFTER the range — the same off-by-one, other end", () => {
    expect(isEntryInDateRange({ Date: "2026-01-01" }, bounds)).toBe(false);
  });

  it("keeps the last day of the to-month", () => {
    expect(isEntryInDateRange({ Date: "2025-12-31" }, bounds)).toBe(true);
  });

  it("excludes the day before the range", () => {
    expect(isEntryInDateRange({ Date: "2025-11-30" }, bounds)).toBe(false);
  });

  it("keeps a mid-month row (never affected by the bug — pins that it stays that way)", () => {
    expect(isEntryInDateRange({ Date: "2025-12-15" }, bounds)).toBe(true);
  });

  it("accepts a full ISO instant by its calendar day", () => {
    expect(isEntryInDateRange({ Date: "2025-12-01T00:00:00.000Z" }, bounds)).toBe(true);
  });

  it("excludes an entry with no usable date", () => {
    expect(isEntryInDateRange({ Date: null }, bounds)).toBe(false);
    expect(isEntryInDateRange({ Date: "garbage" }, bounds)).toBe(false);
  });

  it("applies no filter when there are no bounds", () => {
    expect(isEntryInDateRange({ Date: "1999-01-01" }, { start: null, end: null })).toBe(true);
  });
});
