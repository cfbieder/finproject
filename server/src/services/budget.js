/**
 * Budget service — CR043 Phase 2.1.
 *
 * Business logic extracted out of `v2/routes/budget.js`: the report-shaping
 * SQL (summary / actual-entries / cash-flow), the entry create/update
 * orchestration (v1→v2 field transform, account/category name resolution,
 * batch transaction), and the COA tree helpers. The route layer keeps only
 * HTTP concerns (param parsing, status codes, response envelopes, validation
 * guards). SQL that already lived in the repositories stays there; only the
 * previously route-inlined SQL moved here, co-located with its shaping logic.
 */

const db = require('../v2/db');
const repo = require('../v2/repositories').budget;
const accountsRepo = require('../v2/repositories').accounts;
const validate = require('../v2/utils/validate');

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Validate a date string is in YYYY-MM-DD format and represents a real date.
 */
function isValidDateString(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const date = new Date(str + 'T00:00:00Z');
  return !Number.isNaN(date.getTime());
}

/**
 * Transform v1-style field names to v2 format for budget entries
 * Maps: Date → entry_date, Amount → amount, etc.
 */
function transformV1ToV2Fields(data) {
  const fieldMap = {
    Date: 'entry_date',
    Description1: 'description',
    Amount: 'amount',
    Currency: 'currency',
    BaseAmount: 'base_amount',
    BaseCurrency: 'base_currency',
    Account: 'account_name',  // Will be resolved to account_id
    Category: 'category_name', // Will be resolved to category_id
    Note: 'note',
    Labels: 'labels'
  };

  const transformed = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const mappedKey = fieldMap[key] || key;
    transformed[mappedKey] = value;
  }
  return transformed;
}

/**
 * Helper: build month sequence array
 */
function buildMonthSequence(from, to) {
  const months = [];
  for (let m = from; m <= to; m++) {
    months.push(m);
  }
  return months;
}

/**
 * Extract transfer category leaf names from { name, children } tree
 */
