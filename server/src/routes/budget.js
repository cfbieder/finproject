const express = require("express");
const mongoose = require("mongoose");
const fs = require("node:fs/promises");
const BudgetData = require("../../../components/models/BudgetData");
const PSdata = require("../../../components/models/PSdata");
const CashFlowFetcher = require("../services/reporting/cashFLowFetcher");
const { dataPaths } = require("../utils/dataPaths");

const router = express.Router();
const budgetCashFlowFetcher = new CashFlowFetcher({
  psDataModel: BudgetData,
  allowJsonFallback: false,
});

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const TEXT_FILTERS = [
  ["account", "Account"],
  ["category", "Category"],
  ["currency", "Currency"],
  ["baseCurrency", "BaseCurrency"],
];
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_SUMMARY_MONTH_FROM = 1;
const DEFAULT_SUMMARY_MONTH_TO = 12;

const CATEGORY_GROUP_TYPES = ["Income", "Expense"];

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

  const normalizeCategoryValue = (value) => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  const traverseNode = (node, currentGroup) => {
    if (Array.isArray(node)) {
      for (const child of node) {
        traverseNode(child, currentGroup);
      }
      return;
    }

    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        const nextGroup =
          CATEGORY_GROUP_TYPES.includes(key) && key !== currentGroup
            ? key
            : currentGroup;
        traverseNode(value, nextGroup);
      }
      return;
    }

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

let cachedCategoryGroups = null;

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

const removeAllEntry = (values) => {
  return values.filter(
    (value) => value && value.toString().toLowerCase() !== "all"
  );
};

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

const buildAccountMatch = (rawValues) => {
  const values = removeAllEntry(normalizeFilterValues(rawValues));
  if (!values.length) {
    return {};
  }

  return values.length === 1
    ? { Account: values[0] }
    : { Account: { $in: values } };
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

const parseYearValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.floor(parsed);
};

const normalizeMonthRange = (fromValue, toValue) => {
  const from = parseMonthValue(fromValue) ?? DEFAULT_SUMMARY_MONTH_FROM;
  const to = parseMonthValue(toValue) ?? DEFAULT_SUMMARY_MONTH_TO;

  if (from <= to) {
    return { from, to };
  }

  return { from: to, to: from };
};

const buildMonthSequence = (from, to) => {
  const months = [];
  for (let next = from; next <= to; next += 1) {
    months.push(next);
  }
  return months;
};

const buildDateRange = (year, fromMonth, toMonth) => {
  const start = new Date(year, fromMonth - 1, 1);
  const end = new Date(year, toMonth, 1);
  return { start, end };
};

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

  const result = {};
  for (const entry of aggregated) {
    if (!entry || typeof entry.month !== "number") {
      continue;
    }

    const normalizedTotal = Number(entry.total ?? 0);
    if (!Number.isFinite(normalizedTotal)) {
      continue;
    }

    if (entry.month < fromMonth || entry.month > toMonth) {
      continue;
    }

    result[entry.month] = normalizedTotal;
  }

  return result;
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

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
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
        new: true,
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

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
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

router.patch("/actual-entries/:id", async (req, res) => {
  const { id } = req.params;
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
      new: true,
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

router.delete("/actual-entries/:id", async (req, res) => {
  const { id } = req.params;
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

router.get("/cash-flow", async (req, res) => {
  const { fromDate, toDate, transfers, includeUnrealizedGL } = req.query ?? {};

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

router.get("/actual-entries", async (req, res) => {
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
    const match = {
      Date: { $gte: start, $lt: end },
      ...categoryMatch,
      ...accountMatch,
    };

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
