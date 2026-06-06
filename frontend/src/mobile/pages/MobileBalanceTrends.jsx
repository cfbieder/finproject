import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import Rest from "../../js/rest.js";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const formatKpi = (n) =>
  (n ?? 0) < 0
    ? `(${currencyFormatter.format(Math.abs(n))})`
    : currencyFormatter.format(n ?? 0);
const compact = (n) => {
  const a = Math.abs(n ?? 0);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n ?? 0)}`;
};

const pad = (v) => String(v).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const findTopLevel = (nodes, name) =>
  Array.isArray(nodes)
    ? nodes.find((n) => (n.name ?? "").toLowerCase() === name.toLowerCase()) || null
    : null;
const netWorthOf = (report) =>
  (findTopLevel(report, "assets")?.totalUSD ?? 0) +
  (findTopLevel(report, "liabilities")?.totalUSD ?? 0);

const RANGES = [
  { key: 6, label: "6M" },
  { key: 12, label: "12M" },
  { key: 24, label: "24M" },
];

export default function MobileBalanceTrends() {
  const [months, setMonths] = useState(12);
  const [series, setSeries] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    const now = new Date();
    const points = [];
    for (let k = months - 1; k >= 0; k--) {
      const mEnd = new Date(now.getFullYear(), now.getMonth() - k + 1, 0);
      const asOf = mEnd > now ? now : mEnd;
      points.push({
        asOf: fmtDate(asOf),
        label:
          mEnd.toLocaleDateString(undefined, { month: "short" }) +
          (mEnd.getMonth() === 0 ? ` '${String(mEnd.getFullYear()).slice(2)}` : ""),
      });
    }
    Promise.all(points.map((p) => Rest.fetchBalanceReportV2(p.asOf)))
      .then((reports) => {
        if (cancelled) return;
        setSeries(points.map((p, i) => ({ ...p, netWorth: netWorthOf(reports[i]) })));
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Failed to load balance trends");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [months]);

  const summary = useMemo(() => {
    if (!series || series.length < 1) return null;
    const first = series[0].netWorth;
    const last = series[series.length - 1].netWorth;
    return { current: last, delta: last - first };
  }, [series]);

  if (isLoading && !series) {
    return (
      <div className="m-state">
        <Loader2 size={28} className="m-spin" />
        <span>Loading trends…</span>
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
  if (!series) return null;

  const up = (summary?.delta ?? 0) >= 0;

  return (
    <div>
      <div className="m-page-meta">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={"m-pill" + (months === r.key ? " m-pill--active" : "")}
            onClick={() => setMonths(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {summary && (
        <div className="m-kpis">
          <div className="m-kpi m-kpi--hero">
            <span className="m-kpi__label">Net Worth</span>
            <span
              className={
                "m-kpi__value" + (summary.current < 0 ? " m-kpi__value--negative" : "")
              }
            >
              {formatKpi(summary.current)}
            </span>
            <span className={"m-kpi__sub m-kpi__sub--" + (up ? "up" : "down")}>
              {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {formatKpi(Math.abs(summary.delta))} over {months}M
            </span>
          </div>
        </div>
      )}

      <div className="m-chart-wrap m-chart-wrap--card">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              interval="preserveStartEnd"
              minTickGap={18}
            />
            <YAxis
              tickFormatter={compact}
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              width={48}
            />
            <Tooltip
              formatter={(v) => [formatKpi(v), "Net Worth"]}
              contentStyle={{
                background: "var(--surface-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--ink)",
              }}
            />
            <Line
              type="monotone"
              dataKey="netWorth"
              stroke="var(--primary)"
              strokeWidth={2.5}
              dot={{ r: 2.5, fill: "var(--primary)" }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
