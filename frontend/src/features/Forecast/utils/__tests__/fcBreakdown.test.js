import { describe, it, expect } from "vitest";
import {
  buildBreakdownSeries,
  level2ChildrenOf,
  leafChildrenOf,
} from "../fcBreakdown.js";

// A small chart of accounts, shaped like the real one: every descendant name maps to
// its level-1 section and level-2 account (that is what balanceAccountMap holds).
const ACCOUNT_MAP = new Map([
  ["Bank Accounts", { level1: "Assets", level2: "Bank Accounts" }],
  ["Fidelity Stock", { level1: "Assets", level2: "Fidelity Stock" }],
  ["US - Properties", { level1: "Assets", level2: "US - Properties" }],
  ["US - Casarina", { level1: "Assets", level2: "US - Properties" }], // leaf
  ["US - Nokomis", { level1: "Assets", level2: "US - Properties" }], // leaf
  ["US - Mortgages", { level1: "Liabilities", level2: "US - Mortgages" }],
]);

const YEARS = [2027, 2028];
const PALETTE = ["#a", "#b", "#c"];

describe("level2ChildrenOf / leafChildrenOf", () => {
  it("lists the level-2 accounts under a section", () => {
    expect(level2ChildrenOf("Assets", ACCOUNT_MAP)).toEqual([
      "Bank Accounts",
      "Fidelity Stock",
      "US - Properties",
    ]);
    expect(level2ChildrenOf("Liabilities", ACCOUNT_MAP)).toEqual(["US - Mortgages"]);
  });

  it("lists the leaves under a level-2 account, never the account itself", () => {
    expect(leafChildrenOf("US - Properties", ACCOUNT_MAP)).toEqual([
      "US - Casarina",
      "US - Nokomis",
    ]);
    expect(leafChildrenOf("Fidelity Stock", ACCOUNT_MAP)).toEqual([]);
  });
});

