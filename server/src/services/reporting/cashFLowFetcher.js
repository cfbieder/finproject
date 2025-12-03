/******************************************************************************************************
 * Cash Flow Fetcher
 * Chris Biedermann
 * V1.0
 * November 2025
 * Purpose: Fetch income and expense data for category as of a from start date to end data.
 * *****************************************************************************************************/

const fs = require("fs");
const path = require("path");
const PSdata = require("../../../../components/models/PSdata");
const { dataPaths, resolveDataPath } = require("../../utils/dataPaths");

const PROJECT_ROOT = path.resolve(__dirname, "../../../..");
const resolveFromRoot = (value, fallbackRelative) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized) {
    return path.isAbsolute(normalized)
      ? normalized
      : path.join(PROJECT_ROOT, normalized);
  }
  return path.join(PROJECT_ROOT, fallbackRelative);
};
const DEFAULT_CATEGORY_NAMES_PATH = dataPaths.categoryNames;

const DEFAULT_COA_PATH = dataPaths.coa;

const DEFAULT_CASH_FLOW_REPORT_PATH = resolveFromRoot(
  process.env.CASH_FLOW_REPORT_PATH,
  "components/reports/cash_flow_report.json"
);

console.log("CFF: Using category names path:", process.env.CATEGORY_NAMES_PATH);
console.log("CFF: Using COA path:", DEFAULT_COA_PATH);
console.log("CFF: Using cash flow report path:", DEFAULT_CASH_FLOW_REPORT_PATH);

const UNREALIZED_GL_CATEGORY = "Unrealized G/L";

const PS_DATA_JSON_PATH = dataPaths.psData;

let cachedPsTransactions = null;
let psTransactionsLoadPromise = null;

const parseAmountValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeTransaction = (entry) => {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const rawDate = entry.Date;
  if (!rawDate) {
    return null;
  }
  const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const category =
    typeof entry.Category === "string" ? entry.Category.trim() : "";
  if (!category) {
    return null;
  }

  const amountValue = entry.BaseAmount ?? entry.Amount;
  const amount = parseAmountValue(amountValue);
  if (amount === null) {
    return null;
  }

  return { date, category, amount };
};

const loadPsTransactions = async () => {
  if (cachedPsTransactions) {
    return cachedPsTransactions;
  }
  if (psTransactionsLoadPromise) {
    return psTransactionsLoadPromise;
  }
  psTransactionsLoadPromise = fs.promises
    .readFile(PS_DATA_JSON_PATH, "utf8")
    .then((raw) => {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const transactions = parsed
        .map((entry) => normalizeTransaction(entry))
        .filter(Boolean);
      cachedPsTransactions = transactions;
      return transactions;
    })
    .catch((error) => {
      console.warn("[CASHFLOW] Failed to load PS data JSON:", error.message);
      cachedPsTransactions = [];
      return [];
    });
  return psTransactionsLoadPromise;
};

const aggregateCategoryTotalsFromJson = async ({
  categories,
  start,
  end,
} = {}) => {
  const normalizedCategories = Array.isArray(categories) ? categories : [];
  if (!normalizedCategories.length) {
    return [];
  }

  const transactions = await loadPsTransactions();
  const totals = new Map();
  const categorySet = new Set(normalizedCategories);

  for (const txn of transactions) {
    if (!txn || !categorySet.has(txn.category)) {
      continue;
    }
    if (start && txn.date < start) {
      continue;
    }
    if (end && txn.date > end) {
      continue;
    }
    totals.set(txn.category, (totals.get(txn.category) || 0) + txn.amount);
  }

  return normalizedCategories.map((category) => ({
    category,
    total: totals.get(category) ?? 0,
  }));
};

/** Fetches income and expense data for category as of a from start date to end data.
 */

class CashFlowFetcher {
  constructor({ psDataModel, allowJsonFallback } = {}) {
    this.psDataModel = psDataModel || PSdata;
    this.allowJsonFallback =
      typeof allowJsonFallback === "boolean"
        ? allowJsonFallback
        : this.psDataModel === PSdata;
  }

