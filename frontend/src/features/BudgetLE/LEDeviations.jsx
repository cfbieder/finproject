import { useState } from "react";
import { formatCurrencyValue } from "../BudgetEntry/utils/budgetInputUtils.js";
import "./LEGrid.css";

/**
 * CR083 — "what changed year-to-date that the rest of the year should know about".
 *
 * DETERMINISTIC, start to finish. CR077's rule is that an LLM stage runs "only
 * over the deterministic rules, never instead of them", and CR081 measured
 * model-proposed edits at 0/15 twice before being deferred. So every figure and
 * every flag here is arithmetic; a narration layer, if it is ever added, sits on
 * top of this and can fail without taking it with it.
 *
 * There is no Accept button, by the same evidence. The action is to open the
 * category's worksheet and decide — which is one click either way, and keeps the
 * typing where the owner can see the months they are changing.
 */
function LEDeviations({ data, onOpenCategory }) {
  const [open, setOpen] = useState(false);
  if (!data || !data.flags.length) return null;

  const { flags, totalEffect, actualMonths } = data;
  const actionable = flags.filter((f) => f.kind === "relevel");
  const refused = flags.filter((f) => f.kind === "refused").length;
  const noBudget = flags.filter((f) => f.kind === "no_budget").length;

  return (
    <section className="le-dev" aria-label="Year-to-date deviations">
      <button
        type="button"
        className="le-dev__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="le-dev__chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="le-dev__title">
          {flags.length} {flags.length === 1 ? "line" : "lines"} worth a look
        </span>
        <span className="le-dev__sub">
          {actionable.length > 0 && (
            <>
              re-levelling {actionable.length} would move the rest of the year by{" "}
              <strong className={totalEffect >= 0 ? "le-grid__money--fav" : "le-grid__money--adv"}>
                {totalEffect >= 0 ? "+" : "−"}{formatCurrencyValue(Math.abs(totalEffect))}
              </strong>
            </>
          )}
          {refused > 0 && <> · {refused} refused</>}
          {noBudget > 0 && <> · {noBudget} with no budget</>}
        </span>
      </button>

      {open && (
        <div className="le-dev__body">
          <p className="le-dev__intro">
            Measured over the {actualMonths} closed months. A line is listed when
            its year-to-date behaviour implies the <strong>months still to
            come</strong> are wrong — not merely because actual differs from
            budget, since a back-loaded budget can be far off year-to-date and
            still land exactly where it says.
          </p>

          <ul className="le-dev__list">
            {flags.map((f) => (
              <li key={f.categoryId} className={`le-dev__item le-dev__item--${f.kind}`}>
                <div className="le-dev__itemhead">
                  <button
                    type="button"
                    className="le-grid__catlink"
                    onClick={() => onOpenCategory(f.categoryId)}
                  >
                    {f.categoryName}
                  </button>
                  {f.kind === "relevel" && (
                    <span className={`le-dev__effect ${f.effect >= 0 ? "le-grid__money--fav" : "le-grid__money--adv"}`}>
                      {f.effect >= 0 ? "+" : "−"}{formatCurrencyValue(Math.abs(f.effect))}
                    </span>
                  )}
                  {f.kind === "refused" && <span className="le-dev__tag">no proposal</span>}
                  {f.kind === "no_budget" && <span className="le-dev__tag">no budget line</span>}
                  {f.estimateIsTyped && <span className="le-dev__tag">you typed this</span>}
                </div>
                {/* The operands, not a verdict. `38,138.55 ÷ 25,999.86 = 1.467`
                    is checkable in two seconds; "trending high" is not. */}
                <p className="le-dev__reason">{f.reason}</p>
              </li>
            ))}
          </ul>

          <p className="le-dev__note">
            {data.thresholds.note} Nothing here changes the estimate — open a
            category to decide.
          </p>
        </div>
      )}
    </section>
  );
}

export default LEDeviations;
