import { describe, it, expect } from "vitest";
import { isOneOffName, liftOneOffs, oneOffTotal } from "../oneOff.js";

describe("one-offs below the line", () => {
  it("matches the one-off names, not lookalikes", () => {
    for (const n of ["One-Off Items", "One-off items", "Oneoff", "one off"]) expect(isOneOffName(n)).toBe(true);
    for (const n of ["Phone", "Money off", "Done-off", "", null]) expect(isOneOffName(n)).toBe(false);
  });

  const tree = [
    { name: "Income", children: [{ name: "Salary" }] },
    { name: "Expense", children: [{ name: "Travel" }, { name: "One-Off Items", children: [{ name: "Car Purchase/Sale" }] }] },
    { name: "Transfers" },
  ];

  it("lifts Expense's one-off category to its own section right after Expense", () => {
    const lifted = liftOneOffs(tree);
    expect(lifted.map((n) => n.name)).toEqual(["Income", "Expense", "One-Off Items", "Transfers"]);
    expect(lifted[1].children.map((c) => c.name)).toEqual(["Travel"]);
    expect(tree[1].children).toHaveLength(2); // the input is not mutated
  });

  it("leaves a tree without one-offs alone, and totals the lifted sections", () => {
    const plain = [{ name: "Expense", children: [{ name: "Travel" }] }];
    expect(liftOneOffs(plain)).toEqual(plain);
    const leaves = { "Car Purchase/Sale": -500 };
    const resolve = (n) => (n.children ? n.children.reduce((s, c) => s + (leaves[c.name] ?? 0), 0) : leaves[n.name] ?? 0);
    expect(oneOffTotal(liftOneOffs(tree), resolve)).toBe(-500);
  });
});
