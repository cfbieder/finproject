/**
 * Budget Routes Module
 *
 * This module provides RESTful API endpoints for managing budget and actual
 * financial data, including CRUD operations, summaries, cash flow reports,
 * and category groupings derived from the Chart of Accounts.
 *
 * =============================================================================
 * ROUTES SUMMARY
 * =============================================================================
 *
 * BUDGET ENTRIES (Database-backed via BudgetData model)
 * -----------------------------------------------------------------------------
 * GET    /                            - Retrieve budget entries with filters
 *                                       Query: ?fromDate, ?toDate, ?account,
 *                                              ?category, ?currency, ?limit
 * POST   /                            - Create new budget entry/entries
 *                                       Accepts single object, array, or wrapped formats
 * PATCH  /:id                         - Update a specific budget entry by ID
 * DELETE /:id                         - Delete a specific budget entry by ID
 *
 * ACTUAL ENTRIES (Database-backed via PSdata model)
 * -----------------------------------------------------------------------------
 * GET    /actual-entries              - Retrieve actual entries with filters
 *                                       Query: ?month OR ?fromMonth & ?toMonth,
 *                                              ?actualYear, ?categories, ?accounts,
 *                                              ?description, ?valueFrom, ?valueTo, ?limit
 * PATCH  /actual-entries/:id          - Update a specific actual entry by ID
 * DELETE /actual-entries/:id          - Delete a specific actual entry by ID
 *
 * ANALYSIS & REPORTING
 * -----------------------------------------------------------------------------
 * GET    /summary                     - Get budget vs actual summary by month
 *                                       Query: ?fromMonth, ?toMonth, ?actualYear,
 *                                              ?budgetYear, ?categories, ?accounts
 * GET    /cash-flow                   - Generate cash flow report for budget data
 *                                       Query: ?fromDate, ?toDate, ?transfers,
 *                                              ?includeUnrealizedGL
 * GET    /category-groups             - Get Income/Expense category groups from COA
 *
 * =============================================================================
 */

const express = require("express");
const mongoose = require("mongoose");
const fs = require("node:fs/promises");
const BudgetData = require("../../../components/models/BudgetData");
const PSdata = require("../../../components/models/PSdata");
const CashFlowFetcher = require("../services/reporting/cashFLowFetcher");
const { dataPaths } = require("../utils/dataPaths");

const router = express.Router();

// Initialize cash flow fetcher specifically for budget data
const budgetCashFlowFetcher = new CashFlowFetcher({
  psDataModel: BudgetData,
  allowJsonFallback: false,
});

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

// Supported text filter fields: [queryParamName, dbFieldName]
const TEXT_FILTERS = [
  ["account", "Account"],
  ["category", "Category"],
  ["currency", "Currency"],
  ["baseCurrency", "BaseCurrency"],
];

const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_SUMMARY_MONTH_FROM = 1;
const DEFAULT_SUMMARY_MONTH_TO = 12;

// Category types recognized in the Chart of Accounts
const CATEGORY_GROUP_TYPES = ["Income", "Expense"];

// =============================================================================
// CHART OF ACCOUNTS (COA) CATEGORY EXTRACTION
// =============================================================================

/**
 * Extracts the "Profit & Loss Accounts" section from COA data.
 *
 * @param {Array} coaData - Parsed Chart of Accounts data
 * @returns {Object|null} The Profit & Loss section object, or null if not found
 */
const getProfitAndLossSection = (coaData) => {
  if (!Array.isArray(coaData)) {
    return null;
  }

  for (const entry of coaData) {
    if (entry && typeof entry === "object" && entry["Profit & Loss Accounts"]) {
      return entry["Profit & Loss Accounts"];
    }
  }

  return null;
};

/**
 * Recursively traverses COA structure to collect category names grouped by type.
 *
 * Navigates through the nested Chart of Accounts structure, identifying
 * Income and Expense categories and collecting all category names under each type.
 *
 * @param {Array} coaData - Parsed Chart of Accounts data
 * @returns {Object} Object with Income and Expense arrays of category names
 *                   { Income: string[], Expense: string[] }
 */
