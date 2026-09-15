import { describe, it, expect, vi, afterEach } from "vitest";
import Rest from "../rest.js";

/**
 * The Budget Worksheet's toggles travel in Budget Analysis's vocabulary, on both the
 * summary and the drill-down, and are OMITTED when a caller passes neither — so the
 * endpoints keep their old include-everything default for any other caller.
 */
describe("worksheet toggles in the REST helpers", () => {
  afterEach(() => vi.restoreAllMocks());

  const lastUrl = (spy) => new URL(spy.mock.calls.at(-1)[0], "http://x");

  it("the summary sends transfers and includeUnrealizedGL", async () => {
    const spy = vi.spyOn(Rest, "fetchJson").mockResolvedValue({});
    await Rest.fetchBudgetBalancesV2({ actualYear: 2026, transfers: "exclude", includeUnrealizedGL: false });
    const url = lastUrl(spy);
    expect(url.pathname).toBe("/api/v2/budget/summary");
    expect(url.searchParams.get("transfers")).toBe("exclude");
    expect(url.searchParams.get("includeUnrealizedGL")).toBe("false");
  });

  it("the drill-down sends the same two parameters", async () => {
    const spy = vi.spyOn(Rest, "fetchJson").mockResolvedValue({ entries: [] });
    await Rest.fetchBudgetActualEntries({ actualYear: 2026, month: 7, transfers: "include", includeUnrealizedGL: true });
    const url = lastUrl(spy);
    expect(url.pathname).toBe("/api/v2/budget/actual-entries");
    expect(url.searchParams.get("transfers")).toBe("include");
    expect(url.searchParams.get("includeUnrealizedGL")).toBe("true");
  });

  it("omits both when a caller passes neither", async () => {
    const spy = vi.spyOn(Rest, "fetchJson").mockResolvedValue({});
    await Rest.fetchBudgetBalancesV2({ actualYear: 2026 });
    const url = lastUrl(spy);
    expect(url.searchParams.has("transfers")).toBe(false);
    expect(url.searchParams.has("includeUnrealizedGL")).toBe(false);
  });
});
