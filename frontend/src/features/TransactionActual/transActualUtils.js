/**
 * Transaction Actual Utility Functions
 * Pure utility functions for transaction actual management
 */

export const SELECTION_COLUMN_KEY = "selected";

/**
 * Gets a sortable value from a transaction entry for a given field key.
 *
 * @param {Object} entry - Transaction entry
 * @param {string} key - Field key to extract
 * @param {Object} meta - Metadata (e.g., { isSelected })
 * @returns {*} Sortable value
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
 * Parses the date from a transaction entry.
 *
 * @param {Object} entry - Transaction entry
 * @returns {Date|null} Parsed date or null
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
 * Creates an object with all edit field keys initialized to a value.
 *
 * @param {Array} editFields - Array of field objects with 'key' property
 * @param {*} initialValue - Value to initialize each field with
 * @returns {Object} Field map
 */
export const createEditFieldMap = (editFields, initialValue) =>
  editFields.reduce((map, field) => {
    map[field.key] = initialValue;
    return map;
  }, {});

/**
 * Formats a date value for ISO input (YYYY-MM-DD).
 *
 * @param {Date|string} value - Date value
 * @returns {string} Formatted date string
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
 * Gets a comparable field value from an entry for consensus checking.
 *
 * @param {Object} entry - Transaction entry
 * @param {string} fieldKey - Field key
 * @returns {*} Comparable value
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
 * Gets the consensus value for a field across multiple entries.
 * Returns null if entries have different values for the field.
 *
 * @param {Array} entries - Array of transaction entries
 * @param {string} fieldKey - Field key
 * @returns {*} Consensus value or null
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
 * Formats a value for display in an edit input field.
 *
 * @param {*} value - Value to format
 * @param {string} fieldType - Field type (date, number, text)
 * @returns {string} Formatted value
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
 * Parses a form value based on field type.
 *
 * @param {*} rawValue - Raw form value
 * @param {string} fieldType - Field type (date, number, text)
 * @returns {Object} { valid, parsed }
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
 * Checks if two filter objects are equal.
 *
 * @param {Object} a - First filter object
 * @param {Object} b - Second filter object
 * @returns {boolean} True if equal
 */
export const filtersAreEqual = (a, b) => {
  if (!a || !b) {
    return false;
  }
  const sameList = (left, right) => {
    const l = Array.isArray(left) ? left : left ? [left] : [];
    const r = Array.isArray(right) ? right : right ? [right] : [];
    if (l.length !== r.length) return false;
    for (let i = 0; i < l.length; i += 1) {
      if (l[i] !== r[i]) return false;
    }
    return true;
  };
  return (
    a.yearEnabled === b.yearEnabled &&
    a.monthEnabled === b.monthEnabled &&
    a.accountEnabled === b.accountEnabled &&
    a.categoryEnabled === b.categoryEnabled &&
    a.currencyEnabled === b.currencyEnabled &&
    a.year === b.year &&
    a.month === b.month &&
    sameList(a.account, b.account) &&
    sameList(a.category, b.category) &&
    sameList(a.currency, b.currency) &&
    a.valueFromEnabled === b.valueFromEnabled &&
    a.valueToEnabled === b.valueToEnabled &&
    a.descriptionEnabled === b.descriptionEnabled &&
    a.description === b.description &&
    a.valueFrom === b.valueFrom &&
    a.valueTo === b.valueTo
  );
};

/**
 * Default filter values.
 */
export const DEFAULT_FILTERS = {
  yearEnabled: true,
  monthEnabled: true,
  accountEnabled: false,
  categoryEnabled: false,
  descriptionEnabled: false,
  currencyEnabled: false,
  year: new Date().getFullYear().toString(),
  month: new Date().getMonth(),
  account: [],
  category: [],
  currency: [],
  description: "",
  valueFromEnabled: false,
  valueToEnabled: false,
  valueFrom: null,
  valueTo: null,
};
