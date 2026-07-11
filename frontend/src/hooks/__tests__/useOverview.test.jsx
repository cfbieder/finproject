import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import Rest from "../../js/rest.js";
import { formatLocalDate } from "../../utils/dateHelpers.js";
import { useOverview } from "../useOverview.js";

/**
 * useOverview (CR043 Phase 3.2) — verifies the KPI hook still derives net
 * worth / delta / income / expense / net correctly after being rebuilt on the
 * shared cached report queries.
 */

const TODAY = formatLocalDate(new Date());

const balanceFor = (assets, liabilities) => [
  { name: "Assets", totalUSD: assets },
  { name: "Liabilities", totalUSD: liabilities }, // stored negative
];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe("useOverview", () => {
  beforeEach(() => {
    // today → net worth 800; prior month-end → 700 (delta +100)
    vi.spyOn(Rest, "fetchBalanceReportV2").mockImplementation((date) =>
      Promise.resolve(
        date === TODAY ? balanceFor(1000, -200) : balanceFor(900, -200)
      )
    );
    vi.spyOn(Rest, "fetchCashFlowReportV2").mockResolvedValue([
      { name: "Income", total: 500 },
      { name: "Expense", total: -300 },
    ]);
  });

  it("starts loading, then derives the KPI set", async () => {
    const { result } = renderHook(() => useOverview(), { wrapper: makeWrapper() });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBe(null);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.failed).toBe(false);
    expect(result.current.data).toEqual({
      netWorth: 800, // 1000 + (-200)
      delta: 100, // 800 - 700
      income: 500,
      expense: -300,
      net: 200, // 500 + (-300)
    });
  });

  it("reports failed (and null data) when a report query errors", async () => {
    Rest.fetchCashFlowReportV2.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useOverview(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.failed).toBe(true);
    expect(result.current.data).toBe(null);
  });
});
