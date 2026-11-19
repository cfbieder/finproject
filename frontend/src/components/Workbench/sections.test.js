import { describe, it, expect } from "vitest";
import routes from "../../config/routes.jsx";
import { WORKBENCH_SECTIONS, findWorkbenchTab } from "./sections.js";

/**
 * CR105 S1 — the Workbench sections only group the route table, so the two
 * must not drift: every nav route appears in exactly one tab, and every tab
 * points at a route the router has.
 */
const tabPaths = WORKBENCH_SECTIONS.flatMap((s) => s.tabs.map((t) => t.path));
const navPaths = routes.filter((r) => r.showInNav !== false).map((r) => r.path);

describe("Workbench sections (CR105 S1)", () => {
  it("lists every nav route exactly once", () => {
    for (const p of navPaths) {
      expect(tabPaths.filter((t) => t === p), p).toHaveLength(1);
    }
  });

  it("points every tab at an existing route", () => {
    const all = routes.map((r) => r.path);
    for (const p of tabPaths) expect(all, p).toContain(p);
  });

  it("picks the longest matching tab", () => {
    expect(findWorkbenchTab("/investments/exposure").tab.label).toBe("Exposure");
    expect(findWorkbenchTab("/investments").tab.label).toBe("Summary");
    expect(findWorkbenchTab("/investments/positions/42").tab.label).toBe("Positions");
    expect(findWorkbenchTab("/balances/periods").tab.label).toBe("Balances");
    expect(findWorkbenchTab("/holdings/7").section.key).toBe("tx");
    expect(findWorkbenchTab("/investment-returns").tab.label).toBe("Returns");
  });

  it("matches whole path segments only", () => {
    expect(findWorkbenchTab("/").section.key).toBe("today");
    expect(findWorkbenchTab("/budget-vs-actual/le").tab.label).toBe("Analysis");
    expect(findWorkbenchTab("/budget").section).toBeNull();
    expect(findWorkbenchTab("/nowhere").section).toBeNull();
  });

  it("lands each section on its first tab, and budget rows live under Budget", () => {
    const first = (key) => WORKBENCH_SECTIONS.find((s) => s.key === key).tabs[0].path;
    expect(first("budget")).toBe("/budget-vs-actual");
    expect(first("tx")).toBe("/ledger");
    expect(findWorkbenchTab("/trans-budget").section.key).toBe("budget");
  });
});
