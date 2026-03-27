/**
 * Transaction Configuration
 * Parameterizes all differences between actual and budget transaction pages.
 */

// ---------- Shared helpers ----------

const appendListParam = (params, key, values) => {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  list.forEach((value) => {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, String(value));
    }
  });
};

const setParam = (params, key, value) => {
  if (value !== undefined && value !== null && value !== "") {
    params.set(key, String(value));
  }
};

/**
 * Builds fromDate/toDate ISO params from year/month filter values.
 * Used by budget endpoints that expect date ranges instead of year/month.
 */
const buildDateRangeParams = (query, filters) => {
  if (!filters.yearEnabled || !filters.year) return;
  const year = Number.parseInt(filters.year, 10);
  if (!Number.isFinite(year)) return;

  let fromMonth = 1;
  let toMonth = 12;
  if (
    filters.monthEnabled &&
    filters.month !== undefined &&
    filters.month !== null
  ) {
    const month = Number(filters.month);
    if (Number.isFinite(month) && month >= 0 && month <= 11) {
      fromMonth = month + 1;
      toMonth = month + 1;
    }
  } else if (filters.fromMonth && filters.toMonth) {
    // Month range from PeriodSelector
    const fm = Number(filters.fromMonth);
    const tm = Number(filters.toMonth);
    if (Number.isFinite(fm) && Number.isFinite(tm)) {
      fromMonth = fm;
      toMonth = tm;
    }
  }
  const fromDate = new Date(Date.UTC(year, fromMonth - 1, 1));
  const toDate = new Date(Date.UTC(year, toMonth, 1));
  query.set("fromDate", fromDate.toISOString());
  query.set("toDate", toDate.toISOString());
};

/**
 * Appends common filter params (account, category, currency) shared by both variants.
 */
const appendCommonFilterParams = (query, filters) => {
  if (filters.accountEnabled && filters.account) {
    appendListParam(query, "account", filters.account);
  }
  if (filters.categoryEnabled && filters.category) {
    appendListParam(query, "category", filters.category);
  }
  if (filters.currencyEnabled && filters.currency) {
    const curr = Array.isArray(filters.currency)
      ? filters.currency[0]
      : filters.currency;
    query.set("currency", curr);
  }
};

// ---------- Actual Config ----------

export const ACTUAL_CONFIG = {
  // API endpoints
  endpoint: "/api/v2/transactions",
  totalsEndpoint: "/api/v2/budget/actual-entries",

  // Edit field definitions (Amount, Currency, Account are PS-sourced and not editable)
  editFields: [
    { key: "Date", label: "Date", type: "date" },
    { key: "Description1", label: "Description", type: "text" },
    { key: "Category", label: "Category", type: "text" },
  ],

  // Default filter state
  defaultFilters: {
    yearEnabled: true,
    monthEnabled: true,
    accountEnabled: false,
    categoryEnabled: false,
    descriptionEnabled: false,
    currencyEnabled: false,
    year: new Date().getFullYear().toString(),
    month: new Date().getMonth(),
    fromMonth: String(new Date().getMonth() + 1).padStart(2, "0"),
    toMonth: String(new Date().getMonth() + 1).padStart(2, "0"),
    account: [],
    category: [],
    currency: [],
    description: "",
    valueFromEnabled: false,
    valueToEnabled: false,
    valueFrom: null,
    valueTo: null,
  },

  // Filter UI behavior
  yearAlwaysEnabled: true,
  hasDescriptionFilter: true,
  hasClientSideFiltering: true,

  // Build query params for loading transactions
  buildFilterQuery(query, filters, fetchLimit) {
    if (filters.yearEnabled && filters.year) {
      query.set("year", filters.year);
    }
    if (
      filters.monthEnabled &&
      filters.month !== undefined &&
      filters.month !== null
    ) {
      query.set("month", filters.month + 1);
    }
    // Month range support: send only year, client-side handles range filtering
    appendCommonFilterParams(query, filters);
    if (filters.descriptionEnabled && filters.description) {
      query.set("description", filters.description);
    }
    if (
      filters.valueFromEnabled &&
      typeof filters.valueFrom === "number" &&
      Number.isFinite(filters.valueFrom)
    ) {
      query.set("minAmount", filters.valueFrom);
    }
    if (
      filters.valueToEnabled &&
      typeof filters.valueTo === "number" &&
      Number.isFinite(filters.valueTo)
    ) {
      query.set("maxAmount", filters.valueTo);
    }
    if (filters.transferMatched !== undefined && filters.transferMatched !== "") {
      query.set("transferMatched", filters.transferMatched);
    }
    query.set("limit", fetchLimit);
  },

  // Build query params for totals
  buildTotalsQuery(query, filters) {
    if (filters.yearEnabled && filters.year) {
      setParam(query, "actualYear", filters.year);
    }
    if (
      filters.monthEnabled &&
      filters.month !== undefined &&
      filters.month !== null
    ) {
      setParam(query, "month", filters.month + 1);
    }
    if (filters.accountEnabled && filters.account) {
      appendListParam(query, "account", filters.account);
    }
    if (filters.categoryEnabled && filters.category) {
      appendListParam(query, "category", filters.category);
    }
    if (filters.currencyEnabled && filters.currency) {
      appendListParam(query, "currency", filters.currency);
    }
    if (filters.descriptionEnabled && filters.description) {
      setParam(query, "description", filters.description);
    }
    if (
      filters.valueFromEnabled &&
      typeof filters.valueFrom === "number" &&
      Number.isFinite(filters.valueFrom)
    ) {
      setParam(query, "valueFrom", filters.valueFrom);
    }
    if (
      filters.valueToEnabled &&
      typeof filters.valueTo === "number" &&
      Number.isFinite(filters.valueTo)
    ) {
      setParam(query, "valueTo", filters.valueTo);
    }
    setParam(query, "limit", 2000);
  },

  // Transform API response entry to component format
  transformEntry(txn) {
    return {
      _id: String(txn.id),
      id: txn.id,
      ps_id: txn.ps_id,
      Date: txn.transaction_date,
      Description1: txn.description1,
      Description2: txn.description2,
      Amount: parseFloat(txn.amount),
      Currency: txn.currency,
      BaseAmount: parseFloat(txn.base_amount),
      BaseCurrency: txn.base_currency,
      Account: txn.account_name,
      account_id: txn.account_id,
      Category: txn.category_name,
      category_id: txn.category_id,
      ClosingBalance: txn.closing_balance
        ? parseFloat(txn.closing_balance)
        : null,
      Labels: txn.labels,
      Memo: txn.memo,
      Note: txn.note,
      Bank: txn.bank,
      Source: txn.source,
      TransferMatched: txn.transfer_matched,
    };
  },

  // Parse totals response
  parseTotalsEntries(payload) {
    return Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.entries)
        ? payload.entries
        : [];
  },
  getTotalsCurrency(entry) {
    return entry?.Currency || "Unknown";
  },
  getTotalsAmount(entry) {
    return Number(entry?.Amount);
  },

  // Messages
  editSuccessMessage: "Transactions updated successfully",
  deleteSuccessMessage: "Transactions deleted successfully",
  loadErrorMessage: "Failed to load transactions from PostgreSQL",
  logPrefix: "TransActual",
};