function extractTransferCategories(nodes) {
  const categories = [];

  const collectLeaves = (items) => {
    for (const node of items) {
      if (!node.children || node.children.length === 0) {
        categories.push(node.name);
      } else {
        collectLeaves(node.children);
      }
    }
  };

  const walk = (items) => {
    for (const node of items) {
      if (!node || !node.name) continue;
      if (node.name.toLowerCase().includes('transfer')) {
        if (!node.children || node.children.length === 0) {
          categories.push(node.name);
        } else {
          collectLeaves(node.children);
        }
      } else if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return categories;
}

/**
 * Build a budget cash flow node recursively from { name, children } tree
 */
function buildBudgetCashFlowNode(node, budgetTotals, transfers, transferCategorySet) {
  if (!node || !node.name) return null;

  const { name, children } = node;
  const isLeaf = !children || children.length === 0;

  if (isLeaf) {
    const isTransfer = transferCategorySet.has(name.toLowerCase());
    if (transfers === 'exclude' && isTransfer) return null;
    if (transfers === 'only' && !isTransfer) return null;

    const total = budgetTotals[name] || 0;
    return { name, total };
  }

  const childNodes = [];
  let total = 0;

  for (const child of children) {
    const childNode = buildBudgetCashFlowNode(child, budgetTotals, transfers, transferCategorySet);
    if (childNode) {
      childNodes.push(childNode);
      total += childNode.total || 0;
    }
  }

  return { name, total, children: childNodes };
}

// ---------------------------------------------------------------------------
// Budget entries — create / update orchestration
// ---------------------------------------------------------------------------

// POST /api/v2/budget/entries field whitelist (checked post-transform, so
// listed in v2 names; *_name resolve to ids).
const ENTRY_FIELDS = [
  'version_id', 'entry_date', 'description', 'amount', 'currency',
  'base_amount', 'base_currency', 'account_id', 'category_id',
  'labels', 'note', 'budget_year', 'account_name', 'category_name', 'id',
];

function validateEntryFields(data, label, { requireCore = true } = {}) {
  validate.assertAllowedFields(data, ENTRY_FIELDS, label);
  validate.assertDateString(data.entry_date, `${label}.entry_date`, { optional: !requireCore });
  validate.assertFiniteNumber(data.amount, `${label}.amount`, { optional: !requireCore });
  validate.assertFiniteNumber(data.base_amount, `${label}.base_amount`, { optional: true });
  validate.assertInteger(data.version_id, `${label}.version_id`, { optional: true });
  validate.assertInteger(data.account_id, `${label}.account_id`, { optional: true });
  validate.assertInteger(data.category_id, `${label}.category_id`, { optional: true });
  validate.assertInteger(data.budget_year, `${label}.budget_year`, { optional: true });
}

/**
 * Create one or a batch of budget entries. Accepts a single object or an
 * array; validates every entry before writing any, resolves account/category
 * names to ids, and inserts the whole batch in one transaction.
 * Returns { isArray, created } — the route shapes the envelope.
 */
async function createEntries(body) {
  const isArray = Array.isArray(body);
  const entries = isArray ? body : [body];

  // CR037 P6: validate every entry BEFORE writing any, then insert the
  // whole batch in one transaction — a mid-batch failure must not leave a
  // partially-saved "all months" submission.
  const transformed = entries.map((rawEntry, i) => {
    const label = isArray ? `entry[${i}]` : 'entry';
    validate.assertPlainObject(rawEntry, label);
    const data = transformV1ToV2Fields(rawEntry);
    validateEntryFields(data, label);
    delete data.id;
    return data;
  });

  for (const data of transformed) {
    // Resolve account/category names to IDs if provided (reads, pre-tx)
    if (data.account_name) {
      const account = await accountsRepo.findByName(data.account_name);
      if (account) {
        data.account_id = account.id;
      }
      delete data.account_name;
    }
    if (data.category_name) {
      const category = await accountsRepo.findByName(data.category_name);
      if (category) {
        data.category_id = category.id;
      }
      delete data.category_name;
    }
  }

  const created = await db.transaction(async (client) => {
    const rows = [];
    for (const data of transformed) {
      rows.push(await repo.create(data, client));
    }
    return rows;
  });

  return { isArray, created };
}

/**
 * Update a single budget entry: transform v1 field names, resolve
 * account/category names to ids, and persist. Returns the updated entry or
 * null when the id does not exist.
 */
async function updateEntry(id, body) {
  validate.assertPlainObject(body, 'entry');
  // Transform v1 field names to v2
  const data = transformV1ToV2Fields(body);
  validateEntryFields(data, 'entry', { requireCore: false });
  delete data.id;

  // Resolve account name to ID if provided
  if (data.account_name) {
    const account = await accountsRepo.findByName(data.account_name);
    if (account) {
      data.account_id = account.id;
    }
    delete data.account_name;
  }

  // Resolve category name to ID if provided
  if (data.category_name) {
    const category = await accountsRepo.findByName(data.category_name);
    if (category) {
      data.category_id = category.id;
    }
    delete data.category_name;
  }

  return repo.update(id, data);
}

// ---------------------------------------------------------------------------
// Report-shaping endpoints (previously route-inlined SQL)
// ---------------------------------------------------------------------------

/**
 * Budget vs actual aggregated by month (v1-compatible response format).
 */
async function getSummary(query) {
  const {
    fromMonth = 1,
    toMonth = 12,
    actualYear,
    budgetYear,
    category,
    categories,
    account,
    accounts
  } = query;

  const currentYear = new Date().getFullYear();
  const parsedActualYear = actualYear ? parseInt(actualYear) : currentYear;
  const parsedBudgetYear = budgetYear ? parseInt(budgetYear) : currentYear;
  const parsedFromMonth = parseInt(fromMonth) || 1;
  const parsedToMonth = parseInt(toMonth) || 12;

  // Handle category/categories as array
  const categoryList = categories
    ? (Array.isArray(categories) ? categories : [categories])
    : (category ? (Array.isArray(category) ? category : [category]) : []);

  // Handle account/accounts as array
  const accountList = accounts
    ? (Array.isArray(accounts) ? accounts : [accounts])
    : (account ? (Array.isArray(account) ? account : [account]) : []);

  // Build category filter condition
  let categoryFilter = '';
  const categoryParams = [];
  if (categoryList.length > 0) {
    const placeholders = categoryList.map((_, i) => `$${i + 1}`).join(', ');
    categoryFilter = `AND c.name IN (${placeholders})`;
    categoryParams.push(...categoryList);
  }

  // Build account filter condition
  let accountFilter = '';
  const accountParams = [];
  if (accountList.length > 0) {
    const startIdx = categoryParams.length + 1;
    const placeholders = accountList.map((_, i) => `$${startIdx + i}`).join(', ');
    accountFilter = `AND a.name IN (${placeholders})`;
    accountParams.push(...accountList);
  }

  const baseParams = [...categoryParams, ...accountParams];

  // Query actual transactions by month
  const actualSql = `
    SELECT
      EXTRACT(MONTH FROM t.transaction_date)::int as month,
      SUM(t.base_amount) as total
    FROM transactions t
    LEFT JOIN accounts c ON t.category_id = c.id
    LEFT JOIN accounts a ON t.account_id = a.id
    WHERE EXTRACT(YEAR FROM t.transaction_date) = $${baseParams.length + 1}
      AND EXTRACT(MONTH FROM t.transaction_date) >= $${baseParams.length + 2}
      AND EXTRACT(MONTH FROM t.transaction_date) <= $${baseParams.length + 3}
      ${categoryFilter}
      ${accountFilter}
    GROUP BY EXTRACT(MONTH FROM t.transaction_date)
  `;

  // Query budget entries by month
  const budgetSql = `
    SELECT
      EXTRACT(MONTH FROM e.entry_date)::int as month,
      SUM(e.base_amount) as total
    FROM budget_entries e
    LEFT JOIN accounts c ON e.category_id = c.id
    LEFT JOIN accounts a ON e.account_id = a.id
    WHERE e.budget_year = $${baseParams.length + 1}
      AND EXTRACT(MONTH FROM e.entry_date) >= $${baseParams.length + 2}
      AND EXTRACT(MONTH FROM e.entry_date) <= $${baseParams.length + 3}
      ${categoryFilter}
      ${accountFilter}
    GROUP BY EXTRACT(MONTH FROM e.entry_date)
  `;

  const [actualResult, budgetResult] = await Promise.all([
    db.query(actualSql, [...baseParams, parsedActualYear, parsedFromMonth, parsedToMonth]),
    db.query(budgetSql, [...baseParams, parsedBudgetYear, parsedFromMonth, parsedToMonth])
  ]);

  // Build month -> total maps
  const actualByMonth = {};
  for (const row of actualResult.rows) {
    actualByMonth[row.month] = parseFloat(row.total) || 0;
  }

  const budgetByMonth = {};
  for (const row of budgetResult.rows) {
    budgetByMonth[row.month] = parseFloat(row.total) || 0;
  }

  return {
    months: buildMonthSequence(parsedFromMonth, parsedToMonth),
    fromMonth: parsedFromMonth,
    toMonth: parsedToMonth,
    actualYear: parsedActualYear,
    budgetYear: parsedBudgetYear,
    actualByMonth,
    budgetByMonth
  };
}

/**
 * Income and Expense category groups from the COA (for filter dropdowns).
 */
async function getCategoryGroups() {
  const tree = await accountsRepo.getNestedTree({ section: 'profit_loss' });
  const groups = { Income: [], Expense: [] };

  if (!tree || tree.length === 0) {
    return groups;
  }

  // Unwrap section root
  const root = tree.find(n => n.name === 'Profit & Loss Accounts');
  const structure = root && root.children.length > 0 ? root.children : tree;

  // Collect leaf category names from a { name, children } tree
  const collectLeaves = (nodes, targetGroup) => {
    for (const node of nodes) {
      if (!node.children || node.children.length === 0) {
        targetGroup.push(node.name);
      } else {
        collectLeaves(node.children, targetGroup);
      }
    }
  };

  // Find Income and Expense sections
  for (const node of structure) {
    const lowerName = node.name.toLowerCase();
    if (lowerName.includes('income') || lowerName.includes('revenue')) {
      collectLeaves(node.children || [], groups.Income);
    } else if (lowerName.includes('expense') || lowerName.includes('cost')) {
      collectLeaves(node.children || [], groups.Expense);
    }
  }

  return groups;
}

/**
 * List budget entries in v1-compatible shape (proxy for GET /api/v2/budget).
 */
async function listBudgetEntriesV1(query) {
  const {
    year, month, category, account, categories, accounts,
    fromDate, toDate, currency, limit = 1000, offset = 0
  } = query;

  // Handle category/categories as array
  const categoryNames = categories
    ? (Array.isArray(categories) ? categories : [categories])
    : (category ? (Array.isArray(category) ? category : [category]) : undefined);

  // Handle account/accounts as array
  const accountNames = accounts
    ? (Array.isArray(accounts) ? accounts : [accounts])
    : (account ? (Array.isArray(account) ? account : [account]) : undefined);

  const entries = await repo.findAllExtended({
    year: year ? parseInt(year) : undefined,
    month: month ? parseInt(month) : undefined,
    startDate: fromDate,
    endDate: toDate,
    categoryNames,
    accountNames,
    currency,
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  // Transform to v1 format if needed
  return entries.map(entry => ({
    ...entry,
    _id: entry.id,
    Date: entry.entry_date,
    Description1: entry.description,
    Amount: entry.amount,
    Currency: entry.currency,
    BaseAmount: entry.base_amount,
    BaseCurrency: entry.base_currency,
    Account: entry.account_name,
    Category: entry.category_name,
    Note: entry.note,
  }));
}

/**
 * Actual transaction entries for budget comparison (v1-compatible shape).
 */
async function getActualEntries(query) {
  const {
    actualYear, month, fromMonth, toMonth,
    fromDate, toDate,
    category, categories, account, accounts,
    limit = 1000
  } = query;

  const currentYear = new Date().getFullYear();

  // Handle category/categories as array
  const categoryList = categories
    ? (Array.isArray(categories) ? categories : [categories])
    : (category ? (Array.isArray(category) ? category : [category]) : []);

  // Handle account/accounts as array
  const accountList = accounts
    ? (Array.isArray(accounts) ? accounts : [accounts])
    : (account ? (Array.isArray(account) ? account : [account]) : []);

  let sql = `
    SELECT t.*, c.name as category_name, a.name as account_name
    FROM transactions t
    LEFT JOIN accounts c ON t.category_id = c.id
    LEFT JOIN accounts a ON t.account_id = a.id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;

  // Date filter — prefer an explicit fromDate/toDate range (may span years);
  // fall back to single-year actualYear + month/month-range for legacy callers.
  if (fromDate || toDate) {
    if (fromDate) {
      sql += ` AND t.transaction_date >= $${paramIndex++}`;
      params.push(fromDate);
    }
    if (toDate) {
      // toDate is the exclusive upper bound (first day after the range)
      sql += ` AND t.transaction_date < $${paramIndex++}`;
      params.push(toDate);
    }
  } else {
    const year = actualYear ? parseInt(actualYear) : currentYear;
    sql += ` AND EXTRACT(YEAR FROM t.transaction_date) = $${paramIndex++}`;
    params.push(year);

    // Month filter
    if (month) {
      sql += ` AND EXTRACT(MONTH FROM t.transaction_date) = $${paramIndex++}`;
      params.push(parseInt(month));
    } else if (fromMonth && toMonth) {
      sql += ` AND EXTRACT(MONTH FROM t.transaction_date) >= $${paramIndex++}`;
      params.push(parseInt(fromMonth));
      sql += ` AND EXTRACT(MONTH FROM t.transaction_date) <= $${paramIndex++}`;
      params.push(parseInt(toMonth));
    }
  }

  // Category filter
  if (categoryList.length > 0) {
    const placeholders = categoryList.map((_, i) => `$${paramIndex + i}`).join(', ');
    sql += ` AND c.name IN (${placeholders})`;
    params.push(...categoryList);
    paramIndex += categoryList.length;
  }

  // Account filter
  if (accountList.length > 0) {
    const placeholders = accountList.map((_, i) => `$${paramIndex + i}`).join(', ');
    sql += ` AND a.name IN (${placeholders})`;
    params.push(...accountList);
    paramIndex += accountList.length;
  }

  sql += ` ORDER BY t.transaction_date DESC`;

  if (limit) {
    sql += ` LIMIT $${paramIndex}`;
    params.push(parseInt(limit));
  }

  const result = await db.query(sql, params);

  // Transform to v1 format
  return result.rows.map(row => ({
    _id: row.id,
    Date: row.transaction_date,
    Description1: row.description,
    Amount: parseFloat(row.amount),
    Currency: row.currency,
    BaseAmount: parseFloat(row.base_amount),
    BaseCurrency: row.base_currency,
    Account: row.account_name,
    Category: row.category_name,
    Note: row.note,
  }));
}

/**
 * Budget cash flow report in hierarchical COA structure. Callers must
 * pre-validate fromDate/toDate; this assumes valid YYYY-MM-DD dates.
 */
async function getCashFlow({ fromDate, toDate, transfers = 'exclude' }) {
  // Load COA structure from SQL
  const tree = await accountsRepo.getNestedTree({ section: 'profit_loss' });

  if (!tree || tree.length === 0) {
    return { 'Profit & Loss Accounts': [] };
  }

  // Unwrap the section root node (e.g. "Profit & Loss Accounts" → its children)
  const root = tree.find(n => n.name === 'Profit & Loss Accounts');
  const structure = root && root.children.length > 0 ? root.children : tree;

  // Extract transfer categories from structure
  const transferCategories = extractTransferCategories(structure);
  const transferCategorySet = transferCategories.length
    ? new Set(transferCategories.map(c => c.toLowerCase()))
    : new Set();

  // Fetch budget totals from PostgreSQL
  const budgetSql = `
    SELECT
      c.name as category_name,
      SUM(e.base_amount) as total_amount
    FROM budget_entries e
    JOIN accounts c ON e.category_id = c.id
    WHERE e.entry_date >= $1
      AND e.entry_date <= $2
    GROUP BY c.name
  `;

  const result = await db.query(budgetSql, [fromDate, toDate]);
  const budgetTotals = {};

  for (const row of result.rows) {
    const categoryName = row.category_name;
    const isTransfer = transferCategorySet.has(categoryName.toLowerCase());

    // Apply transfer filtering
    if (transfers === 'exclude' && isTransfer) continue;
    if (transfers === 'only' && !isTransfer) continue;

    budgetTotals[categoryName] = parseFloat(row.total_amount) || 0;
  }

  // Build hierarchical tree structure
  const nodes = [];
  for (const item of structure) {
    const node = buildBudgetCashFlowNode(item, budgetTotals, transfers, transferCategorySet);
    if (node) {
      nodes.push(node);
    }
  }

  return { 'Profit & Loss Accounts': nodes };
}

module.exports = {
  // helpers exported for the route layer's validation guards
  isValidDateString,
  // entry orchestration
  createEntries,
  updateEntry,
  // report-shaping endpoints
  getSummary,
  getCategoryGroups,
  listBudgetEntriesV1,
  getActualEntries,
  getCashFlow,
};
