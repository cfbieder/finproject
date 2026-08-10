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
import { scenarioOptions, scenarioOptionTitle } from "../features/Forecast/utils/scenarioOptions.js";
import { useForecastData } from "../features/Forecast/hooks/useForecastData.js";
import { useFCLineStructure } from "../features/Forecast/hooks/useFCLineStructure.js";
import { useBalanceSheetAccounts } from "../features/Forecast/hooks/useBalanceSheetAccounts.js";
import { useBaseYearBalanceSheet } from "../features/Forecast/hooks/useBaseYearBalanceSheet.js";
import {
  buildScenarioMatrix,
  compareMatrices,
  buildCommentary,
  deflateMatrix,
} from "../features/Forecast/utils/fcCompareUtils.js";
import { buildDeflators, inflationRateFor } from "../features/Forecast/utils/fcRealTerms.js";
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
  const {
    scenarios,
    inflationRows,               // CR079 — the real-terms deflator
    isLoading: scenariosLoading,
    loadError: scenariosError,
  } = useScenarios();

  const [scenarioA, setScenarioA] = useState("");
  const [scenarioB, setScenarioB] = useState("");
  const [mode, setMode] = useState("delta"); // "delta" | "a" | "b"
  const [hideUnchanged, setHideUnchanged] = useState(true);
  // Resets to nominal every visit, like the Review's: nominal is the basis the export, the audit
  // CSVs and every figure in the docs speak.
  const [realTerms, setRealTerms] = useState(false);

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

  const matrices = useMemo(() => {
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

    return {
      matA: build(dataA, scenarioObjA, baseYearValuesA, baseBalA),
      matB: build(dataB, scenarioObjB, baseYearValuesB, baseBalB),
    };
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

  // CR079 increment 3 — "today" for a COMPARISON of two scenarios.
  //
  // Each scenario's own base year is its PeriodStart − 1, and the two need not agree. Anchoring
  // each on its own would put A in one year's money and B in another while the page called both
  // "today", and every delta between them would be the difference of two different currencies.
  // The earlier of the two is used for BOTH, and the banner names it.
  const realTermsAnchor = useMemo(() => {
    const a = Number(scenarioObjA?.PeriodStart);
    const b = Number(scenarioObjB?.PeriodStart);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.min(a, b) - 1;
  }, [scenarioObjA, scenarioObjB]);

  // Offered only when BOTH scenarios declare inflation. Checked independently of the toggle so the
  // control is disabled rather than silently doing nothing when ticked.
  const realTermsAvailable =
    realTermsAnchor != null &&
    inflationRateFor(inflationRows, scenarioA, realTermsAnchor) != null &&
    inflationRateFor(inflationRows, scenarioB, realTermsAnchor) != null;

  const deflators = useMemo(() => {
    if (!realTerms || !matrices || realTermsAnchor == null) return null;
    const of = (name, years) =>
      buildDeflators({ inflationRows, scenarioName: name, baseYear: realTermsAnchor, years });
    const a = of(scenarioA, matrices.matA.years);
    const b = of(scenarioB, matrices.matB.years);
    // BOTH or NEITHER. One side in today's money against the other in 2062 money would make every
    // delta on the page meaningless while still looking exactly like money.
    return a && b ? { a, b } : null;
  }, [realTerms, matrices, realTermsAnchor, inflationRows, scenarioA, scenarioB]);

  // Each scenario is deflated by ITS OWN inflation. That is the point rather than a detail: if
  // Downside assumes higher inflation than Base, its nominal 2062 figure is inflated by more, and
  // comparing the two nominally flatters it for a reason that has nothing to do with the plan.
  const compare = useMemo(() => {
    if (!matrices) return null;
    const matA = deflators ? deflateMatrix(matrices.matA, deflators.a) : matrices.matA;
    const matB = deflators ? deflateMatrix(matrices.matB, deflators.b) : matrices.matB;
    return compareMatrices(matA, matB, {
      cashRows: cashAccounts,
      balanceRows: balanceAccounts,
    });
  }, [matrices, deflators, cashAccounts, balanceAccounts]);

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

  // Rebuild BOTH sides, then reload. Compare diffs two `/entries` payloads, so a scenario that
  // was never generated — or was edited since it last was — reads as "only in the other one",
  // which looks like a finding and isn't. Review has a Generate for one scenario; here it has to
  // be both, or the comparison is between a fresh scenario and a stale one.
  //
  // SEQUENTIAL, not parallel: the engine takes pg_advisory_xact_lock(scenario_id) and rebuilds
  // inside one transaction. Two builds would not corrupt each other, but firing them together
  // buys nothing and makes a failure harder to attribute. A variant (CR050) re-materializes from
  // its base at the top of its own build, so ordering A before B is enough — no extra step here.
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateResult, setGenerateResult] = useState("");

  const handleGenerateBoth = async () => {
    if (!scenarioA || !scenarioB || generating) return;

    setGenerating(true);
    setGenerateError("");
    setGenerateResult("");

    // Comparing a scenario with itself is legal (every delta is zero) — don't build it twice.
    const targets = sameScenario ? [scenarioA] : [scenarioA, scenarioB];

    try {
      const built = [];
      for (const name of targets) {
        const result = await Rest.fetchJson(
          `/api/v2/forecast/generate/${encodeURIComponent(name)}`,
          { method: "POST" }
        );
        built.push(`${name} (${result?.entriesCreated ?? 0} entries)`);
      }
      dataA.reload();
      dataB.reload();
      setGenerateResult(`Rebuilt ${built.join(" · ")}`);
    } catch (err) {
      // Name the scenario that failed — "generation failed" over two scenarios is half an answer.
      setGenerateError(err.message || "Failed to generate the forecasts");
    } finally {
      setGenerating(false);
    }
  };

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
            {scenarioOptions(scenarios).map((option) => (
              <option key={option.name} value={option.name} title={scenarioOptionTitle(option)}>
                {option.label}
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
            {scenarioOptions(scenarios).map((option) => (
              <option key={option.name} value={option.name} title={scenarioOptionTitle(option)}>
                {option.label}
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

        {/* CR079 increment 3 — the same control the Review carries, on the surface where nominal
            misleads most: two scenarios 36 years out are both inflated by the same factor, so
            comparing them nominally flatters BOTH and hides how much of a gap is purchasing power
            rather than plan. Disabled, not hidden, when a scenario declares no inflation — an
            absent control reads as a missing feature, a disabled one states why. */}
        <label
          className="fc-compare-hide-toggle"
          title={
            realTermsAvailable
              ? `Express both scenarios in ${realTermsAnchor} dollars`
              : "Both scenarios must declare an inflation rate"
          }
        >
          <input
            type="checkbox"
            checked={realTerms && realTermsAvailable}
            disabled={!realTermsAvailable}
            onChange={(e) => setRealTerms(e.target.checked)}
          />
          Show in {realTermsAnchor ?? "base-year"} dollars
        </label>

        {/* Rebuilds A and B, so the comparison is between two current forecasts. */}
        <button
          type="button"
          className="btn btn--primary fc-compare-generate"
          onClick={handleGenerateBoth}
          disabled={generating || loading || !scenarioA || !scenarioB}
          title={
            sameScenario
              ? `Rebuild "${scenarioA}"`
              : `Rebuild both "${scenarioA}" and "${scenarioB}" from their current modules and assumptions`
          }
        >
          <span aria-hidden="true">⚡</span>
          {generating ? "Generating both..." : "Generate both"}
        </button>
      </div>

      {generateError && <div className="fc-compare-error">{generateError}</div>}
      {generateResult && <div className="fc-compare-hint">{generateResult}</div>}
      {error && <div className="fc-compare-error">{error}</div>}
      {sameScenario && (
        <div className="fc-compare-hint">
          Comparing a scenario to itself — every difference is zero. Pick a
          different comparison scenario.
        </div>
      )}
      {loading && <div className="fc-compare-loading">Loading scenarios…</div>}

      {/* A screenshot crops to the figures, not to the control that produced them. */}
      {deflators && (
        <div className="fc-compare-real-terms-banner">
          Every figure below — deltas included — is in <b>{realTermsAnchor} dollars</b>, each
          scenario deflated by its own inflation.
        </div>
      )}

      {!loading && kpis && (
        <KpiCardRow>
          <KpiCard
            title={deflators ? "Net Assets (B) · " + realTermsAnchor + "$" : "Net Assets (B)"}
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
            title={deflators ? "Total Assets (B) · " + realTermsAnchor + "$" : "Total Assets (B)"}
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
            title={deflators ? "Net Cash Flow (B) · " + realTermsAnchor + "$" : "Net Cash Flow (B)"}
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
            title={deflators ? "Expenses (B) · " + realTermsAnchor + "$" : "Expenses (B)"}
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
