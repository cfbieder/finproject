import { describe, it, expect } from "vitest";
import routes, { getRoutesByCategory } from "./routes.jsx";

/**
 * Routes config invariants (CR042 U5) — locks the Balances 4→1 consolidation:
 * the four former balance pages are gone from the config and replaced by one
 * nav destination (/balances) plus a hidden deep-link route (/balances/:view).
 */

const paths = routes.map((r) => r.path);

describe("Balances consolidation (CR042 U5)", () => {
  it("removes the four former balance page routes", () => {
    expect(paths).not.toContain("/balance");
    expect(paths).not.toContain("/balance-trends");
    expect(paths).not.toContain("/balance-sheet-periods");
    expect(paths).not.toContain("/balance-chart");
  });

  it("exposes a single /balances nav route plus a hidden tab route", () => {
    const nav = routes.find((r) => r.path === "/balances");
    const tab = routes.find((r) => r.path === "/balances/:view");
    expect(nav).toBeTruthy();
    expect(nav.showInNav).not.toBe(false);
    expect(tab).toBeTruthy();
    expect(tab.showInNav).toBe(false);
    expect(nav.component).toBe(tab.component);
  });

  it("lists Balances exactly once in the Reports & Graphs nav", () => {
    const navBalances = getRoutesByCategory("Reports & Graphs").filter(
      (r) => r.path.startsWith("/balances")
    );
    expect(navBalances).toHaveLength(1);
    expect(navBalances[0].path).toBe("/balances");
  });
});

describe("Cash Flow 2→1 (CR042 U5)", () => {
  it("removes /cash-flow-periods and keeps one /cash-flow nav route + hidden tab", () => {
    expect(paths).not.toContain("/cash-flow-periods");
    const nav = routes.find((r) => r.path === "/cash-flow");
    const tab = routes.find((r) => r.path === "/cash-flow/:view");
    expect(nav?.showInNav).not.toBe(false);
    expect(tab?.showInNav).toBe(false);
    expect(nav.component).toBe(tab.component);
  });
});

describe("Budget vs Actual 3→1 (CR042 U5)", () => {
  it("removes the three variant routes", () => {
    expect(paths).not.toContain("/budget-realization");
    expect(paths).not.toContain("/budget-graph");
    expect(paths).not.toContain("/budget-variances");
  });

  it("exposes one /budget-vs-actual nav route + hidden tab, worksheet/FX untouched", () => {
    const nav = routes.find((r) => r.path === "/budget-vs-actual");
    const tab = routes.find((r) => r.path === "/budget-vs-actual/:view");
    expect(nav?.showInNav).not.toBe(false);
    expect(tab?.showInNav).toBe(false);
    expect(nav.component).toBe(tab.component);
    // The non-vs-actual budget pages stay separate.
    expect(paths).toContain("/budget-worksheet");
    expect(paths).toContain("/budget-fx");
  });
});
