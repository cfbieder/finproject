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
