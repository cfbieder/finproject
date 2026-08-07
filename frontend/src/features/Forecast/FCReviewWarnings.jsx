import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, AlertCircle, CheckCircle2, ChevronDown, X, Undo2 } from "lucide-react";
import Rest from "../../js/rest.js";
import {
  formatMoney,
  formatYearList,
  warningFingerprint,
  partitionDismissed,
} from "./utils/fcWarnings.js";
import "./FCReviewWarnings.css";

/**
 * FCReviewWarnings (CR045 Phase 1) — cash-health warnings for the generated
 * scenario, between the KPI row and the Review table.
 *
 * Presentational over a pure derivation: `warnings` comes from `computeForecastWarnings`.
 * Renders an explicit all-clear when there is nothing wrong, so a silent panel
 * can never be mistaken for a healthy forecast — the failure mode that let a
 * $20M unfunded shortfall sit on this page unremarked (CR045 §1).
 *
 * ── CR074 — DISMISSING a warning ────────────────────────────────────────────
 *
 * Twenty-one issues is a list nobody reads, and the ones already judged and accepted are what
 * make it that long. So each row can be dismissed, and the header can dismiss the lot.
 *
 * Three properties this must keep, all of them consequences of CR045 §1 — the panel exists
 * because a quiet page was mistaken for a healthy plan, and a dismissal is a way to make a page
 * quiet:
 *
 *   1. **Dismissed is never invisible.** The header keeps counting the FULL number of issues and
 *      says how many are dismissed; one click shows them again. The panel never reports fewer
 *      problems than the plan has.
 *   2. **All-dismissed is not all-clear.** With every issue accepted the panel says exactly
 *      that, in its own state — it does not fall through to "Cash stays funded across every
 *      forecast year", which is a statement about the plan and would become a lie.
 *   3. **A dismissal expires when the warning changes.** It is stored against a fingerprint of
 *      what the warning asserts (`warningFingerprint`), so accepting "Sweep source fully drained
 *      2061" does not silence the same rule when the plan makes it 2041. Such a warning returns
 *      to the visible list flagged `staleDismissal`, and says so.
 */
