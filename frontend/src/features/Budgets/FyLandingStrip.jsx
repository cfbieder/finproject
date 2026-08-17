import { memo } from "react";
import { formatCurrencyValue, getMonthLabel } from "../BudgetEntry/utils/budgetInputUtils.js";
import "./FyLandingStrip.css";

/**
 * CR083 P0a — where the year lands if the rest of it comes in at budget.
 *
 * Deliberately a strip and NOT a fifth KpiCard. The four cards above respond to
 * the period selector and the transfer/unrealized toggles; this figure is
 * full-year and scope-fixed. Rendering it as their peer would say it moves with
 * the period, which it does not.
 *
 * It also does not tie to the table below, by design and by a small amount, so
 * it says so rather than letting a reader discover two derivations of one idea
 * (CR083 §11.2 / §2.1a).
 */
function FyLandingStrip({ landing }) {
  if (!landing) return null;

  const {
    year,
    actualMonths,
    actualThrough,
    landing: landingValue,
    budgetFy,
    variance,
  } = landing;

  // With no closed months the landing IS the budget; saying so twice is noise.
  if (!actualMonths) return null;

  const varianceIsGood = variance >= 0;
  const lastActualMonth = getMonthLabel(actualMonths);
  const firstEstimateMonth = actualMonths < 12 ? getMonthLabel(actualMonths + 1) : null;

  return (
    <section
      className="fy-landing"
      aria-label={`Full year ${year} landing at carry`}
    >
      <div className="fy-landing__figures">
        <div className="fy-landing__figure">
          <span className="fy-landing__label">FY{year} landing at carry</span>
          <span
            className={`fy-landing__value${
              landingValue < 0 ? " fy-landing__value--negative" : ""
            }`}
          >
            {formatCurrencyValue(landingValue)}
          </span>
        </div>
        <div className="fy-landing__figure">
          <span className="fy-landing__label">Budget FY{year}</span>
          <span
            className={`fy-landing__value${
              budgetFy < 0 ? " fy-landing__value--negative" : ""
            }`}
          >
            {formatCurrencyValue(budgetFy)}
          </span>
        </div>
        <div className="fy-landing__figure">
          <span className="fy-landing__label">Variance</span>
          <span
            className={`fy-landing__value fy-landing__value--${
              varianceIsGood ? "favourable" : "adverse"
            }`}
          >
            {varianceIsGood ? "+" : "−"}
            {formatCurrencyValue(Math.abs(variance))}
          </span>
        </div>
      </div>
      <p className="fy-landing__basis">
        Actual Jan&ndash;{lastActualMonth} ({actualMonths} of 12 months, to{" "}
        {actualThrough})
        {firstEstimateMonth
          ? ` + budget ${firstEstimateMonth}–Dec`
          : ""}
        . Excludes transfers and Unrealized G/L, so this{" "}
        <strong>does not tie to the table below</strong> &mdash; that uses this
        page&rsquo;s own transfer convention and counts leaf categories only.
      </p>
    </section>
  );
}

export default memo(FyLandingStrip);
