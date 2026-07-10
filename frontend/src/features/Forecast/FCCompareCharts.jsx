/**
 * FCCompareCharts (CR040) — visual A-vs-B comparison.
 *
 * Chart 1: overlaid lines of a selected headline metric for both scenarios.
 * Chart 2: diverging horizontal bars of cumulative P&L delta by FC Line.
 *
 * Colors are validated pairs (dataviz six-checks, light + dark):
 *   A (baseline) green / B (comparison) blue; delta bars blue = B higher,
 *   red = B lower. Hex is picked at runtime by theme because SVG attributes
 *   can't resolve CSS variables.
 */
import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import useTheme from "../../hooks/useTheme.js";
import { formatKpiValue } from "../../components/KpiCards.jsx";

const PALETTE = {
  light: {
    a: "#3E8A3E",
    b: "#4A72B0",
    pos: "#4A72B0",
    neg: "#C0504D",
    grid: "#E8E6DF",
    ink: "#4A5568",
  },
  dark: {
    a: "#45A045",
    b: "#3987E5",
    pos: "#3987E5",
    neg: "#E05252",
    grid: "#33383E",
    ink: "#AEB4BB",
  },
};

const METRICS = [
  { key: "netAssets", label: "Net Assets" },
  { key: "totalAssets", label: "Total Assets" },
  { key: "netCashFlow", label: "Net Cash Flow" },
  { key: "income", label: "Income" },
  { key: "expense", label: "Expenses" },
];

const tooltipStyle = {
  background: "var(--surface-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--ink)",
  fontSize: "0.78rem",
};

export default function FCCompareCharts({ compare, nameA, nameB }) {
  const { theme } = useTheme();
  const colors = PALETTE[theme === "dark" ? "dark" : "light"];
  const [metric, setMetric] = useState("netAssets");

  const lineData = useMemo(() => {
    if (!compare) return [];
    const row = compare.totals[metric];
    return compare.years.map((year, i) => ({
      year,
      [nameA]: row.a[i],
      [nameB]: row.b[i],
    }));
  }, [compare, metric, nameA, nameB]);

  const barData = useMemo(() => {
    if (!compare) return [];
    return compare.rows
      .filter(
        (r) => r.section === "cash" && r.level === 2 && !r.derived && r.hasData
      )
      .map((r) => ({
        label: r.label,
        value: r.delta.reduce((s, d) => s + (d ?? 0), 0),
      }))
      .filter((d) => Math.abs(d.value) > 0.5)
      .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))
      .slice(0, 10);
  }, [compare]);

  if (!compare || !compare.years.length) return null;

  return (
    <div className="fc-compare-charts">
      <div className="fc-compare-chart-card">
        <div className="fc-compare-chart-head">
          <h3>Trajectory — A vs B</h3>
          <div className="fc-compare-metric-toggle" role="tablist">
            {METRICS.map((m) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={metric === m.key}
                className={metric === m.key ? "active" : ""}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={lineData} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fill: colors.ink, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: colors.grid }}
            />
            <YAxis
              tickFormatter={(v) => formatKpiValue(v)}
              tick={{ fill: colors.ink, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={64}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v) => formatKpiValue(v)}
              labelFormatter={(y) => `Year ${y}`}
            />
            <Legend wrapperStyle={{ fontSize: "0.78rem" }} />
            <Line
              type="monotone"
              dataKey={nameA}
              stroke={colors.a}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey={nameB}
              stroke={colors.b}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {barData.length > 0 && (
        <div className="fc-compare-chart-card">
          <div className="fc-compare-chart-head">
            <h3>Cumulative P&L difference by FC Line (B − A)</h3>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(160, barData.length * 34 + 40)}>
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
            >
              <CartesianGrid stroke={colors.grid} strokeDasharray="2 4" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v) => formatKpiValue(v)}
                tick={{ fill: colors.ink, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: colors.grid }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={150}
                tick={{ fill: colors.ink, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [formatKpiValue(v), "Cumulative Δ"]}
              />
              <ReferenceLine x={0} stroke={colors.ink} strokeWidth={1} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
                {barData.map((d) => (
                  <Cell
                    key={d.label}
                    fill={d.value >= 0 ? colors.pos : colors.neg}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="fc-compare-chart-note">
            Blue = higher under “{nameB}”, red = lower. Top {barData.length} lines by
            cumulative absolute difference over the compared years.
          </div>
        </div>
      )}
    </div>
  );
}
