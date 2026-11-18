/**
 * CR105 S3 — Balances Summary in Proposal B's layout (Workbench layout only;
 * the classic layout keeps BalanceV2).
 *
 * - Reads the header month (S2): the balance sheet as of it, and the 12
 *   month-ends ending there. Loads on open; there is no Generate.
 * - Hero: net worth with its change over 12 months (13 month-ends) and the line,
 *   assets and liabilities beside it.
 * - Rows keep the chart-of-accounts groups (the mock's groups were invented),
 *   each with a 12-month sparkline. Negatives stay `(1,234)` (D2) and only
 *   negatives are coloured (colour means sign).
 * - Reconcile column: the bank-feed balance check, per account and rolled up
 *   per group. It is a CURRENT check (the feed reports today's balance), so it
 *   shows only when the header is on the current month.
 *
 * The 12 reports share TanStack's ["balanceReport", date] cache with the Home
 * hero and the other balance views.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, Download, Check } from "lucide-react";
import Rest from "../js/rest.js";
import { useHeaderPeriod } from "../contexts/headerPeriod.js";
import { trailingDates, valuesByPath } from "./balanceWorkbenchData.js";
import { formatMoney } from "../components/Money/formatMoney.js";
import { exportBalanceSheet } from "../utils/excelExporter.js";
import { ChartTooltip, useChartTheme } from "../utils/chartTheme.jsx";
import "./BalanceWorkbench.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SEP = " / "; // must match balanceWorkbenchData.js

const top = (report, name) =>
  Number((report || []).find((n) => (n.name || "").toLowerCase() === name)?.totalUSD) || 0;

const fmt = (v, decimals = 0) => formatMoney(v, { currency: "USD", decimals });
const longDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};
const monthLabel = (iso) => MONTHS[Number(iso.slice(5, 7)) - 1];
// Axis ticks: compact, with enough precision that a narrow 12-month range does not
// print the same label on every tick, and parentheses for a negative (D2).
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});
const axisMoney = (v) => (v < 0 ? `(${compact.format(-v)})` : compact.format(v));

function Amount({ value, decimals = 2, strong }) {
  const neg = Number(value) < 0;
  return (
    <span className={`bw-amt${neg ? " bw-amt--neg" : ""}${strong ? " bw-amt--strong" : ""}`}>
      {fmt(value, decimals)}
    </span>
  );
}

/** A 12-point sparkline; nothing when the series is incomplete. */
function Spark({ values }) {
  if (!values || values.length < 2 || values.some((v) => v == null)) return null;
  const w = 120;
  const h = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (w - 4) + 2,
    h - 3 - ((v - min) / span) * (h - 6),
  ]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="bw-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" />
      <circle cx={lx} cy={ly} r="2.2" />
    </svg>
  );
}

/**
 * The reconcile page's own rule (BalanceReconciliation rowStatus): an account
 * needs work only when it is unreconciled AND not marked current to the latest
 * month-end — an MTM/accrual account marked at month-end is current; its gap is
 * next month's to book. Counting every reconciled=false row showed 7 "drifting"
 * where the page and the endpoint (total_unreconciled) say 2.
 */
const needsWork = (r) => r.reconciled === false && !r.mtm_current_to;

/** ✓, a chip naming the work, or nothing — for one account or a whole group. */
function ReconCell({ rows }) {
  const fed = (rows || []).filter((r) => r.reconciled != null);
  if (fed.length === 0) return null;
  const off = fed.filter(needsWork);
  if (off.length === 0) {
    return (
      <span
        className="bw-ok"
        role="img"
        aria-label={`${fed.length} feed account${fed.length === 1 ? "" : "s"} reconciled`}
        title={`${fed.length} feed account${fed.length === 1 ? "" : "s"} reconciled`}
      >
        <Check size={13} />
      </span>
    );
  }
  let label;
  if (fed.length === 1) {
    const r = off[0];
    label =
      r.reconcile_mode === "mtm"
        ? "MTM due"
        : `drift ${formatMoney(r.drift, { currency: r.currency || r.account_currency })}`;
  } else {
    label = `${off.length} of ${fed.length} to reconcile`;
  }
  return (
    <Link className="bw-drift" to="/balance-calibration" title="Open the reconcile page">
      {label} ›
    </Link>
  );
}