const collectCoaCategoryGroups = (coaData) => {
  const groups = {
    Income: new Set(),
    Expense: new Set(),
  };

  const profitAndLoss = getProfitAndLossSection(coaData);
  if (!profitAndLoss) {
    return {
      Income: [],
      Expense: [],
    };
  }

  /**
   * Normalizes a category value by trimming whitespace.
   *
   * @param {*} value - Raw category value
   * @returns {string|null} Trimmed string or null if invalid
   */
  const normalizeCategoryValue = (value) => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  /**
   * Recursively traverses a COA node to collect categories.
   *
   * @param {*} node - Current node in the COA structure
   * @param {string|null} currentGroup - Current category group (Income/Expense)
   */
  const traverseNode = (node, currentGroup) => {
    // Handle arrays by traversing each element
    if (Array.isArray(node)) {
      for (const child of node) {
        traverseNode(child, currentGroup);
      }
      return;
    }

    // Handle objects by traversing each property
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        // Update current group if we encounter an Income or Expense key
        const nextGroup =
          CATEGORY_GROUP_TYPES.includes(key) && key !== currentGroup
            ? key
            : currentGroup;
        traverseNode(value, nextGroup);
      }
      return;
    }

    // Handle leaf string values - these are actual category names
    if (currentGroup && typeof node === "string") {
      const normalizedValue = normalizeCategoryValue(node);
      if (normalizedValue) {
        groups[currentGroup].add(normalizedValue);
      }
    }
  };

  traverseNode(profitAndLoss, null);

  return {
    Income: Array.from(groups.Income).sort(),
    Expense: Array.from(groups.Expense).sort(),
  };
};

// Cache for category groups to avoid re-reading the COA file
let cachedCategoryGroups = null;

/**
 * Loads and caches category groups from the Chart of Accounts file.
 *
 * On first call, reads and parses the COA file. Subsequent calls return
 * the cached result for performance.
 *
 * @returns {Promise<Object>} Object with Income and Expense category arrays
 * @throws Returns empty arrays on file read/parse errors
 */
const loadCategoryGroups = async () => {
  if (cachedCategoryGroups) {
    return cachedCategoryGroups;
  }

  try {
    const raw = await fs.readFile(dataPaths.coa, "utf8");
    const parsed = JSON.parse(raw);
    cachedCategoryGroups = collectCoaCategoryGroups(parsed);
  } catch (error) {
    console.error("[BUDGET] Failed to read COA for category groups:", error);
    cachedCategoryGroups = {
      Income: [],
      Expense: [],
    };
  }

  return cachedCategoryGroups;
};

// =============================================================================
// UTILITY FUNCTIONS - VALUE PARSING & NORMALIZATION
// =============================================================================

/**
 * Parses a value into a valid Date object.
 *
 * @param {*} value - Value to parse as a date
 * @returns {Date|null} Valid Date object or null if parsing fails
 */
const parseDateValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Parses a value into a finite number.
 *
 * @param {*} value - Value to parse as a number
 * @returns {number|null} Finite number or null if parsing fails
 */
const parseNumberValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Escapes special regex characters in a string for safe use in RegExp.
 *
 * @param {*} value - String to escape
 * @returns {string} Escaped string safe for regex, or empty string if invalid
 */
const escapeForRegex = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/**
 * Normalizes text by trimming whitespace.
 *
 * @param {*} value - Value to normalize
 * @returns {string|null} Trimmed string or null if invalid
 */
const normalizeText = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value).trim();
};

/**
 * Normalizes filter values into an array of trimmed strings.
 *
 * Handles both single values and arrays, filtering out empty strings.
 *
 * @param {*} value - Single value or array of values
 * @returns {string[]} Array of non-empty trimmed strings
 */
const normalizeFilterValues = (value) => {
  if (value === undefined || value === null) {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];
  return items
    .map((entry) => {
      if (entry === undefined || entry === null) {
        return "";
      }
      return String(entry).trim();
    })
    .filter((entry) => entry.length);
};

/**
 * Removes "all" entries from an array (case-insensitive).
 *
 * Used to filter out placeholder "all" values from filter arrays.
 *
 * @param {Array} values - Array of filter values
 * @returns {Array} Array with "all" values removed
 */
