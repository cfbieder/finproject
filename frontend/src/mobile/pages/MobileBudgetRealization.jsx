import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import Rest from "../../js/rest.js";
import { PERIOD_PRESETS, DEFAULT_PERIOD_KEY, getPreset } from "../periodPresets.js";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatKpi = (value) => {
  const n = value ?? 0;
  return n < 0
    ? `(${currencyFormatter.format(Math.abs(n))})`
    : currencyFormatter.format(n);
};

const findTopLevel = (nodes, name) => {
  if (!Array.isArray(nodes)) return null;
  return (
    nodes.find((n) => (n.name ?? "").toLowerCase() === name.toLowerCase()) ||
    null
  );
};

// Flatten subtree to leaves while tagging each leaf with its top-level kind.
const flattenLeavesTagged = (node, kind, out = []) => {
  if (!node) return out;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    out.push({ name: node.name, total: node.total ?? 0, kind });
    return out;
  }
  for (const c of children) flattenLeavesTagged(c, kind, out);
  return out;
};

// Build a flat map: leafName → { actual, budget, kind }.
const buildLeafMap = (actualReport, budgetReport) => {
  const map = new Map();

  const accumulate = (report, key) => {
    if (!Array.isArray(report)) return;
    const incomeNode = findTopLevel(report, "income");
    const expenseNode =
      findTopLevel(report, "expense") || findTopLevel(report, "expenses");
    const leaves = [
      ...flattenLeavesTagged(incomeNode, "income"),
      ...flattenLeavesTagged(expenseNode, "expense"),
    ];
    for (const leaf of leaves) {
      if (!leaf.name) continue;
      if (!map.has(leaf.name)) {
        map.set(leaf.name, { name: leaf.name, kind: leaf.kind, actual: 0, budget: 0 });
      }
      const entry = map.get(leaf.name);
      entry[key] = leaf.total;
      if (!entry.kind) entry.kind = leaf.kind;
    }
  };

  accumulate(actualReport, "actual");
  accumulate(budgetReport, "budget");
  return map;
};

const TOP_VARIANCES_DEFAULT = 8;

