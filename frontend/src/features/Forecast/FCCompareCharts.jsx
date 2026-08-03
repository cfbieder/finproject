/**
 * FCCompareCharts (CR040) — visual A-vs-B comparison.
 *
 * Chart 1: the shared `FCTrajectoryChart` with two series — A (baseline) green,
 *          B (comparison) blue. Extracted in CR067 P1 so the Multi-Compare page renders the
 *          same chart instead of a second copy of it; what this page DISPLAYS is unchanged,
 *          which `__tests__/fcTrajectoryChart.parity.test.jsx` exists to prove.
 * Chart 2: diverging horizontal bars of cumulative P&L delta by FC Line — blue = B higher,
 *          red = B lower — which stays here, being pairwise by definition.
 *
 * Colors are validated pairs (dataviz six-checks, light + dark) and now live in
 * `utils/fcSeriesPalette.js`. Hex is picked at runtime by theme because SVG attributes
 * can't resolve CSS variables.
 */
import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import useTheme from "../../hooks/useTheme.js";
import { formatKpiValue } from "../../components/KpiCards.jsx";
import FCTrajectoryChart from "./FCTrajectoryChart.jsx";
import { chartChrome, compareABColors, tooltipStyle } from "./utils/fcSeriesPalette.js";

export default function FCCompareCharts({ compare, nameA, nameB }) {
  const { theme } = useTheme();
  const chrome = chartChrome(theme);
  const colors = compareABColors(theme);
  const [metric, setMetric] = useState("netAssets");

  const series = useMemo(() => {
    if (!compare) return [];
    const row = compare.totals[metric];
    return [
      { name: nameA, values: row.a, color: colors.a },
      { name: nameB, values: row.b, color: colors.b },
    ];
  }, [compare, metric, nameA, nameB, colors]);

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
      <FCTrajectoryChart
        title="Trajectory — A vs B"
        years={compare.years}
        series={series}
        metric={metric}
        onMetricChange={setMetric}
      />

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
              <CartesianGrid stroke={chrome.grid} strokeDasharray="2 4" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(v) => formatKpiValue(v)}
                tick={{ fill: chrome.ink, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: chrome.grid }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={150}
                tick={{ fill: chrome.ink, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v) => [formatKpiValue(v), "Cumulative Δ"]}
              />
              <ReferenceLine x={0} stroke={chrome.ink} strokeWidth={1} />
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
