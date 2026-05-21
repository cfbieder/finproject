import { describe, it, expect } from "vitest";
import {
  collectCollapsiblePaths,
  buildAccountValueMap,
  collectLeafNames,
  findNodeByPath,
} from "../treeTraversal";

describe("collectCollapsiblePaths", () => {
  it("returns only nodes that have children, keyed by path", () => {
    const tree = [
      { name: "Assets", children: [{ name: "Cash" }] },
      { name: "Liabilities", children: [] },
    ];
    expect([...collectCollapsiblePaths(tree)]).toEqual(["Assets"]);
  });

  it("walks nested children and joins path with '>'", () => {
    const tree = [
      {
        name: "Assets",
        children: [
          {
            name: "Current",
            children: [{ name: "Cash" }, { name: "Receivables" }],
          },
        ],
      },
    ];
    const result = collectCollapsiblePaths(tree);
    expect(result.has("Assets")).toBe(true);
    expect(result.has("Assets>Current")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("returns an empty Set for non-array input", () => {
    expect(collectCollapsiblePaths(null).size).toBe(0);
    expect(collectCollapsiblePaths(undefined).size).toBe(0);
    expect(collectCollapsiblePaths("not array").size).toBe(0);
  });

  it("treats nodes with empty children[] as leaves (not collapsible)", () => {
    const tree = [{ name: "Empty", children: [] }];
    expect(collectCollapsiblePaths(tree).size).toBe(0);
  });
});

describe("buildAccountValueMap", () => {
  it("maps every node by path to its value", () => {
    const tree = [
      {
        name: "Assets",
        totalUSD: 1000,
        children: [{ name: "Cash", totalUSD: 500 }],
      },
    ];
    const map = buildAccountValueMap(tree);
    expect(map.get("Assets")).toBe(1000);
    expect(map.get("Assets>Cash")).toBe(500);
    expect(map.size).toBe(2);
  });

  it("uses a custom value key when provided", () => {
    const tree = [{ name: "Assets", balance: 42 }];
    const map = buildAccountValueMap(tree, [], new Map(), "balance");
    expect(map.get("Assets")).toBe(42);
  });

  it("returns an empty Map for non-array input", () => {
    expect(buildAccountValueMap(null).size).toBe(0);
    expect(buildAccountValueMap(undefined).size).toBe(0);
  });

  it("skips nullish nodes inside an array", () => {
    const tree = [null, { name: "Real", totalUSD: 10 }, undefined];
    const map = buildAccountValueMap(tree);
    expect(map.size).toBe(1);
    expect(map.get("Real")).toBe(10);
  });
});

describe("collectLeafNames", () => {
  it("flattens a tree to its leaf names", () => {
    const tree = {
      name: "Root",
      children: [
        { name: "Branch", children: [{ name: "Leaf1" }] },
        { name: "Leaf2" },
      ],
    };
    expect(collectLeafNames(tree)).toEqual(["Leaf1", "Leaf2"]);
  });

  it("returns [name] for a single leaf with no children", () => {
    expect(collectLeafNames({ name: "Solo" })).toEqual(["Solo"]);
  });

  it("returns [] for nodes with missing/empty/whitespace name", () => {
    expect(collectLeafNames({ name: "" })).toEqual([]);
    expect(collectLeafNames({ name: "   " })).toEqual([]);
    expect(collectLeafNames({})).toEqual([]);
  });

  it("returns [] for nullish or non-object input", () => {
    expect(collectLeafNames(null)).toEqual([]);
    expect(collectLeafNames(undefined)).toEqual([]);
    expect(collectLeafNames("string")).toEqual([]);
  });

  it("treats empty children[] as a leaf", () => {
    expect(collectLeafNames({ name: "L", children: [] })).toEqual(["L"]);
  });
});

describe("findNodeByPath", () => {
  const tree = [
    {
      name: "Assets",
      children: [
        { name: "Cash", total: 100 },
        { name: "Investments", children: [{ name: "AAPL", total: 50 }] },
      ],
    },
  ];

  it("finds a direct child by single-segment path", () => {
    expect(findNodeByPath(tree, ["Assets"])).toEqual(tree[0]);
  });

  it("walks a multi-segment path to a nested node", () => {
    expect(findNodeByPath(tree, ["Assets", "Cash"])).toEqual({
      name: "Cash",
      total: 100,
    });
    expect(findNodeByPath(tree, ["Assets", "Investments", "AAPL"])).toEqual({
      name: "AAPL",
      total: 50,
    });
  });

  it("returns null when any segment is missing", () => {
    expect(findNodeByPath(tree, ["Assets", "Bogus"])).toBeNull();
    expect(findNodeByPath(tree, ["Liabilities"])).toBeNull();
  });

  it("returns null for empty path or non-array inputs", () => {
    expect(findNodeByPath(tree, [])).toBeNull();
    expect(findNodeByPath(null, ["Assets"])).toBeNull();
    expect(findNodeByPath(tree, null)).toBeNull();
  });
});
