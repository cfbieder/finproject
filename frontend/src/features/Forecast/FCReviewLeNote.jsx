import { formatAmount } from "./utils/fcReviewUtils.js";

/**
 * CR083 §8.1 — one line on Forecast Review: what the base year (the budget) says against what
 * the latest finalised Latest Estimate says. Every figure is the server's; nothing here is
 * re-derived, and nothing here feeds the plan. Renders nothing when there is no final LE.
 */

// Colour means sign: negative red, otherwise ink.
const Amount = ({ value, signed = false }) => {
  const num = Number(value);
  const text = signed
    ? `${num < 0 ? "−" : "+"}${formatAmount(Math.abs(num))}`
    : formatAmount(num);
  return (
    <b style={{ color: num < 0 ? "var(--danger)" : "var(--ink)" }}>{text}</b>
  );
};

export default function FCReviewLeNote({ leReference }) {
  if (!leReference?.le) return null;
  const { le, baseYear, budgetTotal, total, gap, leNet, outsideLines } = leReference;
  const hasOutside = Math.abs(Number(outsideLines) || 0) >= 0.5;
  return (
    <p className="fc-review__le-note" data-testid="fc-review-le-note">
      Base year {baseYear}: <Amount value={budgetTotal} /> (budget) · {le.name} says{" "}
      <Amount value={total} /> (<Amount value={gap} signed />).{" "}
      <span className="fc-review__le-note-aside">
        Reference only — the plan&apos;s base year stays the budget, and the {le.name} column is
        never summed into any figure.
        {hasOutside && (
          <>
            {" "}{le.name}&apos;s own net is <Amount value={leNet} />;{" "}
            <Amount value={outsideLines} /> of it sits on categories no FC line covers.
          </>
        )}
      </span>
    </p>
  );
}
