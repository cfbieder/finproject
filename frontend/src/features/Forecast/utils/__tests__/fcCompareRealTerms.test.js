import { describe, it, expect } from "vitest";
import {
  buildScenarioMatrix,
  compareMatrices,
  deflateMatrix,
  MATRIX_MONEY_SERIES,
  MATRIX_MONEY_MAPS,
  MATRIX_NON_MONEY,
} from "../fcCompareUtils.js";
import { buildDeflators } from "../fcRealTerms.js";

/**
 * CR079 increment 3 — real terms on Compare.
 *
 * The arithmetic is the same deflator the Review already uses and is already tested. What is NEW
 * here, and what these pin, is the risk that comes from applying it to a *structure*: a matrix
 * field that `deflateMatrix` does not know about passes through NOMINAL and lands on a page that
 * says "2026 dollars", and it looks exactly like money either way.
 */

const cashAccountMap = new Map([
  ["Salary", { level1: "Income", level2: "Salary" }],
  ["Rent", { level1: "Expense", level2: "Rent" }],
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
  { Year: 2027, Account: "House", Amount: 500 },
  { Year: 2027, Account: "Mortgage", Amount: -200 },
  { Year: 2028, Account: "Salary", Amount: 110 },
  { Year: 2028, Account: "Rent", Amount: -45 },
  { Year: 2028, Account: "House", Amount: 510 },
  { Year: 2028, Account: "Mortgage", Amount: -190 },
];

const build = (scale = 1) =>
  buildScenarioMatrix({
    entries: entries.map((e) => ({ ...e, Amount: e.Amount * scale })),
    years: [2027, 2028],
    periodStart: 2027,
    baseYearValues: { Salary: 90, Rent: -30 },
    lastActualBalance: {
      level1: new Map([["Assets", 1000]]),
      level2: new Map([["Bank Accounts", 300]]),
      level3: new Map([["Checking", 300]]),
    },
    cashAccountMap,
    balanceAccountMap,
    balanceRows,
  });

// Base year 2026 (PeriodStart − 1), 10% so the factors are exact in binary-friendly steps.
const INFLATION = [{ Scenario: "S", Year: 2026, Rate: 10 }];
const deflators = buildDeflators({
  inflationRows: INFLATION,
  scenarioName: "S",
  baseYear: 2026,
  years: [2027, 2028],
});

describe("deflateMatrix", () => {
  it("knows about EVERY key a real matrix carries", () => {
    // The guard that matters. `deflateMatrix` works off hand-listed field names, and a hand-listed
    // set is exactly what silently dropped `disposal_cost_pct` from the variant sync — the code
    // kept working and just stopped covering one thing. Adding a series to `buildScenarioMatrix`
    // without classifying it here fails HERE, naming the field, instead of quietly rendering a
    // nominal row on a page headed "2026 dollars".
    const known = new Set([...MATRIX_MONEY_SERIES, ...MATRIX_MONEY_MAPS, ...MATRIX_NON_MONEY]);
    const unclassified = Object.keys(build()).filter((k) => !known.has(k));
    expect(unclassified).toEqual([]);
  });

  it("divides every money series by its year's deflator", () => {
    const mat = build();
    const real = deflateMatrix(mat, deflators);
    for (const key of MATRIX_MONEY_SERIES) {
      mat[key].forEach((nominal, i) => {
        const factor = i === 0 ? 1.1 : 1.1 * 1.1;
        expect(real[key][i]).toBeCloseTo(nominal / factor, 6);
      });
    }
  });

  it("deflates inside the cash and balance maps too, and keeps every label", () => {
    const mat = build();
    const real = deflateMatrix(mat, deflators);
    for (const key of MATRIX_MONEY_MAPS) {
      expect([...real[key].keys()].sort()).toEqual([...mat[key].keys()].sort());
    }
    expect(real.cash.get("Salary")[0]).toBeCloseTo(100 / 1.1, 6);
    expect(real.balance.get("Properties")[1]).toBeCloseTo(510 / 1.21, 6);
    // A liability is stored negative and deflates like anything else — sign preserved.
    expect(real.balance.get("Mortgage")[0]).toBeCloseTo(-200 / 1.1, 6);
  });

  it("leaves years and labelsWithData alone — they are not money", () => {
    const mat = build();
    const real = deflateMatrix(mat, deflators);
    expect(real.years).toEqual(mat.years);
    expect([...real.labelsWithData].sort()).toEqual([...mat.labelsWithData].sort());
  });

  it("returns the matrix untouched when there are no deflators", () => {
    const mat = build();
    expect(deflateMatrix(mat, null)).toBe(mat);
  });

  it("does not mutate the nominal matrix it was given", () => {
    // FCCompare derives the deflated view from the nominal memo on every render. If deflateMatrix
    // wrote through, the second render would deflate an already-deflated matrix — the "deflated
    // twice" failure, which produces a plausible smaller number rather than an error.
    const mat = build();
    const before = [...mat.netAssets];
    deflateMatrix(mat, deflators);
    expect(mat.netAssets).toEqual(before);
  });
});

describe("deflating BEFORE compareMatrices", () => {
  it("gives the same deltas as deflating the deltas — the reason inputs are the choke point", () => {
    // Deflation is linear, so deflate(B) − deflate(A) = deflate(B − A). That identity is what
    // makes it safe to convert the two matrices once and let the table, charts, commentary and
    // KPI cards all read the result, instead of four call sites each remembering to convert.
    const matA = build(1);
    const matB = build(2);
    const opts = { cashRows, balanceRows };

    const realFirst = compareMatrices(
      deflateMatrix(matA, deflators),
      deflateMatrix(matB, deflators),
      opts
    );
    const nominal = compareMatrices(matA, matB, opts);

    realFirst.totals.netAssets.delta.forEach((d, i) => {
      const factor = i === 0 ? 1.1 : 1.1 * 1.1;
      expect(d).toBeCloseTo(nominal.totals.netAssets.delta[i] / factor, 6);
    });
  });
});
