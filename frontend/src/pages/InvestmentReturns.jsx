/**
 * InvestmentReturns (CR056 P1) — realized income and price return per interval
 * for one account (a parent rolls up its descendants), absolute and as a
 * percentage of average capital, in USD or the account's own currency.
 *
 * The caveats are not decoration. Most of this portfolio cannot support a
 * return figure — Fidelity is marked monthly only from 2025-01, United
 * Beverages anchors its marks on 31 March, and ~$32M of assets have never been
 * revalued — so a page that quietly printed 0.00% would be worse than one that
 * prints nothing. Every suppressed cell says why, and the `Mark coverage` row
 * makes the reason scannable across the period rather than hidden in a tooltip.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
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
import PeriodSelector from "../components/PeriodSelector/PeriodSelector.jsx";
import AccountPicker, {
  buildHierarchyOptions,
} from "../components/AccountPicker/AccountPicker.jsx";
import EmptyState from "../components/EmptyState.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import { useChartTheme, ChartTooltip } from "../utils/chartTheme.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "./InvestmentReturns.css";

const CURRENT_YEAR = new Date().getFullYear();
const INTERVALS = [
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
  // Columns run valuation-to-valuation instead of on the calendar — the only
  // honest layout for a holding marked on its own schedule.
  { key: "marks", label: "Between marks" },
];
const PARTIAL_SUFFIX = { month: "MTD", quarter: "QTD", year: "YTD", marks: "partial" };

const lastOfMonth = (year, month) =>
  new Date(Date.UTC(Number(year), Number(month), 0)).toISOString().slice(0, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);

export default function InvestmentReturns() {
  const [accountOptions, setAccountOptions] = useState([]);
  const [accountId, setAccountId] = useState("");
  const [fromMonth, setFromMonth] = useState("01");
  const [toMonth, setToMonth] = useState("12");
  const [actualYear, setActualYear] = useState(CURRENT_YEAR);
  const [toYear, setToYear] = useState(CURRENT_YEAR);
  const [intervalKey, setIntervalKey] = useState("month");
  const [currency, setCurrency] = useState("usd");

  const [report, setReport] = useState(null);
  const [meta, setMeta] = useState(null);
  const [shown, setShown] = useState(null); // what the on-screen table describes
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestInterval, setSuggestInterval] = useState("");

  useEffect(() => {
    let active = true;
    Rest.fetchAccountsV2()
      .then((rows) => {
        if (!active) return;
        // Balance-sheet accounts only: a return on an expense category is not a
        // thing, and offering it would only produce nonsense.
        setAccountOptions(
          buildHierarchyOptions(rows).filter((r) => r.section === "balance_sheet")
        );
      })
      .catch(() => {
        if (active) setError("Could not load the chart of accounts.");
      });
    return () => {
      active = false;
    };
  }, []);

  const handlePeriodChange = useCallback((next) => {
    if (next.fromMonth !== undefined) setFromMonth(next.fromMonth);
    if (next.toMonth !== undefined) setToMonth(next.toMonth);
    if (next.actualYear !== undefined) setActualYear(Number(next.actualYear));
    if (next.toYear !== undefined) setToYear(Number(next.toYear));
  }, []);

  const runReport = useCallback(
    async (withInterval, overrideDates) => {
      if (!accountId) {
        setError("Pick an account first.");
        return;
      }
      const useInterval = withInterval || intervalKey;
      setError("");
      setSuggestInterval("");
      setIsLoading(true);
      // A period that runs past today would render months that have not
      // happened as 0 / 0.00% — and a zero is not a blank. Clip to today and
      // let the server's own span clipping produce one honest partial column.
      const requestedEnd = lastOfMonth(toYear, toMonth);
      const today = todayIso();
      const fromDate = overrideDates?.fromDate ?? `${actualYear}-${fromMonth}-01`;
      const toDate =
        overrideDates?.toDate ?? (requestedEnd > today ? today : requestedEnd);
      try {
        const { data, meta: m } = await Rest.fetchInvestmentReturnsV2({
          account: accountId,
          fromDate,
          toDate,
          interval: useInterval,
          currency,
        });
        setReport(data);
        setMeta(m);
        setShown({
          account: data?.account,
          interval: useInterval,
          currency,
          fromDate,
          toDate,
          clippedToToday: !overrideDates && requestedEnd > today,
        });
      } catch (err) {
        const message = err?.message ?? "Failed to build the investment returns report";
        setError(message);
        // The interval control is inches away — offer the fix, don't dead-end.
        if (/quarterly or annual/.test(message)) {
          setSuggestInterval(useInterval === "month" ? "quarter" : "year");
        }
        setReport(null);
        setMeta(null);
        setShown(null);
      } finally {
        setIsLoading(false);
      }
    },
    [accountId, actualYear, fromMonth, toYear, toMonth, intervalKey, currency]
  );

  // The unit the on-screen numbers are in — the real ISO code, never a symbol
  // table that can silently have a hole in it.
  const unit = useMemo(() => {
    if (!shown) return null;
    if (shown.currency === "usd") return "USD";
    const list = meta?.currencies ?? [];
    return list.length === 1 ? list[0] : null; // null ⇒ mixed, see the warning
  }, [shown, meta]);

  // Bare numbers. The unit is stated once, in the table's corner cell and the
  // caption — repeating it on every cell is noise in a grid whose whole job is
  // comparing figures down and across.
  const fmt = useCallback((v) => {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
    const n = Number(v);
    const body = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
    return `${n < 0 ? "−" : ""}${body}`;
  }, []);

  const fmtPct = (v) =>
    v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(2)}%`;

  const isStale =
    shown && (shown.interval !== intervalKey || shown.currency !== currency);

  return (
    <main className="page-main balance-grid balance-grid--single investment-returns">
      <header className="investment-returns__header">
        <h1 className="investment-returns__title">Investment Returns</h1>
        <p className="investment-returns__subtitle">
          Realized income and unrealized gain/loss per period, each as a
          percentage of the average capital employed.
        </p>
      </header>

      <section className="panel investment-returns__toolbar">
        <div className="investment-returns__toolbar-grid">
          <label className="investment-returns__field investment-returns__field--account">
            <span className="investment-returns__label">Account</span>
            <AccountPicker
              value={accountId}
              options={accountOptions}
              onChange={setAccountId}
              placeholder="Pick an account, or a parent to roll up…"
            />
          </label>

          <div className="investment-returns__field investment-returns__field--period">
            <span className="investment-returns__label">Period</span>
            <PeriodSelector
              onChange={handlePeriodChange}
              fromMonth={fromMonth}
              toMonth={toMonth}
              actualYear={actualYear}
              toYear={toYear}
              defaultPreset="this-year"
              hideBudgetYear
              enableYearRange
            />
          </div>

          <div className="investment-returns__controls">
          <div className="investment-returns__field">
            <span className="investment-returns__label">Interval</span>
            <div
              className="investment-returns__segmented"
              role="group"
              aria-label="Interval"
            >
              {INTERVALS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={intervalKey === opt.key}
                  className={`btn btn--sm ${
                    intervalKey === opt.key ? "btn--primary" : "btn--outline"
                  }`}
                  onClick={() => setIntervalKey(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="investment-returns__field">
            <span className="investment-returns__label">Currency</span>
            <div
              className="investment-returns__segmented"
              role="group"
              aria-label="Currency mode"
            >
              {[
                { key: "usd", label: "USD" },
                { key: "lc", label: "Original" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={currency === opt.key}
                  className={`btn btn--sm ${
                    currency === opt.key ? "btn--primary" : "btn--outline"
                  }`}
                  onClick={() => setCurrency(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="investment-returns__field investment-returns__field--action">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => runReport()}
              disabled={isLoading || !accountId}
            >
              {isLoading ? "Generating…" : "Generate"}
            </button>
            {isStale ? (
              <span className="investment-returns__hint">
                Interval/currency changed — Generate to apply.
              </span>
            ) : null}
          </div>
          </div>
        </div>
      </section>

      {error ? (
        <p className="investment-returns__error" role="alert">
          {error}
          {suggestInterval ? (
            <button
              type="button"
              className="btn btn--sm btn--outline investment-returns__error-action"
              onClick={() => {
                setIntervalKey(suggestInterval);
                runReport(suggestInterval);
              }}
            >
              Switch to {suggestInterval === "quarter" ? "Quarterly" : "Yearly"}
            </button>
          ) : null}
        </p>
      ) : null}

      {isLoading ? <LoadingSpinner /> : null}

      {!isLoading && !report && !error ? (
        <EmptyState
          variant="finance"
          message="Pick an account (a parent rolls up everything beneath it), choose a period and interval, then Generate."
        />
      ) : null}

      {!isLoading && report && report.intervals.length === 0 ? (
        <EmptyState
          variant="finance"
          message="That account has no transactions in the selected range. Try a wider period."
        />
      ) : null}

      {!isLoading && report && report.intervals.length > 0 ? (
        <>
          <Warnings meta={meta} unit={unit} />
          <MarkedPeriodPrompt
            meta={meta}
            report={report}
            shown={shown}
            onUse={(w) => {
              const [fy, fm] = w.start.split("-");
              const [ty, tm] = w.end.split("-");
              setActualYear(Number(fy));
              setFromMonth(fm);
              setToYear(Number(ty));
              setToMonth(tm);
              runReport(undefined, { fromDate: w.start, toDate: w.end });
            }}
          />
          <ReturnsTable
            report={report}
            meta={meta}
            shown={shown}
            unit={unit}
            fmt={fmt}
            fmtPct={fmtPct}
          />
          <ReturnsCharts report={report} fmt={fmt} unit={unit} />
          <SuppressionNotes meta={meta} report={report} />
        </>
      ) : null}
    </main>
  );
}

/**
 * Warnings that change how a number is READ — capped and kept above the table.
 * The "why is this cell —" explanations live below it (SuppressionNotes),
 * because they are read after the report, not before it.
 */