const removeAllEntry = (values) => {
  return values.filter(
    (value) => value && value.toString().toLowerCase() !== "all"
  );
};

/**
 * Parses a month value (1-12).
 *
 * @param {*} value - Value to parse as a month
 * @returns {number|null} Integer between 1-12, or null if invalid
 */
const parseMonthValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const normalized = Math.floor(parsed);
  if (normalized < 1 || normalized > 12) {
    return null;
  }

  return normalized;
};

/**
 * Parses a year value.
 *
 * @param {*} value - Value to parse as a year
 * @returns {number|null} Integer year or null if invalid
 */
const parseYearValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.floor(parsed);
};

/**
 * Normalizes a month range, ensuring from <= to.
 *
 * @param {*} fromValue - Starting month (1-12)
 * @param {*} toValue - Ending month (1-12)
 * @returns {Object} { from: number, to: number } - Normalized range
 */
const normalizeMonthRange = (fromValue, toValue) => {
  const from = parseMonthValue(fromValue) ?? DEFAULT_SUMMARY_MONTH_FROM;
  const to = parseMonthValue(toValue) ?? DEFAULT_SUMMARY_MONTH_TO;

  // Swap if from > to
  if (from <= to) {
    return { from, to };
  }

  return { from: to, to: from };
};

/**
 * Builds a sequential array of month numbers.
 *
 * @param {number} from - Starting month (inclusive)
 * @param {number} to - Ending month (inclusive)
 * @returns {number[]} Array of month numbers [from, from+1, ..., to]
 */
const buildMonthSequence = (from, to) => {
  const months = [];
  for (let next = from; next <= to; next += 1) {
    months.push(next);
  }
  return months;
};

/**
 * Builds start and end Date objects for a month range within a year.
 *
 * @param {number} year - The year
 * @param {number} fromMonth - Starting month (1-12)
 * @param {number} toMonth - Ending month (1-12)
 * @returns {Object} { start: Date, end: Date } - Date range
 */
const buildDateRange = (year, fromMonth, toMonth) => {
  const start = new Date(year, fromMonth - 1, 1); // First day of fromMonth
  const end = new Date(year, toMonth, 1); // First day of month after toMonth
  return { start, end };
};

/**
 * Resolves a limit value, clamping between 1 and MAX_LIMIT.
 *
 * @param {*} value - Limit value from query parameter
 * @returns {number} Clamped limit value (default: DEFAULT_LIMIT)
 */
const resolveLimit = (value) => {
  if (value === undefined || value === null) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }

  const normalized = Math.max(1, Math.floor(parsed));
  return Math.min(normalized, MAX_LIMIT);
};

// =============================================================================
// UTILITY FUNCTIONS - FILTER BUILDING
// =============================================================================

/**
 * Builds a MongoDB match object for category filters.
 *
 * @param {*} rawValues - Single category or array of categories
 * @returns {Object} MongoDB match object (empty if no valid values)
 */
const buildCategoryMatch = (rawValues) => {
  const values = normalizeFilterValues(rawValues);
  if (!values.length) {
    return {};
  }

  if (values.length === 1) {
    return { Category: values[0] };
  }

  return { Category: { $in: values } };
};

/**
 * Builds a MongoDB match object for account filters.
 * Filters out "all" placeholder values.
 *
 * @param {*} rawValues - Single account or array of accounts
 * @returns {Object} MongoDB match object (empty if no valid values)
 */
const buildAccountMatch = (rawValues) => {
  const values = removeAllEntry(normalizeFilterValues(rawValues));
  if (!values.length) {
    return {};
  }

  return values.length === 1
    ? { Account: values[0] }
    : { Account: { $in: values } };
};

/**
 * Retrieves a field value from an entry, checking both exact and lowercase field names.
 *
 * @param {Object} entry - Entry object
 * @param {string} fieldName - Field name to retrieve
 * @returns {*} Field value or undefined if not found
 */
const getFieldValue = (entry, fieldName) => {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  return entry[fieldName] ?? entry[fieldName.toLowerCase()];
};

