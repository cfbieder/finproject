/**
 * investmentFormat.js — CR090 P1. Pure formatters for the Investments section.
 *
 * Split from the components so the file exports only non-components: a module
 * exporting both breaks React Fast Refresh, and the repo ratchets that warning
 * downward (`Scripts/check-lint-debt.sh`).
 *
 * The summary page and the per-account page share these so a figure cannot read
 * one way in the list and another on the detail.
 */

/* Money, with its currency. A figure without one can be read wrong (CR087 §2). */
export const money = (n, currency = "USD") => {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v < 0 ? "-" : ""}${currency === "USD" ? "$" : ""}${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const pct = (x, digits = 1) =>
  x === null || x === undefined || !Number.isFinite(Number(x))
    ? "—"
    : `${(Number(x) * 100).toFixed(digits)}%`;

/* Quantity carries its unit, because the conventions are not comparable: an
   equity is shares, a bond is FACE VALUE, a money-market fund is shares at par.
   A bare number invites a comparison that means nothing. */
export const UNIT_LABEL = {
  per_share: "sh",
  per_1_face: "face",
  per_100_face: "face",
  par: "sh",
};

/**
 * Two bond conventions are live in this portfolio and only the basis tells them
 * apart — `value = quantity × price` holds for both. A fraction of par (0.9989)
 * is scaled to the market convention; a percent of par (98.745) ALREADY IS that
 * convention and must be left alone. Scaling both rendered a bond priced at
 * 98.745 as 9874.500.
 */
export function renderPrice(p) {
  if (p.price === null || p.price === undefined) return "—";
  const v = Number(p.price);
  if (p.price_basis === "par") return "par";
  if (p.price_basis === "per_1_face") return (v * 100).toFixed(3);
  if (p.price_basis === "per_100_face") return v.toFixed(3);
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