// ---------- Review Config (RefreshPS new-transaction review) ----------

export const REVIEW_CONFIG = {
  endpoint: "/api/v2/transactions",

  editFields: [
    { key: "Date", label: "Date", type: "date" },
    { key: "Description1", label: "Description", type: "text" },
    { key: "Category", label: "Category", type: "text" },
  ],

  transformEntry(txn) {
    // id may be null if the record hasn't been synced to transactions yet
    // pg driver returns BIGSERIAL as string, so parse to number
    const parsedId = txn.id != null ? Number(txn.id) : null;
    const safeId = Number.isFinite(parsedId) ? parsedId : null;
    const entryId = safeId != null ? safeId : `ps-${txn.ps_id}`;
    return {
      _id: String(entryId),
      id: safeId,
      ps_id: txn.ps_id,
      Date: txn.transaction_date,
      Description1: txn.description1,
      Description2: txn.description2,
      Amount: parseFloat(txn.amount),
      Currency: txn.currency,
      BaseAmount: parseFloat(txn.base_amount),
      BaseCurrency: txn.base_currency,
      Account: txn.account_name,
      account_id: txn.account_id,
      Category: txn.category_name,
      category_id: txn.category_id,
      ClosingBalance: txn.closing_balance
        ? parseFloat(txn.closing_balance)
        : null,
      Labels: txn.labels,
      Memo: txn.memo,
      Note: txn.note,
      Bank: txn.bank,
      Source: txn.source,
    };
  },

  editSuccessMessage: "Transactions updated successfully",
  logPrefix: "ReviewNew",
};

// ---------- Ledger Config ----------