describe("buildBreakdownSeries", () => {
  const valuesForLevel2 = (label) =>
    ({
      "Bank Accounts": [100, 110],
      "Fidelity Stock": [200, 220],
      "US - Properties": [300, 330],
    }[label] || []);

  const leafValues = new Map([
    ["US - Casarina", new Map([[2027, 180], [2028, 190]])],
    ["US - Nokomis", new Map([[2027, 120], [2028, 140]])],
  ]);

  const build = (label, level) =>
    buildBreakdownSeries({
      label,
      level,
      sortedYears: YEARS,
      accountMap: ACCOUNT_MAP,
      valuesForLevel2,
      leafValues,
      palette: PALETTE,
    });

  it("expands a level-1 section into its level-2 accounts", () => {
    const series = build("Assets", 1);
    expect(series.map((s) => s.label)).toEqual([
      "Bank Accounts",
      "Fidelity Stock",
      "US - Properties",
    ]);
    expect(series[1].values).toEqual([200, 220]);
    expect(series[0].color).toBe("#a");
  });

  it("expands a level-2 account into its leaves, straight from the raw entries", () => {
    const series = build("US - Properties", 2);
    expect(series.map((s) => s.label)).toEqual(["US - Casarina", "US - Nokomis"]);
    expect(series[0].values).toEqual([180, 190]);
    // the leaves reconcile with the parent row
    const summed = YEARS.map((_, i) => series.reduce((t, s) => t + s.values[i], 0));
    expect(summed).toEqual(valuesForLevel2("US - Properties"));
  });

  it("returns nothing for a row with no children — the caller keeps the line chart", () => {
    expect(build("Fidelity Stock", 2)).toEqual([]);
  });

  it("returns nothing for a section with a single child — a stack of one is just a line", () => {
    expect(build("Liabilities", 1)).toEqual([]);
  });

  it("returns nothing for a synthetic row with no level (Net Cash Flow, Cash Flow)", () => {
    expect(build("Net Cash Flow", undefined)).toEqual([]);
  });

  it("drops children that are all-zero rather than stacking empty bands", () => {
    const series = buildBreakdownSeries({
      label: "US - Properties",
      level: 2,
      sortedYears: YEARS,
      accountMap: ACCOUNT_MAP,
      valuesForLevel2,
      leafValues: new Map([
        ["US - Casarina", new Map([[2027, 180], [2028, 190]])],
        ["US - Nokomis", new Map([[2027, 0], [2028, 0]])],
      ]),
      palette: PALETTE,
    });
    // only one child left with data ⇒ not worth a stack
    expect(series).toEqual([]);
  });

  it("excludes Transfers from the Expense stack, so it reconciles with the row", () => {
    // Transfer - Bank maps to level1 "Expense" / level2 "Transfers", but the Expense ROW
    // is displayed net of transfers (getCellValue subtracts them; Transfers gets its own
    // row). Stacking them under Expense totalled to a number the row above never showed.
    const cashMap = new Map([
      ["Living Expenses", { level1: "Expense", level2: "Living Expenses" }],
      ["Travel", { level1: "Expense", level2: "Travel" }],
      ["Transfer - Bank", { level1: "Expense", level2: "Transfers" }],
    ]);
    const cashValues = (label) =>
      ({
        "Living Expenses": [-174383, -180000],
        Travel: [-84879, -87000],
        Transfers: [53801, 60000],
      }[label] || []);

    const series = buildBreakdownSeries({
      label: "Expense",
      level: 1,
      sortedYears: YEARS,
      accountMap: cashMap,
      valuesForLevel2: cashValues,
      leafValues: new Map(),
      palette: PALETTE,
      excludeChildren: ["Transfers"],
    });

    expect(series.map((s) => s.label)).toEqual(["Living Expenses", "Travel"]);
    expect(series.map((s) => s.label)).not.toContain("Transfers");

    // The stack now totals to Expense-net-of-transfers, which is what the row says.
    const total2027 = series.reduce((t, s) => t + s.values[0], 0);
    expect(total2027).toBe(-174383 - 84879);
  });

  describe("baseLeafValues — the pre-forecast columns of a leaf breakdown", () => {
    const YEARS_WITH_BASE = [2025, 2026, 2027];
    // 2025 is the ledger's actuals year: it has EVERY leaf, including ones the engine
    // never writes (the engine posts Fidelity Stock at level 2, not to its leaves).
    const LEDGER_2025 = new Map([
      ["US - Casarina", 900000],
      ["US - Nokomis", 400000],
    ]);

    it("fills the actuals column for leaves the engine already models", () => {
      const series = buildBreakdownSeries({
        label: "US - Properties",
        level: 2,
        sortedYears: YEARS_WITH_BASE,
        accountMap: ACCOUNT_MAP,
        valuesForLevel2,
        leafValues: new Map([
          ["US - Casarina", new Map([[2026, 950000], [2027, 1000000]])],
          ["US - Nokomis", new Map([[2026, 420000], [2027, 430000]])],
        ]),
        baseLeafValues: new Map([[2025, LEDGER_2025]]),
        palette: PALETTE,
      });
      expect(series.map((s) => s.values)).toEqual([
        [900000, 950000, 1000000],
        [400000, 420000, 430000],
      ]);
    });

    it("does NOT resurrect a row the engine writes at level 2 — it stays a line chart", () => {
      // Fidelity Stock's leaves have no engine entries at all. The ledger has all three of
      // them, so overlaying first would produce a stack filled in 2025 and empty for every
      // forecast year after it. The engine-data filter has to run first.
      const series = buildBreakdownSeries({
        label: "Fidelity Stock",
        level: 2,
        sortedYears: YEARS_WITH_BASE,
        accountMap: new Map([
          ...ACCOUNT_MAP,
          ["Fidelity IRA", { level1: "Assets", level2: "Fidelity Stock" }],
          ["Fidelity Stocks", { level1: "Assets", level2: "Fidelity Stock" }],
        ]),
        valuesForLevel2,
        leafValues: new Map(),
        baseLeafValues: new Map([
          [2025, new Map([["Fidelity IRA", 500000], ["Fidelity Stocks", 800000]])],
        ]),
        palette: PALETTE,
      });
      expect(series).toEqual([]);
    });

    it("keeps a single-engine-leaf row a line chart, even with ledger data for the rest", () => {
      // US - Nokomis reaches the engine only as a module, never as an account.
      const series = buildBreakdownSeries({
        label: "US - Properties",
        level: 2,
        sortedYears: YEARS_WITH_BASE,
        accountMap: ACCOUNT_MAP,
        valuesForLevel2,
        leafValues: new Map([["US - Casarina", new Map([[2027, 1000000]])]]),
        baseLeafValues: new Map([[2025, LEDGER_2025]]),
        palette: PALETTE,
      });
      expect(series).toEqual([]);
    });

    it("never overwrites a year the engine modelled, including a real zero", () => {
      const series = buildBreakdownSeries({
        label: "US - Properties",
        level: 2,
        sortedYears: YEARS_WITH_BASE,
        accountMap: ACCOUNT_MAP,
        valuesForLevel2,
        leafValues: new Map([
          // Casarina is sold in 2027 — the engine says zero, and it must stay zero.
          ["US - Casarina", new Map([[2026, 950000], [2027, 0]])],
          ["US - Nokomis", new Map([[2026, 420000], [2027, 430000]])],
        ]),
        baseLeafValues: new Map([
          [2025, LEDGER_2025],
          [2027, new Map([["US - Casarina", 999999]])], // would be wrong to apply
        ]),
        palette: PALETTE,
      });
      expect(series[0].values).toEqual([900000, 950000, 0]);
    });

    it("is a no-op when no base data is supplied", () => {
      const series = build("US - Properties", 2);
      expect(series[0].values).toEqual([180, 190]);
    });
  });

  it("treats a missing year as zero, not NaN", () => {
    const series = buildBreakdownSeries({
      label: "US - Properties",
      level: 2,
      sortedYears: [2027, 2028, 2029], // 2029 has no entries at all
      accountMap: ACCOUNT_MAP,
      valuesForLevel2,
      leafValues,
      palette: PALETTE,
    });
    expect(series[0].values).toEqual([180, 190, 0]);
  });
});
