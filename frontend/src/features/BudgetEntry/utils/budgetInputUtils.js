/**
 * BudgetInput Utility Functions
 * Pure utility functions and constants for budget entry management
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Month selection options with zero-padded values
 */
export const MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

export const CURRENT_YEAR = new Date().getFullYear();
export const YEAR_OPTION_COUNT = 6;

/**
 * Builds an array of year options
 * @param {number} startYear - Starting year
 * @param {number} step - Increment/decrement step
 * @returns {number[]} Array of year values
 */
export const buildYearOptions = (startYear, step) =>
  Array.from(
    { length: YEAR_OPTION_COUNT },
    (_, index) => startYear + step * index
  );

export const YEAR_OPTIONS = buildYearOptions(CURRENT_YEAR, -1);
export const BUDGET_YEAR_OPTIONS = buildYearOptions(CURRENT_YEAR - 1, 1);

export const BASE_CURRENCY = "USD";

export const DEFAULT_ACCOUNT_OPTIONS = [
  "All",
  "Checking",
  "Savings",
  "Credit Card",
  "Investments",
  "Payables",
];

export const DEFAULT_CATEGORY_OPTIONS = [
  "Revenue",
  "Cost of Goods Sold",
  "Operating Expenses",
  "Investments",
  "Other Income",
];

// Category group identifiers
export const CATEGORY_GROUP_INCOME = "__group__income";
export const CATEGORY_GROUP_EXPENSE = "__group__expense";
export const CATEGORY_GROUP_EXPENSE_OPERATIONAL = "__group__expense_operational";

export const CATEGORY_GROUP_LABELS = {
  [CATEGORY_GROUP_INCOME]: "Income (all)",
  [CATEGORY_GROUP_EXPENSE]: "Expense (all)",
  [CATEGORY_GROUP_EXPENSE_OPERATIONAL]: "Expense (operational)",
};

export const OPERATIONAL_EXPENSE_EXCLUDED_VALUES = new Set([
  "unrealized g/l",
  "unrealized gains/losses",
  "fx",
]);

// ============================================================================
// UTILITY FUNCTIONS - Array Operations
// ============================================================================

/**
 * Returns the accounts selected by the user excluding the "All" option.
 * @param {string[]|undefined} values - Selected account values.
 * @returns {string[]} Filtered list of account names.
 */
export const getSelectedAccountFilters = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((value) => value && value !== "All");
};

/**
 * Ensures "All" option is first in the array and removes duplicates
 * @param {string[]} values - Array of option values
 * @returns {string[]} Normalized array with "All" first
 */
export const ensureAllOption = (values) => {
  if (!Array.isArray(values)) {
    values = [];
  }

  const normalized = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  const unique = Array.from(new Set(normalized));
  const rest = unique.filter((value) => value !== "All");

  return ["All", ...rest];
};

/**
 * Normalizes currency options to uppercase and removes duplicates
 * @param {string[]} values - Array of currency codes
 * @returns {string[]} Sorted array of normalized currency codes
 */
export const normalizeCurrencyOptions = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = values
    .map((value) =>
      typeof value === "string" ? value.trim().toUpperCase() : ""
    )
    .filter((value) => value.length);

  return Array.from(new Set(normalized)).sort();
};

export const buildBudgetMonthValue = (yearValue, monthValue) => {
  const normalizedYear =
    typeof yearValue === "number" && Number.isFinite(yearValue)
      ? Math.floor(yearValue)
      : Number.isFinite(Number(yearValue ?? NaN))
      ? Math.floor(Number(yearValue))
      : null;
  const normalizedMonth =
    typeof monthValue === "number" && Number.isFinite(monthValue)
      ? Math.floor(monthValue)
      : Number.isFinite(Number(monthValue ?? NaN))
      ? Math.floor(Number(monthValue))
      : null;
  if (
    normalizedYear === null ||
    normalizedMonth === null ||
    normalizedMonth < 1 ||
    normalizedMonth > 12
  ) {
    return "";
  }
  const paddedYear = String(normalizedYear).padStart(4, "0");
  const paddedMonth = String(normalizedMonth).padStart(2, "0");
  return `${paddedYear}-${paddedMonth}`;
};

// ============================================================================
// UTILITY FUNCTIONS - Category Operations
// ============================================================================

/**
 * Checks if a category should be excluded from operational expenses
 * @param {string} value - Category name to check
 * @returns {boolean} True if category should be excluded
 */
export const isOperationalExpenseExcluded = (value) => {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (OPERATIONAL_EXPENSE_EXCLUDED_VALUES.has(normalized)) {
    return true;
  }
  return normalized.startsWith("transfer");
};

/**
 * Filters expense categories to only include operational expenses
 * @param {string[]} values - Array of expense category names
 * @returns {string[]} Filtered array of operational expense categories
 */
export const getOperationalExpenseCategories = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(
    (category) =>
      typeof category === "string" &&
      category.trim().length &&
      !isOperationalExpenseExcluded(category)
  );
};

/**
 * Checks if a value is a category group identifier
 * @param {string} value - Value to check
 * @returns {boolean} True if value is a category group
 */
export const isCategoryGroupValue = (value) =>
  value === CATEGORY_GROUP_INCOME ||
  value === CATEGORY_GROUP_EXPENSE ||
  value === CATEGORY_GROUP_EXPENSE_OPERATIONAL;

/**
 * Gets the display label for a category value
 * @param {string} value - Category value or group identifier
 * @returns {string} Display label
 */
export const getCategoryDisplayLabel = (value) =>
  CATEGORY_GROUP_LABELS[value] ?? value;

