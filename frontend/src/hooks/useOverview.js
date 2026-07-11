import { useMemo } from "react";
import { formatLocalDate, getMonthStart, getMonthEnd } from "../utils/dateHelpers.js";
import { useBalanceReport, useCashFlowReport } from "./useReports.js";

/**
 * useOverview — the "where do I stand" numbers shared by desktop Home and
 * MobileHome (CR038 P1): net worth today, its delta vs last month-end, and
 * this month's income / expenses / net cash flow.
 *
 * One fetch per mount (three parallel report calls). Both shells render the
 * same object; only the presentation differs.
 */

const findTopLevel = (nodes, name) => {
  if (!Array.isArray(nodes)) return null;
  return (
    nodes.find((n) => (n.name ?? "").toLowerCase() === name.toLowerCase()) ||
    null
  );
};

const netWorthOf = (report) => {
  const assets = findTopLevel(report, "assets")?.totalUSD ?? 0;
  const liabilities = findTopLevel(report, "liabilities")?.totalUSD ?? 0;
  return assets + liabilities; // liabilities stored negative
};

export function useOverview() {
  // Compute the date windows once per mount so the query keys stay stable
  // across re-renders (same cache entries as the balance / cash-flow pages).
  const { today, priorMonthEnd, fromDate, toDate } = useMemo(() => {
    const now = new Date();
    return {
      today: formatLocalDate(now),
      priorMonthEnd: formatLocalDate(
        new Date(now.getFullYear(), now.getMonth(), 0)
      ),
      fromDate: getMonthStart(),
      toDate: getMonthEnd(),
    };
  }, []);

  // Three shared, cached report queries — deduped against the Balance and
  // Cash Flow pages that request the same date/range.
  const balNowQ = useBalanceReport(today);
  const balPriorQ = useBalanceReport(priorMonthEnd);
  const cfQ = useCashFlowReport({
    fromDate,
    toDate,
    transfers: "exclude",
    includeUnrealizedGL: false,
  });

  const isLoading = balNowQ.isPending || balPriorQ.isPending || cfQ.isPending;
  const failed = balNowQ.isError || balPriorQ.isError || cfQ.isError;

  const data = useMemo(() => {
    if (isLoading || failed) return null;
    const cf = cfQ.data;
    const income = findTopLevel(cf, "income")?.total ?? 0;
    const expense =
      (findTopLevel(cf, "expense") || findTopLevel(cf, "expenses"))?.total ?? 0;
    const netWorth = netWorthOf(balNowQ.data);
    return {
      netWorth,
      delta: netWorth - netWorthOf(balPriorQ.data),
      income,
      expense,
      net: income + expense,
    };
  }, [isLoading, failed, balNowQ.data, balPriorQ.data, cfQ.data]);

  return { data, isLoading, failed };
}

const overviewCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** Accountant-style formatter shared by both overview renderings. */
export const formatOverviewKpi = (value) => {
  const n = value ?? 0;
  return n < 0
    ? `(${overviewCurrencyFormatter.format(Math.abs(n))})`
    : overviewCurrencyFormatter.format(n);
};
