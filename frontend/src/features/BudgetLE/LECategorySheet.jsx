import { useCallback, useEffect, useState } from "react";
import Modal from "../../components/Modal/Modal.jsx";
import Rest from "../../js/rest.js";
import { formatCurrencyValue } from "../BudgetEntry/utils/budgetInputUtils.js";
import "./LEGrid.css";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const label = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1] || ym;

function Cell({ value, muted = false }) {
  if (value === null || value === undefined) {
    return <span className="le-sheet__empty">—</span>;
  }
  const n = Number(value);
  return (
    <span className={`le-grid__money${n < 0 ? " le-grid__money--neg" : ""}${muted ? " le-sheet__muted" : ""}`}>
      {formatCurrencyValue(n)}
    </span>
  );
}

/**
 * CR083 §10 — the per-category worksheet.
 *
 * The month detail lives here rather than on the summary grid, so the grid keeps
 * one estimate column and stays inside its width. Actual months are read-only
 * and show their transaction count; estimate months are typed.
 *
 * Actuals are shown for EVERY month, including months on the estimate side. A
 * part-month that is already running hot is the single most useful thing to see
 * while typing next month's figure, and hiding it would be a choice to withhold
 * it.
 *
 * An empty estimate field is EMPTY, not zero. Clearing a field removes the row
 * rather than writing 0.00, because "never budgeted" and "deliberately zeroed"
 * are different facts and L4 is the rule that depends on telling them apart.
 */
function LECategorySheet({ leId, categoryId, onClose, onSaved }) {
  const [sheet, setSheet] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const d = Rest.unwrap(await Rest.get(`/budget/le/${leId}/category/${categoryId}`));
      setSheet(d);
      setDraft({});
      setError("");
    } catch (e) {
      console.error("[LECategorySheet] load failed:", e);
      setError("Could not load this category.");
    }
  }, [leId, categoryId]);

  useEffect(() => { load(); }, [load]);

  const editable = sheet?.le?.status === "draft";

  const shown = (m) =>
    Object.prototype.hasOwnProperty.call(draft, m.month)
      ? draft[m.month]
      : (m.estimate === null ? "" : String(m.estimate));

  const dirty = Object.keys(draft).length > 0;

  const projected = sheet
    ? sheet.months.reduce((s, m) => {
        if (m.isActual) return s + (m.actual || 0);
        const raw = shown(m);
        const n = raw === "" ? 0 : Number(raw);
        return s + (Number.isFinite(n) ? n : 0);
      }, 0)
    : 0;

  const handleSave = async () => {
    setBusy(true);
    setError("");
    try {
      const values = {};
      for (const [month, raw] of Object.entries(draft)) {
        values[month] = raw === "" ? null : Number(raw);
        if (values[month] !== null && !Number.isFinite(values[month])) {
          throw new Error(`${label(month)} is not a number`);
        }
      }
      const d = Rest.unwrap(
        await Rest.patch(`/budget/le/${leId}/category/${categoryId}`, { values })
      );
      setSheet(d);
      setDraft({});
      onSaved?.();
    } catch (e) {
      setError(e?.message || "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title={sheet ? sheet.category.name : "Category"}
      description={
        sheet
          ? `${sheet.le.name} · actual to ${sheet.le.actualThrough} · estimate months are editable`
          : ""
      }
      footer={
        <div className="le-sheet__footer">
          <span className="le-sheet__projected">
            Full year{" "}
            <Cell value={projected} />
            {dirty && <em className="le-sheet__dirty"> unsaved</em>}
          </span>
          <span className="le-sheet__footer-actions">
            <button type="button" className="btn btn--outline" onClick={onClose} disabled={busy}>
              Close
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSave}
              disabled={busy || !dirty || !editable}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </span>
        </div>
      }
    >
      {error && <p className="le-error" role="alert">{error}</p>}
      {!sheet && <p className="le-sheet__loading">Loading…</p>}

      {sheet && (
        <>
          <table className="le-sheet">
            <thead>
              <tr>
                <th className="le-sheet__month">MONTH</th>
                <th className="le-sheet__num">ACTUAL</th>
                <th className="le-sheet__num">BUDGET</th>
                <th className="le-sheet__num">ESTIMATE</th>
              </tr>
            </thead>
            <tbody>
              {sheet.months.map((m) => (
                <tr key={m.month} className={m.isActual ? "le-sheet__row--actual" : ""}>
                  <th scope="row" className="le-sheet__month">
                    {label(m.month)}
                    {m.isActual && <span className="le-sheet__tag">actual</span>}
                  </th>
                  <td className="le-sheet__num">
                    <Cell value={m.actual} muted={!m.isActual} />
                    {m.actualRowCount > 0 && (
                      <span className="le-sheet__count">{m.actualRowCount}</span>
                    )}
                  </td>
                  <td className="le-sheet__num"><Cell value={m.budget} muted /></td>
                  <td className="le-sheet__num">
                    {m.isActual ? (
                      <span className="le-sheet__empty">—</span>
                    ) : (
                      <input
                        className="le-sheet__input"
                        type="text"
                        inputMode="decimal"
                        aria-label={`${sheet.category.name}, ${label(m.month)} estimate`}
                        value={shown(m)}
                        disabled={!editable}
                        placeholder="—"
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [m.month]: e.target.value }))
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="le-sheet__note">
            Actuals are shown for every month, including months you are still
            estimating — an estimate month that is already running is worth
            seeing while you type. <strong>An empty field is empty, not zero</strong>:
            clearing one removes the estimate rather than asserting that the
            category will spend nothing.
          </p>
        </>
      )}
    </Modal>
  );
}

export default LECategorySheet;
