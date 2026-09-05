/**
 * Formatters and the column set for a net-worth bridge (CR092 P2).
 *
 * Split out of `bridgeParts.jsx` so that file exports components ONLY:
 * `react-refresh/only-export-components` is a baselined debt rule here
 * (`Scripts/check-lint-debt.sh`), and a component file that also exports
 * constants grows a count the ratchet only lets shrink.
 */

export const fullUSD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Always signed: these are movements, and an unsigned one reads as a balance. */
export const signedUSD = (n) => (n < 0 ? "−" : "+") + fullUSD.format(Math.abs(n));

export const signClass = (n) =>
  n < 0 ? "is-negative" : n > 0 ? "is-positive" : "is-zero";

export const prettyDate = (iso) => {
  if (typeof iso !== "string" || iso.length < 10) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

/** The driver columns both grids carry, in the order the eye reads them. */
export const COLUMNS = [
  { key: "revaluation", head: "Re-valued" },
  { key: "income", head: "Earned" },
  { key: "spending", head: "Spent" },
  { key: "currency", head: "Currency" },
  { key: "transfers", head: "Transfers" },
];
