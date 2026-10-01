import { describe, it, expect } from "vitest";
import { desktopRouteFor, DESKTOP_PREFIX } from "../desktopPages";

// The "All pages" menu opens a desktop page inside the mobile shell at /m/d/...
describe("desktopRouteFor", () => {
  it("resolves a desktop page from its /m/d path", () => {
    expect(desktopRouteFor(`${DESKTOP_PREFIX}/budget-le`)?.path).toBe("/budget-le");
  });
  it("resolves a PARAMETERISED page, so links into it from a desktop page work", () => {
    expect(desktopRouteFor(`${DESKTOP_PREFIX}/budget-vs-actual/table`)?.path).toBe("/budget-vs-actual/:view");
  });
  it("returns null for a path that is no page, so the shell goes home", () => {
    expect(desktopRouteFor(`${DESKTOP_PREFIX}/no-such-page`)).toBeNull();
  });
});
