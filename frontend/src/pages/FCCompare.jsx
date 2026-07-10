/**
 * Forecast Compare Page (CR040)
 *
 * Pick two forecast scenarios (baseline A, comparison B) and see where they
 * differ: KPI deltas, the Review page's P&L + balance-sheet grids as deltas,
 * A-vs-B trajectory charts, and instant deterministic commentary.
 *
 * All diffing happens client-side over the two scenarios' /entries payloads
 * (fcCompareUtils mirrors FCReview's pivot, so A/B columns reconcile with
 * the Review page). Deltas read B − A throughout.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Landmark, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import FCStepNav from "../features/Forecast/FCStepNav.jsx";
import FCCompareTable from "../features/Forecast/FCCompareTable.jsx";
import FCCompareCharts from "../features/Forecast/FCCompareCharts.jsx";
import FCCompareCommentary from "../features/Forecast/FCCompareCommentary.jsx";
import FCCompareAIPanel from "../features/Forecast/FCCompareAIPanel.jsx";
import { useScenarios } from "../features/Forecast/hooks/useScenarios.js";
import { useForecastData } from "../features/Forecast/hooks/useForecastData.js";
import { useFCLineStructure } from "../features/Forecast/hooks/useFCLineStructure.js";
import { useBalanceSheetAccounts } from "../features/Forecast/hooks/useBalanceSheetAccounts.js";
import { useBaseYearBalanceSheet } from "../features/Forecast/hooks/useBaseYearBalanceSheet.js";
import {
  buildScenarioMatrix,
  compareMatrices,
  buildCommentary,
} from "../features/Forecast/utils/fcCompareUtils.js";
import { KpiCard, KpiCardRow } from "../components/KpiCards.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "./FCCompare.css";

function useBaseYearValues(scenario) {
  const [values, setValues] = useState({});
  useEffect(() => {
    if (!scenario) {
      setValues({});
      return;
    }
    let cancelled = false;
    Rest.get(`/forecast/base-year-values?scenario=${encodeURIComponent(scenario)}`)
      .then((res) => {
        if (!cancelled) setValues(res.data || {});
      })
      .catch(() => {
        if (!cancelled) setValues({});
      });
    return () => {
      cancelled = true;
    };
  }, [scenario]);
  return values;
}

export default function FCCompare() {
  const { scenarios, isLoading: scenariosLoading, loadError: scenariosError } =
    useScenarios();

  const [scenarioA, setScenarioA] = useState("");
  const [scenarioB, setScenarioB] = useState("");
  const [mode, setMode] = useState("delta"); // "delta" | "a" | "b"
  const [hideUnchanged, setHideUnchanged] = useState(true);

  // Default A = first scenario, B = first different one.
  useEffect(() => {
    if (!scenarios.length) return;
    setScenarioA((cur) => (cur ? cur : scenarios[0]?.Name || ""));
    setScenarioB((cur) => {
      if (cur) return cur;
      const firstOther = scenarios.find((s) => s.Name !== scenarios[0]?.Name);
      return firstOther?.Name || scenarios[0]?.Name || "";
    });
  }, [scenarios]);

  const scenarioObjA = useMemo(
    () => scenarios.find((s) => s.Name === scenarioA),
    [scenarios, scenarioA]
  );
  const scenarioObjB = useMemo(
    () => scenarios.find((s) => s.Name === scenarioB),
    [scenarios, scenarioB]
  );

  const dataA = useForecastData(scenarioA);
  const dataB = useForecastData(scenarioB);
  const { cashAccounts, cashAccountMap, loading: linesLoading, error: linesError } =
    useFCLineStructure();
  const {
    balanceAccounts,
    balanceAccountMap,
    loading: balanceLoading,
    error: balanceError,
  } = useBalanceSheetAccounts();

  const baseYearValuesA = useBaseYearValues(scenarioA);
  const baseYearValuesB = useBaseYearValues(scenarioB);
  const baseBalA = useBaseYearBalanceSheet(scenarioObjA?.PeriodStart, balanceAccountMap);
  const baseBalB = useBaseYearBalanceSheet(scenarioObjB?.PeriodStart, balanceAccountMap);

  const loading =
    scenariosLoading ||
    linesLoading ||
    balanceLoading ||
    dataA.yearsLoading ||
    dataA.entriesLoading ||
    dataB.yearsLoading ||
    dataB.entriesLoading ||
    baseBalA.loading ||
    baseBalB.loading;

  const error =
    scenariosError ||
    linesError ||
    balanceError ||
    dataA.yearsError ||
    dataA.entriesError ||
    dataB.yearsError ||
    dataB.entriesError;

  const compare = useMemo(() => {
    if (loading || !scenarioA || !scenarioB) return null;
    if (!cashAccounts.length || !balanceAccounts.length) return null;

    const build = (data, scenarioObj, baseYearValues, baseBal) =>
      buildScenarioMatrix({
        entries: data.entries,
        years: data.years,
        periodStart: scenarioObj?.PeriodStart,
        baseYearValues,
        lastActualBalance: scenarioObj?.PeriodStart
          ? baseBal.baseBalanceTotalsByYear.get(Number(scenarioObj.PeriodStart) - 2)
          : null,
        cashAccountMap,
        balanceAccountMap,
        balanceRows: balanceAccounts,
      });

    const matA = build(dataA, scenarioObjA, baseYearValuesA, baseBalA);
    const matB = build(dataB, scenarioObjB, baseYearValuesB, baseBalB);
    return compareMatrices(matA, matB, {
      cashRows: cashAccounts,
      balanceRows: balanceAccounts,
    });
  }, [
    loading,
    scenarioA,
    scenarioB,
    dataA,
    dataB,
    scenarioObjA,
    scenarioObjB,
    baseYearValuesA,
    baseYearValuesB,
    baseBalA,
    baseBalB,
    cashAccounts,
    cashAccountMap,
    balanceAccounts,
    balanceAccountMap,
  ]);

  const commentary = useMemo(
    () =>
      compare ? buildCommentary(compare, { a: scenarioA, b: scenarioB }) : [],
    [compare, scenarioA, scenarioB]
  );

  const kpis = useMemo(() => {
    if (!compare) return null;
    const lastCommon = (() => {
      const d = compare.totals.netAssets.delta;
      for (let i = d.length - 1; i >= 0; i--) if (d[i] != null) return i;
      return -1;
    })();
    if (lastCommon < 0) return null;
    const year = compare.years[lastCommon];
    const card = (row) => ({
      value: row.b[lastCommon] ?? 0,
      delta: row.delta[lastCommon] ?? 0,
      chart: row.delta.map((d) => ({ value: d ?? 0 })),
    });
    return {
      year,
      netAssets: card(compare.totals.netAssets),
      totalAssets: card(compare.totals.totalAssets),
      netCashFlow: card(compare.totals.netCashFlow),
      expense: card(compare.totals.expense),
    };
  }, [compare]);

  const swap = () => {
    setScenarioA(scenarioB);
    setScenarioB(scenarioA);
  };

  const sameScenario = scenarioA && scenarioA === scenarioB;

  return (
    <main className="page-main trans-budget-main">
      <FCStepNav />

      <div className="fc-compare-controls">
        <div className="fc-compare-picker">
          <label htmlFor="fc-compare-a">Baseline (A)</label>
          <select
            id="fc-compare-a"
            value={scenarioA}
            onChange={(e) => setScenarioA(e.target.value)}
            disabled={scenariosLoading}
          >
            {scenarios.map((s) => (
              <option key={s.Name} value={s.Name}>
                {s.Name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="fc-compare-swap"
          onClick={swap}
          title="Swap baseline and comparison"
          aria-label="Swap scenarios"
        >
          <ArrowLeftRight size={16} />
        </button>
        <div className="fc-compare-picker">
          <label htmlFor="fc-compare-b">Comparison (B)</label>
          <select
            id="fc-compare-b"
            value={scenarioB}
            onChange={(e) => setScenarioB(e.target.value)}
            disabled={scenariosLoading}
          >
            {scenarios.map((s) => (
              <option key={s.Name} value={s.Name}>
                {s.Name}
              </option>
            ))}
          </select>
        </div>

        <div className="fc-compare-mode-toggle" role="tablist" aria-label="Cell values">
          {[
            { key: "delta", label: "Δ (B − A)" },
            { key: "a", label: "A" },
            { key: "b", label: "B" },
          ].map((m) => (
            <button
              key={m.key}
              role="tab"
              aria-selected={mode === m.key}
              className={mode === m.key ? "active" : ""}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <label className="fc-compare-hide-toggle">
          <input
            type="checkbox"
            checked={hideUnchanged}
            onChange={(e) => setHideUnchanged(e.target.checked)}
          />
          Hide unchanged rows
        </label>
      </div>

      {error && <div className="fc-compare-error">{error}</div>}
      {sameScenario && (
        <div className="fc-compare-hint">
          Comparing a scenario to itself — every difference is zero. Pick a
          different comparison scenario.
        </div>
      )}
      {loading && <div className="fc-compare-loading">Loading scenarios…</div>}

      {!loading && kpis && (
        <KpiCardRow>
          <KpiCard
            title="Net Assets (B)"
            value={kpis.netAssets.value}
            icon={<Landmark size={16} />}
            changeValue={kpis.netAssets.delta}
            changeLabel={`vs ${scenarioA} in ${kpis.year}`}
            positiveIsGood={true}
            chartData={kpis.netAssets.chart}
            chartType="area"
            chartColor="#4A72B0"
          />
          <KpiCard
            title="Total Assets (B)"
            value={kpis.totalAssets.value}
            icon={<TrendingUp size={16} />}
            changeValue={kpis.totalAssets.delta}
            changeLabel={`vs ${scenarioA} in ${kpis.year}`}
            positiveIsGood={true}
            chartData={kpis.totalAssets.chart}
            chartType="area"
            chartColor="#4A72B0"
          />
          <KpiCard
            title="Net Cash Flow (B)"
            value={kpis.netCashFlow.value}
            icon={<DollarSign size={16} />}
            changeValue={kpis.netCashFlow.delta}
            changeLabel={`vs ${scenarioA} in ${kpis.year}`}
            positiveIsGood={true}
            chartData={kpis.netCashFlow.chart}
            chartType="area"
            chartColor="#4A72B0"
          />
          <KpiCard
            title="Expenses (B)"
            value={kpis.expense.value}
            icon={<TrendingDown size={16} />}
            changeValue={kpis.expense.delta}
            changeLabel={`vs ${scenarioA} in ${kpis.year}`}
            positiveIsGood={true}
            chartData={kpis.expense.chart}
            chartType="area"
            chartColor="#4A72B0"
          />
        </KpiCardRow>
      )}

      {!loading && commentary.length > 0 && (
        <FCCompareCommentary items={commentary} />
      )}

      {!loading && compare && (
        <FCCompareAIPanel scenarioA={scenarioA} scenarioB={scenarioB} />
      )}

      {!loading && compare && (
        <FCCompareCharts compare={compare} nameA={scenarioA} nameB={scenarioB} />
      )}

      {!loading && compare && (
        <FCCompareTable
          compare={compare}
          nameA={scenarioA}
          nameB={scenarioB}
          mode={mode}
          hideUnchanged={hideUnchanged}
        />
      )}
    </main>
  );
}
