import { describe, it, expect } from "vitest";
import {
  parseLevelAccounts,
  aggregateForecastEntries,
  calculateNetCashFlow,
  formatTableCell,
} from "../forecastHelpers";

describe("parseLevelAccounts — tree format ({name, children})", () => {
  const tree = [
    {
      name: "Income",
      children: [
        { name: "Salary", children: [{ name: "Base" }, { name: "Bonus" }] },
      ],
    },
    {
      name: "Expense",
      children: [{ name: "Housing", children: [{ name: "Rent" }] }],
    },
  ];

  it("emits level-1 and level-2 rows in order", () => {
    const { rows } = parseLevelAccounts(tree);
    expect(rows).toEqual([
      { label: "Income", level: 1 },
      { label: "Salary", level: 2 },
      { label: "Expense", level: 1 },
      { label: "Housing", level: 2 },
    ]);
  });

  it("with includeMapping=true, maps every descendant leaf to its level1/level2", () => {
    const { mapping } = parseLevelAccounts(tree, true);
    expect(mapping.get("Base")).toEqual({ level2: "Salary", level1: "Income" });
    expect(mapping.get("Bonus")).toEqual({ level2: "Salary", level1: "Income" });
    expect(mapping.get("Rent")).toEqual({ level2: "Housing", level1: "Expense" });
    // The level2 itself is also mapped
    expect(mapping.get("Salary")).toEqual({ level2: "Salary", level1: "Income" });
  });

  it("returns an empty mapping when includeMapping is false", () => {
    const { mapping } = parseLevelAccounts(tree, false);
    expect(mapping.size).toBe(0);
  });

  it("skips nullish or unnamed nodes without throwing", () => {
    // The first element drives format detection — keep it well-formed.
    const malformed = [
      { name: "Income", children: [null, { name: "Salary" }, { children: [] }] },
      null,
      { name: "", children: [] },
    ];
    const { rows } = parseLevelAccounts(malformed);
    expect(rows).toEqual([
      { label: "Income", level: 1 },
      { label: "Salary", level: 2 },
    ]);
  });
});

describe("parseLevelAccounts — legacy format ([{Income: [{Salary: [...]}]}])", () => {
  const legacy = [
    {
      Income: [{ Salary: ["Base", "Bonus"] }],
      Expense: [{ Housing: ["Rent"] }],
    },
  ];

  it("emits level-1 and level-2 rows in order", () => {
    const { rows } = parseLevelAccounts(legacy);
    expect(rows).toEqual([
      { label: "Income", level: 1 },
      { label: "Salary", level: 2 },
      { label: "Expense", level: 1 },
      { label: "Housing", level: 2 },
    ]);
  });

  it("maps string leaves under their level2/level1 when includeMapping is true", () => {
    const { mapping } = parseLevelAccounts(legacy, true);
    expect(mapping.get("Base")).toEqual({ level2: "Salary", level1: "Income" });
    expect(mapping.get("Rent")).toEqual({ level2: "Housing", level1: "Expense" });
  });
});

describe("parseLevelAccounts — defensive", () => {
  it("returns empty rows + empty mapping for non-array input", () => {
    const r = parseLevelAccounts(null);
    expect(r.rows).toEqual([]);
    expect(r.mapping.size).toBe(0);
  });

  it("handles an empty array", () => {
    const r = parseLevelAccounts([]);
    expect(r.rows).toEqual([]);
    expect(r.mapping.size).toBe(0);
  });
});

