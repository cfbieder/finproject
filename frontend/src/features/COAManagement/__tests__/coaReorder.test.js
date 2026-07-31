import { describe, it, expect } from "vitest";
import { reorderPlan, siblingsOf } from "../coaReorder.js";

/**
 * CR063 — the reorder rules. The interesting cases are all about what counts as
 * a "sibling", because the table is FLATTENED: the row rendered directly above a
 * given row is very often not the row it would swap with.
 */

// Assets ▸ [Bank, Fidelity ▸ [Stocks], Property]  +  Liabilities ▸ [Mortgage]
// "Balance Sheet Accounts" is the client-synthesized wrapper: no accountId.
const ROWS = [
  { id: "-BS", accountId: null, name: "Balance Sheet Accounts", path: [], isCategory: true },
  { id: "BS-Assets", accountId: 1, name: "Assets", path: ["BS"], isCategory: true },
  { id: "BS|Assets-Bank", accountId: 2, name: "Bank", path: ["BS", "Assets"], isCategory: false },
  { id: "BS|Assets-Fidelity", accountId: 3, name: "Fidelity", path: ["BS", "Assets"], isCategory: true },
  { id: "BS|Assets|Fidelity-Stocks", accountId: 4, name: "Stocks", path: ["BS", "Assets", "Fidelity"], isCategory: false },
  { id: "BS|Assets-Property", accountId: 5, name: "Property", path: ["BS", "Assets"], isCategory: false },
  { id: "BS-Liabilities", accountId: 6, name: "Liabilities", path: ["BS"], isCategory: true },
  { id: "BS|Liabilities-Mortgage", accountId: 7, name: "Mortgage", path: ["BS", "Liabilities"], isCategory: false },
];

const row = (name) => ROWS.find((r) => r.name === name);

describe("siblingsOf", () => {
  it("groups by parent path, not by position in the flattened table", () => {
    // Stocks sits BETWEEN Fidelity and Property in the rendered table, and is a
    // sibling of neither — it is Fidelity's child. Reading the table linearly is
    // exactly the bug this guards.
    expect(siblingsOf(ROWS, row("Bank")).map((r) => r.name)).toEqual([
      "Bank",
      "Fidelity",
      "Property",
    ]);
    expect(siblingsOf(ROWS, row("Stocks")).map((r) => r.name)).toEqual(["Stocks"]);
  });
});

describe("reorderPlan", () => {
  it("swaps with the next SIBLING, skipping any nested descendants", () => {
    // Fidelity moving down must swap with Property (id 5) — not with its own
    // child Stocks (id 4), which is the row physically beneath it.
    const plan = reorderPlan(ROWS, row("Fidelity"), 1);
    expect(plan.orderedIds).toEqual([2, 5, 3]);
    expect(plan.parent).toEqual({ parentId: 1 });
  });

  it("moves up within the group", () => {
    expect(reorderPlan(ROWS, row("Property"), -1).orderedIds).toEqual([2, 5, 3]);
  });

  it("returns null at both ends of a group", () => {
    expect(reorderPlan(ROWS, row("Bank"), -1)).toBeNull();
    expect(reorderPlan(ROWS, row("Property"), 1)).toBeNull();
  });

  it("returns null for an only child", () => {
    expect(reorderPlan(ROWS, row("Stocks"), -1)).toBeNull();
    expect(reorderPlan(ROWS, row("Stocks"), 1)).toBeNull();
  });

  it("addresses a parent with no id BY NAME", () => {
    // Assets/Liabilities hang off the section wrapper, which the API strips and
    // fetchCoaSections re-adds client-side — so there is no parent id to send.
    const plan = reorderPlan(ROWS, row("Assets"), 1);
    expect(plan.orderedIds).toEqual([6, 1]);
    expect(plan.parent).toEqual({ parentName: "BS" });
  });

  it("refuses a level where any sibling lacks a real account id", () => {
    // A short orderedIds list is rejected by the server as a stale tree (409),
    // which is right — so do not send one. Better to disable the arrow.
    const rows = ROWS.map((r) =>
      r.name === "Property" ? { ...r, accountId: null } : r
    );
    expect(reorderPlan(rows, rows.find((r) => r.name === "Bank"), 1)).toBeNull();
  });

  it("refuses a row with no account id of its own", () => {
    expect(reorderPlan(ROWS, row("Balance Sheet Accounts"), 1)).toBeNull();
  });

  it("is a pure function — the input rows are not mutated", () => {
    const snapshot = JSON.stringify(ROWS);
    reorderPlan(ROWS, row("Fidelity"), 1);
    expect(JSON.stringify(ROWS)).toBe(snapshot);
  });
});