export default function BalanceWorkbench() {
  const hp = useHeaderPeriod();
  const t = useChartTheme();
  // The line is the brand colour (B), resolved per theme: an SVG attribute cannot read var().
  const brand = useMemo(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || t.seriesAt(0),
    [t]
  );
  // 13 month-ends: the header month and the same month a year earlier, so the
  // change is a true 12 months (12 points give 11 intervals). Sparklines use the last 12.
  const dates = useMemo(() => trailingDates(hp.year, hp.month, 13), [hp.year, hp.month]);
  const asOf = dates[dates.length - 1];

  const results = useQueries({
    queries: dates.map((date) => ({
      queryKey: ["balanceReport", date],
      queryFn: () => Rest.fetchBalanceReportV2(date),
    })),
  });
  const current = results[results.length - 1];
  const report = current.data;
  const seriesReady = results.every((r) => r.isSuccess);
  const seriesKey = results.map((r) => r.dataUpdatedAt).join(",");

  const recon = useQuery({
    queryKey: ["balanceRecon"],
    queryFn: () => Rest.fetchJson("/api/v2/bank-feed/balance-recon"),
    enabled: hp.isCurrent,
    staleTime: 60 * 1000,
  });

  // path → 12 values, and the net-worth line.
  const { series, line } = useMemo(() => {
    if (!seriesReady) return { series: new Map(), line: [] };
    const maps = results.map((r) => valuesByPath(r.data));
    const s = new Map();
    for (const key of maps[maps.length - 1].keys()) {
      s.set(key, maps.slice(-12).map((m) => (m.has(key) ? m.get(key) : 0)));
    }
    const l = results.map((r, i) => ({
      date: dates[i],
      month: monthLabel(dates[i]),
      label: longDate(dates[i]),
      netWorth: top(r.data, "assets") + top(r.data, "liabilities"),
    }));
    return { series: s, line: l };
    // results' identity changes every render; seriesKey tracks the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesReady, seriesKey, dates]);

  // Reconcile rows by account name — only names that are unique among them, so
  // a shared name can never put one account's drift on another's row.
  const reconByName = useMemo(() => {
    const rows = hp.isCurrent ? recon.data?.accounts || [] : [];
    const counts = new Map();
    for (const r of rows) counts.set(r.name, (counts.get(r.name) || 0) + 1);
    const m = new Map();
    for (const r of rows) if (counts.get(r.name) === 1) m.set(r.name, r);
    return m;
  }, [hp.isCurrent, recon.data]);

  const [open, setOpen] = useState(() => new Set(["Assets", "Liabilities"]));
  const toggle = (key) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const assets = top(report, "assets");
  const liabilities = top(report, "liabilities");
  const netWorth = assets + liabilities;
  const first = line[0]?.netWorth;
  const change = line.length && first ? netWorth - first : null;
  const pct = change != null && first ? (change / Math.abs(first)) * 100 : null;

  const rows = [];
  const leafRecon = (node) => {
    if (!node.children || node.children.length === 0) {
      const r = reconByName.get(node.name);
      return r ? [r] : [];
    }
    return node.children.flatMap(leafRecon);
  };
  const walk = (nodes, prefix, depth) => {
    for (const n of nodes || []) {
      const key = prefix ? prefix + SEP + n.name : n.name;
      const kids = n.children && n.children.length > 0;
      rows.push({ key, node: n, depth, kids, recon: leafRecon(n) });
      if (kids && open.has(key)) walk(n.children, key, depth + 1);
    }
  };
  walk(report, "", 0);

  return (
    <div className="bw">
      <div className="bw-head">
        <h1 className="bw-title">Balances</h1>
        <span className="bw-sub">
          As of {longDate(asOf)}
          {hp.isCurrent ? " (today)" : ""} · the header period
        </span>
        <button
          type="button"
          className="btn btn--outline btn--sm bw-export"
          onClick={() => report && exportBalanceSheet([report], [asOf])}
          disabled={!report}
        >
          <Download size={15} />
          <span>Export</span>
        </button>
      </div>

      {current.isError && (
        <div className="bw-error" role="alert">
          Could not load the balance sheet: {current.error?.message || "request failed"}
        </div>
      )}

      <section className="bw-hero bw-card" aria-label="Net worth">
        <div className="bw-kpis">
          <div className="bw-kpi">
            <span className="bw-lbl">Net worth</span>
            <span className="bw-kpi__big">{report ? <Amount value={netWorth} decimals={0} /> : "…"}</span>
            {change != null && (
              <span className={`bw-delta${change < 0 ? " bw-delta--neg" : ""}`}>
                {change < 0 ? "▼" : "▲"} {fmt(Math.abs(change))}
                {pct != null ? ` · ${Math.abs(pct).toFixed(1)}%` : ""}
                <span className="bw-delta__over"> since {longDate(dates[0])}</span>
              </span>
            )}
          </div>
          <div className="bw-kpi">
            <span className="bw-lbl">Assets</span>
            <span className="bw-kpi__mid">{report ? <Amount value={assets} decimals={0} /> : "…"}</span>
          </div>
          <div className="bw-kpi">
            <span className="bw-lbl">Liabilities</span>
            <span className="bw-kpi__mid">{report ? <Amount value={liabilities} decimals={0} /> : "…"}</span>
          </div>
        </div>
        <div className="bw-chart">
          {line.length > 0 ? (
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={line} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="bwFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={brand} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={brand} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={t.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fill: t.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  width={58}
                  tick={{ fill: t.axis, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  domain={["auto", "auto"]}
                  tickFormatter={axisMoney}
                />
                <Tooltip
                  content={({ active, payload }) => (
                    <ChartTooltip
                      active={active}
                      payload={payload}
                      label={payload?.[0]?.payload?.label}
                      formatter={(v) => fmt(v)}
                    />
                  )}
                />
                <Area
                  type="monotone"
                  dataKey="netWorth"
                  name="Net worth"
                  stroke={brand}
                  strokeWidth={2}
                  fill="url(#bwFill)"
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="bw-chart__wait">
              {results.some((r) => r.isError) ? (
                <>
                  Some months did not load.{" "}
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    onClick={() => results.filter((r) => r.isError).forEach((r) => r.refetch())}
                  >
                    Retry
                  </button>
                </>
              ) : (
                "Loading the 12 months…"
              )}
            </div>
          )}
        </div>
      </section>

      <section className="bw-table bw-card" aria-label="Balance sheet">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th className="bw-num">Balance (USD)</th>
              <th className="bw-sparkcol">12 months</th>
              {hp.isCurrent && <th className="bw-reconcol">Reconcile</th>}
            </tr>
          </thead>
          <tbody>
            {!report && !current.isError && (
              <tr>
                <td colSpan={hp.isCurrent ? 4 : 3} className="bw-loading">Loading…</td>
              </tr>
            )}
            {rows.map(({ key, node, depth, kids, recon: rr }) => (
              <tr key={key} className={depth === 0 ? "bw-row--grp" : undefined}>
                <td>
                  <span className="bw-name" style={{ paddingLeft: `${depth * 18}px` }}>
                    {kids ? (
                      <button
                        type="button"
                        className="bw-toggle"
                        onClick={() => toggle(key)}
                        aria-expanded={open.has(key)}
                        aria-label={`${open.has(key) ? "Collapse" : "Expand"} ${node.name}`}
                      >
                        {open.has(key) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : (
                      <span className="bw-toggle bw-toggle--leaf" aria-hidden="true" />
                    )}
                    {node.name}
                  </span>
                </td>
                <td className="bw-num">
                  <Amount value={node.totalUSD} strong={depth === 0} />
                </td>
                <td className="bw-sparkcol">{depth > 0 && <Spark values={series.get(key)} />}</td>
                {hp.isCurrent && (
                  <td className="bw-reconcol">
                    {depth > 0 && (recon.isPending ? <span className="bw-wait">…</span> : <ReconCell rows={rr} />)}
                  </td>
                )}
              </tr>
            ))}
            {report && (
              <tr className="bw-row--tot">
                <td>Net worth</td>
                <td className="bw-num">
                  <Amount value={netWorth} strong />
                </td>
                <td className="bw-sparkcol" />
                {hp.isCurrent && <td className="bw-reconcol" />}
              </tr>
            )}
          </tbody>
        </table>
        {hp.isCurrent && recon.isError && (
          <p className="bw-note">The reconcile check is unavailable right now — balances are unaffected.</p>
        )}
        {!hp.isCurrent && (
          <p className="bw-note">The reconcile column shows on the current month: the feed reports today's balance only.</p>
        )}
      </section>
    </div>
  );
}
