import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import FCCashTransferModal from "../FCCashTransferModal.jsx";
import Rest from "../../../js/rest.js";

/**
 * Adding a cash transfer must APPEND to the module's schedule, never replace it.
 *
 * The modal took its modules from the LIST endpoint, which carries no Invest/Dispose, so
 * `module.Dispose` was always undefined and the PUT sent a one-row array. The server
 * replaces the whole schedule on PUT — so one added transfer deleted every existing
 * disposal, including a module's Full sale. Same list-vs-detail defect
 * FCReviewAdjustTransferModal had; this test goes through the real fetches for that reason.
 */

const SUMMARY = { id: 87, Name: "United Beverages", Scenario: "2026 Base", Type: "Business" };
const FULL = {
  data: {
    id: 87,
    Name: "United Beverages",
    Invest: [],
    Dispose: [{ Date: "2036-07-01", Amount: 0, Flag: "Full", CostPct: 2 }],
  },
};

describe("FCCashTransferModal", () => {
  let fetchJson;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchJson = vi.spyOn(Rest, "fetchJson").mockImplementation(async (url) =>
      url.startsWith("/api/v2/forecast/modules?") ? [SUMMARY] : {}
    );
    vi.spyOn(Rest, "get").mockResolvedValue(FULL);
  });

  afterEach(cleanup);

  it("keeps the module's existing disposals when a transfer is added", async () => {
    render(
      <FCCashTransferModal isOpen onClose={() => {}} title="2030" year={2030} scenarioName="2026 Base" />
    );

    await screen.findByRole("option", { name: "United Beverages" });
    fireEvent.change(document.getElementById("transfer-module"), { target: { value: "United Beverages" } });
    fireEvent.change(document.getElementById("transfer-amount"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Transfer" }));

    await waitFor(() =>
      expect(fetchJson).toHaveBeenCalledWith("/api/v2/forecast/modules/87", expect.objectContaining({ method: "PUT" }))
    );
    const put = fetchJson.mock.calls.find(([url]) => url === "/api/v2/forecast/modules/87");
    const body = JSON.parse(put[1].body);

    expect(Rest.get).toHaveBeenCalledWith("/forecast/modules/87");
    expect(body.Dispose).toEqual([
      { Date: "2036-07-01", Amount: 0, Flag: "Full", CostPct: 2 },
      { Date: "2030-12-31", Amount: 5000, Flag: "OneTime" },
    ]);
  });
});
