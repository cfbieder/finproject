import { useEffect, useState } from "react";
import Rest from "../js/rest.js";
import { formatLocalDate, getMonthStart, getMonthEnd } from "../utils/dateHelpers.js";

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
  const [data, setData] = useState(null); // { netWorth, delta, income, expense, net }
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const today = formatLocalDate(now);
    const priorMonthEnd = formatLocalDate(
      new Date(now.getFullYear(), now.getMonth(), 0)
    );

    // initial state is already { loading: true, failed: false } and the
    // effect runs once on mount, so no synchronous setState needed here
    Promise.all([
      Rest.fetchBalanceReportV2(today),
      Rest.fetchBalanceReportV2(priorMonthEnd),
      Rest.fetchCashFlowReportV2({
        fromDate: getMonthStart(),
        toDate: getMonthEnd(),
        transfers: "exclude",
        includeUnrealizedGL: false,
      }),
    ])
      .then(([balNow, balPrior, cf]) => {
        if (cancelled) return;
        const income = findTopLevel(cf, "income")?.total ?? 0;
        const expense =
          (findTopLevel(cf, "expense") || findTopLevel(cf, "expenses"))?.total ??
          0;
        const netWorth = netWorthOf(balNow);
        setData({
          netWorth,
          delta: netWorth - netWorthOf(balPrior),
          income,
          expense,
          net: income + expense,
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
