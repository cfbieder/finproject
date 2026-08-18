import { memo } from "react";
import { formatCurrencyValue } from "../BudgetEntry/utils/budgetInputUtils.js";
import "./LEGrid.css";

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

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
 * CR083 §10.2 — the LE summary.
 *
 * SEVEN columns: category, one actual, ONE estimate, FY, budget, variance,
 * basis. The five month columns an earlier version carried were read-only and
 * bought width for nothing; the month detail belongs in the worksheet, where it
 * can be edited. Width remains the load-bearing constraint — no scroll container
 * and no sticky column, which is what lets the print stylesheet stay simple
 * instead of re-solving the clipping that lost CR082's money column on paper.
 *
 * Rows follow the CHART OF ACCOUNTS order and keep its hierarchy, so the LE
 * reads like every other report rather than inventing an alphabetical third
 * ordering. A parent's figures are its subtree plus anything posted directly to
 * it, and parents carry no BASIS — §10.5: marking a sum implies an edit that
 * does not exist.
 */
function LEGrid({ grid, onOpenCategory }) {
  const { le, estimateMonths, rows, totals, fxBasis, scopeNote } = grid;
  const lastActual = MONTHS[le.actualMonths - 1];
  const firstEstimate = estimateMonths.length
    ? MONTHS[Number(estimateMonths[0].slice(5, 7)) - 1]
    : null;

  return (
    <section className="le-grid-wrap" aria-label={`Latest Estimate ${le.name}`}>
      <div className="le-grid__printhead">
        <strong>{le.name}</strong>{le.label ? ` — ${le.label}` : ""} · FY{le.budgetYear} ·
        actual Jan–{lastActual} ({le.actualMonths} of 12, to {le.actualThrough})
        {firstEstimate ? ` · estimate ${firstEstimate}–DEC` : ""} · USD
      </div>

      <table className="le-grid">
        <thead>
          <tr className="le-grid__grouprow">
            <th />
            <th className="le-grid__group">ACTUAL</th>
            <th className="le-grid__group le-grid__seam">ESTIMATE</th>
            <th colSpan={4} />
          </tr>
          <tr>
            <th className="le-grid__cat">CATEGORY</th>
            <th className="le-grid__num">JAN–{lastActual}</th>
            <th className="le-grid__num le-grid__seam">
              {firstEstimate ? `${firstEstimate}–DEC` : "—"}
            </th>
            <th className="le-grid__num">FY TOTAL</th>
            <th className="le-grid__num">BUDGET FY</th>
            <th className="le-grid__num">VAR</th>
            <th className="le-grid__basis">BASIS</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr
              key={r.categoryId}
              className={`le-grid__row le-grid__row--d${Math.min(r.depth, 3)}${
                r.hasChildren ? " le-grid__row--rollup" : ""
              }`}
            >
              <th scope="row" className="le-grid__cat">
                <span style={{ paddingLeft: `${r.depth * 1.1}rem` }}>
                  {r.editable ? (
                    <button
                      type="button"
                      className="le-grid__catlink"
                      onClick={() => onOpenCategory(r.categoryId)}
                      title={`Open the ${r.categoryName} worksheet`}
                    >
                      {r.categoryName}
                    </button>
                  ) : (
                    r.categoryName
                  )}
                </span>
              </th>
              <td className="le-grid__num"><Money value={r.ytdActual} /></td>
              <td className="le-grid__num le-grid__seam"><Money value={r.estimateTotal} /></td>
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
            <td className="le-grid__num le-grid__seam"><Money value={totals.estimateTotal} bold /></td>
            <td className="le-grid__num"><Money value={totals.fyTotal} bold /></td>
            <td className="le-grid__num"><Money value={totals.budgetFy} bold /></td>
            <td className="le-grid__num"><Variance value={totals.variance} /></td>
            <td className="le-grid__basis" />
          </tr>
        </tfoot>
      </table>

      <p className="le-grid__basisnote">
        <strong>Left of the rule is fact; right of it is your estimate.</strong>{" "}
        Click a category to open its month-by-month worksheet and edit the
        estimate. {scopeNote} {fxBasis}
      </p>
    </section>
  );
}

export default memo(LEGrid);
