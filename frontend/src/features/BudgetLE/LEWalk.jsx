import { useEffect, useState } from "react";
import Rest from "../../js/rest.js";
import { formatCurrencyValue } from "../BudgetEntry/utils/budgetInputUtils.js";
import "./LEGrid.css";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const monthOf = (isoDate) => Number(String(isoDate).slice(5, 7)); // 1-based

/** Signed change: negative red, everything else ink — colour means sign. */
function Delta({ value, bold = false }) {
  const n = Number(value) || 0;
  if (Math.abs(n) < 0.005) return <span className="le-grid__empty">—</span>;
  return (
    <span className={`le-grid__money${n < 0 ? " le-grid__money--neg" : ""}${bold ? " le-grid__money--bold" : ""}`}>
      {n > 0 ? "+" : "−"}{formatCurrencyValue(Math.abs(n))}
    </span>
  );
}

function Money({ value, bold = false }) {
  const n = Number(value) || 0;
  return (
    <span className={`le-grid__money${n < 0 ? " le-grid__money--neg" : ""}${bold ? " le-grid__money--bold" : ""}`}>
      {formatCurrencyValue(n)}
    </span>
  );
}

/**
 * Why the full-year figure moved since an earlier LE — the walk
 *   prior FY + restated + closed + re-estimated = new FY.
 *
 * Reverses part of CR083 §11.1's cut. Two grids side by side showed LE-10-26
 * landing 35k better than LE-09-26; the walk shows 24k of that was typed
 * estimates the new LE never carried (fixed in the seeding, 2026-10-01). The
 * BASIS column is what makes that visible: `Typed → Budget` is not a forecast
 * change, it is a lost one.
 */