/**
 * Builds MongoDB filter object from query parameters.
 *
 * Supports date range filtering and text field filtering (account, category, currency, etc.)
 *
 * @param {Object} query - Express request query object
 * @returns {Object} MongoDB filter object
 */
const buildFilters = (query) => {
  const filters = {};

  // Date range filter
  const fromDate = parseDateValue(query.fromDate);
  const toDate = parseDateValue(query.toDate);
  if (fromDate || toDate) {
    const dateFilter = {};
    if (fromDate) {
      dateFilter.$gte = fromDate;
    }
    if (toDate) {
      dateFilter.$lte = toDate;
    }
    if (Object.keys(dateFilter).length) {
      filters.Date = dateFilter;
    }
  }

  // Text field filters
  for (const [queryKey, field] of TEXT_FILTERS) {
    const values = normalizeFilterValues(query[queryKey]);
    if (!values.length) {
      continue;
    }
    if (values.length === 1) {
      filters[field] = values[0];
    } else {
      filters[field] = { $in: values };
    }
  }

  return filters;
};

// =============================================================================
// UTILITY FUNCTIONS - DATA SANITIZATION
// =============================================================================

/**
 * Sanitizes a raw budget/actual entry, extracting and validating known fields.
 *
 * Ensures data integrity by parsing dates and numbers, trimming text fields,
 * and filtering out invalid values.
 *
 * @param {Object} raw - Raw entry data
 * @returns {Object|null} Sanitized entry object, or null if no valid fields
 */
const sanitizeEntry = (raw) => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const entry = {};

  // Parse and validate Date field
  const dateValue = getFieldValue(raw, "Date");
  const parsedDate = parseDateValue(dateValue);
  if (parsedDate) {
    entry.Date = parsedDate;
  }

  // Extract and normalize text fields
  const textFields = [
    "Description1",
    "Currency",
    "BaseCurrency",
    "Account",
    "Category",
    "Labels",
    "Note",
  ];
  for (const field of textFields) {
    const value = getFieldValue(raw, field);
    const normalized = normalizeText(value);
    if (normalized !== null) {
      entry[field] = normalized;
    }
  }

  // Parse and validate numeric fields
  const numericFields = ["Amount", "BaseAmount"];
  for (const field of numericFields) {
    const parsed = parseNumberValue(getFieldValue(raw, field));
    if (parsed !== null) {
      entry[field] = parsed;
    }
  }

  // Return null if no valid fields were extracted
  if (!Object.keys(entry).length) {
    return null;
  }

  return entry;
};

/**
 * Extracts entries from various payload formats.
 *
 * Handles:
 * - Direct array: [entry1, entry2]
 * - Wrapped in 'entries' property: { entries: [...] }
 * - Wrapped in 'items' property: { items: [...] }
 * - Single object: { ...entry }
 *
 * @param {*} payload - Request body payload
 * @returns {Array} Array of entry objects
 */
const extractEntries = (payload) => {
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload.entries)) {
    return payload.entries;
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  if (typeof payload === "object") {
    return [payload];
  }
  return [];
};

// =============================================================================
// UTILITY FUNCTIONS - DATA AGGREGATION
// =============================================================================

/**
 * Aggregates BaseAmount values by month for a given date range.
 *
 * Uses MongoDB aggregation pipeline to sum BaseAmount values grouped by month.
 *
 * @param {Model} model - Mongoose model to query (BudgetData or PSdata)
 * @param {number} year - Year to aggregate
 * @param {number} fromMonth - Starting month (1-12)
 * @param {number} toMonth - Ending month (1-12)
 * @param {Object} extraMatch - Additional MongoDB match criteria (e.g., category, account filters)
 * @returns {Promise<Object>} Object mapping month numbers to totals: { 1: 1000, 2: 1500, ... }
 */
