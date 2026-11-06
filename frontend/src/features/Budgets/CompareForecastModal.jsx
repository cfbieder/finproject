import { Fragment, useEffect, useState } from "react";
import Rest from "../../js/rest.js";
import Modal from "../../components/Modal/Modal.jsx";
import { delta, deltaPct } from "./compareForecast.js";
import "./CompareForecastModal.css";

const fmt = (v, digits = 0) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const neg = (v) => (v != null && Number(Number(v).toFixed(0)) < 0 ? "bb-neg" : undefined);
const day = (iso) => (iso ? String(iso).slice(0, 10) : "—");

/** One figure row: label, Budget, Forecast, Δ, Δ%, LE. */
function Figures({ budget, forecast, le, budgetNote }) {
  const d = delta(budget, forecast);
  const p = deltaPct(budget, forecast);
  return (
    <>
      <td className={`num ${neg(budget) || ""}`} title={budgetNote}>{budgetNote && budget == null ? <span className="bb-muted">—</span> : fmt(budget)}</td>
      <td className={`num ${neg(forecast) || ""}`}>{fmt(forecast)}</td>
      <td className={`num ${neg(d) || ""}`}>{fmt(d)}</td>
      <td className={`num ${neg(p) || ""}`}>{p == null ? "" : `${fmt(p, 0)}%`}</td>
      <td className={`num ${neg(le) || ""}`}>{fmt(le)}</td>
    </>
  );
}

/**
 * CR102 — the build against a forecast scenario's (or variant's) stored figures for the build's own
 * year, in the forecast's P&L. Read-only. Lines expand to the budget categories behind them; the
 * forecast side has no category split.
 */