function Warnings({ meta, unit }) {
  if (!meta) return null;
  const notes = [];

  if (meta.mixedCurrency || (!unit && meta.currency === "lc")) {
    notes.push(
      `This selection spans ${(meta.currencies ?? []).join(", ")}. An "Original" total across currencies is not a real number — pick a single-currency account to total meaningfully.`
    );
  }

  if (meta.feedBalanceOverrides?.length) {
    notes.push(
      `${meta.feedBalanceOverrides.join(", ")} take their balance from the feed. The Balance Sheet will show a different value for them and it is the one to believe — a feed snapshot cannot be decomposed into income and price movement.`
    );
  }

  if (Math.abs(Number(meta.unattributedTotal) || 0) >= 1) {
    notes.push(
      `${Number(meta.unattributedTotal).toLocaleString("en-US")} of value is unattributed — transactions that moved the balance but carry no P&L category. That is a ledger defect worth fixing, not a return.`
    );
  }

  if (!notes.length) return null;
  return (
    <section className="investment-returns__warnings">
      {notes.slice(0, 2).map((text) => (
        <p key={text} className="investment-returns__warning">
          {text}
        </p>
      ))}
    </section>
  );
}

/**
 * When the requested period reaches outside the window where marks actually
 * exist, columns fail the boundary test by a few weeks and every % reads `—`.
 * That is "you asked outside the data", not "no return" — so offer the fix
 * rather than only explaining the blank.
 */