const aggregateBaseAmounts = async (model, year, fromMonth, toMonth, extraMatch = {}) => {
  const effectiveYear = parseYearValue(year) ?? CURRENT_YEAR;
  const { start, end } = buildDateRange(
    effectiveYear,
    fromMonth,
    toMonth
  );

  const pipeline = [
    {
      $match: {
        Date: { $gte: start, $lt: end },
        ...extraMatch,
      },
    },
    {
      $group: {
        _id: { $month: "$Date" },
        total: {
          $sum: {
            $ifNull: ["$BaseAmount", 0],
          },
        },
      },
    },
    {
      $project: {
        month: "$_id",
        total: 1,
      },
    },
  ];

  const aggregated = await model.aggregate(pipeline).exec();

  // Convert aggregation results to a month-to-total mapping
  const result = {};
  for (const entry of aggregated) {
    if (!entry || typeof entry.month !== "number") {
      continue;
    }

    const normalizedTotal = Number(entry.total ?? 0);
    if (!Number.isFinite(normalizedTotal)) {
      continue;
    }

    // Only include months within the requested range
    if (entry.month < fromMonth || entry.month > toMonth) {
      continue;
    }

    result[entry.month] = normalizedTotal;
  }

  return result;
};

// =============================================================================
// BUDGET ENTRY ROUTES
// =============================================================================

/**
 * GET /
 *
 * Retrieves budget entries with optional filtering and pagination.
 *
 * @query {string} fromDate - Filter entries on or after this date
 * @query {string} toDate - Filter entries on or before this date
 * @query {string|string[]} account - Filter by account name(s)
 * @query {string|string[]} category - Filter by category name(s)
 * @query {string|string[]} currency - Filter by currency code(s)
 * @query {string|string[]} baseCurrency - Filter by base currency code(s)
 * @query {number} limit - Maximum number of results (default: 500, max: 2000)
 * @returns {Array} Array of budget entry objects, sorted by date descending
 * @throws {500} If database query fails
 */
router.get("/", async (req, res) => {
  const filters = buildFilters(req.query);
  const limit = resolveLimit(req.query.limit);

  try {
    const budgets = await BudgetData.find(filters)
      .sort({ Date: -1 })
      .limit(limit)
      .lean()
      .exec();
    return res.json(budgets);
  } catch (error) {
    console.error("[BUDGET] Failed to fetch budget entries:", error);
    return res.status(500).json({
      error: "Failed to fetch budget data",
    });
  }
});

/**
 * POST /
 *
 * Creates one or more new budget entries. Accepts multiple payload formats
 * and sanitizes data before insertion.
 *
 * Accepts formats:
 * - Single object: { Date: "2024-01-01", Account: "...", Amount: 1000, ... }
 * - Array: [{ ...entry1 }, { ...entry2 }]
 * - Wrapped: { entries: [...] } or { items: [...] }
 *
 * @body {Object|Array} Budget entry data in any supported format
 * @returns {Object} { insertedCount: number } - Count of successfully inserted entries
 * @throws {400} If no valid entries provided in payload
 * @throws {500} If database insertion fails
 */
router.post("/", async (req, res) => {
  const rawEntries = extractEntries(req.body);
  const sanitizedEntries = rawEntries
    .map((entry) => sanitizeEntry(entry))
    .filter(Boolean);

  if (!sanitizedEntries.length) {
    return res.status(400).json({
      error: "No valid budget entries were provided",
    });
  }

  try {
    // Use ordered: false to continue inserting even if some documents fail
    const inserted = await BudgetData.insertMany(sanitizedEntries, {
      ordered: false,
    });
    return res.status(201).json({
      insertedCount: Array.isArray(inserted) ? inserted.length : 0,
    });
  } catch (error) {
    console.error("[BUDGET] Failed to persist budget entries:", error);
    return res.status(500).json({
      error: "Failed to persist budget data",
    });
  }
});

/**
 * PATCH /:id
 *
 * Updates an existing budget entry with new field values.
 * Only provided fields are updated (partial update).
 *
 * @param {string} id - MongoDB ObjectId of the budget entry to update
 * @body {Object} Fields to update (Date, Account, Amount, etc.)
 * @returns {Object} { entry: updatedEntryObject }
 * @throws {400} If entry ID is invalid or no valid fields provided
 * @throws {404} If entry with given ID not found
 * @throws {500} If database update fails
 */
