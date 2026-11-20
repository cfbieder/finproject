/**
 * The percentage beside a delta chip, or null when a percentage would mislead.
 *
 * A bare amount reads the same against a large base as a small one — a $32K
 * move on $748K and on $80K look identical. But a percentage of a base that is
 * zero, or that crosses zero between `base` and `current`, is the misread class
 * CR076 exists to remove (a net cash flow going from −$2K to +$5K is not
 * "+350%"). So it is shown only when both ends sit on the same side of zero.
 *
 * @param {number} current - the value now (the KPI's headline figure)
 * @param {number} change  - current − base
 * @returns {string|null} magnitude only, e.g. "4.3%" — the chip's arrow carries
 *   the direction
 */
export function deltaPercent(current, change) {
  if (!Number.isFinite(current) || !Number.isFinite(change)) return null;
  const base = current - change;
  if (base === 0 || current === 0 || Math.sign(base) !== Math.sign(current)) return null;
  const pct = Math.abs(change / base) * 100;
  if (pct < 0.05) return null;
  // Decide the precision on the ROUNDED value, or 9.96 would print "10.0%".
  return pct.toFixed(1) < 10 ? `${pct.toFixed(1)}%` : `${pct.toFixed(0)}%`;
}
