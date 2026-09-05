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

// Month-end ISO date for `offset` months before this month, CLAMPED to today
// for the current month (offset 0).
//
// CR092: this used to return the current month's END — a future date for all but
// one day a month. Harmless while nothing was dated ahead, and wrong the moment
// something is: the chart plotted a point the calendar has not reached, the hero
// printed today's net worth beside a delta measured to month-end, and the
// "What changed?" window opened on "to Sep 30, 2026" while sitting under a
// figure read on the 5th. Found by rendering the page, not by a test — dev
// carries future-dated rows and prod happens not to.
const monthEndISO = (offset) => {
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1 - offset, 0);
  return formatLocalDate(monthEnd > now ? now : monthEnd);
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

/**
 * CR092 — the net-worth bridge for one window, fetched lazily.
 *
 * `enabled` is the point: the Home hero mounts on every visit, and this is a
 * dozen balance builds. It runs only once the modal is actually opened.
 */
export function useNetWorthBridge({
  fromDate, toDate, granularity = "month", movers, enabled = true,
}) {
  return useQuery({
    // `movers` is IN the key: the modal's capped answer and the report's full
    // one are different payloads for the same window, and sharing a key would
    // serve whichever landed first.
    queryKey: [
      "netWorthBridge",
      { fromDate: fromDate ?? null, toDate: toDate ?? null, granularity, movers: movers ?? null },
    ],
    queryFn: () => Rest.fetchNetWorthBridgeV2({ fromDate, toDate, granularity, movers }),
    enabled: Boolean(enabled && fromDate && toDate),
    staleTime: 5 * 60 * 1000,
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
