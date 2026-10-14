import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildForecastReviewRows, forecastReviewSheet, forecastWarningsSheet } from "../fcReviewWorkbook.js";
import { resolveCashValue } from "../fcCashValue.js";

// PeriodStart 2027 ⇒ 2025 actuals, 2026 budget, 2027 forecast.
const YEARS = [2025, 2026, 2027];
const ENGINE = { 2027: { Income: 520000, Expense: -310000 } };

// The page's getCellValue: engine years only — null for P&L rows in the two pre-forecast years.
const getCellValue = (row, year, isCash) => {
  if (!isCash) return null;
  const y = ENGINE[Number(year)];
  if (!y) return null;
  if (row.isNet || row.isCashFlow) return y.Income + y.Expense;
  return y[row.label] ?? null;
};

const ctx = {
  getCellValue,
  baseYears: new Set([2026]),
  lastActualYears: new Set([2025]),
  baseActualTotalsByYear: new Map([[2025, {
    level1: new Map([["Income", 500000], ["Expense", -300000]]),
    level2: new Map(),
    net: 200000,
  }]]),
  categoryToLineMap: new Map(),
  baseYearBudget: { Salary: 450000, Travel: -90000 },
  cashAccountMap: new Map([
    ["Salary", { level1: "Income", level2: "Salary" }],
    ["Travel", { level1: "Expense", level2: "Travel" }],
  ]),
};

const input = {
  sortedYears: YEARS,
  cashRowsWithNet: [{ label: "Income", level: 1 }, { label: "Expense", level: 1 }, { label: "Net Cash Flow", level: 1, isNet: true }],
  resolveCashValue: (row, year) => resolveCashValue(row, year, ctx),
  balanceAccounts: [{ label: "Assets", level: 1 }, { label: "Bank Accounts", level: 2 }],
  balanceDisplayValues: new Map([["Bank Accounts", [100, 200, 300]]]),
  totalAssetsByYear: [100, 200, 300],
  netAssetsByYear: [100, 200, 300],
  transferDetailRows: [],
  balanceAccountMap: new Map([["Bank Accounts", { level1: "Assets", level2: "Bank Accounts" }]]),
  bankAccountLabels: new Set(["Bank Accounts"]),
  getCellValue,
};

const find = (rows, label) => rows.find((r) => r.type === "row" && r.label === label);

describe("buildForecastReviewRows", () => {
  const rows = buildForecastReviewRows(input);

  it("fills the Actual and Budget P&L columns the old export left blank", () => {
    expect(find(rows, "Income").values).toEqual([500000, 450000, 520000]);
    expect(find(rows, "Expense").values).toEqual([-300000, -90000, -310000]);
  });

  it("carries every section the page shows, in the page's order", () => {
    const sections = rows.filter((r) => r.type === "section").map((r) => r.label);
    expect(sections).toEqual(["Cash Flow", "Balance Sheet", "Cash Flow Summary", "Change in Net Assets"]);
    expect(find(rows, "Net Assets").values).toEqual([100, 200, 300]);
    expect(find(rows, "Total Change in Net Assets").values).toEqual([null, 100, 100]);
  });
});

describe("forecastReviewSheet", () => {
  it("writes numbers, not formatted strings, with a basis row naming each column", () => {
    const rows = buildForecastReviewRows(input);
    const ws = forecastReviewSheet({
      scenario: "Base", sortedYears: YEARS, birthYear: 1970, rows,
      yearBasis: { 2025: "Actual", 2026: "Budget" },
    });
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    expect(aoa[4]).toEqual(["Basis", "Actual", "Budget", "Forecast"]);
    expect(aoa[5]).toEqual(["Age", 55, 56, 57]);
    const income = aoa.find((r) => r[0] === "Income");
    expect(income.slice(1)).toEqual([500000, 450000, 520000]);
  });
});

describe("forecastWarningsSheet", () => {
  it("names each warning's tab", () => {
    const ws = forecastWarningsSheet([{ kind: "advisory", severity: "info", title: "T", detail: "D", years: [2030], amount: 5 }]);
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
    expect(aoa[1]).toEqual(["Assumptions to consider", "info", "T", "D", "2030", 5]);
  });
});
