import { useQuery } from "@tanstack/react-query";
import Rest from "../js/rest.js";

/**
 * Shared cached report hooks (CR043 Phase 3.2). Both shells fetch the same
 * balance / cash-flow reports; wrapping them in TanStack Query means a given
 * (date) / (range) is fetched once and reused across consumers and revisits
 * instead of every page re-running its own fetch+loading boilerplate.
 *
 * Each returns the standard useQuery result; `data` is the report array the
 * corresponding Rest.*V2 helper unwraps ("Balance Sheet Accounts" /
 * "Profit & Loss Accounts"), or null.
 */

/** Balance sheet as of a single date. */
export function useBalanceReport(asOfDate) {
  return useQuery({
    queryKey: ["balanceReport", asOfDate ?? null],
    queryFn: () => Rest.fetchBalanceReportV2(asOfDate),
    enabled: !!asOfDate,
  });
}

/** Cash-flow (P&L) for a date range. */
export function useCashFlowReport({
  fromDate,
  toDate,
  transfers = "exclude",
  includeUnrealizedGL = false,
} = {}) {
  return useQuery({
    queryKey: [
      "cashFlowReport",
      { fromDate: fromDate ?? null, toDate: toDate ?? null, transfers, includeUnrealizedGL },
    ],
    queryFn: () =>
      Rest.fetchCashFlowReportV2({ fromDate, toDate, transfers, includeUnrealizedGL }),
    enabled: !!fromDate && !!toDate,
  });
}
