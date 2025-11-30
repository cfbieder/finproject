const express = require("express");
const BudgetData = require("../../../components/models/BudgetData");

const router = express.Router();

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const TEXT_FILTERS = [
  ["account", "Account"],
  ["category", "Category"],
  ["currency", "Currency"],
  ["baseCurrency", "BaseCurrency"],
];

const parseDateValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseNumberValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeText = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value).trim();
};

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

const getFieldValue = (entry, fieldName) => {
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  return entry[fieldName] ?? entry[fieldName.toLowerCase()];
};

const buildFilters = (query) => {
  const filters = {};

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

const sanitizeEntry = (raw) => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const entry = {};
  const dateValue = getFieldValue(raw, "Date");
  const parsedDate = parseDateValue(dateValue);
  if (parsedDate) {
    entry.Date = parsedDate;
  }

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

  const numericFields = ["Amount", "BaseAmount"];
  for (const field of numericFields) {
    const parsed = parseNumberValue(getFieldValue(raw, field));
    if (parsed !== null) {
      entry[field] = parsed;
    }
  }

  if (!Object.keys(entry).length) {
    return null;
  }

  return entry;
};

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

module.exports = router;
