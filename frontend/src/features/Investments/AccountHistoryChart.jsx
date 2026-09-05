/**
 * AccountHistoryChart.jsx — CR090 P3. One account's value over time.
 *
 * 🔴 TWO SERIES, NEVER ONE LINE. This is the whole design (CR090 §5.1).
 *
 *   statement  quarterly · dated by `valued_on`, which the custodian STATES
 *   feed       daily     · dated by `polled_on`; its `valued_on` is NULL by
 *                          design (CR089 — nothing upstream states it)
 *
 * ⚠️ They do not overlap: statements end 2026-06-30, the feed begins
 * 2026-07-04. No observation validates the join, so a single continuous line
 * would splice two datings across a seam neither can vouch for — smooth-looking
 * and unverifiable.
 *
 * ⚠️ NOTHING IS INTERPOLATED BETWEEN STATEMENT POINTS. A straight segment across
 * a quarter asserts a path nobody observed, and CR058 §9 has an account that
 * took +1.46M while losing 1.17M inside one year. Statements are therefore drawn
 * as discrete markers — which is what they are — and only the daily feed gets a
 * line.
 *
 * The distinction is carried by SHAPE (dots vs line) before hue, following the
 * palette module's own rule that a different KIND of thing takes a secondary
 * encoding rather than another colour slot.
 *
 * This chart shows VALUE, not return. A level series is not a performance
 * series — CR056 §3.3, CR058 §9 and §12.8 have each settled that separately.
 */

import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import useTheme from "../../hooks/useTheme.js";
import { chartChrome, seriesColors, tooltipStyle } from "../Forecast/utils/fcSeriesPalette.js";
import { money } from "./investmentFormat.js";
import { DAY, toSeries, fmtDate } from "./investmentHistory.js";

function HistoryTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const v = p.statement ?? p.feed;
  return (
    <div style={tooltipStyle} className="inv-chart-tip">
      <div className="inv-chart-tip__val">{money(v, currency)}</div>
      {/* The date basis is named on every reading, not just in the legend — the
          whole hazard is a reader assuming one dating for both series. */}
      <div className="inv-chart-tip__meta">
        {p.source === "statement"
          ? `Statement · valued ${p.valued_on}`
          : `Feed · polled ${p.polled_on} · value date not stated`}
      </div>
      <div className="inv-chart-tip__meta">{p.positions_count} positions</div>
    </div>
  );
}

export default function AccountHistoryChart({ rows, currency = "USD", height = 260 }) {
  const { theme } = useTheme();
  const chrome = chartChrome(theme);
  const colors = seriesColors(theme);
  const data = toSeries(rows);

  const statements = data.filter((d) => d.statement !== null);
  const feed = data.filter((d) => d.feed !== null);
  if (!data.length) return null;

  const firstStatement = statements[0]?.observed_on;
  const firstFeed = feed[0]?.observed_on;

  return (
    <section className="inv-history">
      <header className="inv-history__head">
        <h3>Value over time</h3>
        {/* ⚠️ Say where each series STARTS. A chart that merely begins where its
            data begins claims the account began there — Fidelity Stocks holds
            statements only from 2024-06-30 and existed long before. Same trap the
            drift report's "dates predate fin's first record" line exists to avoid. */}
        <p className="inv-history__coverage">
          {statements.length > 0 && (
            <>
              <strong>{statements.length}</strong> quarterly statement
              {statements.length === 1 ? "" : "s"} held from <strong>{firstStatement}</strong>
              {" — dated by the statement's own period end."}
            </>
          )}
          {feed.length > 0 && (
            <>
              {" "}
              <strong>{feed.length}</strong> daily feed reading
              {feed.length === 1 ? "" : "s"} from <strong>{firstFeed}</strong>
              {" — dated by when the custodian was polled, not by when the values were true."}
            </>
          )}
        </p>
        <p className="inv-history__caveat">
          Statement points are discrete observations and are not joined: nothing was
          measured between them. Values only — see Investment Returns for performance.
        </p>
      </header>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
          <CartesianGrid stroke={chrome.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin - " + 30 * DAY, "dataMax + " + 30 * DAY]}
            tickFormatter={fmtDate}
            tick={{ fill: chrome.ink, fontSize: 11 }}
            axisLine={{ stroke: chrome.grid }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: chrome.ink, fontSize: 11 }}
            axisLine={{ stroke: chrome.grid }}
            tickLine={false}
            width={78}
            tickFormatter={(v) => `${Math.round(v / 1000)}k`}
          />
          <Tooltip content={<HistoryTooltip currency={currency} />} />
          <Legend wrapperStyle={{ fontSize: "0.75rem", color: chrome.ink }} />

          {/* Markers only. No `line`, and the series holds nulls on every feed row,
              so there is nothing for recharts to connect even by accident. */}
          <Scatter
            name="Statement (quarterly, valued)"
            dataKey="statement"
            fill={colors[0]}
            shape="circle"
            legendType="circle"
            isAnimationActive={false}
          />
          {/* connectNulls={false} is load-bearing: the feed's nulls are the
              statement era, and joining across them would draw the very line
              this chart exists to refuse. */}
          <Line
            name="Feed (daily, polled)"
            dataKey="feed"
            stroke={colors[2]}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            legendType="line"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}
