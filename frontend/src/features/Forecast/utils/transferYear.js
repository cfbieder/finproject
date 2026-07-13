/**
 * transferYear.js — which module transfers produce an entry in a given forecast year.
 *
 * This MUST mirror the engine (server/src/services/forecast/fcbuilder-module.js), which
 * expands a **Periodic** row across every year from Date to DateEnd (or to the end of the
 * horizon when DateEnd is blank), while a OneTime row lands only on its own year.
 *
 * The Modify Transfer modal used to match on the stored year alone. That made every
 * periodic transfer invisible in every year but its first: the Review showed the entry,
 * you clicked it, and the modal said "no transfers for this year" — while the engine was
 * happily generating one. Keeping the rule here, tested, is what stops the two sides
 * drifting apart again.
 */

const yearOf = (d) => (d ? new Date(d).getFullYear() : null);

/**
 * True when `transfer` contributes an entry in `year`.
 */
export function transferAppliesToYear(transfer, year) {
  const start = yearOf(transfer?.Date);
  if (start === null || !Number.isFinite(year)) return false;

  if (transfer.Flag !== "Periodic") return start === year;

  // No DateEnd ⇒ the engine runs it to the end of the horizon.
  const end = yearOf(transfer.DateEnd) ?? Infinity;
  return year >= start && year <= end;
}

/**
 * "2028" for a one-off; "2026–2030" or "2026 onwards" for a periodic row — so a row
 * showing under 2028 doesn't misrepresent itself as a 2028 transfer.
 */
export function transferSpanLabel(transfer) {
  const start = yearOf(transfer?.Date);
  if (start === null) return "-";
  if (transfer.Flag !== "Periodic") return String(start);
  return transfer.DateEnd ? `${start}–${yearOf(transfer.DateEnd)}` : `${start} onwards`;
}
