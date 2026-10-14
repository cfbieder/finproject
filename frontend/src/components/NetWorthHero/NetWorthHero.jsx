import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useState } from "react";
import { TrendingUp, TrendingDown, HelpCircle, Eye, EyeOff } from "lucide-react";
import { useChartTheme, ChartTooltip } from "../../utils/chartTheme.jsx";
import NetWorthBridgeModal from "./NetWorthBridgeModal.jsx";
import "./NetWorthHero.css";

/**
 * NetWorthHero (CR042 U3) — the net-worth-over-time hero the market references
 * (Monarch/Copilot/Empower) all lead with. Recharts area chart themed via
 * chartTheme, current value + delta over the window.
 */

const fullUSD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const compactUSD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const monthLabel = (m) => {
  if (typeof m !== "string" || !m.includes("-")) return m;
  const [y, mo] = m.split("-");
  const d = new Date(Date.UTC(Number(y), Number(mo) - 1, 1));
  return d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + " " + y.slice(2);
};

export default function NetWorthHero({ series, current, delta, isLoading }) {
  const chart = useChartTheme();
  const [explaining, setExplaining] = useState(false);
  // Hidden until asked for, every visit — the mobile Home rule (owner,
  // 2026-10-14: the browser is opened in public too). The chart hides with the
  // figure because its y-axis gives the magnitude away. Deliberately not
  // remembered, or the next public opening would show it again.
  const [revealed, setRevealed] = useState(false);
  const hasData = Array.isArray(series) && series.length > 1;
  const up = (delta ?? 0) >= 0;
  const months = hasData ? series.length : 0;

  // The window the DELTA is measured over, not the one the chart happens to
  // draw: `delta` is series[last] − series[0], so the explanation has to run
  // between those same two dates or it would explain a different number from
  // the one the button sits beside.
  const fromDate = hasData ? series[0].date : null;
  const toDate = hasData ? series[series.length - 1].date : null;

  return (
    <section className="nw-hero panel" aria-label="Net worth over time">
      <header className="nw-hero__head">
        <span className="nw-hero__label">Net Worth</span>
        <button
          type="button"
          className="nw-hero__reveal"
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
          aria-label={revealed ? "Hide net worth" : "Show net worth"}
        >
          {revealed ? (
            <span className="nw-hero__value">
              {isLoading && current == null ? "…" : fullUSD.format(current ?? 0)}
            </span>
          ) : (
            <span className="nw-hero__value nw-hero__value--masked">••••••</span>
          )}
          {revealed ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
        {!revealed && <span className="nw-hero__hint">Click to show</span>}
        {revealed && delta != null && !isLoading && (
          <span className={"nw-hero__delta " + (up ? "is-up" : "is-down")}>
            {up ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
            {fullUSD.format(Math.abs(delta))}
            <span className="nw-hero__delta-note">
              {up ? "up" : "down"} over {months} mo
            </span>
            {hasData && (
              <button
                type="button"
                className="nw-hero__explain"
                onClick={() => setExplaining(true)}
              >
                <HelpCircle size={14} aria-hidden="true" />
                What changed?
              </button>
            )}
          </span>
        )}
      </header>

      {revealed && (
      <div className="nw-hero__chart">
        {hasData ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="nw-hero-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chart.positive} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={chart.positive} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chart.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={monthLabel}
                tick={{ fill: chart.axis, fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: chart.grid }}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v) => compactUSD.format(v)}
                tick={{ fill: chart.axis, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip
                cursor={{ stroke: chart.grid }}
                content={
                  <ChartTooltip
                    formatter={(v) => fullUSD.format(v)}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="netWorth"
                name="Net Worth"
                stroke={chart.positive}
                strokeWidth={2}
                fill="url(#nw-hero-area)"
                dot={false}
                activeDot={{ r: 4, fill: chart.positive }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="nw-hero__empty">
            {isLoading ? "Loading net worth…" : "Not enough history yet"}
          </div>
        )}
      </div>
      )}

      {/* Mounted only while open: the bridge is a dozen balance builds, and the
          hero renders on every visit to Home. */}
      {explaining && (
        <NetWorthBridgeModal
          open
          onClose={() => setExplaining(false)}
          fromDate={fromDate}
          toDate={toDate}
        />
      )}
    </section>
  );
}