function MarkedPeriodPrompt({ meta, report, shown, onUse }) {
  const w = meta?.markedWindow;
  if (!w || !shown) return null;
  const allSuppressed = report.rows.returnPct.every((v) => v === null);
  if (!allSuppressed) return null;
  // Only worth offering if it would actually change the answer.
  const reachesOutside = shown.fromDate < w.start || shown.toDate > w.end;
  if (!reachesOutside) return null;

  const pretty = (d) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });

  return (
    <section className="investment-returns__prompt">
      <p>
        No period has a mark at both ends, so every return is blank. This account
        is only marked to market between <strong>{pretty(w.start)}</strong> and{" "}
        <strong>{pretty(w.end)}</strong> — outside that, the ledger knows what cash
        moved but not what the holdings were worth.
      </p>
      <button
        type="button"
        className="btn btn--sm btn--primary"
        onClick={() => onUse(w)}
      >
        Use the marked period
      </button>
    </section>
  );
}

/** The "why some cells show —" detail, collapsed, below the report. */
function SuppressionNotes({ meta, report }) {
  if (!meta) return null;
  const notes = [];

  const neverMarked = (meta.markCadence ?? []).filter((c) => c.cadence === "never");
  if (neverMarked.length) {
    notes.push(
      `Never revalued: ${neverMarked.map((c) => c.account).join(", ")}. Their balance cannot move on price, so they contribute no return — only the income posted against them.`
    );
  }

  for (const c of meta.markCadence ?? []) {
    if (c.cadence === "never" || !c.anchor) continue;
    const [mm, dd] = c.anchor.split("-");
    const month = new Date(Date.UTC(2000, Number(mm) - 1, 1)).toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    if (c.cadence === "annual" && c.anchor !== "12-31") {
      notes.push(
        `${c.account} is marked annually on ${Number(dd)} ${month}, so calendar periods have no mark at their boundaries and no return can be computed for them.`
      );
    }
  }

  if (meta.chainBrokenBy?.length) {
    const total = report.total;
    const which = meta.chainBrokenBy.join(", ");
    notes.push(
      `A return needs the account's market value at BOTH ends of a period, which means an "Unrealized G/L" posting near each boundary. ${which} ${
        meta.chainBrokenBy.length === 1 ? "does" : "do"
      } not have one, so no % can be computed for ${
        meta.chainBrokenBy.length === 1 ? "it" : "them"
      }.` +
        (total?.clippedSpan
          ? ` The Total is chained over ${total.clippedSpan.start} → ${total.clippedSpan.end} only.`
          : " That also breaks the chain, so there is no Total %.")
    );
  }

  notes.push(
    'Mark coverage is the share of each period\'s opening balance held in accounts that DO have a mark at both boundaries. 100% means every dollar is valued; 0% means none is, and the % is blank rather than guessed.'
  );

  if (!notes.length) return null;
  return (
    <details className="investment-returns__notes">
      <summary>Why some cells show — ({notes.length})</summary>
      {notes.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </details>
  );
}

function ReturnsTable({ report, meta, shown, unit, fmt, fmtPct }) {
  const { intervals, rows, total } = report;
  // Detail rows are collapsed by default: the summary lines are the report,
  // the breakdown is what you open when a number looks wrong.
  const [expanded, setExpanded] = useState({ income: false, flows: false });
  const toggle = (group) =>
    setExpanded((prev) => ({ ...prev, [group]: !prev[group] }));
  const showFx = rows.fxEffect.some((v) => Math.abs(Number(v) || 0) >= 0.005);
  // The plug can only be FX if there IS a foreign currency in the selection.
  // On an all-USD selection a non-zero plug is a ledger defect — most often
  // `amount` and `base_amount` disagreeing on a USD row, which is impossible by
  // definition and means something wrote one column without the other. Calling
  // that "FX" sends the reader hunting for a currency movement that never
  // happened.
  const plugCanBeFx = (meta?.currencies ?? []).some((c) => c !== "USD");
  const showUnattributed = rows.unattributed.some(
    (v) => Math.abs(Number(v) || 0) >= 0.005
  );
  const incomeTotals = new Map(
    (total?.income ?? []).map((r) => [r.category, r.value])
  );
  const flowTotals = new Map((total?.flows ?? []).map((r) => [r.category, r.value]));

  const detail = (group, source, totals) =>
    expanded[group]
      ? source.map((r) => ({
          key: `${group}:${r.category}`,
          label: r.category,
          values: r.values,
          total: totals.get(r.category) ?? null,
          indent: true,
        }))
      : [];

  const body = [
    { key: "beginningMV", label: "Beginning market value", values: rows.beginningMV, total: total?.beginningMV, strong: true },
    {
      key: "netFlows",
      label: "Net external flows",
      values: rows.netFlows,
      total: total?.netFlows,
      strong: true,
      group: "flows",
      count: rows.flows.length,
    },
    ...detail("flows", rows.flows, flowTotals),
    {
      key: "incomeTotal",
      label: "Realized income",
      values: rows.incomeTotal,
      total: total?.incomeTotal,
      strong: true,
      group: "income",
      count: rows.income.length,
    },
    ...detail("income", rows.income, incomeTotals),
    {
      key: "priceReturn",
      label: "Unrealized G/L",
      values: rows.priceReturn,
      total: total?.priceReturn,
      strong: true,
      signed: true,
    },
    ...(showFx
      ? [{
          key: "fxEffect",
          label: plugCanBeFx
            ? "FX effect & rate drift"
            : "Unreconciled — USD amounts disagree",
          values: rows.fxEffect,
          total: total?.fxEffect,
          signed: plugCanBeFx,
          flag: !plugCanBeFx,
        }]
      : []),
    ...(showUnattributed
      ? [{ key: "unattributed", label: "Unattributed", values: rows.unattributed, total: total?.unattributed, flag: true }]
      : []),
    { key: "totalReturn", label: "Total return", values: rows.totalReturn, total: total?.totalReturn, strong: true, signed: true },
  ];

  const caption = [
    shown?.account?.name,
    shown?.account?.isRollup
      ? `rolls up ${shown.account.members.length} accounts`
      : null,
    `${shown?.fromDate} → ${shown?.toDate}`,
    shown?.interval === "month"
      ? "monthly"
      : shown?.interval === "marks"
        ? "between valuations"
        : `${shown?.interval}ly`,
    unit ?? "mixed currencies",
    shown?.clippedToToday ? "clipped to today" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const labelFor = (i) =>
    intervals[i].partial
      ? `${intervals[i].label} (${PARTIAL_SUFFIX[shown?.interval] ?? "partial"})`
      : intervals[i].label;

  return (
    <section className="panel investment-returns__table-panel">
      <p className="investment-returns__caption">{caption}</p>
      <div className="investment-returns__table-scroll">
        <table className="investment-returns__table">
          <thead>
            <tr>
              <th scope="col" className="investment-returns__row-label">
                {unit ?? "Mixed"}
              </th>
              {intervals.map((s, i) => (
                <th key={s.key} scope="col">
                  {labelFor(i)}
                </th>
              ))}
              <th scope="col" className="investment-returns__total-col">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {body.map((row) => (
              <tr
                key={row.key}
                className={[
                  row.strong ? "is-strong" : "",
                  row.indent ? "is-indent" : "",
                  row.flag ? "is-flag" : "",
                  row.signed ? "is-signed" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <th scope="row" className="investment-returns__row-label">
                  {row.group && row.count > 0 ? (
                    <button
                      type="button"
                      className="investment-returns__disclosure"
                      onClick={() => toggle(row.group)}
                      aria-expanded={!!expanded[row.group]}
                    >
                      <span aria-hidden="true">
                        {expanded[row.group] ? "▾" : "▸"}
                      </span>{" "}
                      {row.label}{" "}
                      <span className="investment-returns__count">({row.count})</span>
                    </button>
                  ) : (
                    row.label
                  )}
                </th>
                {row.values.map((v, i) => (
                  <td
                    key={intervals[i].key}
                    className={row.signed && Number(v) < 0 ? "is-negative" : undefined}
                  >
                    {fmt(v)}
                  </td>
                ))}
                <td
                  className={`investment-returns__total-col${
                    row.signed && Number(row.total) < 0 ? " is-negative" : ""
                  }`}
                >
                  {fmt(row.total)}
                </td>
              </tr>
            ))}

            {/* Ending MV closes the value block, directly under the components
                that explain the move from Beginning MV. */}
            <tr className="is-strong">
              <th scope="row" className="investment-returns__row-label">
                Ending market value
              </th>
              {rows.endingMV.map((v, i) => (
                <td key={intervals[i].key}>{fmt(v)}</td>
              ))}
              <td className="investment-returns__total-col">{fmt(total?.endingMV)}</td>
            </tr>

            <tr className="investment-returns__spacer" aria-hidden="true">
              <td colSpan={intervals.length + 2} />
            </tr>

            <tr className="investment-returns__divider">
              <th
                scope="row"
                className="investment-returns__row-label"
                title="Every return below is divided by this — (opening + closing market value) / 2."
              >
                Average capital
              </th>
              {rows.avgCapital.map((v, i) => (
                <td key={intervals[i].key}>{fmt(v)}</td>
              ))}
              <td className="investment-returns__total-col" />
            </tr>

            {[
              {
                key: "returnPctRealized",
                label: "Realized return %",
                values: rows.returnPctRealized,
                total: total?.returnPctRealized,
              },
              {
                key: "returnPctUnrealized",
                label: "Unrealized return %",
                values: rows.returnPctUnrealized,
                total: total?.returnPctUnrealized,
              },
              {
                key: "returnPct",
                label: "Total return %",
                values: rows.returnPct,
                total: total?.returnPct,
                strong: true,
              },
            ].map((row) => (
              <tr
                key={row.key}
                className={`is-pct is-signed${row.strong ? " is-strong" : ""}`}
              >
                <th scope="row" className="investment-returns__row-label">
                  {row.label}
                </th>
                {row.values.map((v, i) => (
                  <td
                    key={intervals[i].key}
                    className={[
                      v === null ? "is-suppressed" : "",
                      v !== null && Number(v) < 0 ? "is-negative" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    title={
                      v === null
                        ? `This period has no Unrealized G/L posting near both of its boundaries, so price movement is unknown${
                            meta?.markCoverage?.[i]?.uncovered?.length
                              ? ` — unmarked: ${meta.markCoverage[i].uncovered
                                  .map((u) => u.account)
                                  .join(", ")}`
                              : ""
                          }`
                        : undefined
                    }
                  >
                    {fmtPct(v)}
                    {/* An irregular span (a missing mark can make one column
                        cover two years) is not comparable to its neighbours
                        without its annual rate. */}
                    {row.key === "returnPct" && rows.annualizedPct?.[i] != null ? (
                      <span className="investment-returns__sub">
                        {fmtPct(rows.annualizedPct[i])} p.a.
                      </span>
                    ) : null}
                  </td>
                ))}
                <td
                  className={`investment-returns__total-col${
                    Number(row.total) < 0 ? " is-negative" : ""
                  }`}
                >
                  {fmtPct(row.total)}
                  {row.key === "returnPct" &&
                  total?.annualizedPct !== null &&
                  total?.annualizedPct !== undefined ? (
                    <span className="investment-returns__sub">
                      {fmtPct(total.annualizedPct)} p.a.
                    </span>
                  ) : null}
                  {row.key === "returnPct" && total?.chainBroken && total?.clippedSpan ? (
                    <span className="investment-returns__sub">clipped span</span>
                  ) : null}
                </td>
              </tr>
            ))}

            {/* Coverage as its own row, not a pill inside the % cell: it keeps
                the % column right-aligned and scannable, and the trend across
                the period is itself information. */}
            <tr className="is-pct is-muted">
              <th
                scope="row"
                className="investment-returns__row-label"
                title="Share of the period's opening balance held in accounts that were actually valued (an Unrealized G/L posting) inside the period. Below 50% the return % is blank rather than guessed. A † means the valuation did not land on the period's boundaries, so the figure is dated to the valuation, not to the calendar period — switch the interval to 'Between marks' for columns that line up exactly."
              >
                Mark coverage
              </th>
              {rows.coverage.map((v, i) => {
                const misdated = rows.boundaryAligned?.[i] === false;
                const dates = rows.markDates?.[i] ?? [];
                return (
                  <td
                    key={intervals[i].key}
                    title={
                      misdated
                        ? `Valued ${dates.join(", ")} — not on this period's boundaries, so the figure is dated to the valuation rather than to ${intervals[i].label}. Use the "Between marks" interval for columns that line up exactly.`
                        : meta?.markCoverage?.[i]?.uncovered?.length
                          ? `Unmarked: ${meta.markCoverage[i].uncovered
                              .map((u) => `${u.account} (${Math.round(u.shareOfBMV * 100)}%)`)
                              .join(", ")}`
                          : undefined
                    }
                  >
                    {`${Math.round(Number(v) * 100)}%`}
                    {misdated ? (
                      <span className="investment-returns__dagger" aria-label="dated to the valuation, not the period">
                        †
                      </span>
                    ) : null}
                  </td>
                );
              })}
              <td className="investment-returns__total-col" />
            </tr>

          </tbody>
        </table>
      </div>

      {/* IRR sits outside the column grid on purpose: it is a single
          whole-period figure solved on the actual dated cash flows, not a
          per-column one, and putting it in a row would invite reading it
          across. */}
      <p className="investment-returns__irr">
        <span className="investment-returns__irr-label">
          IRR (money-weighted, annualized)
        </span>
        <span className="investment-returns__irr-value">
          {total?.irr === null || total?.irr === undefined
            ? "—"
            : fmtPct(total.irr)}
        </span>
        <span className="investment-returns__irr-note">
          {total?.irr === null || total?.irr === undefined
            ? "needs either a valuation in the period or a closed-out position, plus money both in and out over a span of 30+ days"
            : total?.irrBasis === "closed"
              ? `position closed at zero — solved on every dated flow from ${shown?.fromDate} to ${shown?.toDate}, no valuation needed`
              : `solved on every dated flow from ${shown?.fromDate} to ${shown?.toDate}`}
        </span>
      </p>
    </section>
  );
}

/**
 * Two panels sharing an x-axis rather than one dual-axis combo chart: the two
 * series differ by orders of magnitude ($237K of mark against 1.1% of return),
 * so a secondary axis would let the scaling place their crossings anywhere.
 */
function ReturnsCharts({ report, fmt, unit }) {
  const t = useChartTheme();
  const { intervals, rows } = report;

  const data = intervals.map((s, i) => ({
    label: s.label,
    income: rows.incomeTotal[i],
    price: rows.priceReturn[i],
    fx: rows.fxEffect[i],
    pct: rows.returnPct[i] === null ? null : rows.returnPct[i] * 100,
  }));
  const showFx = data.some((d) => Math.abs(Number(d.fx) || 0) >= 0.005);

  return (
    <section className="panel investment-returns__charts">
      <h2 className="investment-returns__chart-title">
        Return components{unit ? ` — ${unit}` : ""}
      </h2>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" stroke={t.axis} tick={{ fill: t.ink, fontSize: 12 }} />
          <YAxis
            stroke={t.axis}
            tick={{ fill: t.ink, fontSize: 12 }}
            tickFormatter={(v) => fmt(v)}
            width={100}
          />
          <Tooltip content={<ChartTooltip formatter={(v) => fmt(v)} />} />
          <Legend wrapperStyle={{ fontSize: 12, color: t.ink }} />
          <ReferenceLine y={0} stroke={t.axis} />
          <Bar dataKey="income" name="Realized income" stackId="a" fill={t.seriesAt(1)} />
          <Bar dataKey="price" name="Price return" stackId="a" fill={t.seriesAt(0)} />
          {showFx ? (
            <Bar dataKey="fx" name="FX effect" stackId="a" fill={t.seriesAt(4)} />
          ) : null}
        </BarChart>
      </ResponsiveContainer>

      <h2 className="investment-returns__chart-title">Return %</h2>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" stroke={t.axis} tick={{ fill: t.ink, fontSize: 12 }} />
          <YAxis
            stroke={t.axis}
            tick={{ fill: t.ink, fontSize: 12 }}
            tickFormatter={(v) => `${v.toFixed(1)}%`}
            width={100}
          />
          <Tooltip
            content={
              <ChartTooltip
                formatter={(v) => (v === null ? "—" : `${Number(v).toFixed(2)}%`)}
              />
            }
          />
          <ReferenceLine y={0} stroke={t.axis} />
          <Bar dataKey="pct" name="Return %">
            {data.map((d) => (
              <Cell key={d.label} fill={d.pct === null ? t.grid : t.signed(d.pct)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
