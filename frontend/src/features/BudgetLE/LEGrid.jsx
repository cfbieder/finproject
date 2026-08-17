import { memo } from "react";
import { formatCurrencyValue } from "../BudgetEntry/utils/budgetInputUtils.js";
import "./LEGrid.css";

const MONTH_LABEL = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const monthLabel = (ym) => MONTH_LABEL[Number(ym.slice(5, 7)) - 1] || ym;

function Money({ value, bold = false }) {
  if (value === null || value === undefined) return <span className="le-grid__empty">—</span>;
  const n = Number(value);
  return (
    <span className={`le-grid__money${n < 0 ? " le-grid__money--neg" : ""}${bold ? " le-grid__money--bold" : ""}`}>
      {formatCurrencyValue(n)}
    </span>
  );
}

function Variance({ value }) {
  const n = Number(value) || 0;
  if (n === 0) return <span className="le-grid__empty">—</span>;
  return (
    <span className={`le-grid__money le-grid__money--${n > 0 ? "fav" : "adv"}`}>
      {n > 0 ? "+" : "−"}{formatCurrencyValue(Math.abs(n))}
    </span>
  );
}

/**
 * CR083 §10.2 — eleven physical columns: 1 label + YTD ACTUAL + 5 estimate
 * months + FY / BUDGET / VAR / BASIS.
 *
 * The width is the point, not an accident. A 12-month grid needs a scroll
 * container and a sticky first column, and that combination is exactly what
 * clipped the money column off CR082's printed FBAR working papers. Eleven
 * columns fit without scrolling, so the defect cannot occur rather than being
 * mitigated. Do not add a twelfth without re-solving print.
 *
 * The actual/estimate boundary is carried by FOUR independent signals, because
 * it must survive dark mode, a mono printer and a reader who has not been told
 * the convention: the group header in words, a 2px rule at the seam, a ground
 * tone (not a tint), and — once editing ships — editability itself.
 */
function LEGrid({ grid }) {
  const { le, estimateMonths, rows, totals, fxBasis, scopeNote } = grid;
  const lastActual = MONTH_LABEL[le.actualMonths - 1];

  return (
    <section className="le-grid-wrap" aria-label={`Latest Estimate ${le.name}`}>
      <div className="le-grid__printhead">
        <strong>{le.name}</strong>{le.label ? ` — ${le.label}` : ""} · FY{le.budgetYear} ·
        actual Jan–{lastActual} ({le.actualMonths} of 12, to {le.actualThrough}) ·
        estimate {monthLabel(estimateMonths[0] || "")}–DEC · USD
      </div>

      <table className="le-grid">
        <thead>
          <tr className="le-grid__grouprow">
            <th />
            <th className="le-grid__group">ACTUAL</th>
            <th className="le-grid__group le-grid__seam" colSpan={estimateMonths.length}>
              ESTIMATE — carried from budget
            </th>
            <th colSpan={4} />
          </tr>
          <tr>
            <th className="le-grid__cat">CATEGORY</th>
            <th className="le-grid__num">JAN–{lastActual}</th>
            {estimateMonths.map((m, i) => (
              <th key={m} className={`le-grid__num${i === 0 ? " le-grid__seam" : ""}`}>
                {monthLabel(m)}
              </th>
            ))}
            <th className="le-grid__num">FY TOTAL</th>
            <th className="le-grid__num">BUDGET FY</th>
            <th className="le-grid__num">VAR</th>
            <th className="le-grid__basis">BASIS</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.categoryId}>
              <th scope="row" className="le-grid__cat">{r.categoryName}</th>
              <td className="le-grid__num"><Money value={r.ytdActual} /></td>
              {estimateMonths.map((m, i) => (
                <td key={m} className={`le-grid__num${i === 0 ? " le-grid__seam" : ""}`}>
                  {/* A MISSING cell is silence, not zero — §7.1. Rendering it as
                      0.00 would make "never budgeted" look like "zeroed", which
                      is the distinction L4 exists to police. */}
                  {r.months[m] ? <Money value={r.months[m].baseAmount} />
                               : <span className="le-grid__empty">—</span>}
                </td>
              ))}
              <td className="le-grid__num"><Money value={r.fyTotal} bold /></td>
              <td className="le-grid__num"><Money value={r.budgetFy} /></td>
              <td className="le-grid__num"><Variance value={r.variance} /></td>
              <td className="le-grid__basis">{r.basis}</td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <th scope="row" className="le-grid__cat">NET</th>
            <td className="le-grid__num"><Money value={totals.ytdActual} bold /></td>
            {estimateMonths.map((m, i) => (
              <td key={m} className={`le-grid__num${i === 0 ? " le-grid__seam" : ""}`} />
            ))}
            <td className="le-grid__num"><Money value={totals.fyTotal} bold /></td>
            <td className="le-grid__num"><Money value={totals.budgetFy} bold /></td>
            <td className="le-grid__num"><Variance value={totals.variance} /></td>
            <td className="le-grid__basis" />
          </tr>
        </tfoot>
      </table>

      <p className="le-grid__basisnote">
        <strong>Left of the rule is fact; right of it is the budget carried forward.</strong>{" "}
        {scopeNote} {fxBasis}
      </p>
    </section>
  );
}

export default memo(LEGrid);
