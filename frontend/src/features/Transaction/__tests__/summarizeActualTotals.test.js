import { describe, it, expect } from "vitest";
import { summarizeActualTotals } from "../transactionUtils.js";
import { ACTUAL_CONFIG } from "../transactionConfig.js";

/**
 * CR068 P2 — the totals tiles.
 *
 * The fixture is the owner's own screenshot (Aug 2026, four rows). It showed
 *
 *     PLN TOTAL (453.64) · EUR TOTAL (116.23) · EXPENSES (BASE) (569.87)
 *
 * and 453.64 + 116.23 = 569.87 — the "base" tile was the two per-currency
 * figures added together, which is not a quantity of anything. The Base Amt
 * column on the same screen sums to 254.27.
 */
const SCREENSHOT_ROWS = [
  { Amount: -101.74, Currency: "PLN", BaseAmount: -27.09 }, // BIEDRONKA
  { Amount: -5.9, Currency: "PLN", BaseAmount: -1.57 }, // ZDROFIT
  { Amount: -116.23, Currency: "EUR", BaseAmount: -133.49 }, // ONEBILL MYBOX
  { Amount: -346.0, Currency: "PLN", BaseAmount: -92.12 }, // ZWROTOD
];

describe("summarizeActualTotals", () => {
  it("totals each currency separately, in that currency", () => {
    const { byCurrency } = summarizeActualTotals(SCREENSHOT_ROWS, ACTUAL_CONFIG);
    const map = Object.fromEntries(byCurrency.map((c) => [c.currency, c.amount]));

    expect(map.PLN).toBeCloseTo(-453.64, 2);
    expect(map.EUR).toBeCloseTo(-116.23, 2);
  });

  it("totals income and expense in BASE, not by adding the currencies together", () => {
    const { income, expense, net } = summarizeActualTotals(
      SCREENSHOT_ROWS,
      ACTUAL_CONFIG
    );

    expect(income).toBe(0);
    expect(expense).toBeCloseTo(-254.27, 2);
    expect(net).toBeCloseTo(-254.27, 2);

    // The number the page used to show. If this ever passes, the defect is back.
    expect(expense).not.toBeCloseTo(-569.87, 2);
  });

  it("splits income from expense by the sign of the BASE amount", () => {
    const rows = [
      { Amount: 4000, Currency: "PLN", BaseAmount: 1000 },
      { Amount: -800, Currency: "EUR", BaseAmount: -900 },
    ];
    const { income, expense, net } = summarizeActualTotals(rows, ACTUAL_CONFIG);

    expect(income).toBeCloseTo(1000, 2);
    expect(expense).toBeCloseTo(-900, 2);
    expect(net).toBeCloseTo(100, 2);
  });

  it("skips rows with an unusable base amount without dropping their currency total", () => {
    const rows = [
      { Amount: -100, Currency: "PLN", BaseAmount: null },
      { Amount: -50, Currency: "PLN", BaseAmount: -12.5 },
    ];
    const { byCurrency, expense } = summarizeActualTotals(rows, ACTUAL_CONFIG);

    // The local total still counts both — it needs no FX rate.
    expect(byCurrency[0].amount).toBeCloseTo(-150, 2);
    // The base total counts only the row that has one, rather than reading
    // null as 0 and silently understating.
    expect(expense).toBeCloseTo(-12.5, 2);
  });

  it("handles an empty or absent result", () => {
    expect(summarizeActualTotals([], ACTUAL_CONFIG)).toEqual({
      byCurrency: [],
      income: 0,
      expense: 0,
      net: 0,
    });
    expect(summarizeActualTotals(undefined, ACTUAL_CONFIG).byCurrency).toEqual([]);
  });

  it("buckets a missing currency rather than dropping the row", () => {
    const { byCurrency } = summarizeActualTotals(
      [{ Amount: -10, BaseAmount: -10 }],
      ACTUAL_CONFIG
    );
    expect(byCurrency).toEqual([{ currency: "Unknown", amount: -10 }]);
  });
});
