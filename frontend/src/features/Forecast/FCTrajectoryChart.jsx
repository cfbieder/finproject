/**
 * FCTrajectoryChart (CR067 P1) — N scenario trajectories over the forecast years.
 *
 * Extracted from `FCCompareCharts` so `/forecast-compare` (two series, A vs B) and
 * `/forecast-multi-compare` (a base plus its variants) render the SAME chart rather than
 * hand-keeping two copies of the metric list, axis config and tooltip — the drift
 * `FCStepNav` was rewritten to end.
 *
 * The caller owns the colors and weights; this owns the axes, the metric toggle and the
 * year alignment. `series[].values` MUST already be aligned to `years` index-for-index —
 * see `fcMultiCompareUtils.alignSeries`, and CR067 §4 for why keying by year rather than by
 * array position is load-bearing.
 */
import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import useTheme from "../../hooks/useTheme.js";
import { formatKpiValue } from "../../components/KpiCards.jsx";
import { chartChrome, tooltipStyle } from "./utils/fcSeriesPalette.js";
import { METRICS } from "./utils/fcTrajectoryMetrics.js";

/**
 * @param {Object}   props
 * @param {string}   props.title       - card heading
 * @param {Array}    props.years       - x axis, ascending
 * @param {Array}    props.series      - [{ name, values, color, strokeWidth, dash? }] aligned to `years`
 * @param {string}   props.metric      - selected METRICS key (controlled by the caller)
 * @param {Function} props.onMetricChange
 * @param {number}   [props.height]
 */
export default function FCTrajectoryChart({
  title,
  years,
  series,
  metric,
  onMetricChange,
  height = 280,
}) {
  const { theme } = useTheme();
  const chrome = chartChrome(theme);

  // Synthetic dataKeys (s0…sN), never the scenario name. recharts resolves a string dataKey
  // as a NESTED PATH, so a scenario called "SP - Prop.2" would silently resolve to undefined
  // — a missing line with no error — and one called "year" would clobber the x axis. The
  // display name rides on <Line name=…> instead, which is what the legend and tooltip read.
  const data = useMemo(
    () =>
      years.map((year, i) => {
        const row = { year };
        series.forEach((s, si) => {
          row[`s${si}`] = s.values[i] ?? null;
        });
        return row;
      }),
    [years, series]
  );

  if (!years.length || !series.length) return null;

  return (
    <div className="fc-compare-chart-card">
      <div className="fc-compare-chart-head">
        <h3>{title}</h3>
        <div className="fc-compare-metric-toggle" role="tablist">
          {METRICS.map((m) => (
            <button
              key={m.key}
              role="tab"
              aria-selected={metric === m.key}
              className={metric === m.key ? "active" : ""}
              onClick={() => onMetricChange(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid stroke={chrome.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="year"
            tick={{ fill: chrome.ink, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: chrome.grid }}
          />
          <YAxis
            tickFormatter={(v) => formatKpiValue(v)}
            tick={{ fill: chrome.ink, fontSize: 11 }}
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
          {series.map((s, si) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={`s${si}`}
              name={s.name}
              stroke={s.color}
              strokeWidth={s.strokeWidth ?? 2}
              // CR085 — optional, and undefined for every existing caller, so Compare and
              // Multi-Compare render byte-identically. A dashed line is how a REFERENCE is told
              // from a measurement without spending a categorical hue on it.
              strokeDasharray={s.dash}
              // CR085 — optional like `dash`, undefined for every existing caller. With one line
              // per BAND per side the trajectory carries six measurements in two hues, and weight
              // plus opacity is what separates them without spending a categorical hue on band
              // size (§4.2 spends hue on which way the METRIC moved).
              strokeOpacity={s.opacity}
              dot={false}
              activeDot={{ r: 4 }}
              // A year a scenario does not cover stays a GAP. CR040's zero-coalescing lives
              // only in the delta computation; the display arrays keep their nulls, and
              // interpolating across one would invent a trajectory.
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
