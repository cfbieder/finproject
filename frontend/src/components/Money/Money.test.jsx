import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import Money from "../Money/Money.jsx";
import { formatMoney, isBlank } from "../Money/formatMoney.js";

/**
 * CR087 P1 — the money contract, which is a correctness contract and not a
 * styling one. Each test below pins a defect this repo has shipped.
 *
 * `globals: false` and no setup file, so cleanup is registered by hand or
 * `screen` queries match the previous test's DOM.
 */
afterEach(cleanup);

describe("formatMoney", () => {
  it("🔴 renders ABSENT as an em dash and ZERO as a number", () => {
    // formatters.js documents formatCurrency(null) → "$0.00"; FCEquity renders
    // "—" for a true zero. Both cannot be right, and each hides the other case.
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney("")).toBe("—");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("refuses a value that is not a number rather than printing NaN", () => {
    expect(formatMoney("abc")).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("states the currency — USD by symbol, everything else by code", () => {
    // 47% of the book is foreign: a PLN mortgage shown as ($412,500.00) cannot
    // be tied to its statement.
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(1650000, { currency: "PLN" })).toBe("1,650,000.00 PLN");
    expect(formatMoney(1409.25, { currency: "eur" })).toBe("1,409.25 EUR");
  });

  it("uses accounting parentheses for negatives, inside the currency", () => {
    expect(formatMoney(-1234.56)).toBe("($1,234.56)");
    expect(formatMoney(-1650000, { currency: "PLN" })).toBe("(1,650,000.00 PLN)");
  });

  it("🔴 pins the locale — the same string on every machine", () => {
    // `toLocaleString(undefined, …)` renders 1.234,56 on a pl-PL browser while
    // the next table renders $1,234.56. The machine is not a property of the money.
    expect(formatMoney(1234.56)).toBe("$1,234.56");
    expect(formatMoney(1234.56, { currency: null })).toBe("1,234.56");
  });

  it("accepts the numeric strings the API returns", () => {
    expect(formatMoney("1045.00")).toBe("$1,045.00");
    expect(formatMoney("-45.5", { currency: null, decimals: 2 })).toBe("(45.50)");
  });

  it("isBlank separates absent from zero", () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank(0)).toBe(false);
    expect(isBlank("0")).toBe(false);
  });
});

describe("<Money>", () => {
  it("renders the formatted figure", () => {
    render(<Money value={-1234.56} />);
    expect(screen.getByText("($1,234.56)")).toBeTruthy();
  });

  it("🔴 colours nothing unless asked, and never colours a zero", () => {
    // A balance sheet's negatives are liabilities, not losses; and a zero delta
    // painted green asserts a gain that did not happen.
    const { container: plain } = render(<Money value={-500} />);
    expect(plain.querySelector(".money--neg")).toBeNull();

    const { container: zero } = render(<Money value={0} signed />);
    expect(zero.querySelector(".money--pos")).toBeNull();
    expect(zero.querySelector(".money--neg")).toBeNull();

    const { container: loss } = render(<Money value={-500} signed />);
    expect(loss.querySelector(".money--neg")).not.toBeNull();
  });

  it("marks an absent value so it reads as missing, not as zero", () => {
    const { container } = render(<Money value={null} />);
    expect(container.querySelector(".money--blank")).not.toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });
});