router.patch("/:id", async (req, res) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      error: "Invalid budget entry identifier",
    });
  }

  const sanitizedPayload = sanitizeEntry(req.body);
  if (!sanitizedPayload || !Object.keys(sanitizedPayload).length) {
    return res.status(400).json({
      error: "No valid budget entry fields were provided",
    });
  }

  try {
    const updated = await BudgetData.findByIdAndUpdate(
      id,
      sanitizedPayload,
      {
        new: true, // Return the modified document
      }
    )
      .lean()
      .exec();

    if (!updated) {
      return res.status(404).json({
        error: "Budget entry not found",
      });
    }
    return res.json({
      entry: updated,
    });
  } catch (error) {
    console.error("[BUDGET] Failed to update budget entry:", error);
    return res.status(500).json({
      error: "Failed to update budget entry",
    });
  }
});

/**
 * DELETE /:id
 *
 * Deletes a budget entry from the database.
 *
 * @param {string} id - MongoDB ObjectId of the budget entry to delete
 * @returns {Object} { deleted: true }
 * @throws {400} If entry ID is invalid
 * @throws {404} If entry with given ID not found
 * @throws {500} If database deletion fails
 */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      error: "Invalid budget entry identifier",
    });
  }

  try {
    const deleted = await BudgetData.findByIdAndDelete(id).lean().exec();
    if (!deleted) {
      return res.status(404).json({
        error: "Budget entry not found",
      });
    }
    return res.json({
      deleted: true,
    });
  } catch (error) {
    console.error("[BUDGET] Failed to delete budget entry:", error);
    return res.status(500).json({
      error: "Failed to delete budget entry",
    });
  }
});

// =============================================================================
// ACTUAL ENTRY ROUTES
// =============================================================================

/**
 * GET /actual-entries
 *
 * Retrieves actual (non-budget) financial entries with filtering.
 * Supports filtering by date range, category, account, description, and amount range.
 *
 * @query {number} month - Specific month to query (1-12), overrides fromMonth/toMonth
 * @query {number} fromMonth - Starting month (1-12, default: 1)
 * @query {number} toMonth - Ending month (1-12, default: 12)
 * @query {number} actualYear - Year to query (default: current year)
 * @query {string|string[]} categories - Filter by category name(s) (or 'category')
 * @query {string|string[]} accounts - Filter by account name(s) (or 'account')
 * @query {string} description - Filter by description text (case-insensitive, partial match)
 * @query {number} valueFrom - Minimum BaseAmount value
 * @query {number} valueTo - Maximum BaseAmount value
 * @query {number} limit - Maximum number of results (default: 500, max: 2000)
 * @returns {Object} { entries: Array } - Array of actual entry objects
 * @throws {500} If database query fails
 */
router.get("/actual-entries", async (req, res) => {
  // Handle single month or month range
  const explicitMonth = parseMonthValue(req.query.month);
  const monthRange = explicitMonth
    ? { from: explicitMonth, to: explicitMonth }
    : normalizeMonthRange(req.query.fromMonth, req.query.toMonth);
  const { from: fromMonth, to: toMonth } = monthRange;
  const actualYear = parseYearValue(req.query.actualYear) ?? CURRENT_YEAR;
  const categoryMatch = buildCategoryMatch(
    req.query.categories ?? req.query.category
  );
  const accountMatch = buildAccountMatch(
    req.query.accounts ?? req.query.account
  );

  try {
    const { start, end } = buildDateRange(actualYear, fromMonth, toMonth);

    // Build description filter (searches Description1 and Description2)
    const descriptionFilter = (
      typeof req.query.description === "string" ? req.query.description.trim() : ""
    ).toLowerCase();

    // Build value range filters
    const valueFromFilter = parseNumberValue(req.query.valueFrom);
    const valueToFilter = parseNumberValue(req.query.valueTo);

    const match = {
      Date: { $gte: start, $lt: end },
      ...categoryMatch,
      ...accountMatch,
    };

    // Add description regex filter if provided
    if (descriptionFilter) {
      const regex = new RegExp(escapeForRegex(descriptionFilter), "i");
      match.$or = [
        { Description1: { $regex: regex } },
        { Description2: { $regex: regex } },
      ];
    }

    // Add BaseAmount range filter if provided
    if (Number.isFinite(valueFromFilter) || Number.isFinite(valueToFilter)) {
      const baseMatch = {};
      if (Number.isFinite(valueFromFilter)) {
        baseMatch.$gte = valueFromFilter;
      }
      if (Number.isFinite(valueToFilter)) {
        baseMatch.$lte = valueToFilter;
      }
      if (Object.keys(baseMatch).length) {
        match.BaseAmount = baseMatch;
      }
    }

    const limit = resolveLimit(req.query.limit);
    const entries = await PSdata.find(match)
      .sort({ Date: -1 })
      .limit(limit)
      .lean()
      .exec();

    return res.json({ entries });
  } catch (error) {
    console.error("[BUDGET] Failed to load actual entries:", error);
    return res.status(500).json({
      error: "Failed to load actual entries",
    });
  }
});

