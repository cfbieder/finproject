import { describe, it, expect } from "vitest";
import { resolveCashValue } from "../fcCashValue.js";

// PeriodStart 2027 ⇒ 2025 is the actuals year, 2026 the budget year.
const BASE_YEARS = new Set([2026]);
const LAST_ACTUAL_YEARS = new Set([2025]);

const BASE_ACTUALS = new Map([
  [
    2025,
    {
      level1: new Map([["Income", 500000], ["Expense", -300000]]),
      level2: new Map([["Total Salary", 420000], ["Travel", -80000]]),
      leafTotals: new Map([["Airfare", -50000], ["Hotels", -30000]]),
      net: 200000,
    },
  ],
]);

const CATEGORY_TO_LINE = new Map([
  ["Airfare", "Travel"],
  ["Hotels", "Travel"],
]);

const CASH_ACCOUNT_MAP = new Map([
  ["Total Salary", { level1: "Income", level2: "Total Salary" }],
  ["Travel", { level1: "Expense", level2: "Travel" }],
]);

const BUDGET = { "Total Salary": 450000, Travel: -90000 };

// The engine only knows the forecast years — this is what FCReview.getCellValue does.
const ENGINE = {
  2027: { Income: 520000, Expense: -310000, "Total Salary": 460000, Travel: -95000 },
};
const getCellValue = (row, year) => {
  const byYear = ENGINE[Number(year)];
  if (!byYear) return null;
  if (row.isNet || row.isCashFlow) {
    return (byYear.Income ?? 0) + (byYear.Expense ?? 0);
  }
  return byYear[row.label] ?? null;
};

const ctx = {
  getCellValue,
  baseYears: BASE_YEARS,
  lastActualYears: LAST_ACTUAL_YEARS,
  baseActualTotalsByYear: BASE_ACTUALS,
  categoryToLineMap: CATEGORY_TO_LINE,
  baseYearBudget: BUDGET,
  cashAccountMap: CASH_ACCOUNT_MAP,
};

describe("resolveCashValue", () => {
  it("reads the actuals year from the ledger report", () => {
    expect(resolveCashValue({ label: "Income", level: 1 }, 2025, ctx)).toBe(500000);
  });

  it("reads the budget year from the budget entries", () => {
    expect(resolveCashValue({ label: "Travel", level: 2 }, 2026, ctx)).toBe(-90000);
  });

  it("rolls a level-1 budget row up from its FC lines", () => {
    expect(resolveCashValue({ label: "Income", level: 1 }, 2026, ctx)).toBe(450000);
  });

  it("maps the actuals year's COA leaves onto the FC line they belong to", () => {
    // Travel's actuals are two ledger categories, not a level-2 total.
    expect(resolveCashValue({ label: "Travel", level: 2 }, 2025, ctx)).toBe(-80000);
  });

  it("leaves the forecast years to the engine", () => {
    expect(resolveCashValue({ label: "Total Salary", level: 2 }, 2027, ctx)).toBe(460000);
  });

  it("returns the actuals net for the synthetic Net row", () => {
    expect(resolveCashValue({ isNet: true }, 2025, ctx)).toBe(200000);
  });

  it("returns null rather than zero when a year has no data anywhere", () => {
    expect(resolveCashValue({ label: "Travel", level: 2 }, 2030, ctx)).toBeNull();
  });

  it("never overrides a value the engine supplied", () => {
    const overlapping = {
      ...ctx,
      lastActualYears: new Set([2027]), // 2027 is modelled AND flagged as actuals
      baseActualTotalsByYear: new Map([
        [2027, { level1: new Map([["Income", 1]]), level2: new Map(), net: 1 }],
      ]),
    };
    expect(resolveCashValue({ label: "Income", level: 1 }, 2027, overlapping)).toBe(520000);
  });
});
