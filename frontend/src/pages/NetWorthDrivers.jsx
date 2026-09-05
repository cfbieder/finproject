import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import PeriodSelector from "../components/PeriodSelector/PeriodSelector.jsx";
import { useNetWorthBridge, useNetWorthNarration } from "../hooks/useReports.js";
import {
  Waterfall,
  PeriodTable,
  MoverTable,
  BridgeNotes,
  BridgeNarrative,
} from "../features/NetWorthBridge/bridgeParts.jsx";
import { fullUSD, prettyDate, totalsFrom } from "../features/NetWorthBridge/bridgeFormat.js";
import { windowFor } from "../features/NetWorthBridge/reportWindow.js";
import "./NetWorthDrivers.css";

/**
 * Net Worth Drivers (CR092 P2) — the Home hero's "What changed?" breakdown as a
 * report, over any period.
 *
 * Owner-requested from the modal: *"I really like this — can we make it a report
 * where the user can select the period."* Same engine, same endpoint, same
 * rendering (`features/NetWorthBridge/bridgeParts.jsx`); what this adds is the
 * period control and every account instead of the modal's top handful.
 *
 * Sits beside `/investment-returns` under Reports & Graphs and borrows its
 * shape deliberately — `PeriodSelector`, a report body, and the caveats
 * rendered rather than dropped.
 */

export default function NetWorthDrivers() {
  const now = new Date();
  const [fromMonth, setFromMonth] = useState("01");
  const [toMonth, setToMonth] = useState(String(now.getMonth() + 1).padStart(2, "0"));
  const [actualYear, setActualYear] = useState(now.getFullYear());
  const [toYear, setToYear] = useState(now.getFullYear());
  const [granularity, setGranularity] = useState("month");

  // Plain function, deliberately not useCallback: the React Compiler infers the
  // setters as dependencies, so a hand-written `[]` is memoization it refuses to
  // preserve — an eslint ERROR here, and CI blocks on those. The compiler
  // memoizes this for us.
  const handlePeriodChange = (next) => {
    if (next.fromMonth !== undefined) setFromMonth(next.fromMonth);
    if (next.toMonth !== undefined) setToMonth(next.toMonth);
    if (next.actualYear !== undefined) setActualYear(Number(next.actualYear));
    if (next.toYear !== undefined) setToYear(Number(next.toYear));
  };

  const { fromDate, toDate } = useMemo(
    () => windowFor({ fromYear: actualYear, fromMonth, toYear, toMonth }),
    [actualYear, fromMonth, toYear, toMonth]
  );

  // An inverted window is a legitimate thing to pick with two year dropdowns,
  // and the endpoint 400s on it. Caught here so the page explains it instead of
  // rendering a request failure.
  const inverted = fromDate >= toDate;

  const { data: payload, isPending, isFetching, isError, error } = useNetWorthBridge({
    fromDate,
    toDate,
    granularity,
    // Every account, not the modal's top 12 — the grid is the point of this page.
    movers: 500,
    enabled: !inverted,
  });

  const data = payload?.data ?? null;
  const meta = payload?.meta ?? null;

  // CR092 P1 — deliberately WITHOUT `movers`. The prose is built from the
  // drivers and their named contributors only, so the page's `movers: 500` and
  // the modal's default produce identical narration for the same window —
  // passing it would fork the cache key and spend a second ~8 s of the shared
  // GPU tier to say the same thing.
  const { data: narrationPayload } = useNetWorthNarration({
    fromDate,
    toDate,
    granularity,
    enabled: !inverted && Boolean(data) && meta?.tieOk !== false,
  });

  return (
    <main className="page-main nw-drivers">
      <header className="nw-drivers__header">
        <h1 className="nw-drivers__title">Net Worth Drivers</h1>
        <p className="nw-drivers__subtitle">
          What moved net worth over a period, and which accounts did it. The
          drivers reconstruct the change exactly — nothing here is estimated.
        </p>
      </header>

      <section className="nw-drivers__controls panel" aria-label="Report controls">
        <div className="nw-drivers__field nw-drivers__field--period">
          <span className="nw-drivers__label">Period</span>
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

        <div className="nw-drivers__field">
          <span className="nw-drivers__label">Break down by</span>
          <div className="nw-drivers__segmented" role="group" aria-label="Granularity">
            {[
              { key: "month", label: "Month" },
              { key: "quarter", label: "Quarter" },
              { key: "year", label: "Year" },
              { key: "none", label: "Whole period" },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                aria-pressed={granularity === opt.key}
                className={`btn btn--sm ${
                  granularity === opt.key ? "btn--primary" : "btn--outline"
                }`}
                onClick={() => setGranularity(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <p className="nw-drivers__window">
          {inverted ? (
            <span className="nw-drivers__window--bad">
              That period ends before it starts — pick a later end.
            </span>
          ) : (
            <>
              Measured from <strong>{prettyDate(fromDate)}</strong> to{" "}
              <strong>{prettyDate(toDate)}</strong>
              {/* The opening boundary is the day before the period, and saying
                  so out loud is cheaper than a reader wondering why January's
                  report starts on 31 December. */}
              <span className="nw-drivers__window-note">
                {" "}— the opening balance is read the day before the period, so
                the first month's own transactions count as change.
              </span>
            </>
          )}
        </p>
      </section>

      {!inverted && isPending && (
        <p className="nwb__state">Working out what moved…</p>
      )}

      {isError && (
        <p className="nwb__state nwb__state--error">
          Could not build the report: {error?.message || "unknown error"}
        </p>
      )}

      {data && (
        <div className={"nwb nw-drivers__body" + (isFetching ? " is-stale" : "")}>
          {meta && meta.tieOk === false && (
            <p className="nwb__tie-warning">
              <AlertTriangle size={16} aria-hidden="true" />
              These figures do not add up to the total — they are out by{" "}
              {fullUSD.format(Math.abs(meta.tie))}. Treat the breakdown as
              incomplete.
            </p>
          )}

          <BridgeNarrative
            summary={data.summary}
            narration={narrationPayload?.data ?? null}
          />

          <section className="panel nw-drivers__panel" aria-label="Drivers">
            <Waterfall data={data} />
          </section>

          {/* Both tables are open on the report. They are collapsed in the modal
              because a dialog has to fit on screen; a report page has no such
              excuse, and hiding the grid behind a click on the page built to
              show it would be the control-that-hides-its-own-content shape. */}
          <section className="panel nw-drivers__panel" aria-label="Which accounts moved">
            <h2 className="nw-drivers__panel-title">
              Which accounts moved
              <span className="nw-drivers__panel-hint">
                {data.movers.length} account{data.movers.length === 1 ? "" : "s"} — sort
                by any column; money moved between accounts nets to nothing
              </span>
            </h2>
            <MoverTable
              movers={data.movers}
              sortable
              totals={totalsFrom(data)}
              remainder={data.remainder}
            />
          </section>

          {data.periods.length > 1 && (
            <section className="panel nw-drivers__panel" aria-label="Period by period">
              <h2 className="nw-drivers__panel-title">
                Period by period
                <span className="nw-drivers__panel-hint">
                  These add up to the total above
                </span>
              </h2>
              <PeriodTable periods={data.periods} totals={totalsFrom(data)} />
            </section>
          )}

          <BridgeNotes meta={meta} />
        </div>
      )}
    </main>
  );
}
