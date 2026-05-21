import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatLocalDate,
  getToday,
  getYearStart,
  getMonthEnd,
  getMonthStart,
  parseMonthYear,
  buildDateFromMonthYear,
  getMonthOptions,
  getYearOptions,
  getYearOptionsAroundNow,
} from "../dateHelpers";

describe("formatLocalDate", () => {
  it("formats a Date in local timezone with zero-padded month and day", () => {
    expect(formatLocalDate(new Date(2024, 0, 5))).toBe("2024-01-05");
    expect(formatLocalDate(new Date(2024, 11, 31))).toBe("2024-12-31");
  });

  // The whole reason dateHelpers exists: never use toISOString().split("T")[0],
  // which shifts the date in UTC+ timezones for a midnight-local Date.
  it("does not shift the date across UTC boundaries", () => {
    const midnightLocal = new Date(2024, 5, 15, 0, 0, 0);
    expect(formatLocalDate(midnightLocal)).toBe("2024-06-15");
  });
});

describe("getToday", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns today's local date as YYYY-MM-DD", () => {
    vi.setSystemTime(new Date(2026, 4, 20, 14, 30));
    expect(getToday()).toBe("2026-05-20");
  });
});

describe("getYearStart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns January 1 of the current year", () => {
    vi.setSystemTime(new Date(2026, 6, 4));
    expect(getYearStart()).toBe("2026-01-01");
  });
});

describe("getMonthStart / getMonthEnd", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns first day of current month", () => {
    vi.setSystemTime(new Date(2024, 0, 15));
    expect(getMonthStart()).toBe("2024-01-01");
  });

  it("returns last day of current month (handles 31-day month)", () => {
    vi.setSystemTime(new Date(2024, 0, 15));
    expect(getMonthEnd()).toBe("2024-01-31");
  });

  it("returns last day of February in a leap year", () => {
    vi.setSystemTime(new Date(2024, 1, 10));
    expect(getMonthEnd()).toBe("2024-02-29");
  });

  it("returns last day of February in a non-leap year", () => {
    vi.setSystemTime(new Date(2025, 1, 10));
    expect(getMonthEnd()).toBe("2025-02-28");
  });

  it("returns last day of a 30-day month", () => {
    vi.setSystemTime(new Date(2024, 3, 10));
    expect(getMonthEnd()).toBe("2024-04-30");
  });
});

describe("parseMonthYear", () => {
  it("splits a YYYY-MM-DD into month and year", () => {
    expect(parseMonthYear("2024-03-15")).toEqual({
      month: "03",
      year: "2024",
    });
  });

  it("returns empty fields for nullish input", () => {
    expect(parseMonthYear(null)).toEqual({ month: "", year: "" });
    expect(parseMonthYear(undefined)).toEqual({ month: "", year: "" });
    expect(parseMonthYear("")).toEqual({ month: "", year: "" });
  });

  it("returns empty fields for non-string input", () => {
    expect(parseMonthYear(20240315)).toEqual({ month: "", year: "" });
  });
});

describe("buildDateFromMonthYear", () => {
  it("builds a first-of-month date string", () => {
    expect(buildDateFromMonthYear("03", "2024")).toBe("2024-03-01");
  });

  it("returns empty string when month or year missing", () => {
    expect(buildDateFromMonthYear("", "2024")).toBe("");
    expect(buildDateFromMonthYear("03", "")).toBe("");
    expect(buildDateFromMonthYear("", "")).toBe("");
  });

  it("is the inverse of parseMonthYear for first-of-month inputs", () => {
    const { month, year } = parseMonthYear("2024-07-01");
    expect(buildDateFromMonthYear(month, year)).toBe("2024-07-01");
  });
});

describe("getMonthOptions", () => {
  it("returns 12 zero-padded options in calendar order", () => {
    const opts = getMonthOptions();
    expect(opts).toHaveLength(12);
    expect(opts[0]).toEqual({ value: "01", label: "January" });
    expect(opts[11]).toEqual({ value: "12", label: "December" });
    expect(opts.map((o) => o.value)).toEqual([
      "01", "02", "03", "04", "05", "06",
      "07", "08", "09", "10", "11", "12",
    ]);
  });
});

describe("getYearOptions", () => {
  it("returns an inclusive range of year strings", () => {
    expect(getYearOptions(2020, 2024)).toEqual([
      "2020", "2021", "2022", "2023", "2024",
    ]);
  });

  it("returns a single year when start equals end", () => {
    expect(getYearOptions(2024, 2024)).toEqual(["2024"]);
  });

  it("returns an empty array when end is before start", () => {
    expect(getYearOptions(2024, 2020)).toEqual([]);
  });
});

describe("getYearOptionsAroundNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("centres the range on the current year using defaults (5/5)", () => {
    vi.setSystemTime(new Date(2024, 5, 1));
    expect(getYearOptionsAroundNow()).toEqual([
      "2019", "2020", "2021", "2022", "2023",
      "2024", "2025", "2026", "2027", "2028", "2029",
    ]);
  });

  it("respects custom before/after counts", () => {
    vi.setSystemTime(new Date(2024, 5, 1));
    expect(getYearOptionsAroundNow(2, 2)).toEqual([
      "2022", "2023", "2024", "2025", "2026",
    ]);
  });
});
