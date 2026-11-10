import { describe, it, expect } from "vitest";
import { buildForecastBalanceForYear } from "../fcBalanceAtYear.js";
import { buildScenarioMatrix } from "../fcCompareUtils.js";

const cashAccountMap = new Map([
  ["Salary", { level1: "Income", level2: "Salary" }],
  ["Rent", { level1: "Expense", level2: "Rent" }],
  ["Transfer - Bank", { level1: "Expense", level2: "Transfers" }],
]);
const balanceAccountMap = new Map([
  ["Checking", { level1: "Assets", level2: "Bank Accounts" }],
  ["Bank Accounts", { level1: "Assets", level2: "Bank Accounts" }],
  ["House", { level1: "Assets", level2: "Properties" }],
  ["Properties", { level1: "Assets", level2: "Properties" }],
  ["Mortgage", { level1: "Liabilities", level2: "Mortgage" }],
]);
const balanceRows = [
  { label: "Assets", level: 1 },
  { label: "Bank Accounts", level: 2 },
  { label: "Properties", level: 2 },
  { label: "Liabilities", level: 1 },
  { label: "Mortgage", level: 2 },
];
const entries = [
  // Base year 2026 (engine BS + transfers; its P&L comes from baseYearValues)
  { Year: 2026, Account: "Transfer - Bank", Amount: -5 },
  { Year: 2026, Account: "House", Amount: 480 },
  { Year: 2026, Account: "Mortgage", Amount: -210 },
  // Forecast 2027
  { Year: 2027, Account: "Salary", Amount: 100 },
  { Year: 2027, Account: "Rent", Amount: -40 },
  { Year: 2027, Account: "House", Amount: 500 },
  { Year: 2027, Account: "Mortgage", Amount: -200 },
];
const lastActualBalance = {
  level1: new Map([["Assets", 1000]]),
  level2: new Map([["Bank Accounts", 300]]),
  level3: new Map(),
};
const base = {
  entries,
  years: [2026, 2027],
  periodStart: 2027,
  baseYearValues: { Salary: 90, Rent: -30 },
  lastActualBalance,
  cashAccountMap,
  balanceAccountMap,
  balanceRows,
};

describe("buildForecastBalanceForYear", () => {
  it("base year: bank = last actual + budget P&L + engine transfers; other rows from engine", () => {
    const r = buildForecastBalanceForYear({ ...base, year: 2026 });
    expect(r.balance.get("Bank Accounts")).toBe(300 + 60 - 5);
    expect(r.balance.get("Properties")).toBe(480);
    expect(r.balance.get("Mortgage")).toBe(-210);
    expect(r.totalAssets).toBe(355 + 480);
    expect(r.totalLiabilities).toBe(-210);
    expect(r.netAssets).toBe(355 + 480 - 210);
  });

  it("forecast year: equals buildScenarioMatrix's column", () => {
    const r = buildForecastBalanceForYear({ ...base, year: 2027 });
    const m = buildScenarioMatrix(base);
    const i = m.years.indexOf(2027);
    expect(r.balance.get("Bank Accounts")).toBe(m.balance.get("Bank Accounts")[i]);
    expect(r.netAssets).toBe(m.netAssets[i]);
    // and it continues from the base-year bank balance
    const b = buildForecastBalanceForYear({ ...base, year: 2026 });
    expect(r.balance.get("Bank Accounts")).toBe(b.balance.get("Bank Accounts") + 60);
  });

  it("returns null outside the scenario", () => {
    expect(buildForecastBalanceForYear({ ...base, year: 2025 })).toBeNull();
    expect(buildForecastBalanceForYear({ ...base, year: 2040 })).toBeNull();
  });
});
