import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import FCReviewAdjustTransferModal from "../FCReviewAdjustTransferModal.jsx";
import Rest from "../../../js/rest.js";

/**
 * The Modify Transfer modal had NEVER shown a transfer — for any module, any year.
 *
 * It fetched the module LIST endpoint, which does not return Invest/Dispose (only
 * GET /modules/:id joins the three child tables). So `moduleData.Invest` was always
 * undefined and every year reported "no transfers for this year", while the Review sat
 * right behind it displaying the very transfer the modal denied existed.
 *
 * A unit test of the year-matching predicate passed happily throughout — it was testing
 * a function that was never reached with real data. So this test goes through the actual
 * fetch: it asserts the modal reads the FULL module, and renders what the engine would
 * have generated for the clicked year.
 */

// The real row that exposed it: OCME Sp. z o.o. — 100,000 PLN/yr, 2026 → 2030. One row,
// five years of entries. The user clicked 2028.
const SUMMARY = { id: 241, Name: "OCME Sp. z o.o.", Currency: "PLN" };
const FULL = {
  data: {
    id: 241,
    Name: "OCME Sp. z o.o.",
    Currency: "PLN",
    Invest: [
      { Date: "2026-07-01", DateEnd: "2030-07-01", Amount: 100000, Flag: "Periodic" },
    ],
    Dispose: [{ Date: "2028-12-31", Amount: 5000, Flag: "OneTime" }],
  },
};

const ENTRY = { Module: "OCME Sp. z o.o.", Year: 2028, Currency: "PLN" };

describe("FCReviewAdjustTransferModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Rest, "fetchJson").mockResolvedValue([SUMMARY]);
    vi.spyOn(Rest, "get").mockResolvedValue(FULL);
  });

  // The modal portals into document.body, so an uncleaned render leaks into the next test.
  afterEach(cleanup);

  it("fetches the FULL module, not the list — the list carries no transfers", async () => {
    render(
      <FCReviewAdjustTransferModal
        isOpen
        onClose={() => {}}
        entry={ENTRY}
        scenarioName="2026 Base"
      />
    );

    await screen.findByText("2026–2030");
    // The bug in one assertion: without this call there are no transfer arrays at all.
    expect(Rest.get).toHaveBeenCalledWith("/forecast/modules/241");
  });

  it("shows a periodic transfer in a MIDDLE year of its range, labelled with its span", async () => {
    render(
      <FCReviewAdjustTransferModal
        isOpen
        onClose={() => {}}
        entry={ENTRY}
        scenarioName="2026 Base"
      />
    );

    // 2028 is neither the start nor the end of the range — the case that used to vanish.
    expect(await screen.findByText("2026–2030")).toBeTruthy();
    expect(screen.queryByText("No invest transfers for this year")).toBeNull();

    // …and it must not masquerade as a one-off: one row drives all five years, so editing
    // it "for 2028" would rewrite 2026–2030. It stays read-only and says so — hence the
    // Flag cell AND the explanatory note both mention Periodic.
    expect(screen.getAllByText(/Periodic/).length).toBeGreaterThan(1);
  });

  it("still shows a one-time transfer in its own year", async () => {
    render(
      <FCReviewAdjustTransferModal
        isOpen
        onClose={() => {}}
        entry={ENTRY}
        scenarioName="2026 Base"
      />
    );

    await screen.findByText("2026–2030");
    expect(screen.queryByText("No dispose transfers for this year")).toBeNull();
    expect(screen.getByText("2028")).toBeTruthy(); // the OneTime disposal
  });
});
