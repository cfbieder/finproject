/**
 * FCAnnualCloseModal (CR064 P2) — roll a base scenario into next year's, after seeing what moves.
 *
 * The close COPIES the base (owner decision 2026-08-02: last year's scenario stays as a record),
 * re-anchors every module at the year-end, moves PeriodStart to that year + 2 (CR075: −2 actual,
 * −1 budget, 0 first forecast year) and re-creates the base's variants against the copy.
 *
 * Cost basis and market value are ticked SEPARATELY per module. The server pre-ticks a column
 * only when it tracked the ledger at the old anchor, so a figure the owner set by hand (a cost
 * basis, an appraisal) is never replaced without a click — the old blind re-base wrote the
 * market value into Fidelity's cost basis.
 */
import { useEffect, useMemo, useState } from "react";
import Modal from "../../components/Modal/Modal.jsx";
import Rest from "../../js/rest.js";
import "./FCAnnualCloseModal.css";

const money = (v) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Why a box starts unticked — per column, so a half-ticked row is explained too. */
const noteFor = (m) => {
  if (m.reason) return m.reason;
  if (!m.rollBase && m.rollMarket) return "cost basis set by hand — kept unless ticked";
  if (m.rollBase && !m.rollMarket) return "market value set by hand — kept unless ticked";
  return "";
};

const neg = (v) => (Number(v) < 0 ? "fc-annual-close__neg" : undefined);

/** The last 31 December that has happened. */
const lastClosedYear = () => {
  const now = new Date();
  return now.getMonth() === 11 && now.getDate() === 31 ? now.getFullYear() : now.getFullYear() - 1;
};

