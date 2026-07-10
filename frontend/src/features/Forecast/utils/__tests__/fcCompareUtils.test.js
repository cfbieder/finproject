import { describe, it, expect } from "vitest";
import {
  buildScenarioMatrix,
  compareMatrices,
  buildCommentary,
} from "../fcCompareUtils.js";

// ---------------------------------------------------------------------------
// Fixtures — a minimal FC structure mirroring what the hooks provide
// ---------------------------------------------------------------------------

const cashAccountMap = new Map([
  ["Salary", { level1: "Income", level2: "Salary" }],
  ["Rent", { level1: "Expense", level2: "Rent" }],
  ["Taxes", { level1: "Expense", level2: "Taxes" }],
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
  { label: "Taxes", level: 2 },
  { label: "Transfers", level: 2 },
];

const balanceRows = [
  { label: "Assets", level: 1 },
  { label: "Bank Accounts", level: 2 },
  { label: "Properties", level: 2 },
  { label: "Liabilities", level: 1 },
  { label: "Mortgage", level: 2 },
];

const entriesA = [
  // 2027
  { Year: 2027, Account: "Salary", Amount: 100 },
  { Year: 2027, Account: "Rent", Amount: -40 },
  { Year: 2027, Account: "Transfer - Bank", Amount: -10 },
  { Year: 2027, Account: "House", Amount: 500 },
  { Year: 2027, Account: "Mortgage", Amount: 200 },
  // 2028 (amounts as strings, as pg numeric returns)
  { Year: "2028", Account: "Salary", Amount: "110" },
  { Year: "2028", Account: "Rent", Amount: "-45" },
  { Year: "2028", Account: "House", Amount: "510" },
  { Year: "2028", Account: "Mortgage", Amount: "190" },
];

const buildA = (overrides = {}) =>
  buildScenarioMatrix({
    entries: entriesA,
    years: [2027, 2028],
    periodStart: 2027,
    baseYearValues: { Salary: 90, Rent: -30 }, // BaseYear (2026) NCF = 60
    lastActualBalance: {
      level1: new Map([["Assets", 1000]]),
      level2: new Map([["Bank Accounts", 300]]),
      level3: new Map([["Checking", 300]]),
    },
    cashAccountMap,
    balanceAccountMap,
    balanceRows,
    ...overrides,
  });

describe("buildScenarioMatrix", () => {
  const mat = buildA();

  it("computes P&L rows with Expense net of Transfers (Review parity)", () => {
    // Expense L1 raw = Rent + Transfer = -50; display = -50 - (-10) = -40
    expect(mat.cash.get("Expense")).toEqual([-40, -45]);
    expect(mat.cash.get("Income")).toEqual([100, 110]);
    expect(mat.cash.get("Salary")).toEqual([100, 110]);
    expect(mat.cash.get("Transfers")).toEqual([-10, null]);
  });

  it("computes Cash Flow and Net Cash Flow like the Review page", () => {
    // Cash Flow = Income + (Expense - Transfers) = 100 + (-40) = 60
    expect(mat.cash.get("Cash Flow")).toEqual([60, 65]);
    // Net = Income + Expense(incl transfers) + TransfersL1(0) = 100 - 50 = 50
    expect(mat.cash.get("Net Cash Flow")).toEqual([50, 65]);
    expect(mat.netCashFlow).toEqual([50, 65]);
  });

  it("runs Bank Accounts as cumulative: LAY seed + BaseYear NCF + yearly NCF", () => {
    // seed 300 + baseYearNcf 60 (budget) + 50 (2027) = 410; + 65 (2028) = 475
    expect(mat.balance.get("Bank Accounts")).toEqual([410, 475]);
  });

  it("totals assets/liabilities from level-2 display values", () => {
    // Assets = Bank(410) + Properties(500); Liabilities = Mortgage(200)
    expect(mat.totalAssets).toEqual([910, 985]);
    expect(mat.totalLiabilities).toEqual([200, 190]);
    expect(mat.netAssets).toEqual([710, 795]);
  });

  it("coerces string Years/Amounts from the API", () => {
    expect(mat.years).toEqual([2027, 2028]);
    expect(mat.cash.get("Rent")).toEqual([-40, -45]);
  });

  it("drops BaseYear rows the years endpoint includes (no transfer double-count)", () => {
    // The engine writes BaseYear (2026) entries — e.g. transfers — and the
    // years endpoint reports 2026. Compare must cover forecast years only,
    // counting 2026 transfers once, via the bank seed's baseYearNcf.
    const withBase = buildA({
      entries: [
        { Year: 2026, Account: "Transfer - Bank", Amount: -25 },
        ...entriesA,
      ],
      years: [2026, 2027, 2028],
    });
    expect(withBase.years).toEqual([2027, 2028]);
    // seed 300 + baseYearNcf (budget 60 + transfers2026 -25) + NCF2027 50 = 385
    expect(withBase.balance.get("Bank Accounts")).toEqual([385, 450]);
  });
});

describe("compareMatrices", () => {
  it("same scenario vs itself yields all-zero deltas and no structural diffs", () => {
    const mat = buildA();
    const cmp = compareMatrices(mat, mat, { cashRows, balanceRows });
    for (const row of cmp.rows) {
      for (const d of row.delta) {
        if (d != null) expect(d).toBe(0);
      }
    }
    expect(cmp.structural.onlyInA).toEqual([]);
    expect(cmp.structural.onlyInB).toEqual([]);
  });

  it("computes delta as B − A and aligns on the year union", () => {
    const matA = buildA();
    const entriesB = [
      ...entriesA,
      { Year: 2027, Account: "Rent", Amount: -20 }, // B spends 20 less
      { Year: 2029, Account: "Salary", Amount: 120 }, // extra year in B only
    ];
    const matB = buildA({ entries: entriesB, years: [2027, 2028, 2029] });
    const cmp = compareMatrices(matA, matB, { cashRows, balanceRows });

    expect(cmp.years).toEqual([2027, 2028, 2029]);
    const rent = cmp.rows.find((r) => r.label === "Rent");
    expect(rent.delta[0]).toBe(-20); // B rent -60 vs A -40
    // 2029 exists only in B → delta null, a null, b has value
    const salary = cmp.rows.find((r) => r.label === "Salary");
    expect(salary.a[2]).toBeNull();
    expect(salary.b[2]).toBe(120);
    expect(salary.delta[2]).toBeNull();
  });

  it("inserts Cash Flow / Net Cash Flow around Transfers and appends Net Assets", () => {
    const mat = buildA();
    const cmp = compareMatrices(mat, mat, { cashRows, balanceRows });
    const labels = cmp.rows.map((r) => r.label);
    const ti = labels.indexOf("Transfers");
    expect(labels[ti - 1]).toBe("Cash Flow");
    expect(labels[ti + 1]).toBe("Net Cash Flow");
    expect(labels[labels.length - 1]).toBe("Net Assets");
  });

  it("flags labels present in only one scenario", () => {
    const matA = buildA();
    const entriesB = entriesA.filter((e) => e.Account !== "House");
    const matB = buildA({ entries: entriesB });
    const cmp = compareMatrices(matA, matB, { cashRows, balanceRows });
    expect(cmp.structural.onlyInA).toContain("Properties");
    expect(cmp.structural.onlyInB).toEqual([]);
  });
});

describe("buildCommentary", () => {
  it("produces a headline and movers for diverging scenarios", () => {
    const matA = buildA();
    const entriesB = entriesA.map((e) =>
      e.Account === "Rent" ? { ...e, Amount: Number(e.Amount) - 30_000 } : e
    );
    const matB = buildA({ entries: entriesB });
    const cmp = compareMatrices(matA, matB, { cashRows, balanceRows });
    const items = buildCommentary(cmp, { a: "Base", b: "Big Rent" });

    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("headline");
    expect(kinds).toContain("pl-movers");
    const movers = items.find((i) => i.kind === "pl-movers");
    expect(movers.text).toContain("Rent");
  });

  it("says scenarios never diverge when comparing a scenario to itself", () => {
    const mat = buildA();
    const cmp = compareMatrices(mat, mat, { cashRows, balanceRows });
    const items = buildCommentary(cmp, { a: "Base", b: "Base" });
    const divergence = items.find((i) => i.kind === "divergence");
    expect(divergence.text).toMatch(/never diverge/i);
    expect(items.find((i) => i.kind === "pl-movers")).toBeUndefined();
  });

  it("detects crossover years when the net-asset advantage flips", () => {
    const matA = buildA();
    // B: worse in 2027 (rent +50k), much better in 2028 (salary +100k)
    const entriesB = entriesA.map((e) => {
      if (e.Account === "Rent" && Number(e.Year) === 2027)
        return { ...e, Amount: -40 - 50_000 };
      if (e.Account === "Salary" && Number(e.Year) === 2028)
        return { ...e, Amount: 110 + 200_000 };
      return e;
    });
    const matB = buildA({ entries: entriesB });
    const cmp = compareMatrices(matA, matB, { cashRows, balanceRows });
    const items = buildCommentary(cmp, { a: "A", b: "B" });
    const crossover = items.find((i) => i.kind === "crossover");
    expect(crossover).toBeDefined();
    expect(crossover.text).toContain("2028");
  });
});
