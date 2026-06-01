/**
 * Shared period helpers for period-end balance reports (Balance Trends,
 * Balance Sheet Periods). These build a series of period-END dates for a
 * Month / Quarter / Year frequency and resolve which columns to actually
 * render given today's date (future periods are dropped; an in-progress
 * period is snapshotted as-of today and flagged partial).
 */

export const pad2 = (v) => String(v).padStart(2, "0");

export const getMonthEndIso = (year, monthIdx) => {
  const d = new Date(Date.UTC(year, monthIdx + 1, 0));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

export const getTodayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

// Frequency options shared across period-based reports.
export const FREQUENCIES = [
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

// Backwards-compatible alias for the interval pill list used by Balance Trends.
export const INTERVALS = FREQUENCIES;

export const PARTIAL_SUFFIX = { month: "MTD", quarter: "QTD", year: "YTD" };

// Quarter-end months are Mar (2), Jun (5), Sep (8), Dec (11).
export const isQuarterEnd = (monthIdx) =>
  monthIdx === 2 || monthIdx === 5 || monthIdx === 8 || monthIdx === 11;

// First day of the period that ends on `endIso`, for the given interval.
export const getPeriodStartIso = (endIso, interval) => {
  const d = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return endIso;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (interval === "year") return `${y}-01-01`;
  if (interval === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    return `${y}-${pad2(qStartMonth + 1)}-01`;
  }
  return `${y}-${pad2(m + 1)}-01`;
};

export const buildEndDateSeries = (fromYear, fromMonthStr, toYear, toMonthStr, interval) => {
  const fromIdx = Math.max(0, Math.min(11, Number(fromMonthStr) - 1));
  const toIdx = Math.max(0, Math.min(11, Number(toMonthStr) - 1));
  const fromAbs = Number(fromYear) * 12 + fromIdx;
  const toAbs = Number(toYear) * 12 + toIdx;
  if (!Number.isFinite(fromAbs) || !Number.isFinite(toAbs) || toAbs < fromAbs) return [];
  const series = [];
  for (let abs = fromAbs; abs <= toAbs; abs += 1) {
    const y = Math.floor(abs / 12);
    const m = abs % 12;
    if (interval === "quarter" && !isQuarterEnd(m)) continue;
    if (interval === "year" && m !== 11) continue;
    series.push(getMonthEndIso(y, m));
  }
  return series;
};

/**
 * Drop columns whose period is entirely in the future; for a column whose
 * period has started but whose end-date is still in the future, fetch the
 * snapshot as of today instead of the period end.
 *
 * Returns [{ label, asOf, isPartial }] where `label` is the original period
 * end-date (used for the column header) and `asOf` is the date passed to
 * the balance endpoint.
 */
export const planColumns = (endDates, interval, todayIso) => {
  const planned = [];
  for (const endIso of endDates) {
    if (endIso <= todayIso) {
      planned.push({ label: endIso, asOf: endIso, isPartial: false });
      continue;
    }
    const startIso = getPeriodStartIso(endIso, interval);
    if (startIso <= todayIso) {
      planned.push({ label: endIso, asOf: todayIso, isPartial: true });
    }
    break;
  }
  return planned;
};

export const formatColumnHeader = (iso, interval, isPartial) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const year = d.getUTCFullYear();
  const monthIdx = d.getUTCMonth();
  let base;
  if (interval === "year") {
    base = String(year);
  } else if (interval === "quarter") {
    const q = Math.floor(monthIdx / 3) + 1;
    base = `Q${q} ${String(year).slice(-2)}`;
  } else {
    base = d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return isPartial ? `${base} (${PARTIAL_SUFFIX[interval] ?? "PTD"})` : base;
};