/**
 * PATCH /actual-entries/:id
 *
 * Updates an existing actual entry with new field values.
 * Only provided fields are updated (partial update).
 *
 * @param {string} id - MongoDB ObjectId of the actual entry to update
 * @body {Object} Fields to update (Date, Account, Amount, etc.)
 * @returns {Object} { entry: updatedEntryObject }
 * @throws {400} If entry ID is invalid or no valid fields provided
 * @throws {404} If entry with given ID not found
 * @throws {500} If database update fails
 */
router.patch("/actual-entries/:id", async (req, res) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      error: "Invalid actual entry identifier",
    });
  }

  const sanitizedPayload = sanitizeEntry(req.body);
  if (!sanitizedPayload || !Object.keys(sanitizedPayload).length) {
    return res.status(400).json({
      error: "No valid actual entry fields were provided",
    });
  }

  try {
    const updated = await PSdata.findByIdAndUpdate(id, sanitizedPayload, {
      new: true, // Return the modified document
    })
      .lean()
      .exec();

    if (!updated) {
      return res.status(404).json({
        error: "Actual entry not found",
      });
    }

    return res.json({
      entry: updated,
    });
  } catch (error) {
    console.error("[BUDGET] Failed to update actual entry:", error);
    return res.status(500).json({
      error: "Failed to update actual entry",
    });
  }
});

/**
 * DELETE /actual-entries/:id
 *
 * Deletes an actual entry from the database.
 *
 * @param {string} id - MongoDB ObjectId of the actual entry to delete
 * @returns {Object} { deleted: true }
 * @throws {400} If entry ID is invalid
 * @throws {404} If entry with given ID not found
 * @throws {500} If database deletion fails
 */
router.delete("/actual-entries/:id", async (req, res) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      error: "Invalid actual entry identifier",
    });
  }

  try {
    const deleted = await PSdata.findByIdAndDelete(id).lean().exec();
    if (!deleted) {
      return res.status(404).json({
        error: "Actual entry not found",
      });
    }
    return res.json({
      deleted: true,
    });
  } catch (error) {
    console.error("[BUDGET] Failed to delete actual entry:", error);
    return res.status(500).json({
      error: "Failed to delete actual entry",
    });
  }
});

// =============================================================================
// ANALYSIS & REPORTING ROUTES
// =============================================================================

/**
 * GET /summary
 *
 * Generates a budget vs actual summary, aggregating data by month.
 * Returns monthly totals for both budget and actual amounts, allowing
 * for comparison and variance analysis.
 *
 * @query {number} fromMonth - Starting month (1-12, default: 1)
 * @query {number} toMonth - Ending month (1-12, default: 12)
 * @query {number} actualYear - Year for actual data (default: current year)
 * @query {number} budgetYear - Year for budget data (default: current year)
 * @query {string|string[]} categories - Filter by category name(s) (or 'category')
 * @query {string|string[]} accounts - Filter by account name(s) (or 'account')
 * @returns {Object} Summary object with month-by-month totals
 *   {
 *     months: number[],        // Array of month numbers [1, 2, 3, ...]
 *     fromMonth: number,       // Starting month
 *     toMonth: number,         // Ending month
 *     actualYear: number,      // Year used for actual data
 *     budgetYear: number,      // Year used for budget data
 *     actualByMonth: Object,   // { 1: 1000, 2: 1500, ... }
 *     budgetByMonth: Object    // { 1: 1200, 2: 1400, ... }
 *   }
 * @throws {500} If aggregation fails
 */