describe("aggregateForecastEntries", () => {
  const accountMap = new Map([
    ["Salaries", { level1: "Expense", level2: "Personnel" }],
    ["Rent", { level1: "Expense", level2: "Personnel" }],
    ["Sales", { level1: "Income", level2: "Revenue" }],
  ]);

  it("sums values per (year, level3/level2/level1)", () => {
    const entries = [
      { Account: "Salaries", 2024: 50000, 2025: 52000 },
      { Account: "Rent", 2024: 12000, 2025: 12000 },
      { Account: "Sales", 2024: 100000, 2025: 110000 },
    ];
    const { level1, level2, level3 } = aggregateForecastEntries(
      entries,
      accountMap,
      [2024, 2025]
    );

    expect(level3.get("Salaries")).toEqual({ 2024: 50000, 2025: 52000 });
    expect(level3.get("Rent")).toEqual({ 2024: 12000, 2025: 12000 });

    expect(level2.get("Personnel")).toEqual({ 2024: 62000, 2025: 64000 });
    expect(level2.get("Revenue")).toEqual({ 2024: 100000, 2025: 110000 });

    expect(level1.get("Expense")).toEqual({ 2024: 62000, 2025: 64000 });
    expect(level1.get("Income")).toEqual({ 2024: 100000, 2025: 110000 });
  });

  it("parses string values as floats and treats missing/NaN as 0", () => {
    const entries = [
      { Account: "Salaries", 2024: "50000.50", 2025: "not-a-number" },
    ];
    const { level3 } = aggregateForecastEntries(entries, accountMap, [2024, 2025]);
    expect(level3.get("Salaries")).toEqual({ 2024: 50000.5, 2025: 0 });
  });

  it("ignores entries whose account is not in the map", () => {
    const entries = [{ Account: "Unknown", 2024: 999 }];
    const { level1, level2, level3 } = aggregateForecastEntries(
      entries,
      accountMap,
      [2024]
    );
    expect(level3.size).toBe(0);
    expect(level2.size).toBe(0);
    expect(level1.size).toBe(0);
  });

  it("returns empty maps for invalid inputs", () => {
    const empty = aggregateForecastEntries(null, accountMap, [2024]);
    expect(empty.level1.size).toBe(0);
    expect(empty.level2.size).toBe(0);
    expect(empty.level3.size).toBe(0);
  });
});

describe("calculateNetCashFlow", () => {
  it("sums Income + Expense per year (expense is already signed)", () => {
    const level1Map = new Map([
      ["Income", { 2024: 100000, 2025: 110000 }],
      ["Expense", { 2024: -60000, 2025: -65000 }],
    ]);
    expect(calculateNetCashFlow(level1Map, [2024, 2025])).toEqual({
      2024: 40000,
      2025: 45000,
    });
  });

  it("treats a missing Income or Expense bucket as 0", () => {
    const level1Map = new Map([["Income", { 2024: 100 }]]);
    expect(calculateNetCashFlow(level1Map, [2024])).toEqual({ 2024: 100 });
  });

  it("returns 0 for years not present in either bucket", () => {
    const level1Map = new Map([["Income", { 2024: 100 }]]);
    expect(calculateNetCashFlow(level1Map, [2030])).toEqual({ 2030: 0 });
  });

  it("returns {} for invalid inputs", () => {
    expect(calculateNetCashFlow(null, [2024])).toEqual({});
    expect(calculateNetCashFlow(new Map(), null)).toEqual({});
  });
});

describe("formatTableCell", () => {
  it("formats positive numbers with thousands separators", () => {
    expect(formatTableCell(1000)).toEqual({
      value: "1,000",
      className: "cell",
    });
    expect(formatTableCell(1234567, "row")).toEqual({
      value: "1,234,567",
      className: "row",
    });
  });

  it("wraps negatives in parens and adds --negative modifier", () => {
    expect(formatTableCell(-500)).toEqual({
      value: "(500)",
      className: "cell cell--negative",
    });
    expect(formatTableCell(-1234, "row")).toEqual({
      value: "(1,234)",
      className: "row row--negative",
    });
  });

  it("renders zero without the negative modifier", () => {
    expect(formatTableCell(0)).toEqual({
      value: "0",
      className: "cell",
    });
  });

  it("returns the em-dash placeholder for non-numeric input", () => {
    expect(formatTableCell(null)).toEqual({ value: "—", className: "cell" });
    expect(formatTableCell(undefined)).toEqual({ value: "—", className: "cell" });
    expect(formatTableCell("1234")).toEqual({ value: "—", className: "cell" });
  });
});
