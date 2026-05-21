import { describe, it, expect } from "vitest";
import {
  addNetCashFlowCategory,
  buildCashFlowValueMap,
} from "../cashFlowHelpers";

describe("addNetCashFlowCategory", () => {
  it("appends Net cash flow = income + expense (expense already signed)", () => {
    const nodes = [
      { name: "Income", total: 5000 },
      { name: "Expenses", total: -3000 },
    ];
    const result = addNetCashFlowCategory(nodes);
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({ name: "Net cash flow", total: 2000 });
  });

  it("accepts both 'Expense' and 'Expenses' spellings", () => {
    const expenseSingular = addNetCashFlowCategory([
      { name: "Income", total: 1000 },
      { name: "Expense", total: -400 },
    ]);
    expect(expenseSingular.at(-1)).toEqual({
      name: "Net cash flow",
      total: 600,
    });
  });

  it("matches case-insensitively", () => {
    const result = addNetCashFlowCategory([
      { name: "INCOME", total: 100 },
      { name: "expenses", total: -25 },
    ]);
    expect(result.at(-1)).toEqual({ name: "Net cash flow", total: 75 });
  });

  it("does not append a second Net cash flow row when one already exists", () => {
    const nodes = [
      { name: "Income", total: 5000 },
      { name: "Expenses", total: -3000 },
      { name: "Net cash flow", total: 2000 },
    ];
    const result = addNetCashFlowCategory(nodes);
    expect(result).toHaveLength(3);
    expect(result.filter((n) => n.name === "Net cash flow")).toHaveLength(1);
  });

  it("preserves non-Income/Expense rows in their original order", () => {
    const nodes = [
      { name: "Header", total: 0 },
      { name: "Income", total: 100 },
      { name: "Other", total: 1 },
      { name: "Expenses", total: -50 },
    ];
    const result = addNetCashFlowCategory(nodes);
    expect(result.slice(0, 4)).toEqual(nodes);
    expect(result.at(-1)).toEqual({ name: "Net cash flow", total: 50 });
  });

  it("treats missing Income or Expense totals as 0", () => {
    const incomeOnly = addNetCashFlowCategory([{ name: "Income", total: 500 }]);
    expect(incomeOnly.at(-1)).toEqual({ name: "Net cash flow", total: 500 });

    const nothing = addNetCashFlowCategory([]);
    expect(nothing).toEqual([{ name: "Net cash flow", total: 0 }]);
  });

  it("returns [] for non-array input", () => {
    expect(addNetCashFlowCategory(null)).toEqual([]);
    expect(addNetCashFlowCategory(undefined)).toEqual([]);
    expect(addNetCashFlowCategory("nope")).toEqual([]);
  });

  it("ignores nullish entries when scanning for Income/Expense", () => {
    const result = addNetCashFlowCategory([
      null,
      { name: "Income", total: 100 },
      { name: "Expenses", total: -40 },
    ]);
    expect(result.at(-1)).toEqual({ name: "Net cash flow", total: 60 });
  });
});

describe("buildCashFlowValueMap", () => {
  it("maps every node by '>'-joined path to its total", () => {
    const nodes = [
      {
        name: "Income",
        total: 5000,
        children: [
          { name: "Salary", total: 4000 },
          { name: "Other", total: 1000 },
        ],
      },
      { name: "Expenses", total: -3000 },
    ];
    const map = buildCashFlowValueMap(nodes);
    expect(map.get("Income")).toBe(5000);
    expect(map.get("Income>Salary")).toBe(4000);
    expect(map.get("Income>Other")).toBe(1000);
    expect(map.get("Expenses")).toBe(-3000);
    expect(map.size).toBe(4);
  });

  it("returns an empty Map for non-array input", () => {
    expect(buildCashFlowValueMap(null).size).toBe(0);
    expect(buildCashFlowValueMap(undefined).size).toBe(0);
  });

  it("skips nullish entries inside the array", () => {
    const nodes = [null, { name: "Income", total: 100 }, undefined];
    const map = buildCashFlowValueMap(nodes);
    expect(map.size).toBe(1);
    expect(map.get("Income")).toBe(100);
  });

  it("treats nodes with empty children[] as leaves", () => {
    const nodes = [{ name: "Income", total: 100, children: [] }];
    const map = buildCashFlowValueMap(nodes);
    expect(map.size).toBe(1);
    expect(map.get("Income")).toBe(100);
  });

  it("stores undefined when 'total' is missing on a node", () => {
    const nodes = [{ name: "Bare" }];
    const map = buildCashFlowValueMap(nodes);
    expect(map.has("Bare")).toBe(true);
    expect(map.get("Bare")).toBeUndefined();
  });
});
