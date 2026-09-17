import { COMPARE_MODES } from "./latestEstimate.js";
import "./BudgetVaTable.css";

/**
 * The compare-mode segmented control, shared by the /budget-vs-actual tabs.
 * Renders nothing for a year with no Latest Estimate. `modes` narrows the set —
 * the Variances tab ranks by ONE variance, so it has no use for `All`.
 */
export function LeCompareControl({ compareProps, modes = COMPARE_MODES }) {
  if (!compareProps || !compareProps.leAvailable) return null;
  return (
    <div className="budget-va__compare" role="group" aria-label="Which pair to compare">
      {modes.map((m) => (
        <button
          key={m.key}
          type="button"
          className={`budget-va__compare-btn${
            compareProps.mode === m.key ? " budget-va__compare-btn--on" : ""
          }`}
          aria-pressed={compareProps.mode === m.key}
          onClick={() => compareProps.onChange(m.key)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/**
 * ⚠️ TWO different ways an LE comparison can read wrong, and they are not the
 * same hazard, so they are not the same sentence.
 *
 * (1) LE vs Bud over a period at or before the cut: the LE holds those actuals,
 *     so the figures are byte-identical to Act vs Bud. Not wrong, just not the
 *     second opinion it looks like.
 *
 * (2) Act vs LE over a period that has not finished: THIS one produces a figure
 *     that is wrong to act on. Measured on prod 2026-08-27, over the full year
 *     it reads +150,091 favourable on expenses, of which essentially all is that
 *     Sep–Dec have not happened — twelve months of estimate against eight months
 *     of actual. It is the shape CR087 P0b closed on the actuals side (a page of
 *     favourable variances that looked like good news), arrived at by honest
 *     arithmetic instead of a bug, which makes it harder to catch.
 */
export function LeCompareNotes({ compareProps }) {
  if (!compareProps) return null;
  const { varLeBud, varActLe, leCut, leName, periodReachesPastCut } = compareProps;
  const unelapsed = compareProps.unelapsedMonths || { count: 0, total: 0 };

  return (
    <>
      {varLeBud && leCut && !periodReachesPastCut && (
        <p className="budget-va__cutnote" role="note">
          <strong>The selected period ends on or before {leName}&rsquo;s
          cut ({leCut}),</strong> where the Latest Estimate holds the
          actual transactions themselves. <strong>LE will equal Actual on every
          row,</strong> so <strong>LE vs Bud</strong> shows the same figures as{" "}
          <strong>Act vs Bud</strong>. Choose a period reaching past the cut to see
          where the estimate departs from the budget.
        </p>
      )}

      {varActLe && unelapsed.count > 0 && (
        <p className="budget-va__cutnote budget-va__cutnote--warn" role="note">
          <strong>
            {unelapsed.count} of the {unelapsed.total}{" "}
            {unelapsed.total === 1 ? "month" : "months"} in this period{" "}
            {unelapsed.count === 1 ? "has" : "have"} not finished.
          </strong>{" "}
          The Latest Estimate covers {unelapsed.total === 1 ? "it" : "all of them"} in
          full; Actual only covers what has been booked so far, so{" "}
          <strong>Act vs LE is measuring elapsed time, not performance</strong> — it
          will read favourable simply because the period is not over. Compare a
          window that has fully elapsed and sits past the cut.
        </p>
      )}

      {varActLe && unelapsed.count === 0 && !periodReachesPastCut && (
        <p className="budget-va__cutnote" role="note">
          <strong>This period ends on or before the cut, where the Latest Estimate
          IS the actual.</strong> <strong>Act vs LE will be zero on every row</strong>{" "}
          &mdash; not a finding, an identity. It only carries information for a
          window past {leName}&rsquo;s cut ({leCut}).
        </p>
      )}
    </>
  );
}
