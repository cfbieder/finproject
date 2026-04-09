import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { AlertTriangle, Loader2 } from "lucide-react";
import Rest from "../../js/rest.js";
import { PERIOD_PRESETS, DEFAULT_PERIOD_KEY, getPreset } from "../periodPresets.js";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatShort = (value) => {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1000)}k`;
  return `${sign}${Math.round(abs)}`;
};

const findTopLevel = (nodes, name) => {
  if (!Array.isArray(nodes)) return null;
  return (
    nodes.find((n) => (n.name ?? "").toLowerCase() === name.toLowerCase()) ||
    null
  );
};

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

const TOP_N = 10;

function MobileChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey}: {currencyFormatter.format(p.value)}
        </div>
      ))}
    </div>
  );
}

export default function MobileBudgetGraph() {
  const [periodKey, setPeriodKey] = useState(DEFAULT_PERIOD_KEY);
  const [actualReport, setActualReport] = useState(null);
  const [budgetReport, setBudgetReport] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const period = useMemo(() => getPreset(periodKey).range(), [periodKey]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    Promise.all([
      Rest.fetchCashFlowReport({
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
        setError(err?.message ?? "Failed to load data");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period.fromDate, period.toDate]);

  // Build chart data: top N expense categories by absolute actual amount,
  // each with Actual + Budget shown as positive numbers (expenses are
  // negative in the API; flip them for visual comparison).
  const data = useMemo(() => {
    if (!actualReport && !budgetReport) return [];
    const expenseActual =
      findTopLevel(actualReport, "expense") ||
      findTopLevel(actualReport, "expenses");
    const expenseBudget =
      findTopLevel(budgetReport, "expense") ||
      findTopLevel(budgetReport, "expenses");
    const actualLeaves = flattenLeaves(expenseActual);
    const budgetLeaves = flattenLeaves(expenseBudget);
    const map = new Map();
    for (const l of actualLeaves) {
      if (!l.name) continue;
      const v = Math.abs(l.total ?? 0);
      if (v === 0) continue;
      map.set(l.name, { name: l.name, Actual: v, Budget: 0 });
    }
    for (const l of budgetLeaves) {
      if (!l.name) continue;
      const v = Math.abs(l.total ?? 0);
      if (v === 0 && !map.has(l.name)) continue;
      if (!map.has(l.name)) {
        map.set(l.name, { name: l.name, Actual: 0, Budget: v });
      } else {
        map.get(l.name).Budget = v;
      }
    }
    return Array.from(map.values())
      .sort((a, b) => Math.max(b.Actual, b.Budget) - Math.max(a.Actual, a.Budget))
      .slice(0, TOP_N);
  }, [actualReport, budgetReport]);

  // Truncate long names for the Y-axis label area
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        shortName: d.name.length > 14 ? d.name.slice(0, 13) + "…" : d.name,
      })),
    [data]
  );

  if (isLoading && !actualReport && !budgetReport) {
    return (
      <div className="m-state">
        <Loader2 size={28} className="m-spin" />
        <span>Loading chart…</span>
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

      <h2 className="m-section-h">Top Expenses — Actual vs Budget</h2>

      {chartData.length === 0 ? (
        <div className="m-state">
          <span>No expense data for this period</span>
        </div>
      ) : (
        <div className="m-chart-wrap--card">
          <ResponsiveContainer width="100%" height={Math.max(280, chartData.length * 44)}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 8, right: 16, bottom: 8, left: 4 }}
              barCategoryGap={6}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={formatShort}
                tick={{ fontSize: 10, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="shortName"
                width={92}
                tick={{ fontSize: 11, fill: "var(--ink-secondary)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<MobileChartTooltip />} cursor={{ fill: "var(--bg-tertiary)" }} />
              <Bar dataKey="Actual" radius={[0, 4, 4, 0]} barSize={10}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={`a-${i}`}
                    fill={
                      entry.Actual > entry.Budget && entry.Budget > 0
                        ? "var(--danger)"
                        : "var(--primary)"
                    }
                  />
                ))}
              </Bar>
              <Bar dataKey="Budget" radius={[0, 4, 4, 0]} barSize={10} fill="var(--muted-light)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
