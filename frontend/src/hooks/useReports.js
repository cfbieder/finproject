import { useMemo } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import Rest from "../js/rest.js";
import { formatLocalDate } from "../utils/dateHelpers.js";

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

// Net worth = Assets + Liabilities (liabilities stored negative) from a balance
// report array (the "Balance Sheet Accounts" children).
const topLevelTotal = (report, name) => {
  if (!Array.isArray(report)) return 0;
  const node = report.find(
    (n) => (n.name ?? "").toLowerCase() === name.toLowerCase()
  );
  return node?.totalUSD ?? 0;
};

// Month-end ISO date for `offset` months before this month (0 = this month-end).
const monthEndISO = (offset) => {
  const now = new Date();
  return formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1 - offset, 0));
};

/**
 * Net-worth time series over the last `monthCount` month-ends (for the Home
 * hero). One cached balance query per month-end via useQueries — the current
 * and prior month-ends share cache with useOverview / the balance pages.
 * Returns { data: [{ date, month, netWorth }], isLoading, failed }.
 */
export function useNetWorthSeries(monthCount = 12) {
  const dates = useMemo(() => {
    const arr = [];
    for (let i = monthCount - 1; i >= 0; i--) arr.push(monthEndISO(i));
    return arr;
  }, [monthCount]);

  const results = useQueries({
    queries: dates.map((date) => ({
      queryKey: ["balanceReport", date],
      queryFn: () => Rest.fetchBalanceReportV2(date),
      enabled: !!date,
    })),
  });

  const isLoading = results.some((r) => r.isPending);
  const failed = results.some((r) => r.isError);

  const data = useMemo(() => {
    if (isLoading || failed) return [];
    return dates.map((date, i) => {
      const report = results[i]?.data;
      return {
        date,
        month: date.slice(0, 7),
        netWorth: topLevelTotal(report, "assets") + topLevelTotal(report, "liabilities"),
      };
    });
    // results identity changes each render; gate on the loading flags instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, isLoading, failed]);

  return { data, isLoading, failed };
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