export const LEDGER_CONFIG = {
  // API endpoint — reuses the existing transactions endpoint
  endpoint: "/api/v2/transactions",

  // No totals needed for ledger view
  totalsEndpoint: null,

  // Read-only report — no editing
  editFields: [],

  // Default filter state — requires an account to be selected
  defaultFilters: {
    yearEnabled: false,
    monthEnabled: false,
    accountEnabled: false,
    categoryEnabled: false,
    currencyEnabled: false,
    year: "",
    month: "",
    fromMonth: "",
    toMonth: "",
    account: [],
    category: [],
    currency: [],
    valueFromEnabled: false,
    valueToEnabled: false,
    valueFrom: null,
    valueTo: null,
  },

  // Filter UI behavior
  yearAlwaysEnabled: false,
  hasDescriptionFilter: false,
  hasClientSideFiltering: false,

  // Build query params — fetch all transactions for selected account, no date limit by default
  buildFilterQuery(query, filters, fetchLimit) {
    appendCommonFilterParams(query, filters);
    if (filters.yearEnabled && filters.year) {
      buildDateRangeParams(query, filters);
    }
    query.set("limit", fetchLimit);
  },

  // No totals query needed
  buildTotalsQuery() {},

  // Transform API response entry to component format (same as ACTUAL_CONFIG)
  transformEntry(txn) {
    return {
      _id: String(txn.id),
      id: txn.id,
      ps_id: txn.ps_id,
      Date: txn.transaction_date,
      Description1: txn.description1,
      Description2: txn.description2,
      Amount: parseFloat(txn.amount),
      Currency: txn.currency,
      BaseAmount: parseFloat(txn.base_amount),
      BaseCurrency: txn.base_currency,
      Account: txn.account_name,
      account_id: txn.account_id,
      Category: txn.category_name,
      category_id: txn.category_id,
      ClosingBalance: txn.closing_balance
        ? parseFloat(txn.closing_balance)
        : null,
      Labels: txn.labels,
      Memo: txn.memo,
      Note: txn.note,
      Bank: txn.bank,
      Source: txn.source,
    };
  },

  // No totals parsing needed
  parseTotalsEntries() { return []; },
  getTotalsCurrency() { return "Unknown"; },
  getTotalsAmount() { return 0; },

  // Messages
  editSuccessMessage: "",
  deleteSuccessMessage: "",
  loadErrorMessage: "Failed to load ledger transactions",
  logPrefix: "Ledger",
};

// ---------- Budget Config ----------

export const BUDGET_CONFIG = {
  // API endpoints
  endpoint: "/api/v2/budget/entries",
  totalsEndpoint: "/api/v2/budget/entries",

  // Edit field definitions
  editFields: [
    { key: "Date", label: "Date", type: "date" },
    { key: "Description1", label: "Description", type: "text" },
    { key: "Amount", label: "LC Amount", type: "number" },
    { key: "Currency", label: "Currency", type: "text" },
    { key: "BaseAmount", label: "USD Amount", type: "number" },
    { key: "Account", label: "Account", type: "text" },
    { key: "Category", label: "Category", type: "text" },
  ],

  // Default filter state
  defaultFilters: {
    yearEnabled: true,
    monthEnabled: false,
    accountEnabled: false,
    categoryEnabled: false,
    currencyEnabled: false,
    year: new Date().getFullYear().toString(),
    month: "",
    fromMonth: "01",
    toMonth: "12",
    account: [],
    category: [],
    currency: [],
    valueFromEnabled: false,
    valueToEnabled: false,
    valueFrom: null,
    valueTo: null,
  },

  // Filter UI behavior
  yearAlwaysEnabled: false,
  hasDescriptionFilter: false,
  hasClientSideFiltering: false,

  // Build query params for loading transactions
  buildFilterQuery(query, filters, fetchLimit) {
    buildDateRangeParams(query, filters);
    appendCommonFilterParams(query, filters);
    query.set("limit", fetchLimit);
  },

  // Build query params for totals
  buildTotalsQuery(query, filters) {
    buildDateRangeParams(query, filters);
    if (filters.accountEnabled && filters.account) {
      appendListParam(query, "account", filters.account);
    }
    if (filters.categoryEnabled && filters.category) {
      appendListParam(query, "category", filters.category);
    }
    if (filters.currencyEnabled && filters.currency) {
      appendListParam(query, "currency", filters.currency);
    }
    setParam(query, "limit", 2000);
  },

  // Transform API response entry to component format
  transformEntry(entry) {
    return {
      _id: String(entry.id),
      id: entry.id,
      Date: entry.entry_date,
      Description1: entry.description,
      Amount: parseFloat(entry.amount),
      Currency: entry.currency,
      BaseAmount: parseFloat(entry.base_amount),
      BaseCurrency: entry.base_currency,
      Account: entry.account_name,
      account_id: entry.account_id,
      Category: entry.category_name,
      category_id: entry.category_id,
      Labels: entry.labels,
      Note: entry.note,
      version_id: entry.version_id,
      version_name: entry.version_name,
      budget_year: entry.budget_year,
    };
  },

  // Parse totals response
  parseTotalsEntries(payload) {
    return Array.isArray(payload?.data) ? payload.data : [];
  },
  getTotalsCurrency(entry) {
    return entry?.currency || "Unknown";
  },
  getTotalsAmount(entry) {
    return Number(entry?.amount);
  },

  // Messages
  editSuccessMessage: "Budget entries updated successfully",
  deleteSuccessMessage: "Budget entries deleted successfully",
  loadErrorMessage: "Failed to load budget transactions from PostgreSQL",
  logPrefix: "TransBudget",
};