export default function FCReviewWarnings({ warnings = [], onAutoAdjust, scenario }) {
  const [collapsed, setCollapsed] = useState(false);
  const [dismissals, setDismissals] = useState({});
  const [showDismissed, setShowDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!scenario) { setDismissals({}); return undefined; }
    (async () => {
      try {
        const map = await Rest.fetchWarningDismissals(scenario);
        if (active) setDismissals(map || {});
      } catch {
        // A dismissal store that cannot be read must not hide anything: fall back to showing
        // every warning rather than to showing none.
        if (active) setDismissals({});
      }
    })();
    return () => { active = false; };
  }, [scenario]);

  const { visible, dismissed } = useMemo(
    () => partitionDismissed(warnings, dismissals),
    [warnings, dismissals]
  );

  const dismiss = useCallback(async (list) => {
    if (!scenario || !list.length) return;
    const items = list.map((w) => ({ warningId: w.id, fingerprint: warningFingerprint(w) }));
    // Optimistic, then reconciled: the panel is a reading surface and a round-trip per click
    // makes it feel broken. A failure puts the rows straight back and says why.
    const before = dismissals;
    setDismissals({ ...before, ...Object.fromEntries(items.map((i) => [i.warningId, i.fingerprint])) });
    setBusy(true);
    setError("");
    try {
      await Rest.dismissWarnings(scenario, items);
    } catch (err) {
      setDismissals(before);
      setError(err?.message || "Could not save that dismissal — the warning is still showing.");
    } finally {
      setBusy(false);
    }
  }, [scenario, dismissals]);

  const restore = useCallback(async (warningId) => {
    if (!scenario) return;
    const before = dismissals;
    const next = { ...before };
    if (warningId) delete next[warningId]; else Object.keys(next).forEach((k) => delete next[k]);
    setDismissals(next);
    setBusy(true);
    setError("");
    try {
      await Rest.restoreWarnings(scenario, warningId);
    } catch (err) {
      setDismissals(before);
      setError(err?.message || "Could not restore that warning.");
    } finally {
      setBusy(false);
    }
  }, [scenario, dismissals]);

  // The all-clear is a claim about the PLAN, so it may only appear when the plan has no issues
  // at all — never because they have been accepted. See property 2 in the header.
  if (warnings.length === 0) {
    return (
      <section className="fc-warnings fc-warnings--clear" aria-label="Forecast cash health">
        <CheckCircle2 size={16} />
        <span>Cash stays funded across every forecast year.</span>
      </section>
    );
  }

  const errorCount = visible.filter((w) => w.severity === "error").length;
  const canDismiss = Boolean(scenario);
  const rows = showDismissed ? [...visible, ...dismissed.map((w) => ({ ...w, isDismissed: true }))] : visible;

  return (
    <section className="fc-warnings" aria-label="Forecast cash health">
      <button
        type="button"
        className="fc-warnings__header"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className="fc-warnings__title">
          <AlertTriangle size={15} />
          {/* The FULL count, always. Reporting only what is left to read would make the panel
              understate the plan's problems, which is the one thing it exists not to do. */}
          Cash health — {warnings.length} issue{warnings.length === 1 ? "" : "s"}
          {dismissed.length > 0 && (
            <span className="fc-warnings__dismissed-count">{dismissed.length} dismissed</span>
          )}
          {errorCount > 0 && (
            <span className="fc-warnings__count">{errorCount} blocking</span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`fc-warnings__chevron${collapsed ? " fc-warnings__chevron--collapsed" : ""}`}
        />
      </button>

      {(onAutoAdjust && errorCount > 0) || canDismiss ? (
        <div className="fc-warnings__actions">
          {onAutoAdjust && errorCount > 0 && (
            <button type="button" className="btn btn-sm" onClick={onAutoAdjust}>
              Auto-adjust spending to fund the plan…
            </button>
          )}
          {canDismiss && visible.length > 0 && (
            <button
              type="button"
              className="btn btn-sm fc-warnings__dismiss-all"
              onClick={() => dismiss(visible)}
              disabled={busy}
            >
              Dismiss all {visible.length}
            </button>
          )}
          {canDismiss && dismissed.length > 0 && (
            <>
              <button
                type="button"
                className="btn btn-sm fc-warnings__toggle-dismissed"
                onClick={() => setShowDismissed((v) => !v)}
              >
                {showDismissed ? "Hide" : "Show"} {dismissed.length} dismissed
              </button>
              <button
                type="button"
                className="btn btn-sm fc-warnings__toggle-dismissed"
                onClick={() => restore(null)}
                disabled={busy}
              >
                <Undo2 size={13} /> Restore all
              </button>
            </>
          )}
        </div>
      ) : null}

      {error && <p className="fc-warnings__error">{error}</p>}

      {!collapsed && (
        <>
          {/* Every issue accepted. Said in its own words rather than falling through to the
              all-clear above, which is a statement about the plan and would be false here. */}
          {visible.length === 0 && !showDismissed && (
            <p className="fc-warnings__all-dismissed">
              All {dismissed.length} issue{dismissed.length === 1 ? " is" : "s are"} dismissed —
              nothing is fixed, they are accepted. Use “Show {dismissed.length} dismissed” to
              read them again.
            </p>
          )}

          <ul className="fc-warnings__list">
            {rows.map((w) => {
              const Icon = w.severity === "error" ? AlertTriangle : AlertCircle;
              return (
                <li
                  key={w.id}
                  className={`fc-warning fc-warning--${w.severity}${w.isDismissed ? " fc-warning--dismissed" : ""}`}
                >
                  <Icon size={16} className="fc-warning__icon" />
                  <div className="fc-warning__body">
                    <div className="fc-warning__headline">
                      <span className="fc-warning__title">{w.title}</span>
                      {w.years.length > 0 && (
                        <span className="fc-warning__years">{formatYearList(w.years)}</span>
                      )}
                      {w.amount != null && (
                        <span className="fc-warning__amount">{formatMoney(w.amount)}</span>
                      )}
                    </div>
                    <p className="fc-warning__detail">{w.detail}</p>
                    {/* A dismissal that expired because the numbers moved. Saying so is the
                        point — otherwise it reads as a warning that was never accepted, and the
                        owner re-reasons from scratch about something they already judged. */}
                    {w.staleDismissal && (
                      <p className="fc-warning__stale">
                        You dismissed this before — it is back because what it says has changed.
                      </p>
                    )}
                    {w.id === "no-sweep-module" && (
                      <Link to="/forecast-modules" className="fc-warning__action">
                        Set a sweep priority →
                      </Link>
                    )}
                  </div>
                  {canDismiss && (
                    w.isDismissed ? (
                      <button
                        type="button"
                        className="fc-warning__dismiss"
                        onClick={() => restore(w.id)}
                        disabled={busy}
                        title="Bring this warning back"
                        aria-label={`Restore warning: ${w.title}`}
                      >
                        <Undo2 size={14} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="fc-warning__dismiss"
                        onClick={() => dismiss([w])}
                        disabled={busy}
                        title="Dismiss — it returns if its figures change"
                        aria-label={`Dismiss warning: ${w.title}`}
                      >
                        <X size={14} />
                      </button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