export default function FCAnnualCloseModal({ scenarioId, scenarioName, existingNames = [], onClose, onDone }) {
  const [year, setYear] = useState(lastClosedYear());
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [rollBase, setRollBase] = useState(new Set());
  const [rollMarket, setRollMarket] = useState(new Set());
  const [variantNames, setVariantNames] = useState({});
  const [saving, setSaving] = useState(false);
  const asOfDate = `${year}-12-31`;

  const pickYear = (y) => {
    setPreview(null);
    setError("");
    setYear(y);
  };

  useEffect(() => {
    let cancelled = false;
    Rest.get(`/forecast/scenarios/${scenarioId}/annual-close?asOfDate=${asOfDate}`)
      .then((r) => {
        if (cancelled) return;
        const p = r.data;
        setPreview(p);
        setNewName(p.suggestedName);
        setRollBase(new Set(p.modules.filter((m) => m.rollBase).map((m) => m.moduleId)));
        setRollMarket(new Set(p.modules.filter((m) => m.rollMarket).map((m) => m.moduleId)));
        setVariantNames(Object.fromEntries(p.variants.map((v) => [v.id, v.newName])));
      })
      .catch((e) => { if (!cancelled) setError(e.message || "Preview failed"); });
    return () => { cancelled = true; };
  }, [scenarioId, asOfDate]);

  const toggle = (setter) => (id) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // A close that moves nothing: the scenario already starts where this close would put it.
  const alreadyClosed = Boolean(preview && preview.newPeriodStart <= preview.scenario.periodStart);
  const taken = new Set(existingNames);
  const nameTaken = taken.has(newName.trim());
  const variantTaken = (preview?.variants || []).filter((v) => v.carry && taken.has((variantNames[v.id] || "").trim()));
  const blocked = !preview || !preview.closed || alreadyClosed || !newName.trim() || nameTaken || variantTaken.length > 0;

  const valued = useMemo(() => (preview?.modules || []).filter((m) => m.canRoll), [preview]);
  const dateOnly = useMemo(() => (preview?.modules || []).filter((m) => !m.canRoll), [preview]);

  const apply = async () => {
    setSaving(true);
    setError("");
    try {
      const r = await Rest.post(`/forecast/scenarios/${scenarioId}/annual-close`, {
        newName: newName.trim(), asOfDate,
        rollBase: [...rollBase], rollMarket: [...rollMarket], variantNames,
      });
      onDone(r.data);
    } catch (e) {
      setError(e.message || "The close failed — nothing was written");
      setSaving(false);
    }
  };

  const footer = (
    <>
      {/* The dialog scrolls; an error above the table is invisible from the buttons. */}
      {error && <span className="fc-annual-close__error fc-annual-close__footer-error" role="alert">{error}</span>}
      <button type="button" className="fc-scenarios-action-button" onClick={onClose} disabled={saving}>
        Cancel
      </button>
      <button
        type="button"
        className="fc-scenarios-action-button fc-scenarios-action-button--primary"
        onClick={apply}
        disabled={blocked || saving}
      >
        {saving ? "Closing…" : `Create ${newName.trim() || "scenario"}`}
      </button>
    </>
  );

  return (
    <Modal
      open
      onClose={onClose}
      dismissable={!saving}
      size="chart"
      title={`Annual close — ${scenarioName}`}
      description="Copies this base into next year's, re-anchored at the year-end. This scenario is left as it is."
      footer={footer}
    >
      <div className="fc-annual-close">
        <div className="fc-annual-close__controls">
          <label>
            <span>Close year-end</span>
            <select value={year} onChange={(e) => pickYear(Number(e.target.value))} disabled={saving}>
              {[0, 1, 2].map((d) => lastClosedYear() - d).map((y) => (
                <option key={y} value={y}>31 Dec {y}</option>
              ))}
            </select>
          </label>
          <label>
            <span>New scenario name</span>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={saving || !preview} />
            {nameTaken && <span className="fc-annual-close__warn">⚠ A scenario with this name already exists</span>}
          </label>
          {preview && (
            <p className="fc-annual-close__period">
              Period {preview.scenario.periodStart ?? "—"}–{preview.scenario.periodEnd ?? "—"} becomes{" "}
              <strong>{preview.newPeriodStart}–{preview.scenario.periodEnd ?? "—"}</strong>: {year} actual,{" "}
              {year + 1} budget, forecast from {preview.newPeriodStart}.
            </p>
          )}
        </div>

        {error && !preview && <p className="fc-annual-close__error" role="alert">{error}</p>}
        {alreadyClosed && (
          <p className="fc-annual-close__warn" role="status">
            ⚠ {scenarioName} already forecasts from {preview.scenario.periodStart} — it is closed at 31 Dec {year}.
            Pick a later year-end.
          </p>
        )}
        {!preview && !error && <p className="fc-annual-close__muted" role="status">Reading the {year} year-end balances…</p>}

        {preview && (
          <>
            <h4 className="fc-annual-close__heading">Valued modules — tick what takes the {year} year-end balance</h4>
            <table className="fc-annual-close__table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Now anchored</th>
                  <th>Cost basis</th>
                  <th>Market value</th>
                  <th>Ledger {year}-12-31</th>
                  <th>Take as cost</th>
                  <th>Take as market</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {valued.map((m) => (
                  <tr key={m.moduleId}>
                    <td>{m.name} <span className="fc-annual-close__muted">{m.currency}</span></td>
                    <td>{m.baseDate}</td>
                    <td className={neg(m.baseValue)}>{money(m.baseValue)}</td>
                    <td className={neg(m.marketValue)}>{money(m.marketValue)}</td>
                    <td className={neg(m.ledger)}>{money(m.ledger)}</td>
                    <td>
                      <input type="checkbox" aria-label={`${m.name}: take the balance as cost basis`}
                        checked={rollBase.has(m.moduleId)} onChange={() => toggle(setRollBase)(m.moduleId)} disabled={saving} />
                    </td>
                    <td>
                      <input type="checkbox" aria-label={`${m.name}: take the balance as market value`}
                        checked={rollMarket.has(m.moduleId)} onChange={() => toggle(setRollMarket)(m.moduleId)} disabled={saving} />
                    </td>
                    <td className="fc-annual-close__muted">{noteFor(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fc-annual-close__muted">
              A box starts ticked only when that value matched the ledger at its current anchor. Unticked values are
              kept, now as your figure at {year}-12-31.
            </p>

            {dateOnly.length > 0 && (
              <details className="fc-annual-close__details">
                <summary>{dateOnly.length} module(s) only move their date, with the period</summary>
                <ul>
                  {dateOnly.map((m) => (
                    <li key={m.moduleId}>{m.name} — {m.reason}</li>
                  ))}
                </ul>
              </details>
            )}

            <h4 className="fc-annual-close__heading">Variants — re-created against the new base</h4>
            {preview.variants.length === 0 && <p className="fc-annual-close__muted">This scenario has no variants.</p>}
            {preview.variants.map((v) => (
              <div key={v.id} className="fc-annual-close__variant">
                <label>
                  <span>{v.name} →</span>
                  <input type="text" value={variantNames[v.id] ?? ""} disabled={saving || !v.carry}
                    onChange={(e) => setVariantNames((prev) => ({ ...prev, [v.id]: e.target.value }))} />
                </label>
                {v.reason && <p className="fc-annual-close__warn">{v.reason}</p>}
                {variantTaken.includes(v) && <p className="fc-annual-close__warn">⚠ A scenario with this name already exists</p>}
                <ul>
                  {v.overrides.map((o, i) => (
                    <li key={i}>
                      {o.pinsValue && <span className="fc-annual-close__marker" aria-hidden="true">⚠ </span>}
                      {o.target}: {o.deleted ? "removed" : o.fields.join(", ")}
                      {o.pinsValue && " — pins a value; it carries as it is, not re-based"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {!preview.closed && (
              <p className="fc-annual-close__warn" role="alert">
                {asOfDate} has not happened yet — the balances above are today&apos;s. Close it after the year ends.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