  async buildCashFlowReport({
    fromDate,
    toDate,
    outputToFile = false,
    transfers,
    includeUnrealizedGL = false,
  } = {}) {
    const transferMode =
      transfers === "include" || transfers === "only" ? transfers : "exclude";
    const excludedCategorySet = includeUnrealizedGL
      ? null
      : new Set([UNREALIZED_GL_CATEGORY]);

    const coaData = JSON.parse(fs.readFileSync(DEFAULT_COA_PATH, "utf8"));
    const profitLossEntry =
      Array.isArray(coaData) &&
      coaData.find(
        (item) =>
          item &&
          typeof item === "object" &&
          Object.prototype.hasOwnProperty.call(item, "Profit & Loss Accounts")
      );

    if (!profitLossEntry) {
      return {};
    }

    const structure = profitLossEntry["Profit & Loss Accounts"];
    const transferCategories = extractTransferCategories(structure);
    const transferCategorySet =
      transferCategories && transferCategories.length
        ? new Set(transferCategories)
        : null;

    const categoryBalances = await this.fetchCategoryBalances({
      filename: DEFAULT_CATEGORY_NAMES_PATH,
      fromDate,
      toDate,
      transfers: transferMode,
      transferCategories,
      excludedCategories: excludedCategorySet
        ? [UNREALIZED_GL_CATEGORY]
        : undefined,
    });

    const totals = new Map();
    for (let i = 0; i < categoryBalances.length; i += 1) {
      const entry = categoryBalances[i];
      if (entry && typeof entry.category === "string") {
        totals.set(
          entry.category,
          typeof entry.total === "number" ? entry.total : 0
        );
      }
    }

    const nodes = [];
    for (let i = 0; i < structure.length; i += 1) {
      const entry = structure[i];
      if (!entry || typeof entry !== "object") {
        continue;
      }

      for (const [name, value] of Object.entries(entry)) {
        const isTransferNode = name === "Transfers";
        if (transferMode === "exclude" && isTransferNode) {
          continue;
        }
        const node = buildCashFlowNode(name, value, totals, {
          transferMode,
          transferCategorySet,
          excludedCategorySet,
        });
        if (node) {
          nodes.push(node);
        }
      }
    }

    const report = { "Profit & Loss Accounts": nodes };

    if (outputToFile) {
      const targetPath = DEFAULT_CASH_FLOW_REPORT_PATH;
      console.log("[DA] Writing cash flow report to: %s", targetPath);
      try {
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(
          targetPath,
          JSON.stringify(report, null, 2),
          "utf8"
        );
      } catch (err) {
        console.warn("Failed to write cash flow report:", err);
      }
    }

    return report;
  }
  /**
   * Fetches total balances for each category between two dates.
   */

  async fetchCategoryBalances({
    filename,
    fromDate,
    toDate,
    transfers,
    transferCategories,
    excludedCategories,
  } = {}) {
    const toDateValue = (value) => {
      if (!value) return null;
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const start = toDateValue(fromDate);
    const end = toDateValue(toDate);

    const filePath = filename
      ? resolveDataPath(filename, "category_names.json")
      : DEFAULT_CATEGORY_NAMES_PATH;

    const categoryData = JSON.parse(fs.readFileSync(filePath, "utf8"));
    let categories = Array.isArray(categoryData)
      ? categoryData
      : Object.keys(categoryData);

    if (excludedCategories && excludedCategories.length > 0) {
      const excludedSet = new Set(
        excludedCategories
          .map((category) =>
            typeof category === "string" ? category.trim() : ""
          )
          .filter(Boolean)
      );
      if (excludedSet.size > 0) {
        categories = categories.filter(
          (category) => !excludedSet.has(category)
        );
      }
    }

    if (transferCategories && transferCategories.length > 0) {
      const transferSet = new Set(transferCategories);
      if (transfers === "exclude") {
        categories = categories.filter(
          (category) => !transferSet.has(category)
        );
      } else if (transfers === "only") {
        categories = categories.filter((category) => transferSet.has(category));
      }
    }

    if (!categories.length) {
      return [];
    }

    const match = { Category: { $in: categories } };
    if (start || end) {
      match.Date = {};
      if (start) match.Date.$gte = start;
      if (end) match.Date.$lte = end;
    }

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: "$Category",
          total: { $sum: { $ifNull: ["$BaseAmount", "$Amount"] } },
        },
      },
      { $project: { _id: 0, category: "$_id", total: 1 } },
    ];

    let aggregated;
    try {
      aggregated = await this.psDataModel.aggregate(pipeline).exec();
    } catch (error) {
      if (this.allowJsonFallback) {
        console.warn(
          "[CASHFLOW] Aggregation failed, falling back to JSON data:",
          error?.message
        );
        aggregated = await aggregateCategoryTotalsFromJson({
          categories,
          start,
          end,
        });
      } else {
        throw error;
      }
    }

    const totals = new Map(
      aggregated.map(({ category, total }) => [category, total ?? 0])
    );

    return categories.map((category) => ({
      category,
      total: totals.get(category) ?? 0,
    }));
  }

  /**
   * Returns the sum of BaseAmount (fallback to Amount) for a category between two dates.
   * Uses an aggregation to keep the work inside MongoDB for speed.
   */

  async getCategoryAmountSumFromToDate({
    category,
    startDate,
    endDate,
    amountField = "Amount",
    fallbackField,
    currency,
    currencyField,
  }) {
    if (!category) {
      throw new Error("Category is required");
    }
    if (!amountField) {
      throw new Error("Amount field is required");
    }

    const toDate = (value) => {
      if (!value) return null;
      const d = value instanceof Date ? value : new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const start = toDate(startDate);
    const end = toDate(endDate);

    const match = { Category: category };
    if (start || end) {
      match.Date = {};
      if (start) match.Date.$gte = start;
      if (end) match.Date.$lte = end;
    }

    if (currency && currencyField) {
      match[currencyField] = currency;
    }

    const sumExpr =
      fallbackField && fallbackField !== amountField
        ? { $sum: { $ifNull: [`$${amountField}`, `$${fallbackField}`] } }
        : { $sum: `$${amountField}` };

    const [result] = await this.psDataModel
      .aggregate([{ $match: match }, { $group: { _id: null, total: sumExpr } }])
      .exec();

    return result ? result.total : 0;
  }

  async getCategoryBaseAmountSum(
    category,
    startDate,
    endDate,
    baseCurrency = "USD"
  ) {
    return this.getCategoryAmountSumFromToDate({
      category,
      startDate,
      endDate,
      amountField: "BaseAmount",
      fallbackField: "Amount",
      currency: baseCurrency ?? "USD",
      currencyField: "BaseCurrency",
    });
  }
}

