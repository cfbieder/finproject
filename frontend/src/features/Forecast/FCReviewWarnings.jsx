import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import { formatMoney, formatYearList } from "./utils/fcWarnings.js";
import "./FCReviewWarnings.css";

/**
 * FCReviewWarnings (CR045 Phase 1) — cash-health warnings for the generated
 * scenario, between the KPI row and the Review table.
 *
 * Presentational: `warnings` comes from the pure `computeForecastWarnings`.
 * Renders an explicit all-clear when there is nothing wrong, so a silent panel
 * can never be mistaken for a healthy forecast — the failure mode that let a
 * $20M unfunded shortfall sit on this page unremarked (CR045 §1).
 */
export default function FCReviewWarnings({ warnings = [] }) {
  const [collapsed, setCollapsed] = useState(false);

  if (warnings.length === 0) {
    return (
      <section className="fc-warnings fc-warnings--clear" aria-label="Forecast cash health">
        <CheckCircle2 size={16} />
        <span>Cash stays funded across every forecast year.</span>
      </section>
    );
  }

  const errorCount = warnings.filter((w) => w.severity === "error").length;

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
          Cash health — {warnings.length} issue{warnings.length === 1 ? "" : "s"}
          {errorCount > 0 && (
            <span className="fc-warnings__count">{errorCount} blocking</span>
          )}
        </span>
        <ChevronDown
          size={16}
          className={`fc-warnings__chevron${collapsed ? " fc-warnings__chevron--collapsed" : ""}`}
        />
      </button>

      {!collapsed && (
        <ul className="fc-warnings__list">
          {warnings.map((w) => {
            const Icon = w.severity === "error" ? AlertTriangle : AlertCircle;
            return (
              <li key={w.id} className={`fc-warning fc-warning--${w.severity}`}>
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
                  {w.id === "no-sweep-module" && (
                    <Link to="/forecast-modules" className="fc-warning__action">
                      Set a sweep priority →
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
