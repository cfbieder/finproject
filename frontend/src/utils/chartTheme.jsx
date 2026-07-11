import { useMemo } from "react";
import useTheme from "../hooks/useTheme.js";

/**
 * chartTheme (CR042 U2) — the single source of chart colors. SVG attributes
 * can't resolve CSS variables, so we read the resolved `--chart-*` / semantic
 * token values off the document once per theme and hand components concrete
 * hex. Re-resolves when the html `data-theme` flips (theme is a dep). This
 * keeps every chart in sync with index.css — including the U1 green split —
 * instead of duplicating frozen light-mode hex.
 */

const SERIES_TOKENS = [
  "--chart-navy",
  "--chart-emerald",
  "--chart-amber",
  "--chart-rose",
  "--chart-purple",
  "--chart-teal",
  "--chart-indigo",
];

function resolve(name, fallback = "") {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

export function useChartTheme() {
  const { theme } = useTheme();
  return useMemo(() => {
    const series = SERIES_TOKENS.map((t) => resolve(t)).filter(Boolean);
    const positive = resolve("--growth-positive");
    const negative = resolve("--growth-negative");
    return {
      theme,
      series,
      seriesAt: (i) =>
        series[((i % series.length) + series.length) % series.length],
      positive,
      negative,
      signed: (v) => (v < 0 ? negative : positive),
      grid: resolve("--border"),
      axis: resolve("--ink-tertiary"),
      ink: resolve("--ink-secondary"),
      surface: resolve("--surface"),
      tooltipBg: resolve("--surface-elevated"),
      tooltipBorder: resolve("--border-strong"),
    };
  }, [theme]);
}

/**
 * Shared Recharts tooltip styled from the tokens. Pass `formatter(value, entry)`
 * for value formatting (e.g. currency).
 */
export function ChartTooltip({ active, payload, label, formatter }) {
  const t = useChartTheme();
  if (!active || !payload || payload.length === 0) return null;
  const fmt = formatter || ((v) => v);
  return (
    <div
      style={{
        background: t.tooltipBg,
        border: `1px solid ${t.tooltipBorder}`,
        borderRadius: "var(--radius-md)",
        padding: "var(--space-2) var(--space-3)",
        boxShadow: "var(--shadow-md)",
        fontSize: "var(--text-sm)",
        color: "var(--ink)",
      }}
    >
      {label != null && label !== "" && (
        <div style={{ color: t.axis, marginBottom: 4, fontWeight: 600 }}>
          {label}
        </div>
      )}
      {payload.map((p, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: p.color || p.fill || t.seriesAt(i),
              display: "inline-block",
              flex: "0 0 auto",
            }}
          />
          <span style={{ color: t.ink }}>{p.name}</span>
          <span
            style={{
              marginLeft: "auto",
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
            }}
          >
            {fmt(p.value, p)}
          </span>
        </div>
      ))}
    </div>
  );
}