function extractTransferCategories(structure) {
  if (!Array.isArray(structure)) {
    return [];
  }

  const transferSet = new Set();
  const stack = structure.slice();

  while (stack.length) {
    const entry = stack.pop();
    if (!entry || typeof entry !== "object") {
      continue;
    }

    for (const [name, value] of Object.entries(entry)) {
      if (name === "Transfers" && Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          const item = value[i];
          if (typeof item === "string") {
            const trimmed = item.trim();
            if (trimmed) {
              transferSet.add(trimmed);
            }
          }
        }
      }
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          const child = value[i];
          if (child && typeof child === "object") {
            stack.push(child);
          }
        }
      }
    }
  }

  return Array.from(transferSet);
}

function buildCashFlowNode(
  name,
  value,
  totals,
  { transferMode, transferCategorySet, excludedCategorySet } = {}
) {
  if (!name) {
    return null;
  }

  if (excludedCategorySet && excludedCategorySet.has(name)) {
    return null;
  }

  if (!Array.isArray(value)) {
    const categoryName =
      typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : name;
    if (excludedCategorySet && excludedCategorySet.has(categoryName)) {
      return null;
    }
    const isTransferCategory =
      name === "Transfers" ||
      (transferCategorySet &&
        (transferCategorySet.has(categoryName) ||
          transferCategorySet.has(name)));
    if (transferMode === "only" && !isTransferCategory) {
      return null;
    }
    if (
      transferMode === "exclude" &&
      transferCategorySet &&
      (transferCategorySet.has(categoryName) || transferCategorySet.has(name))
    ) {
      return null;
    }
    const total = totals.get(categoryName) || 0;
    return { name, total };
  }

  const children = [];
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (typeof entry === "string") {
      const categoryName = entry.trim();
      if (!categoryName) {
        continue;
      }
      if (excludedCategorySet && excludedCategorySet.has(categoryName)) {
        continue;
      }
      const isTransferCategory =
        transferCategorySet && transferCategorySet.has(categoryName);
      if (transferMode === "only" && !isTransferCategory) {
        continue;
      }
      if (
        transferMode === "exclude" &&
        transferCategorySet &&
        transferCategorySet.has(categoryName)
      ) {
        continue;
      }
      const categoryTotal = totals.get(categoryName) || 0;
      children.push({ name: categoryName, total: categoryTotal });
      total += categoryTotal;
      continue;
    }

    if (entry && typeof entry === "object") {
      for (const [childName, childValue] of Object.entries(entry)) {
        const childNode = buildCashFlowNode(childName, childValue, totals, {
          transferMode,
          transferCategorySet,
          excludedCategorySet,
        });
        if (childNode) {
          children.push(childNode);
          total += childNode.total || 0;
        }
      }
    }
  }

  if (
    transferMode === "only" &&
    children.length === 0 &&
    name !== "Transfers"
  ) {
    return null;
  }

  return { name, total, children };
}

module.exports = CashFlowFetcher;
