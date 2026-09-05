/**
 * Turning a chosen period into the two dates the bridge actually takes
 * (CR092 P2).
 *
 * Its own module, not a helper beside the page component, because
 * `react-refresh/only-export-components` is a BASELINED debt rule here — a
 * second export alongside a component grows a count the ratchet only lets
 * shrink. It is also the piece worth testing on its own.
 */

/** Last day of `month` in `year`, in UTC. Month is 1-based; 0 means December of year−1. */
const monthEnd = (year, month) =>
  // Day 0 of the NEXT month is the last day of this one. UTC throughout, so a
  // timezone west of UTC cannot roll it back a day (Known Issue #3).
  new Date(Date.UTC(Number(year), Number(month), 0)).toISOString().slice(0, 10);

const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
};

/**
 * A chosen period → `{ fromDate, toDate }`.
 *
 * ⚠️ `fromDate` is the month end BEFORE the period starts, not its first day.
 * The bridge reads `fromDate` as the opening boundary and attributes every
 * transaction *after* it, so asking for "January onwards" with 2026-01-01 would
 * bury that day's transactions inside the opening balance and drop them from
 * the explanation entirely. Same `start − 1` convention `investmentReturns`
 * uses for its own opening market value.
 *
 * `toDate` is clamped to today: a month end in the future reads a balance the
 * calendar has not reached, which is the exact defect the Home hero shipped
 * with and that CR092 P0 had to fix.
 */
export function windowFor({ fromYear, fromMonth, toYear, toMonth, today = todayISO() }) {
  const openingBoundary = monthEnd(fromYear, Number(fromMonth) - 1);
  const periodEnd = monthEnd(toYear, Number(toMonth));
  return {
    fromDate: openingBoundary,
    toDate: periodEnd > today ? today : periodEnd,
  };
}