export default function CompareForecastModal({ buildId, buildLabel, onClose }) {
  const [scenario, setScenario] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const q = scenario ? `?scenario=${encodeURIComponent(scenario)}` : "";
    Rest.get(`/budget-builder/${buildId}/compare-forecast${q}`)
      .then((r) => { if (!cancelled) setData(Rest.unwrap(r)); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Could not load the comparison"); });
    return () => { cancelled = true; };
  }, [buildId, scenario]);

  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const lineRows = (lines) => lines.map((l) => {
    const key = l.fcLineId ?? l.name;
    const expandable = l.categories.length > 0;
    return (
      <Fragment key={key}>
        <tr className="cf-line">
          <td>
            {expandable ? (
              <button type="button" className="bb-linkish" aria-expanded={open.has(key)} onClick={() => toggle(key)}>
                {open.has(key) ? "▾" : "▸"} {l.name}
              </button>
            ) : <span className="cf-indent">{l.name}</span>}
            {l.noMapping && <span className="bb-muted"> · computed by the engine, nothing to budget</span>}
          </td>
          <Figures budget={l.budget} forecast={l.forecast} le={l.le} budgetNote={l.noMapping ? "No budget category maps to this line" : undefined} />
        </tr>
        {open.has(key) && l.categories.map((c) => (
          <tr key={`${key}-${c.categoryId}-${c.currency}`} className="cf-cat">
            <td>{c.name} <span className="bb-muted">{c.currency}{c.inactive ? " · inactive" : ""}</span></td>
            <td className={`num ${neg(c.budget) || ""}`}>{fmt(c.budget)}</td>
            <td /><td /><td />
            <td className={`num ${neg(c.le) || ""}`}>{fmt(c.le)}</td>
          </tr>
        ))}
      </Fragment>
    );
  });

  const subtotal = (label, t) => (
    <tr className="cf-subtotal">
      <th scope="row">{label}</th>
      <Figures budget={t.budget} forecast={t.forecast} le={t.le} />
    </tr>
  );

  const nif = data?.notInForecast;
  return (
    <Modal open onClose={onClose} size="chart" title={`Compare forecast — ${buildLabel}`}
      description="The budget build against a forecast's figures for the same year, in the forecast's P&L."
      footer={<button type="button" className="btn btn--secondary" onClick={onClose}>Close</button>}>
      <div className="cf">
        {error && <p className="bb-flag" role="alert">⚠ {error}</p>}
        {!data && !error && <p className="bb-muted">Loading…</p>}
        {data && (
          <>
            <div className="cf-head">
              <label>
                Forecast{" "}
                <select value={data.scenario.name} aria-label="Forecast scenario or variant"
                  onChange={(e) => { setError(""); setScenario(e.target.value); }}>
                  {data.options.map((o) => (
                    <option key={o.name} value={o.name}>{o.isVariant ? `${o.name} (variant)` : o.name}</option>
                  ))}
                </select>
              </label>
              <span className="bb-muted">
                Budget {data.build.targetYear} against forecast {data.build.targetYear}, generated {day(data.scenario.generatedAt)}
                {" "}· LE: {data.le?.name} at the build&apos;s rates · USD
              </span>
            </div>
            {!data.scenario.generatedForYear && (
              <p className="bb-flag">⚠ {data.scenario.name} has no stored forecast for {data.build.targetYear} — regenerate it on Forecasting.</p>
            )}
            {data.rates.differ && (
              <p className="bb-flag">
                ⚠ The rates differ: the build uses PLN {fmt(data.rates.build.PLN, 2)} · EUR {fmt(data.rates.build.EUR, 2)}, the
                forecast PLN {fmt(data.rates.forecast.PLN, 2)} · EUR {fmt(data.rates.forecast.EUR, 2)} — part of each difference is currency.
              </p>
            )}
            {(data.residual.budget || data.residual.le) ? (
              <p className="bb-flag">
                ⚠ {fmt(data.residual.budget)} of the budget is counted on more than one forecast line (a category mapped under two
                lines); fix the mapping on Forecast Line Mapping.
              </p>
            ) : null}
            <div className="cf-scroll">
              <table className="bb-table cf-table">
                <thead>
                  <tr>
                    <th>Forecast line</th>
                    <th className="num">Budget</th><th className="num">Forecast</th>
                    <th className="num">Δ</th><th className="num">Δ%</th><th className="num">LE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="cf-section"><th colSpan={6}>Income</th></tr>
                  {lineRows(data.income)}
                  {subtotal("Total income", data.totals.income)}
                  <tr className="cf-section"><th colSpan={6}>Expenses</th></tr>
                  {lineRows(data.expense)}
                  {subtotal("Total expenses", data.totals.expense)}
                  {nif && nif.categories.length > 0 && (
                    <>
                      <tr className="cf-line">
                        <td>
                          <button type="button" className="bb-linkish" aria-expanded={open.has("nif")} onClick={() => toggle("nif")}>
                            {open.has("nif") ? "▾" : "▸"} Not in the forecast
                          </button>
                          <span className="bb-muted"> · budget categories on no forecast line</span>
                        </td>
                        <Figures budget={nif.budget} forecast={null} le={nif.le} />
                      </tr>
                      {open.has("nif") && nif.categories.map((c) => (
                        <tr key={`nif-${c.categoryId}-${c.currency}`} className="cf-cat">
                          <td>{c.name} <span className="bb-muted">{c.currency}{c.isParent ? " · parent category" : ""}</span></td>
                          <td className={`num ${neg(c.budget) || ""}`}>{fmt(c.budget)}</td>
                          <td /><td /><td />
                          <td className={`num ${neg(c.le) || ""}`}>{fmt(c.le)}</td>
                        </tr>
                      ))}
                    </>
                  )}
                  {subtotal("P&L net (excludes transfers)", data.totals.net)}
                </tbody>
              </table>
            </div>
            <p className="bb-muted cf-note">
              Δ is budget − forecast; Δ% is over the forecast&apos;s size, so spending over plan reads negative. On lines the engine
              computes (taxes, property costs, interest, dividends), the forecast figure is the engine&apos;s own calculation — a
              difference there is a modelling difference, not overspending.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
