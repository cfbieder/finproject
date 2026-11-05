import { useMemo, useState } from "react";
import Modal from "../../components/Modal/Modal.jsx";
import { CURRENCIES, MAX_ITEMS, categoryReference, factor, summarise } from "./itemsMath.js";
import "./ItemsModal.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (v, digits = 0) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const neg = (v) => (Number(v) < 0 ? "bb-neg" : undefined);
const blankRow = (currency) => ({ description: "", currency, months: Array(12).fill("") });

/**
 * CR100 — an itemised line's rows: one per item (a trip, say), by month, each in its own currency,
 * totalled into the line's currency at the build's rates. Reference rows on top: the LE year's
 * actual and budget for the whole category, converted the same way. Nothing saves until Save; a
 * refusal (from the page's own check or the server) is shown here and the rows are kept.
 */
export default function ItemsModal({ line, categoryLines, rates, reference, leYear, targetYear, readOnly, busy, error, onSave, onClose }) {
  const [rows, setRows] = useState(() =>
    line.items?.length
      ? line.items.map((it) => ({ description: it.description, currency: it.currency, months: it.months.map((v) => (v ? String(v) : "")) }))
      : [blankRow(line.currency)]);
  const fx = rates?.fx;
  const sum = useMemo(() => summarise(rows, line, fx), [rows, line, fx]);
  const ref = useMemo(
    () => (reference ? categoryReference(categoryLines, line.currency, fx, reference) : null),
    [reference, categoryLines, line.currency, fx],
  );

  const setCell = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setMonth = (i, m, v) => setRows(rows.map((r, j) => (j === i ? { ...r, months: r.months.map((x, k) => (k === m ? v : x)) } : r)));
  const rateNote = CURRENCIES.filter((c) => c !== line.currency && fx?.[c]?.rate && fx?.[line.currency]?.rate)
    .map((c) => `1 ${c} = ${fmt(factor(c, line.currency, fx), 4)} ${line.currency}`).join(" · ");

  const footer = readOnly ? (
    <button type="button" className="btn btn--secondary" onClick={onClose}>Close</button>
  ) : (
    <>
      <button type="button" className="btn btn--secondary" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="btn btn--primary" disabled={busy || !!sum.problem}
        onClick={() => onSave(rows.map((r) => ({ description: r.description.trim(), currency: r.currency, months: r.months.map((v) => v.trim()) })))}>
        {busy ? "Saving…" : "Save items"}
      </button>
    </>
  );

  return (
    <Modal open onClose={busy ? undefined : onClose} dismissable={!busy} size="chart"
      title={`${line.category} (${line.currency}) — items`}
      description={`Budget ${targetYear}, itemised: each row is an item by month, in its own currency; the total is the line's figure in ${line.currency}.`}
      footer={footer}>
      <div className="bb-items">
        <p className="bb-muted bb-items__note">
          Positive amounts take the line&apos;s sign; negatives stay negative. Converted at the build&apos;s rates
          {rateNote ? ` (${rateNote})` : ""}.
        </p>

        <table className="bb-months bb-items__ref">
          <thead><tr><th className="bb-months__lbl" />{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Year</th></tr></thead>
          <tbody>
            {ref ? (
              <>
                <tr>
                  <th scope="row" className="bb-months__lbl">Actual {leYear}</th>
                  {ref.actual.map((v, i) => <td key={i} className={`num ${neg(v) || ""}`}>{fmt(v)}</td>)}
                  <td className="num">{fmt(ref.actual.reduce((a, v) => a + (v ?? 0), 0))}</td>
                </tr>
                <tr>
                  <th scope="row" className="bb-months__lbl">Budget {leYear}</th>
                  {ref.budget.map((v, i) => <td key={i} className={`num ${neg(v) || ""}`}>{fmt(v)}</td>)}
                  <td className="num">{fmt(ref.budget.reduce((a, v) => a + v, 0))}</td>
                </tr>
              </>
            ) : (
              <tr><td colSpan={14} className="bb-muted">Loading last year&apos;s figures…</td></tr>
            )}
          </tbody>
        </table>
        {ref && (
          <p className="bb-muted bb-items__note">
            Every currency line of {line.category}, converted into {line.currency} at the {targetYear} rates, so it will
            not match the Budget page to the cent{ref.skipped.length ? ` · not included (no rate): ${ref.skipped.join(", ")}` : ""}.
          </p>
        )}

        <div className="bb-items__scroll">
          <table className="bb-months bb-items__grid">
            <thead>
              <tr>
                <th className="bb-items__desc">Item</th><th className="bb-items__cur">Cur</th>
                {MONTHS.map((m) => <th key={m} className="num">{m}</th>)}
                <th className="num">Total</th><th className="num">In {line.currency}</th>{!readOnly && <th className="bb-items__del" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="bb-items__desc">
                    {readOnly ? r.description : (
                      <input type="text" maxLength={200} value={r.description} disabled={busy}
                        aria-label={`Item ${i + 1} description`} placeholder="e.g. Lisbon flights"
                        onChange={(e) => setCell(i, { description: e.target.value })} />
                    )}
                  </td>
                  <td className="bb-items__cur">
                    {readOnly ? r.currency : (
                      <select value={r.currency} disabled={busy} aria-label={`Item ${i + 1} currency`}
                        onChange={(e) => setCell(i, { currency: e.target.value })}>
                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                  </td>
                  {r.months.map((v, m) => (
                    <td key={m} className="num">
                      {readOnly ? <span className={neg(v)}>{v ? fmt(v, 2) : ""}</span> : (
                        <input type="text" inputMode="decimal" className="bb-num-input" value={v} placeholder="0" disabled={busy}
                          aria-label={`Item ${i + 1} ${MONTHS[m]}`}
                          onChange={(e) => setMonth(i, m, e.target.value)} />
                      )}
                    </td>
                  ))}
                  <td className={`num ${neg(sum.rowTotals[i]?.own) || ""}`}>{fmt(sum.rowTotals[i]?.own)}</td>
                  <td className={`num ${neg(sum.rowTotals[i]?.line) || ""}`}>{fmt(sum.rowTotals[i]?.line)}</td>
                  {!readOnly && (
                    <td className="bb-items__del">
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
                        aria-label={`Delete item ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2} className="bb-months__lbl">Budget {targetYear} ({line.currency})</th>
                {(sum.months || Array(12).fill(null)).map((v, m) => <td key={m} className={`num bb-strong ${neg(v) || ""}`}>{fmt(v)}</td>)}
                <td />
                <td className={`num bb-strong ${neg(sum.annual) || ""}`}>{fmt(sum.annual)}</td>
                {!readOnly && <td />}
              </tr>
            </tfoot>
          </table>
        </div>

        {!readOnly && (
          <p className="bb-items__actions">
            <button type="button" className="btn btn--secondary btn--sm" disabled={busy || rows.length >= MAX_ITEMS}
              onClick={() => setRows([...rows, blankRow(line.currency)])}>+ Add item</button>
            {sum.problem && <span className="bb-flag"> ⚠ Not saved yet: {sum.problem}</span>}
            {!sum.problem && sum.months == null && <span className="bb-flag"> ⚠ An item&apos;s currency has no rate in this build&apos;s scenario</span>}
          </p>
        )}
        {error && <p className="bb-flag" role="alert">⚠ {error}</p>}
      </div>
    </Modal>
  );
}
