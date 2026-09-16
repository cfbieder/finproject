import PropTypes from "prop-types";
import { formatMoney, isBlank } from "./formatMoney.js";
import "./Money.css";

/**
 * `<Money>` — CR087 P1. A figure that cannot be read wrong.
 *
 * The behavioural contract lives in `formatMoney.js` (null → `—`, zero → a
 * number, pinned locale, currency always stated). This adds only what belongs to
 * the rendering: tabular numerals so a column lines up, and a sign class.
 *
 * ⚠️ A zero is NEUTRAL, never coloured. Painting `0.00` as a gain asserts
 * something untrue about a figure that did not move — the same rule the
 * reconcile preview follows for a zero delta.
 *
 * ⚠️ `signed` colours the value (a delta, a drift). A BALANCE is not signed in
 * that sense: a negative liability is normal, not bad, so colouring every
 * negative on a balance sheet would paint half the page red. Callers opt in.
 */
export default function Money({
  value,
  currency = "USD",
  decimals = 2,
  signed = false,
  bold = false,
  title,
}) {
  const blank = isBlank(value);
  const n = blank ? 0 : Number(value);
  const tone = !signed || blank || n === 0 ? "" : n < 0 ? " money--neg" : " money--pos";
  return (
    <span
      className={`money${blank ? " money--blank" : ""}${tone}${bold ? " money--bold" : ""}`}
      title={title}
    >
      {formatMoney(value, { currency, decimals })}
    </span>
  );
}

Money.propTypes = {
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  currency: PropTypes.string,
  decimals: PropTypes.number,
  signed: PropTypes.bool,
  bold: PropTypes.bool,
  title: PropTypes.string,
};