function LEWalk({ leId, list, refreshKey, onOpenCategory }) {
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState(null);
  const [walk, setWalk] = useState(null);
  const [error, setError] = useState("");

  const current = list.find((l) => l.id === leId);
  const earlier = current
    ? list.filter((l) => l.id !== leId && String(l.actual_through) < String(current.actual_through))
    : [];

  useEffect(() => {
    if (!leId) return undefined;
    let active = true;
    // Re-read on refreshKey too: a worksheet save moves the grid, and the walk
    // beside it must move with it or the two disagree on one screen.
    Rest.get(`/budget/le/${leId}/walk${fromId ? `?from=${fromId}` : ""}`)
      .then((p) => { if (active) { setWalk(Rest.unwrap(p) || null); setError(""); } })
      // Advisory: a failed first load hides the panel and never blocks the page;
      // a failed CHANGE keeps the last walk and the picker, and says why.
      .catch((e) => { if (active) setError(e?.message || "Could not compare those estimates."); });
    return () => { active = false; };
  }, [leId, fromId, refreshKey]);

  // Render only a walk that belongs to the selected LE (same gate as the page's panels).
  if (!walk || walk.leId !== leId || !walk.from) return null;
  const { from, to, rows, totals } = walk;

  const closedFrom = monthOf(from.actualThrough) + 1;
  const closedTo = monthOf(to.actualThrough);
  const closedLabel = closedFrom > closedTo
    ? null
    : closedFrom === closedTo ? MONTHS[closedTo - 1] : `${MONTHS[closedFrom - 1]}–${MONTHS[closedTo - 1]}`;
  // Restated is non-zero only when the ledger moved under a frozen month — rare,
  // so the column appears only when it has something to say.
  const showRestated = rows.some((r) => Math.abs(r.restated) >= 0.005);
  const lost = rows.filter((r) => r.priorBasis !== "Budget" && r.priorBasis !== "—" && r.newBasis !== r.priorBasis);

  return (
    <section className="le-dev" aria-label={`Walk from ${from.name} to ${to.name}`}>
      <button
        type="button"
        className="le-dev__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="le-dev__chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="le-dev__title">
          Since {from.name}: FY moved <Delta value={totals.change} bold />
        </span>
        <span className="le-dev__sub">
          {closedLabel && <>{closedLabel} came in <Delta value={totals.closed} /> · </>}
          re-estimated <Delta value={totals.reestimated} />
          {Math.abs(totals.restated) >= 0.005 && <> · actuals restated <Delta value={totals.restated} /></>}
          {lost.length > 0 && <> · {lost.length} typed {lost.length === 1 ? "estimate" : "estimates"} changed basis</>}
        </span>
      </button>

      {open && (
        <div className="le-dev__body">
          {error && <p className="le-error" role="alert">{error}</p>}
          <div className="le-walk__controls">
            <label className="le-toolbar__field">
              <span className="le-toolbar__label">Compare to</span>
              <select
                className="le-toolbar__select"
                value={fromId ?? from.id}
                onChange={(e) => setFromId(Number(e.target.value))}
              >
                {earlier.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.status} · actuals to {String(l.actual_through).slice(0, 10)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <table className="le-grid le-walk">
            <thead>
              <tr>
                <th className="le-grid__cat">CATEGORY</th>
                <th className="le-grid__num">{from.name} FY</th>
                {showRestated && (
                  <th className="le-grid__num" title="Actual months both estimates hold as fact: did the ledger move under them?">RESTATED</th>
                )}
                {closedLabel && (
                  <th className="le-grid__num" title={`What ${from.name} estimated for ${closedLabel}, against what was actually booked`}>
                    {closedLabel.toUpperCase()} EST → ACTUAL
                  </th>
                )}
                <th className="le-grid__num le-grid__seam" title="Months both still estimate: new figure minus old">RE-ESTIMATED</th>
                <th className="le-grid__basis">BASIS</th>
                <th className="le-grid__num">{to.name} FY</th>
                <th className="le-grid__num">CHANGE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.categoryId} className="le-grid__row">
                  <th scope="row" className="le-grid__cat">
                    <button
                      type="button"
                      className="le-grid__catlink"
                      onClick={() => onOpenCategory(r.categoryId)}
                      title={`Open the ${r.categoryName} worksheet`}
                    >
                      {r.categoryName}
                    </button>
                  </th>
                  <td className="le-grid__num"><Money value={r.priorFy} /></td>
                  {showRestated && <td className="le-grid__num"><Delta value={r.restated} /></td>}
                  {closedLabel && (
                    <td className="le-grid__num">
                      <span className="le-walk__pair">
                        <Money value={r.closedEstimate} /> → <Money value={r.closedActual} />
                      </span>{" "}
                      <Delta value={r.closed} />
                    </td>
                  )}
                  <td className="le-grid__num le-grid__seam"><Delta value={r.reestimated} /></td>
                  <td className="le-grid__basis">
                    {r.basisChanged ? <strong>{r.priorBasis} → {r.newBasis}</strong> : r.newBasis}
                  </td>
                  <td className="le-grid__num"><Money value={r.newFy} /></td>
                  <td className="le-grid__num"><Delta value={r.change} bold /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="le-grid__cat">NET</th>
                <td className="le-grid__num"><Money value={totals.priorFy} bold /></td>
                {showRestated && <td className="le-grid__num"><Delta value={totals.restated} bold /></td>}
                {closedLabel && (
                  <td className="le-grid__num">
                    <span className="le-walk__pair">
                      <Money value={totals.closedEstimate} /> → <Money value={totals.closedActual} />
                    </span>{" "}
                    <Delta value={totals.closed} bold />
                  </td>
                )}
                <td className="le-grid__num le-grid__seam"><Delta value={totals.reestimated} bold /></td>
                <td className="le-grid__basis" />
                <td className="le-grid__num"><Money value={totals.newFy} bold /></td>
                <td className="le-grid__num"><Delta value={totals.change} bold /></td>
              </tr>
            </tfoot>
          </table>

          <p className="le-dev__note">
            {from.name} FY + {showRestated ? "restated + " : ""}{closedLabel ? `${closedLabel} actual vs estimate + ` : ""}re-estimated
            = {to.name} FY. Only categories that moved are listed, largest change first.
            A <strong>Typed → Budget</strong> or <strong>Typed → —</strong> basis means a figure you
            typed is no longer there. Check that you meant it.
          </p>
        </div>
      )}
    </section>
  );
}

export default LEWalk;