export default function MobileBudgetRealization() {
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD_KEY);
  const [actualReport, setActualReport] = useState(null);
  const [budgetReport, setBudgetReport] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const period = useMemo(() => getPreset(periodKey).range(), [periodKey]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    setShowAll(false);
    Promise.all([
      Rest.fetchCashFlowReportV2({
        fromDate: period.fromDate,
        toDate: period.toDate,
        transfers: "exclude",
        includeUnrealizedGL: false,
      }),
      Rest.fetchBudgetCashFlowReport({
        fromDate: period.fromDate,
        toDate: period.toDate,
        transfers: "exclude",
        includeUnrealizedGL: false,
      }),
    ])
      .then(([actual, budget]) => {
        if (cancelled) return;
        setActualReport(actual);
        setBudgetReport(budget);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load budget realization");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period.fromDate, period.toDate]);

  const kpis = useMemo(() => {
    if (!actualReport && !budgetReport) return null;
    const incomeActual = findTopLevel(actualReport, "income")?.total ?? 0;
    const incomeBudget = findTopLevel(budgetReport, "income")?.total ?? 0;
    const expenseActual =
      (findTopLevel(actualReport, "expense") ||
        findTopLevel(actualReport, "expenses"))?.total ?? 0;
    const expenseBudget =
      (findTopLevel(budgetReport, "expense") ||
        findTopLevel(budgetReport, "expenses"))?.total ?? 0;
    const netActual = incomeActual + expenseActual;
    const netBudget = incomeBudget + expenseBudget;
    const savingsRate =
      incomeActual > 0 ? (netActual / incomeActual) * 100 : 0;
    return {
      incomeActual,
      incomeBudget,
      expenseActual,
      expenseBudget,
      netActual,
      netBudget,
      savingsRate,
    };
  }, [actualReport, budgetReport]);

  const variances = useMemo(() => {
    if (!actualReport && !budgetReport) return [];
    const map = buildLeafMap(actualReport, budgetReport);
    const rows = [];
    for (const entry of map.values()) {
      const variance = entry.actual - entry.budget;
      if (variance === 0 && entry.actual === 0 && entry.budget === 0) continue;
      // For income, positive variance is good. For expense (negative numbers),
      // a less-negative actual (variance > 0) is also good.
      const isGood = variance >= 0;
      rows.push({
        ...entry,
        variance,
        isGood,
        absVariance: Math.abs(variance),
      });
    }
    rows.sort((a, b) => b.absVariance - a.absVariance);
    return rows;
  }, [actualReport, budgetReport]);

  const visibleVariances = showAll
    ? variances
    : variances.slice(0, TOP_VARIANCES_DEFAULT);

  if (isLoading && !actualReport && !budgetReport) {
    return (
      <div className="m-state">
        <Loader2 size={28} className="m-spin" />
        <span>Loading budget realization…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-state m-state--error">
        <AlertTriangle size={28} />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="m-period-row" role="tablist" aria-label="Period">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={periodKey === p.key}
            className={
              "m-period-pill" +
              (periodKey === p.key ? " m-period-pill--active" : "")
            }
            onClick={() => setPeriodKey(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {kpis && (
        <div className="m-kpis m-kpis--grid">
          <div className="m-kpi">
            <span className="m-kpi__label">Income</span>
            <span className="m-kpi__value m-kpi__value--positive">
              {formatKpi(kpis.incomeActual)}
            </span>
            <span className="m-kpi__sub">
              vs {formatKpi(kpis.incomeBudget)}
            </span>
          </div>
          <div className="m-kpi">
            <span className="m-kpi__label">Expenses</span>
            <span
              className={
                "m-kpi__value" +
                (kpis.expenseActual < 0 ? " m-kpi__value--negative" : "")
              }
            >
              {formatKpi(kpis.expenseActual)}
            </span>
            <span className="m-kpi__sub">
              vs {formatKpi(kpis.expenseBudget)}
            </span>
          </div>
          <div className="m-kpi">
            <span className="m-kpi__label">Net Cash Flow</span>
            <span
              className={
                "m-kpi__value" +
                (kpis.netActual < 0 ? " m-kpi__value--negative" : "")
              }
            >
              {formatKpi(kpis.netActual)}
            </span>
            <span className="m-kpi__sub">vs {formatKpi(kpis.netBudget)}</span>
          </div>
          <div className="m-kpi">
            <span className="m-kpi__label">Savings Rate</span>
            <span
              className={
                "m-kpi__value" +
                (kpis.savingsRate < 0 ? " m-kpi__value--negative" : "")
              }
            >
              {kpis.savingsRate.toFixed(0)}%
            </span>
            <span className="m-kpi__sub">of income</span>
          </div>
        </div>
      )}

      {variances.length > 0 && (
        <>
          <h2 className="m-section-h">Top Variances</h2>
          <div className="m-var-list">
            {visibleVariances.map((row, i) => {
              const budgetMag = Math.abs(row.budget) || 1;
              const actualMag = Math.abs(row.actual);
              const pct = Math.min((actualMag / budgetMag) * 100, 150);
              return (
                <div className="m-var" key={`v-${row.name}-${i}`}>
                  <div className="m-var__top">
                    <span className="m-var__name">{row.name}</span>
                    <span
                      className={
                        "m-var__delta " +
                        (row.isGood ? "m-var__delta--good" : "m-var__delta--bad")
                      }
                    >
                      {row.variance >= 0 ? "+" : ""}
                      {formatKpi(row.variance)}
                    </span>
                  </div>
                  <div className="m-var__bar">
                    <div
                      className={
                        "m-var__fill" + (row.isGood ? "" : " m-var__fill--bad")
                      }
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="m-var__meta">
                    <span>Actual {formatKpi(row.actual)}</span>
                    <span>Budget {formatKpi(row.budget)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {variances.length > TOP_VARIANCES_DEFAULT && (
            <button
              type="button"
              className="m-seeall"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll
                ? "Show top variances"
                : `See all ${variances.length} categories`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