/**
 * Expands category group selections into individual categories
 * @param {string[]} values - Selected category values (may include group identifiers)
 * @param {string[]} expenseCategories - All expense categories
 * @param {string[]} operationalExpenseCategories - Filtered operational expense categories
 * @param {Object} categoryGroups - Category groups object with Income and Expense arrays
 * @returns {string[]} Expanded array of individual category names
 */
export const expandSelectedCategories = (
  values,
  expenseCategories = [],
  operationalExpenseCategories = [],
  categoryGroups = {}
) => {
  if (!Array.isArray(values)) {
    return [];
  }

  const expanded = new Set();

  for (const value of values) {
    if (!value) {
      continue;
    }

    if (value === CATEGORY_GROUP_INCOME) {
      (categoryGroups?.Income ?? []).forEach((category) => {
        if (category) {
          expanded.add(category);
        }
      });
      continue;
    }

    if (value === CATEGORY_GROUP_EXPENSE) {
      (expenseCategories ?? []).forEach((category) => {
        if (category) {
          expanded.add(category);
        }
      });
      continue;
    }

    if (value === CATEGORY_GROUP_EXPENSE_OPERATIONAL) {
      (operationalExpenseCategories ?? []).forEach((category) => {
        if (category) {
          expanded.add(category);
        }
      });
      continue;
    }

    expanded.add(value);
  }

  return Array.from(expanded);
};

// ============================================================================
// UTILITY FUNCTIONS - Currency Operations
// ============================================================================

/**
 * Normalizes a currency code to uppercase
 * @param {string} value - Currency code to normalize
 * @returns {string} Normalized currency code
 */
export const normalizeCurrencyCode = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

/**
 * Builds a currency exchange rate map from app data
 * @param {Object} doc - App data document containing exchange rates
 * @returns {Object} Map of currency codes to USD exchange rates
 */
export const buildBudgetRateMap = (doc) => {
  const map = { USD: 1 };
  if (!doc || typeof doc !== "object") {
    return map;
  }

  for (const [key, value] of Object.entries(doc)) {
    if (!key || typeof key !== "string") {
      continue;
    }
    const normalizedKey = key.trim().toUpperCase();
    if (!normalizedKey.endsWith("/USD")) {
      continue;
    }
    const [currencyCode] = normalizedKey.split("/USD");
    if (!currencyCode) {
      continue;
    }
    const parsedRate = Number(value);
    if (!Number.isFinite(parsedRate)) {
      continue;
    }
    map[currencyCode] = parsedRate;
  }

  return map;
};

/**
 * Currency formatter for USD display
 */
export const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/**
 * Formats a currency value with proper sign handling
 * @param {number} value - Numeric value to format
 * @returns {string} Formatted currency string (negative values in parentheses)
 */
export const formatCurrencyValue = (value) => {
  const normalized = Number.isFinite(value) ? value : 0;
  const absolute = Math.abs(normalized);
  const formatted = currencyFormatter.format(absolute);
  return normalized < 0 ? `(${formatted})` : formatted;
};

// ============================================================================
// UTILITY FUNCTIONS - Date Operations
// ============================================================================

/**
 * Normalizes a month number to valid range (1-12)
 * @param {number|string} value - Month value to normalize
 * @param {number} fallback - Fallback value if invalid
 * @returns {number} Normalized month number
 */
export const normalizeMonthNumber = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.floor(parsed);
  if (normalized < 1) {
    return fallback;
  }
  if (normalized > 12) {
    return fallback;
  }

  return normalized;
};

/**
 * Builds a sequence of month numbers from a range
 * @param {number|string} fromValue - Starting month
 * @param {number|string} toValue - Ending month
 * @returns {number[]} Array of month numbers
 */
export const buildMonthSequence = (fromValue, toValue) => {
  const fromMonth = normalizeMonthNumber(fromValue, 1);
  const toMonth = normalizeMonthNumber(toValue, 12);
  const start = Math.min(fromMonth, toMonth);
  const end = Math.max(fromMonth, toMonth);
  const months = [];
  for (let next = start; next <= end; next += 1) {
    months.push(next);
  }
  return months;
};

/**
 * Gets the display label for a month number
 * @param {number} monthNumber - Month number (1-12)
 * @returns {string} Month label
 */
export const getMonthLabel = (monthNumber) => {
  const found = MONTH_OPTIONS.find(
    (option) => Number(option.value) === monthNumber
  );
  return found ? found.label : `Month ${monthNumber}`;
};

// ============================================================================
// UTILITY FUNCTIONS - Input Normalization
// ============================================================================

/**
 * Normalizes text input by trimming whitespace
 * @param {*} value - Input value to normalize
 * @returns {string|undefined} Trimmed string or undefined if empty
 */
export const normalizeTextInput = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

/**
 * Evaluates a numeric input that may contain basic math expressions
 * @param {*} value - Input value to evaluate
 * @returns {number|undefined} Evaluated number or undefined if invalid
 */
export const evaluateMathInput = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const stringValue = String(value).trim();
  if (!stringValue.length) {
    return undefined;
  }

  const isSafeExpression = /^[\d+\-*/().\s]+$/.test(stringValue);
  if (isSafeExpression) {
    try {
      const evaluated = Function(`"use strict"; return (${stringValue});`)();
      if (typeof evaluated === "number" && Number.isFinite(evaluated)) {
        return evaluated;
      }
    } catch {
      // Ignore invalid expressions and fall back to basic parsing
    }
  }

  const parsed = Number(stringValue);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Parses numeric input and validates it's finite
 * @param {*} value - Input value to parse
 * @returns {number|undefined} Parsed number or undefined if invalid
 */
export const parseNumericInput = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return evaluateMathInput(value);
};
