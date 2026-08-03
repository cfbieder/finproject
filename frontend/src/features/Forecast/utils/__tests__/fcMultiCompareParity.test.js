/**
 * CR067 P2's parity gate, as a permanent test rather than a one-off click-through.
 *
 * Multi-Compare and Compare must plot the SAME numbers for the same scenario. They share
 * `buildScenarioMatrix`, so any difference is a wiring bug — and the two that can occur are
 * exactly the ones this asserts:
 *
 *   1. reading `matrix.netCashFlow` (plain numbers, never null) where Compare reads
 *      `cash.get("Net Cash Flow")` (null in an empty year) — 0 drawn where Compare draws a gap;
 *   2. an index-aligned rather than year-aligned series, which is invisible until two scenarios
 *      have different PeriodStarts.
 *
 * Compare's own chart reads `compare.totals[metric].a`, so that is what this compares against —
 * the actual expression in FCCompareCharts, not a restatement of it.
 */
import { describe, it, expect } from "vitest";
import { buildScenarioMatrix, compareMatrices } from "../fcCompareUtils.js";
import { metricValues, alignSeries } from "../fcMultiCompareUtils.js";
import { METRICS } from "../fcTrajectoryMetrics.js";

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

const cashRows = [
  { label: "Income", level: 1 },
  { label: "Salary", level: 2 },
  { label: "Expense", level: 1 },
  { label: "Rent", level: 2 },
  { label: "Transfers", level: 2 },
];

const balanceRows = [
  { label: "Assets", level: 1 },
  { label: "Bank Accounts", level: 2 },
  { label: "Properties", level: 2 },
  { label: "Liabilities", level: 1 },
  { label: "Mortgage", level: 2 },
];

const entries = [
  { Year: 2027, Account: "Salary", Amount: 100 },
  { Year: 2027, Account: "Rent", Amount: -40 },
  { Year: 2027, Account: "Transfer - Bank", Amount: -10 },
  { Year: 2027, Account: "House", Amount: 500 },
  { Year: 2027, Account: "Mortgage", Amount: -200 },
  { Year: 2028, Account: "Salary", Amount: 110 },
  { Year: 2028, Account: "Rent", Amount: -45 },
  { Year: 2028, Account: "House", Amount: 510 },
  { Year: 2028, Account: "Mortgage", Amount: -190 },
];

const build = () =>
  buildScenarioMatrix({
    entries,
    years: [2026, 2027, 2028],
    periodStart: 2027,
    baseYearValues: { Salary: 90, Rent: -35 },
    lastActualBalance: {
      level1: new Map([["Assets", 300]]),
      level2: new Map([["Bank Accounts", 300]]),
      level3: new Map([["Checking", 300]]),
    },
    cashAccountMap,
    balanceAccountMap,
    balanceRows,
  });

describe("Multi-Compare plots the same numbers as Compare", () => {
  const matrix = build();
  // What Compare's chart actually reads: `compare.totals[metric].a`.
  const compare = compareMatrices(matrix, build(), { cashRows, balanceRows });

  it.each(METRICS.map((m) => m.key))("agrees on %s, year for year", (key) => {
    const compareSeries = compare.totals[key].a;
    const multiSeries = metricValues(matrix, key);

    expect(multiSeries).toEqual(compareSeries);
    // and the same axis, so "year for year" is a real claim and not a coincidence of length
    expect(matrix.years).toEqual(compare.years);
  });

  it("does not mistake the top-level netCashFlow array for the charted row", () => {
    // The two disagree the moment a year carries no cash rows, which is precisely when it
    // matters: one draws a gap, the other draws zero.
    const charted = metricValues(matrix, "netCashFlow");
    expect(charted).toBe(matrix.cash.get("Net Cash Flow"));
    expect(charted).not.toBe(matrix.netCashFlow);
  });

  it("survives the alignment layer unchanged when one scenario is selected", () => {
    // alignSeries is a no-op on a single scenario; if it is not, it is reindexing something.
    for (const { key } of METRICS) {
      const { years, series } = alignSeries([{ name: "Base", matrix }], key);
      expect(years).toEqual(matrix.years);
      expect(series[0].values).toEqual(metricValues(matrix, key));
    }
  });
});