router.get("/summary", async (req, res) => {
  const monthRange = normalizeMonthRange(
    req.query.fromMonth,
    req.query.toMonth
  );
  const { from, to } = monthRange;
  const actualYear = parseYearValue(req.query.actualYear) ?? CURRENT_YEAR;
  const budgetYear = parseYearValue(req.query.budgetYear) ?? CURRENT_YEAR;
  const categoryMatch = buildCategoryMatch(
    req.query.categories ?? req.query.category
  );
  const accountMatch = buildAccountMatch(
    req.query.accounts ?? req.query.account
  );

  try {
    // Run both aggregations in parallel for better performance
    const [actualByMonth, budgetByMonth] = await Promise.all([
      aggregateBaseAmounts(PSdata, actualYear, from, to, {
        ...categoryMatch,
        ...accountMatch,
      }),
      aggregateBaseAmounts(BudgetData, budgetYear, from, to, {
        ...categoryMatch,
        ...accountMatch,
      }),
    ]);

    return res.json({
      months: buildMonthSequence(from, to),
      fromMonth: from,
      toMonth: to,
      actualYear,
      budgetYear,
      actualByMonth,
      budgetByMonth,
    });
  } catch (error) {
    console.error("[BUDGET] Failed to summarize budget data:", error);
    return res.status(500).json({
      error: "Failed to summarize budget data",
    });
  }
});

/**
 * GET /cash-flow
 *
 * Generates a cash flow report for budget data within a date range.
 * Uses the CashFlowFetcher service to categorize and summarize cash flows.
 *
 * @query {string} fromDate - Start date (required, ISO format or parseable date string)
 * @query {string} toDate - End date (required, ISO format or parseable date string)
 * @query {string} transfers - How to handle transfers: "include", "only", or "exclude" (default: "exclude")
 * @query {string} includeUnrealizedGL - Include unrealized gains/losses: "true" or "false" (default: "false")
 * @returns {Object} Cash flow report object from CashFlowFetcher
 * @throws {400} If required date parameters missing or invalid
 * @throws {500} If cash flow generation fails
 */
router.get("/cash-flow", async (req, res) => {
  const { fromDate, toDate, transfers, includeUnrealizedGL } = req.query ?? {};

  // Validate required parameters
  if (!fromDate || !toDate) {
    return res.status(400).json({
      error: "Missing required query parameters 'fromDate' and 'toDate'",
    });
  }

  const start = new Date(fromDate);
  const end = new Date(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return res.status(400).json({
      error: "Invalid 'fromDate' or 'toDate'; expected valid dates",
    });
  }

  // Normalize transfer mode to valid values
  const transferMode =
    transfers === "include" || transfers === "only" ? transfers : "exclude";

  try {
    const report = await budgetCashFlowFetcher.buildCashFlowReport({
      fromDate: start,
      toDate: end,
      transfers: transferMode,
      includeUnrealizedGL: includeUnrealizedGL === "true",
    });
    res.json(report);
  } catch (error) {
    console.error("[BUDGET] Failed to build cash flow report:", error);
    res.status(500).json({
      error: "Failed to build budget cash flow report",
    });
  }
});

/**
 * GET /category-groups
 *
 * Retrieves Income and Expense category groups derived from the Chart of Accounts.
 * This endpoint caches the COA data for performance.
 *
 * @returns {Object} Category groups object
 *   {
 *     Income: string[],   // Array of income category names
 *     Expense: string[]   // Array of expense category names
 *   }
 * @throws {500} If COA file read or parsing fails (returns empty arrays)
 */
router.get("/category-groups", async (req, res) => {
  try {
    const groups = await loadCategoryGroups();
    return res.json(groups);
  } catch (error) {
    console.error("[BUDGET] Failed to fetch category groups:", error);
    return res.status(500).json({
      error: "Failed to fetch category groups",
    });
  }
});

module.exports = router;
