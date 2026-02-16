/**
 * Shared Transaction Utility Functions
 * Pure utility functions used by both actual and budget transaction pages.
 */

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
  if (!value) {
    return "";
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
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
    const parsed = new Date(normalized);
    if (!Number.isFinite(parsed.getTime())) {
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
