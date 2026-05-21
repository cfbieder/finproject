import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatPercentage,
  formatRate,
  formatFxRate,
  formatNumber,
  formatCompactNumber,
  parseCurrency,
} from "../formatters";

describe("formatCurrency", () => {
  it("formats positive amounts as USD with thousands separators", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
    expect(formatCurrency(0)).toBe("$0.00");
    expect(formatCurrency(1_000_000)).toBe("$1,000,000.00");
  });

  it("wraps negative amounts in parentheses (accountant style)", () => {
    expect(formatCurrency(-1234.56)).toBe("($1,234.56)");
    expect(formatCurrency(-0.01)).toBe("($0.01)");
  });

  it("treats null/undefined as zero", () => {
    expect(formatCurrency(null)).toBe("$0.00");
    expect(formatCurrency(undefined)).toBe("$0.00");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatCurrency(1.004)).toBe("$1.00");
    expect(formatCurrency(1.006)).toBe("$1.01");
  });
});

describe("formatPercentage", () => {
  it("multiplies by 100 and appends %", () => {
    expect(formatPercentage(0.1534)).toBe("15.34%");
    expect(formatPercentage(1.5)).toBe("150.00%");
    expect(formatPercentage(0)).toBe("0.00%");
  });

  it("respects the decimals parameter", () => {
    expect(formatPercentage(0.1534, 1)).toBe("15.3%");
    expect(formatPercentage(0.1534, 0)).toBe("15%");
    expect(formatPercentage(0.1534, 4)).toBe("15.3400%");
  });

  it("returns '0.00%' for non-numeric input", () => {
    expect(formatPercentage(null)).toBe("0.00%");
    expect(formatPercentage(undefined)).toBe("0.00%");
    expect(formatPercentage("0.5")).toBe("0.00%");
    expect(formatPercentage(NaN)).toBe("NaN%");
  });
});

describe("formatRate", () => {
  it("appends % without multiplying (input already in percent units)", () => {
    expect(formatRate(2.5)).toBe("2.50%");
    expect(formatRate(0)).toBe("0.00%");
    expect(formatRate(100)).toBe("100.00%");
  });

  it("rounds to the requested precision", () => {
    expect(formatRate(2.567)).toBe("2.57%");
    expect(formatRate(2.567, 1)).toBe("2.6%");
    expect(formatRate(2.567, 3)).toBe("2.567%");
  });

  it("returns '0.00%' for non-numeric input", () => {
    expect(formatRate(null)).toBe("0.00%");
    expect(formatRate(undefined)).toBe("0.00%");
    expect(formatRate("2.5")).toBe("0.00%");
  });
});

describe("formatFxRate", () => {
  it("formats with 4 decimal places by default", () => {
    expect(formatFxRate(1.2345)).toBe("1.2345");
    expect(formatFxRate(1.23)).toBe("1.2300");
  });

  it("respects custom precision", () => {
    expect(formatFxRate(1.234567, 6)).toBe("1.234567");
    expect(formatFxRate(1.2345, 2)).toBe("1.23");
  });

  it("returns '-' for non-numeric input", () => {
    expect(formatFxRate(null)).toBe("-");
    expect(formatFxRate(undefined)).toBe("-");
    expect(formatFxRate("1.5")).toBe("-");
  });
});

describe("formatNumber", () => {
  it("adds thousands separators with 0 decimals by default", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(0)).toBe("0");
  });

  it("respects the decimals parameter and rounds", () => {
    expect(formatNumber(1234.567, 2)).toBe("1,234.57");
    expect(formatNumber(1234, 2)).toBe("1,234.00");
  });

  it("handles negative numbers with leading minus", () => {
    expect(formatNumber(-1234)).toBe("-1,234");
  });

  it("returns '0' for non-numeric input", () => {
    expect(formatNumber(null)).toBe("0");
    expect(formatNumber(undefined)).toBe("0");
    expect(formatNumber("1234")).toBe("0");
  });
});

describe("formatCompactNumber", () => {
  it("uses K / M / B suffixes for large magnitudes", () => {
    expect(formatCompactNumber(1234)).toBe("1.2K");
    expect(formatCompactNumber(1_234_567)).toBe("1.2M");
    expect(formatCompactNumber(1_234_567_890)).toBe("1.2B");
  });

  it("respects the decimals parameter", () => {
    expect(formatCompactNumber(1234, 0)).toBe("1K");
    expect(formatCompactNumber(1234, 2)).toBe("1.23K");
  });

  it("does not use a suffix for small values", () => {
    expect(formatCompactNumber(0)).toBe("0.0");
    expect(formatCompactNumber(999)).toBe("999.0");
  });

  it("returns '0' for non-numeric input", () => {
    expect(formatCompactNumber(null)).toBe("0");
    expect(formatCompactNumber(undefined)).toBe("0");
  });
});

describe("parseCurrency", () => {
  it("strips $ and commas", () => {
    expect(parseCurrency("$1,234.56")).toBe(1234.56);
    expect(parseCurrency("$1,000,000")).toBe(1_000_000);
  });

  it("treats parenthesised values as negative (accountant style)", () => {
    expect(parseCurrency("($1,234.56)")).toBe(-1234.56);
    expect(parseCurrency("(500)")).toBe(-500);
  });

  it("returns 0 for non-numeric / non-string input", () => {
    expect(parseCurrency("invalid")).toBe(0);
    expect(parseCurrency(null)).toBe(0);
    expect(parseCurrency(undefined)).toBe(0);
    expect(parseCurrency(1234)).toBe(0);
    expect(parseCurrency("")).toBe(0);
  });

  it("is the inverse of formatCurrency for finite values", () => {
    const values = [0, 1234.56, -1234.56, 1_000_000, -0.01];
    for (const v of values) {
      expect(parseCurrency(formatCurrency(v))).toBe(v);
    }
  });
});
