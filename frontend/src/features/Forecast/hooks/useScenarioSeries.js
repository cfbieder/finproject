/**
 * useScenarioSeries (CR067 P2) — build a `buildScenarioMatrix` result for N scenarios at once.
 *
 * The Compare page loads each of its two scenarios through hooks called once per scenario
 * (`useForecastData`, `useBaseYearBalanceSheet`, a local base-year-values effect). Hooks cannot
 * be called in a loop, so N scenarios needs a different shape. That shape is `useQueries`
 * (already a dependency, already used by `useReports`), NOT a hand-rolled effect: it gives
 * per-scenario cancellation, per-scenario error state, and a cache keyed by scenario — so
 * ticking a sixth checkbox fetches the sixth scenario and leaves the five loaded lines alone,
 * where one effect over an array would refetch all six and blank the chart on every click.
 *
 * Takes scenario OBJECTS, not names: `buildScenarioMatrix` needs `PeriodStart`, which lives in
 * the assumptions document (`/forecast/assumptions` → `useScenarios`) and is in none of the
 * per-scenario fetches. The balance report is its own query keyed on `PeriodStart − 2`, which
 * is also the dedupe — every scenario sharing a PeriodStart shares one fetch, and it shares
 * cache with `useReports`/`useOverview`, which ask for the same report by the same key.
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import Rest from "../../../js/rest.js";
import { buildScenarioMatrix } from "../utils/fcCompareUtils.js";
import { aggregateBalanceReport } from "../utils/fcBalanceAggregate.js";

const lastActualYear = (periodStart) =>
  periodStart ? Number(periodStart) - 2 : null;

/**
 * @param {Array} scenarioObjs - [{ Name, PeriodStart }] from useScenarios, in display order
 * @param {Object} structure   - { cashAccountMap, balanceAccountMap, balanceAccounts }
 * @returns {{entries: Array<{name, matrix, isEmpty}>, isLoading: boolean, errors: Array}}
 */
export function useScenarioSeries(scenarioObjs, structure) {
  const { cashAccountMap, balanceAccountMap, balanceAccounts } = structure || {};
  const scenarios = useMemo(
    () => (scenarioObjs || []).filter((s) => s?.Name),
    [scenarioObjs]
  );

  const ready = Boolean(
    cashAccountMap && balanceAccountMap && balanceAccounts?.length
  );

  const perScenario = useQueries({
    queries: scenarios.map((s) => ({
      queryKey: ["fcScenarioSeries", s.Name],
      queryFn: async () => {
        const encoded = encodeURIComponent(s.Name);
        // One scenario's three payloads travel together: a matrix needs all three, so
        // resolving them as one query keeps a scenario atomically loaded or not.
        const [years, entries, baseYearValues] = await Promise.all([
          Rest.fetchJson(`/api/v2/forecast/scenarios/years/${encoded}`),
          Rest.fetchJson(`/api/v2/forecast/entries?scenario=${encoded}`),
          Rest.get(`/forecast/base-year-values?scenario=${encoded}`).then(
            (res) => res.data || {}
          ),
        ]);
        return {
          years: (Array.isArray(years?.years) ? years.years : [])
            .map(Number)
            .sort((a, b) => a - b),
          entries: Array.isArray(entries?.entries) ? entries.entries : [],
          baseYearValues,
        };
      },
    })),
  });

  // Distinct LastActualYears only — five scenarios sharing a PeriodStart make ONE request.
  const balanceYears = useMemo(() => {
    const set = new Set();
    for (const s of scenarios) {
      const y = lastActualYear(s.PeriodStart);
      if (y != null && Number.isFinite(y)) set.add(y);
    }
    return [...set].sort((a, b) => a - b);
  }, [scenarios]);

  const balanceQueries = useQueries({
    queries: balanceYears.map((year) => ({
      queryKey: ["balanceReport", `${year}-12-31`],
      queryFn: () => Rest.fetchBalanceReportV2(`${year}-12-31`),
      enabled: ready,
    })),
  });

  const isLoading =
    !ready ||
    perScenario.some((q) => q.isPending) ||
    balanceQueries.some((q) => q.isPending);

  const errors = useMemo(() => {
    const out = [];
    perScenario.forEach((q, i) => {
      if (q.isError) {
        out.push({ scenario: scenarios[i]?.Name, message: q.error?.message || "Failed to load" });
      }
    });
    if (balanceQueries.some((q) => q.isError)) {
      out.push({ scenario: null, message: "Failed to load the opening balance sheet" });
    }
    return out;
    // Query object identity changes every render; gate on the flags, as useReports does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, isLoading]);

  const entries = useMemo(() => {
    if (!ready) return [];

    const balanceByYear = new Map();
    balanceYears.forEach((year, i) => {
      const report = balanceQueries[i]?.data;
      if (report) balanceByYear.set(year, aggregateBalanceReport(report, balanceAccountMap));
    });

    return scenarios.map((s, i) => {
      const payload = perScenario[i]?.data;
      if (!payload) return { name: s.Name, matrix: null, isEmpty: false, loaded: false };

      // No entries ⇒ the years endpoint returns nothing (it reads DISTINCT forecast_year off
      // forecast_entries), so an ungenerated scenario is EMPTY, not broken. The page says so
      // rather than letting the reader count four lines where they ticked five.
      const isEmpty = payload.years.length === 0;

      const matrix = isEmpty
        ? null
        : buildScenarioMatrix({
            entries: payload.entries,
            years: payload.years,
            periodStart: s.PeriodStart,
            baseYearValues: payload.baseYearValues,
            lastActualBalance: balanceByYear.get(lastActualYear(s.PeriodStart)) || null,
            cashAccountMap,
            balanceAccountMap,
            balanceRows: balanceAccounts,
          });

      return { name: s.Name, matrix, isEmpty, loaded: true };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarios, balanceYears, isLoading, ready, cashAccountMap, balanceAccountMap, balanceAccounts]);

  return { entries, isLoading, errors };
}
