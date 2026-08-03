/**
 * Shared Transaction Utility Functions
 * Pure utility functions used by both actual and budget transaction pages.
 */

import { formatDateOnly } from "../../utils/dateHelpers.js";

const pad2 = (value) => String(value).padStart(2, "0");

export const SELECTION_COLUMN_KEY = "selected";
export const DEFAULT_SORT = { key: "Date", direction: "desc" };

const arrayEqual = (left, right) => {
  const l = Array.isArray(left) ? left : left ? [left] : [];
  const r = Array.isArray(right) ? right : right ? [right] : [];
  if (l.length !== r.length) return false;
  for (let i = 0; i < l.length; i += 1) {
    if (l[i] !== r[i]) return false;
  }
  return true;
};

/**
 * Parses a date from a transaction entry, handling both Date and date fields.
 * @param {Object} entry - The transaction entry
 * @returns {Date|null} Parsed date object or null if invalid
 */
export const parseEntryDate = (entry) => {
  const rawDate = entry?.Date ?? entry?.date;
  if (!rawDate) {
    return null;
  }
  const parsed = rawDate instanceof Date ? rawDate : new Date(rawDate);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

/**
 * Half-open date bounds `[start, end)` for the period filter, as date-only
 * YYYY-MM-DD STRINGS — deliberately not instants.
 *
 * The client-side period filter used to parse each row with `parseEntryDate`
 * (`new Date("2025-12-01")` — UTC midnight per spec) and then bucket it by LOCAL
 * calendar parts, which shifts every row back a day west of UTC. A 1-Dec-2025
 * transaction bucketed as 2025-11-30 and fell OUT of a December filter, while a
 * 1-Jan-2026 one fell IN — with the KPI tile (server-side totals) still counting
 * the missing row, so the page showed a (55,000.00) total above an empty table.
 * Same hazard as Known Issue #3; v3.6.1 fixed the render side and left this one.
 *
 * ISO date-only strings compare lexicographically, so string bounds make the
 * comparison timezone-free by construction rather than by correcting a parse.
 *
 * @param {Object} filters - Filter state (year, toYear, fromMonth, toMonth)
 * @returns {{start: string|null, end: string|null}} null bounds ⇒ no date filter
 */
export const getDateRangeBounds = (filters) => {
  const fromYear = Number(filters?.year);
  if (!Number.isFinite(fromYear) || fromYear <= 0) {
    return { start: null, end: null };
  }
  const parsedToYear = Number(filters?.toYear);
  const toYear =
    Number.isFinite(parsedToYear) && parsedToYear > 0 ? parsedToYear : fromYear;
  const fromMonth = Number(filters?.fromMonth) || 1;
  const toMonth = Number(filters?.toMonth) || 12;

  return {
    start: `${fromYear}-${pad2(fromMonth)}-01`,
    // Exclusive upper bound: first day of the month after toMonth in toYear
    end:
      toMonth >= 12
        ? `${toYear + 1}-01-01`
        : `${toYear}-${pad2(toMonth + 1)}-01`,
  };
};

/**
 * True when an entry's date falls inside half-open bounds from getDateRangeBounds.
 * An entry with no usable date is excluded, as it was before.
 *
 * @param {Object} entry - The transaction entry
 * @param {{start: string|null, end: string|null}} bounds
 * @returns {boolean}
 */
export const isEntryInDateRange = (entry, bounds) => {
  if (!bounds?.start || !bounds?.end) return true;
  const date = formatDateOnly(entry?.Date ?? entry?.date);
  if (!date) return false;
  return date >= bounds.start && date < bounds.end;
};

/**
 * Maps a PeriodSelector-shaped period into the period FIELDS of an
 * ACTUAL_CONFIG-shaped filter object.
 *
 * Extracted verbatim from TransActual's inline `handlePeriodChange` so the
 * desktop page and the mobile one (CR068) cannot drift on what a period means.
 * The two build the same query — `ACTUAL_CONFIG.buildFilterQuery` reads these
 * fields — so a difference here is a difference in which rows each page shows
 * for the same month, which is exactly the class of defect the
 * `getDateRangeBounds` note above records.
 *
 * The single-month rule is deliberately narrow: `monthEnabled` only when the
 * endpoints share a month AND a year. Aug-2025 → Aug-2026 is a 13-month range,
 * not "August" — collapsing it would silently drop 12 months of rows.
 *
 * @param {Object} vals - { fromMonth, toMonth, actualYear, toYear }
 *   fromMonth/toMonth are 1-based, zero-padded strings ("01".."12").
 * @returns {Object} { yearEnabled, year, toYear, monthEnabled, month, fromMonth, toMonth }
 *   `month` is the 0-based month index the filter uses, or undefined for a range.
 */
export const periodToFilterFields = (vals) => {
  const year = String(vals?.actualYear);
  const toYear = String(vals?.toYear ?? vals?.actualYear);
  const sameYear = year === toYear;
  const isSingleMonth = sameYear && vals?.fromMonth === vals?.toMonth;

  return {
    yearEnabled: true,
    year,
    toYear,
    monthEnabled: isSingleMonth,
    month: isSingleMonth ? Number(vals.fromMonth) - 1 : undefined,
    fromMonth: vals?.fromMonth,
    toMonth: vals?.toMonth,
  };
};

/**
 * Totals for a set of actual-entry rows, split per currency AND in base.
 *
 * Shared by the desktop Actuals page and the mobile one (CR068) so "base"
 * cannot mean two things. The split matters:
 *
 *   - `byCurrency` sums the LOCAL amount, one figure per currency. Correct —
 *     each is a quantity of one currency.
 *   - `income`/`expense`/`net` sum BASE amounts. Adding the per-currency
 *     figures together instead produced "(453.64) PLN + (116.23) EUR =
 *     (569.87) base", which is not a quantity of anything.
 *
 * Sign decides the bucket, matching the tiles: base amount > 0 is income.
 *
 * @param {Array} entries - rows from the totals endpoint
 * @param {Object} config - transaction config supplying the accessors
 * @returns {{byCurrency: Array<{currency: string, amount: number}>,
 *            income: number, expense: number, net: number}}
 */
export const summarizeActualTotals = (entries, config) => {
  const byCurrency = new Map();
  let income = 0;
  let expense = 0;

  for (const entry of Array.isArray(entries) ? entries : []) {
    const amount = config.getTotalsAmount(entry);
    if (Number.isFinite(amount)) {
      const currency = config.getTotalsCurrency(entry);
      byCurrency.set(currency, (byCurrency.get(currency) || 0) + amount);
    }

    const base = config.getTotalsBaseAmount?.(entry);
    if (Number.isFinite(base)) {
      if (base > 0) income += base;
      else expense += base;
    }
  }

  return {
    byCurrency: Array.from(byCurrency.entries()).map(([currency, amount]) => ({
      currency,
      amount,
    })),
    income,
    expense,
    net: income + expense,
  };
};

/**
 * Extracts a sortable value from a transaction entry for a given field key.
 * @param {Object} entry - The transaction entry
 * @param {string} key - The field key to extract
 * @param {Object} meta - Metadata object containing isSelected flag
 * @returns {number|string|null} The comparable sort value
 */
export const getSortValue = (entry, key, meta = {}) => {
  if (!entry) {
    return null;
  }

  if (key === SELECTION_COLUMN_KEY) {
    return meta.isSelected ? 1 : 0;
  }

  if (key === "Date") {
    const date = parseEntryDate(entry);
    return date ? date.getTime() : null;
  }

  const value = entry[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value === undefined || value === null) {
    return null;
  }
  return String(value).toLowerCase();
};

/**
 * Creates an object mapping each edit field key to an initial value.
 * @param {Array} editFields - Array of field objects with 'key' property
 * @param {*} initialValue - The value to assign to each field
 * @returns {Object} Map of field keys to initial values
 */
export const createEditFieldMap = (editFields, initialValue) =>
  editFields.reduce((map, field) => {
    map[field.key] = initialValue;
    return map;
  }, {});

/**
 * Formats a date value to ISO format (YYYY-MM-DD) for date input fields.
 * @param {Date|string} value - The date value to format
 * @returns {string} ISO date string or empty string if invalid
 */
export const formatIsoInputDate = (value) => {
  // formatDateOnly returns a date-only string verbatim and a Date via LOCAL parts;
  // the previous `new Date(value).toISOString().slice(0,10)` shifted a locally-built
  // Date back a day west of UTC (Known Issue #3).
  return formatDateOnly(value);
};

/**
 * Extracts a comparable field value from an entry for consensus checking.
 * Dates are converted to ISO strings for comparison.
 * @param {Object} entry - The transaction entry
 * @param {string} fieldKey - The field key to extract
 * @returns {*} The comparable value or null if not found
 */
export const getComparableFieldValue = (entry, fieldKey) => {
  if (!entry) {
    return null;
  }
  if (fieldKey === "Date") {
    const date = parseEntryDate(entry);
    return date ? date.toISOString() : null;
  }
  const value = entry[fieldKey];
  if (value === undefined || value === null) {
    return null;
  }
  return value;
};

/**
 * Determines if all entries have the same value for a given field (consensus).
 * Returns the consensus value if all match, otherwise null.
 * @param {Array<Object>} entries - Array of transaction entries
 * @param {string} fieldKey - The field key to check
 * @returns {*} The consensus value or null if values differ
 */
export const getConsensusValue = (entries, fieldKey) => {
  if (!entries.length) {
    return null;
  }
  const reference = getComparableFieldValue(entries[0], fieldKey);
  for (let index = 1; index < entries.length; index += 1) {
    if (getComparableFieldValue(entries[index], fieldKey) !== reference) {
      return null;
    }
  }
  return reference;
};

/**
 * Formats a value for display in an edit form input field.
 * @param {*} value - The value to format
 * @param {string} fieldType - The field type (date, number, text)
 * @returns {string} Formatted value for the input
 */
export const formatEditInputValue = (value, fieldType) => {
  if (value === null || value === undefined) {
    return "";
  }
  if (fieldType === "date") {
    return formatIsoInputDate(value);
  }
  if (fieldType === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  return String(value);
};

/**
 * Parses and validates a value from an edit form input.
 * @param {*} rawValue - The raw input value
 * @param {string} fieldType - The field type (date, number, text)
 * @returns {{valid: boolean, parsed: *}} Object with validation status and parsed value
 */
export const parseEditFormValue = (rawValue, fieldType) => {
  const normalized = rawValue?.toString().trim() ?? "";
  if (!normalized) {
    return { valid: true, parsed: null };
  }
  if (fieldType === "number") {
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return { valid: false, parsed: null };
    }
    return { valid: true, parsed };
  }
  if (fieldType === "date") {
    // Must stay a YYYY-MM-DD STRING, not a Date. A Date object survives as far as
    // JSON.stringify, which serializes it to a full ISO instant
    // ("2021-08-19T00:00:00.000Z") — and the API's assertDateString requires
    // /^\d{4}-\d{2}-\d{2}$/, so it 400s with "transaction_date must be a
    // YYYY-MM-DD date string". Because a single-row edit always includes Date via
    // consensus, that rejected EVERY single-row edit, whatever field was actually
    // being changed. Every other field type here returns a primitive; date was the
    // outlier.
    const parsed = formatDateOnly(normalized);
    if (!parsed) {
      return { valid: false, parsed: null };
    }
    return { valid: true, parsed };
  }
  return { valid: true, parsed: normalized };
};

/**
 * Deep equality comparison for filter objects.
 * @param {Object} a - First filter object
 * @param {Object} b - Second filter object
 * @returns {boolean} True if filters are equal
 */
export const filtersAreEqual = (a, b) => {
  if (!a || !b) {
    return false;
  }
  return (
    a.yearEnabled === b.yearEnabled &&
    a.monthEnabled === b.monthEnabled &&
    a.accountEnabled === b.accountEnabled &&
    a.categoryEnabled === b.categoryEnabled &&
    a.currencyEnabled === b.currencyEnabled &&
    a.year === b.year &&
    a.month === b.month &&
    a.fromMonth === b.fromMonth &&
    a.toMonth === b.toMonth &&
    arrayEqual(a.account, b.account) &&
    arrayEqual(a.category, b.category) &&
    arrayEqual(a.currency, b.currency) &&
    a.valueFromEnabled === b.valueFromEnabled &&
    a.valueToEnabled === b.valueToEnabled &&
    a.descriptionEnabled === b.descriptionEnabled &&
    a.description === b.description &&
    a.valueFrom === b.valueFrom &&
    a.valueTo === b.valueTo
  );
};

/**
 * Normalizes a list of string options, removing duplicates and invalid values.
 * Optionally includes a fallback value if it doesn't already exist in the list.
 * @param {Array} baseOptions - The original array of options
 * @param {string} fallbackValue - Optional fallback value to include
 * @returns {Array<string>} Normalized array of unique, valid string options
 */
export const normalizeStringOptions = (baseOptions, fallbackValue = "") => {
  const safeOptions = Array.isArray(baseOptions) ? baseOptions : [];
  const seen = new Set();
  const normalized = [];

  for (const option of safeOptions) {
    if (typeof option !== "string") {
      continue;
    }
    if (!seen.has(option)) {
      seen.add(option);
      normalized.push(option);
    }
  }

  if (fallbackValue && typeof fallbackValue === "string" && !seen.has(fallbackValue)) {
    normalized.push(fallbackValue);
  }

  return normalized;
};
