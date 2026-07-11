import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useCashFlowReport } from "../../hooks/useReports.js";
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

// Flatten any account subtree to its leaves (no children).
const flattenLeaves = (node, out = []) => {
  if (!node) return out;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    out.push(node);
    return out;
  }
  for (const c of children) flattenLeaves(c, out);
  return out;
};

const TOP_EXPENSES_DEFAULT = 8;
const TOP_INCOME_DEFAULT = 5;

export default function MobileCashFlow() {
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD_KEY);
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [showAllIncome, setShowAllIncome] = useState(false);

  // Collapse the "show all" lists when the period changes — the React
  // "adjust state during render" pattern (no effect, no cascading render).
  const [prevPeriodKey, setPrevPeriodKey] = useState(periodKey);
  if (periodKey !== prevPeriodKey) {
    setPrevPeriodKey(periodKey);
    setShowAllExpenses(false);
    setShowAllIncome(false);
  }

  const period = useMemo(() => getPreset(periodKey).range(), [periodKey]);

  const {
    data: report,
    isPending: isLoading,
    error: reportError,
  } = useCashFlowReport({
    fromDate: period.fromDate,
    toDate: period.toDate,
    transfers: "exclude",
    includeUnrealizedGL: false,
  });
  const error = reportError
    ? reportError.message ?? "Failed to load cash flow report"
    : "";

  const kpis = useMemo(() => {
    if (!report) return null;
    const incomeNode = findTopLevel(report, "income");
    const expenseNode =
      findTopLevel(report, "expense") || findTopLevel(report, "expenses");
    const income = incomeNode?.total ?? 0;
    const expense = expenseNode?.total ?? 0;
    return {
      income,
      expense,
      net: income + expense,
    };
  }, [report]);

  const incomeLeaves = useMemo(() => {
    if (!report) return [];
    const node = findTopLevel(report, "income");
    return flattenLeaves(node)
      .map((l) => ({ name: l.name, total: l.total ?? 0 }))
      .filter((l) => l.total !== 0)
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [report]);

  const expenseLeaves = useMemo(() => {
    if (!report) return [];
    const node =
      findTopLevel(report, "expense") || findTopLevel(report, "expenses");
    return flattenLeaves(node)
      .map((l) => ({ name: l.name, total: l.total ?? 0 }))
      .filter((l) => l.total !== 0)
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [report]);

  const visibleExpenses = showAllExpenses
    ? expenseLeaves
    : expenseLeaves.slice(0, TOP_EXPENSES_DEFAULT);
  const visibleIncome = showAllIncome
    ? incomeLeaves
    : incomeLeaves.slice(0, TOP_INCOME_DEFAULT);

  if (isLoading && !report) {
    return (
      <div className="m-state">
        <Loader2 size={28} className="m-spin" />
        <span>Loading cash flow…</span>
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
        <div className="m-kpis">
          <div className="m-kpi m-kpi--hero">
            <span className="m-kpi__label">Net</span>
            <span
              className={
                "m-kpi__value" + (kpis.net < 0 ? " m-kpi__value--negative" : "")
              }
            >
              {formatKpi(kpis.net)}
            </span>
          </div>
          <div className="m-kpi">
            <span className="m-kpi__label">Income</span>
            <span className="m-kpi__value m-kpi__value--positive">
              {formatKpi(kpis.income)}
            </span>
          </div>
          <div className="m-kpi">
            <span className="m-kpi__label">Expenses</span>
            <span
              className={
                "m-kpi__value" +
                (kpis.expense < 0 ? " m-kpi__value--negative" : "")
              }
            >
              {formatKpi(kpis.expense)}
            </span>
          </div>
        </div>
      )}

      {expenseLeaves.length > 0 && (
        <>
          <h2 className="m-section-h">Top Expenses</h2>
          <div className="m-cat-list">
            {visibleExpenses.map((row, i) => (
              <div className="m-cat-row" key={`e-${row.name}-${i}`}>
                <span className="m-cat-row__name">{row.name}</span>
                <span className="m-cat-row__amt">{formatKpi(row.total)}</span>
              </div>
            ))}
          </div>
          {expenseLeaves.length > TOP_EXPENSES_DEFAULT && (
            <button
              type="button"
              className="m-seeall"
              onClick={() => setShowAllExpenses((v) => !v)}
            >
              {showAllExpenses
                ? "Show top expenses"
                : `See all ${expenseLeaves.length} expense categories`}
            </button>
          )}
        </>
      )}

      {incomeLeaves.length > 0 && (
        <>
          <h2 className="m-section-h">Top Income</h2>
          <div className="m-cat-list">
            {visibleIncome.map((row, i) => (
              <div className="m-cat-row" key={`i-${row.name}-${i}`}>
                <span className="m-cat-row__name">{row.name}</span>
                <span className="m-cat-row__amt m-cat-row__amt--income">
                  {formatKpi(row.total)}
                </span>
              </div>
            ))}
          </div>
          {incomeLeaves.length > TOP_INCOME_DEFAULT && (
            <button
              type="button"
              className="m-seeall"
              onClick={() => setShowAllIncome((v) => !v)}
            >
              {showAllIncome
                ? "Show top income"
                : `See all ${incomeLeaves.length} income sources`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
