import { useEffect, useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
import BudgetEntriesAtualPopup from "../features/BudgetEntry/BudgetEntriesAtualPopup.jsx";
import BudgetEntriesBudgetPopup from "../features/BudgetEntry/BudgetEntriesBudgetPopup.jsx";
import BudgetRegionBalances from "../features/BudgetEntry/BudgetRegionBalances.jsx";
import BudgetRegionSelectors from "../features/BudgetEntry/BudgetRegionSelectors.jsx";
import BudgetRegionBudgetEntry from "../features/BudgetEntry/BudgetRegionBudgetEntry.jsx";
import "./PageLayout.css";

// ============================================================================
// CONSTANTS
// ============================================================================
/**
 * Month selection options with zero-padded values
 */
const MONTH_OPTIONS = [
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

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTION_COUNT = 6;

/**
 * Returns the accounts selected by the user excluding the "All" option.
 * @param {string[]|undefined} values - Selected account values.
 * @returns {string[]} Filtered list of account names.
 */
const getSelectedAccountFilters = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((value) => value && value !== "All");
};

/**
 * Builds an array of year options
 * @param {number} startYear - Starting year
 * @param {number} step - Increment/decrement step
 * @returns {number[]} Array of year values
 */
const buildYearOptions = (startYear, step) =>
  Array.from(
    { length: YEAR_OPTION_COUNT },
    (_, index) => startYear + step * index
  );

const YEAR_OPTIONS = buildYearOptions(CURRENT_YEAR, -1);
const BUDGET_YEAR_OPTIONS = buildYearOptions(CURRENT_YEAR - 1, 1);

const BASE_CURRENCY = "USD";

const DEFAULT_ACCOUNT_OPTIONS = [
  "All",
  "Checking",
  "Savings",
  "Credit Card",
  "Investments",
  "Payables",
];

const DEFAULT_CATEGORY_OPTIONS = [
  "Revenue",
  "Cost of Goods Sold",
  "Operating Expenses",
  "Investments",
  "Other Income",
];

// Category group identifiers
const CATEGORY_GROUP_INCOME = "__group__income";
const CATEGORY_GROUP_EXPENSE = "__group__expense";
const CATEGORY_GROUP_EXPENSE_OPERATIONAL = "__group__expense_operational";

const CATEGORY_GROUP_LABELS = {
  [CATEGORY_GROUP_INCOME]: "Income (all)",
  [CATEGORY_GROUP_EXPENSE]: "Expense (all)",
  [CATEGORY_GROUP_EXPENSE_OPERATIONAL]: "Expense (operational)",
};

const OPERATIONAL_EXPENSE_EXCLUDED_VALUES = new Set([
  "unrealized g/l",
  "unrealized gains/losses",
  "fx",
]);

// ============================================================================
// UTILITY FUNCTIONS - Array Operations
// ============================================================================

/**
 * Ensures "All" option is first in the array and removes duplicates
 * @param {string[]} values - Array of option values
 * @returns {string[]} Normalized array with "All" first
 */
const ensureAllOption = (values) => {
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
const normalizeCurrencyOptions = (values) => {
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

// ============================================================================
// UTILITY FUNCTIONS - Category Operations
// ============================================================================

/**
 * Checks if a category should be excluded from operational expenses
 * @param {string} value - Category name to check
 * @returns {boolean} True if category should be excluded
 */
const isOperationalExpenseExcluded = (value) => {
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
const getOperationalExpenseCategories = (values) => {
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
const isCategoryGroupValue = (value) =>
  value === CATEGORY_GROUP_INCOME ||
  value === CATEGORY_GROUP_EXPENSE ||
  value === CATEGORY_GROUP_EXPENSE_OPERATIONAL;

/**
 * Gets the display label for a category value
 * @param {string} value - Category value or group identifier
 * @returns {string} Display label
 */
const getCategoryDisplayLabel = (value) =>
  CATEGORY_GROUP_LABELS[value] ?? value;

/**
 * Expands category group selections into individual categories
 * @param {string[]} values - Selected category values (may include group identifiers)
 * @param {string[]} expenseCategories - All expense categories
 * @param {string[]} operationalExpenseCategories - Filtered operational expense categories
 * @param {Object} categoryGroups - Category groups object with Income and Expense arrays
 * @returns {string[]} Expanded array of individual category names
 */
const expandSelectedCategories = (
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
const normalizeCurrencyCode = (value) => {
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
const buildBudgetRateMap = (doc) => {
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
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/**
 * Formats a currency value with proper sign handling
 * @param {number} value - Numeric value to format
 * @returns {string} Formatted currency string (negative values in parentheses)
 */
const formatCurrencyValue = (value) => {
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
const normalizeMonthNumber = (value, fallback) => {
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
const buildMonthSequence = (fromValue, toValue) => {
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
const getMonthLabel = (monthNumber) => {
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
const normalizeTextInput = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

/**
 * Parses numeric input and validates it's finite
 * @param {*} value - Input value to parse
 * @returns {number|undefined} Parsed number or undefined if invalid
 */
const parseNumericInput = (value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * BudgetInput - Main budget input and management page
 *
 * This component provides functionality for:
 * - Viewing actual vs budget balances by month
 * - Creating and editing budget entries
 * - Filtering by accounts and categories
 * - Multi-currency support with exchange rates
 */
export default function BudgetInput() {
  // ========== State: Date Range ==========
  const [fromMonth, setFromMonth] = useState(MONTH_OPTIONS[0].value);
  const [toMonth, setToMonth] = useState(MONTH_OPTIONS[11].value);
  const [actualYear, setActualYear] = useState(YEAR_OPTIONS[0]);
  const [budgetYear, setBudgetYear] = useState(BUDGET_YEAR_OPTIONS[2]);

  // ========== State: Filter Options ==========
  const [accountOptions, setAccountOptions] = useState(DEFAULT_ACCOUNT_OPTIONS);
  const [categoryOptions, setCategoryOptions] = useState(
    DEFAULT_CATEGORY_OPTIONS
  );
  const [selectedAccounts, setSelectedAccounts] = useState(["All"]);
  const [selectedCategories, setSelectedCategories] = useState([
    CATEGORY_GROUP_EXPENSE,
  ]);
  const [categoryGroups, setCategoryGroups] = useState({
    Income: [],
    Expense: [],
  });

  // ========== State: Balance Data ==========
  const [balanceRows, setBalanceRows] = useState([]);
  const [balancesStatus, setBalancesStatus] = useState({
    loading: true,
    error: "",
  });
  const [balancesRefreshKey, setBalancesRefreshKey] = useState(0);

  // ========== State: Entry Form ==========
  const [entryForm, setEntryForm] = useState({
    date: "",
    description: "",
    account: "None",
    category: "",
    amount: "",
    currency: "USD",
    note: "",
  });
  const [entryStatus, setEntryStatus] = useState({
    loading: false,
    error: "",
    message: "",
  });

  // ========== State: Currency ==========
  const [currencyOptions, setCurrencyOptions] = useState([BASE_CURRENCY]);
  const [budgetRates, setBudgetRates] = useState({ USD: 1 });

  // ========== State: Popups ==========
  const [actualEntriesPopupRequest, setActualEntriesPopupRequest] =
    useState(null);
  const [budgetEntriesPopupRequest, setBudgetEntriesPopupRequest] =
    useState(null);

  // ========== Computed Values ==========

  // Filtered account options (excludes "All")
  const filteredAccountOptions = useMemo(
    () =>
      accountOptions.filter(
        (option) => option && option.toLowerCase() !== "all"
      ),
    [accountOptions]
  );

  // Operational expense categories (excludes transfers, unrealized gains, etc.)
  const operationalExpenseCategories = useMemo(
    () => getOperationalExpenseCategories(categoryGroups?.Expense),
    [categoryGroups]
  );

  // Category group select options with dynamic disabled state
  const categoryGroupSelectOptions = useMemo(() => {
    return [
      {
        value: CATEGORY_GROUP_INCOME,
        label: CATEGORY_GROUP_LABELS[CATEGORY_GROUP_INCOME],
        disabled: !categoryGroups?.Income?.length,
        className: "category-group-option category-group-option--income",
      },
      {
        value: CATEGORY_GROUP_EXPENSE,
        label: CATEGORY_GROUP_LABELS[CATEGORY_GROUP_EXPENSE],
        disabled: !categoryGroups?.Expense?.length,
        className: "category-group-option category-group-option--expense",
      },
      {
        value: CATEGORY_GROUP_EXPENSE_OPERATIONAL,
        label: CATEGORY_GROUP_LABELS[CATEGORY_GROUP_EXPENSE_OPERATIONAL],
        disabled: !operationalExpenseCategories.length,
        className:
          "category-group-option category-group-option--expense category-group-option--expense-operational",
      },
    ];
  }, [categoryGroups, operationalExpenseCategories]);

  // Active month range (normalized to ensure start <= end)
  const activeMonthRange = useMemo(() => {
    const start = normalizeMonthNumber(fromMonth, 1);
    const end = normalizeMonthNumber(toMonth, 12);
    if (start <= end) {
      return { start, end };
    }
    return { start: end, end: start };
  }, [fromMonth, toMonth]);

  // Month select options for the entry form (includes "All" option)
  const monthSelectOptions = useMemo(() => {
    const yearNumber = Number(budgetYear);
    if (!Number.isFinite(yearNumber)) {
      return [];
    }

    const paddedYear = String(Math.floor(yearNumber)).padStart(4, "0");
    const { start, end } = activeMonthRange;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return [];
    }

    const options = [];
    for (let month = start; month <= end; month += 1) {
      const label = getMonthLabel(month);
      const paddedMonth = String(month).padStart(2, "0");
      options.push({
        value: `${paddedYear}-${paddedMonth}`,
        label: `${label} ${paddedYear}`,
      });
    }

    if (!options.length) {
      return [];
    }

    return [{ value: "All", label: "All" }, ...options];
  }, [activeMonthRange, budgetYear]);

  // Derived category value from selected categories
  const derivedCategoryValue = useMemo(() => {
    const normalizedSelections = Array.isArray(selectedCategories)
      ? selectedCategories.filter(Boolean)
      : [];

    const meaningfulSelections = normalizedSelections.filter(
      (category) =>
        typeof category === "string" &&
        category.trim().length &&
        category.toLowerCase() !== "all"
    );

    // Prefer explicit category over group category
    const explicitCategory = meaningfulSelections.find(
      (category) => !isCategoryGroupValue(category)
    );
    if (explicitCategory) {
      return explicitCategory;
    }

    const groupCategory = meaningfulSelections.find((category) =>
      isCategoryGroupValue(category)
    );
    if (groupCategory) {
      return groupCategory;
    }

    return categoryOptions.length ? categoryOptions[0] : "";
  }, [selectedCategories, categoryOptions]);

  const derivedCategoryLabel = getCategoryDisplayLabel(derivedCategoryValue);
  const derivedCategoryIsGroup = isCategoryGroupValue(derivedCategoryValue);

  // Expanded selected categories (groups expanded to individual categories)
  const expandedSelectedCategories = useMemo(
    () =>
      expandSelectedCategories(
        selectedCategories,
        categoryGroups?.Expense,
        operationalExpenseCategories,
        categoryGroups
      ),
    [selectedCategories, categoryGroups, operationalExpenseCategories]
  );

  // Current exchange rate based on selected currency
  const currentExchangeRate = useMemo(() => {
    const normalizedCurrency = normalizeCurrencyCode(entryForm.currency);
    if (!normalizedCurrency) {
      return undefined;
    }
    if (normalizedCurrency === BASE_CURRENCY) {
      return 1;
    }
    const rate = budgetRates[normalizedCurrency];
    return Number.isFinite(rate) ? rate : undefined;
  }, [entryForm.currency, budgetRates]);

  // Computed base amount (converted to USD)
  const computedBaseAmount = useMemo(() => {
    const parsedAmount = parseNumericInput(entryForm.amount);
    if (!Number.isFinite(parsedAmount)) {
      return undefined;
    }
    if (!Number.isFinite(currentExchangeRate)) {
      return undefined;
    }
    return parsedAmount / currentExchangeRate;
  }, [entryForm.amount, currentExchangeRate]);

  // ========== Effects: Initialization ==========

  // Set default month when month options change
  useEffect(() => {
    if (!monthSelectOptions.length) {
      return;
    }

    const defaultOption =
      monthSelectOptions.find((option) => option.value !== "All") ??
      monthSelectOptions[0];

    setEntryForm((previous) => {
      if (
        previous.date &&
        monthSelectOptions.some((option) => option.value === previous.date)
      ) {
        return previous;
      }
      return { ...previous, date: defaultOption?.value ?? "" };
    });
  }, [monthSelectOptions]);

  useEffect(() => {
    let isActive = true;

    const loadFilters = async () => {
      try {
        const [psOptions, categoryGroupPayload] = await Promise.all([
          Rest.fetchPsDataOptions(),
          Rest.fetchCategoryGroups(),
        ]);
        if (!isActive) {
          return;
        }

        const { accounts = [], categories = [] } = psOptions ?? {};

        if (Array.isArray(accounts)) {
          setAccountOptions(ensureAllOption(accounts));
        }

        if (Array.isArray(categories) && categories.length) {
          setCategoryOptions(categories);
        }

        setCategoryGroups({
          Income: Array.isArray(categoryGroupPayload?.Income)
            ? categoryGroupPayload.Income
            : [],
          Expense: Array.isArray(categoryGroupPayload?.Expense)
            ? categoryGroupPayload.Expense
            : [],
        });
      } catch (error) {
        console.error("[BudgetInput] Failed to load psdata options:", error);
      }
    };

    loadFilters();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadCurrencyMetadata = async () => {
      try {
        const [currencyPayload, appDataPayload] = await Promise.all([
          Rest.fetchCurrencyOptions(),
          Rest.fetchJson("/api/util/getappdata"),
        ]);

        if (!isActive) {
          return;
        }

        const normalizedCurrencies = normalizeCurrencyOptions(
          currencyPayload?.currencies ?? []
        );
        setCurrencyOptions(
          normalizedCurrencies.length ? normalizedCurrencies : [BASE_CURRENCY]
        );

        const appDataDoc =
          Array.isArray(appDataPayload) && appDataPayload.length
            ? appDataPayload[0]
            : {};
        setBudgetRates(buildBudgetRateMap(appDataDoc));
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error("[BudgetInput] Failed to load currency metadata:", error);
        setCurrencyOptions([BASE_CURRENCY]);
        setBudgetRates({ USD: 1 });
      }
    };

    loadCurrencyMetadata();

    return () => {
      isActive = false;
    };
  }, []);

  // Update entry form category when derived category changes
  useEffect(() => {
    setEntryForm((previous) => {
      if (previous.category === derivedCategoryLabel) {
        return previous;
      }
      return { ...previous, category: derivedCategoryLabel };
    });
  }, [derivedCategoryLabel]);

  // Set default currency when currency options change
  useEffect(() => {
    if (!currencyOptions.length) {
      return;
    }
    setEntryForm((previous) => {
      if (currencyOptions.includes(previous.currency)) {
        return previous;
      }
      return { ...previous, currency: currencyOptions[0] };
    });
  }, [currencyOptions]);

  // ========== Event Handlers ==========

  /**
   * Handles account filter selection change
   */
  const handleAccountsChange = (event) => {
    const nextValues = Array.from(
      event.target.selectedOptions,
      (option) => option.value
    );
    setSelectedAccounts(nextValues);
  };

  /**
   * Handles category filter selection change
   */
  const handleCategoriesChange = (event) => {
    const nextValues = Array.from(
      event.target.selectedOptions,
      (option) => option.value
    );
    setSelectedCategories(nextValues);
  };

  /**
   * Handles budget entry form submission
   * Supports single month or all months in range
   */
  const handleBudgetEntrySubmit = async (event) => {
    event.preventDefault();
    setEntryStatus({ loading: true, error: "", message: "" });

    const normalizedCurrency = normalizeCurrencyCode(entryForm.currency);
    const isAllMonthsSelected = entryForm.date === "All";
    const payload = {
      Date:
        entryForm.date && entryForm.date !== "All"
          ? `${entryForm.date}-01`
          : undefined,
      Description1: normalizeTextInput(entryForm.description),
      Account: (() => {
        const normalized = normalizeTextInput(entryForm.account);
        return normalized && normalized.toLowerCase() === "none"
          ? undefined
          : normalized;
      })(),
      Category: normalizeTextInput(entryForm.category),
      Amount: parseNumericInput(entryForm.amount),
      BaseAmount: Number.isFinite(computedBaseAmount)
        ? computedBaseAmount
        : undefined,
      Currency: normalizedCurrency || undefined,
      BaseCurrency: BASE_CURRENCY,
      Note: normalizeTextInput(entryForm.note),
    };

    const sanitizedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    );

    if (!Object.keys(sanitizedPayload).length) {
      setEntryStatus({
        loading: false,
        error: "Please provide at least one valid value to submit.",
        message: "",
      });
      return;
    }

    let entriesToPersist = [];
    if (isAllMonthsSelected) {
      const budgetYearNumber = Number(budgetYear);
      if (!Number.isFinite(budgetYearNumber)) {
        setEntryStatus({
          loading: false,
          error: "Unable to resolve the budget year for the selected months.",
          message: "",
        });
        return;
      }

      const monthSequence = buildMonthSequence(
        activeMonthRange.start,
        activeMonthRange.end
      );
      if (!monthSequence.length) {
        setEntryStatus({
          loading: false,
          error: "No months are available for the current budget period.",
          message: "",
        });
        return;
      }

      const paddedYear = String(Math.floor(budgetYearNumber)).padStart(4, "0");
      const basePayload = { ...sanitizedPayload };
      delete basePayload.Date;

      entriesToPersist = monthSequence.map((monthNumber) => {
        const paddedMonth = String(monthNumber).padStart(2, "0");
        return {
          ...basePayload,
          Date: `${paddedYear}-${paddedMonth}-01`,
        };
      });
    } else {
      entriesToPersist = [sanitizedPayload];
    }

    const submissionBody = isAllMonthsSelected
      ? entriesToPersist
      : entriesToPersist[0];

    try {
      await Rest.fetchJson("/api/budget", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(submissionBody),
      });

      setEntryStatus({
        loading: false,
        error: "",
        message:
          entriesToPersist.length > 1
            ? "Budget entries saved successfully."
            : "Budget entry saved successfully.",
      });
      setEntryForm((previous) => ({
        ...previous,
        date: "",
        description: "",
        amount: "",
        note: "",
      }));
      setBalancesRefreshKey((previous) => previous + 1);
    } catch (error) {
      console.error("[BudgetInput] Failed to submit budget entry:", error);
      setEntryStatus({
        loading: false,
        error: error?.message || "Unable to submit budget entry.",
        message: "",
      });
    }
  };

  /**
   * Handles double-click on actual balance cell
   * Opens popup showing detailed actual entries for the month
   */
  const handleBalanceActualDoubleClick = (row) => {
    if (!row?.monthNumber) {
      return;
    }

    setActualEntriesPopupRequest({
      id: `${actualYear}-${row.monthNumber}-${Date.now()}`,
      row,
      actualYear,
      selectedAccounts: Array.isArray(selectedAccounts)
        ? [...selectedAccounts]
        : [],
      expandedCategories: Array.isArray(expandedSelectedCategories)
        ? [...expandedSelectedCategories]
        : [],
      formatCurrencyValue,
    });
  };

  /**
   * Handles double-click on budget balance cell
   * Opens popup showing detailed budget entries for the month
   */
  const handleBalanceBudgetDoubleClick = (row) => {
    if (!row?.monthNumber) {
      return;
    }

    setBudgetEntriesPopupRequest({
      id: `${budgetYear}-${row.monthNumber}-${Date.now()}`,
      row,
      budgetYear,
      selectedAccounts: Array.isArray(selectedAccounts)
        ? [...selectedAccounts]
        : [],
      expandedCategories: Array.isArray(expandedSelectedCategories)
        ? [...expandedSelectedCategories]
        : [],
      accountOptions: filteredAccountOptions,
      categoryOptions,
      currencyOptions,
      formatCurrencyValue,
      budgetRates,
      baseCurrency: BASE_CURRENCY,
      onClose: () => setBalancesRefreshKey((prev) => prev + 1),
    });
  };

  // ========== Effects: Data Fetching ==========

  // Fetch balance data when filters change
  useEffect(() => {
    let isActive = true;

    const fetchBalances = async () => {
      setBalancesStatus({ loading: true, error: "" });
      setBalanceRows([]);

      try {
        const accountsToFilter = getSelectedAccountFilters(selectedAccounts);

        const categoryFilters = expandedSelectedCategories;

        const payload = await Rest.fetchBudgetBalances({
          fromMonth,
          toMonth,
          actualYear,
          budgetYear,
          categories: categoryFilters,
          accounts: accountsToFilter,
        });

        if (!isActive) {
          return;
        }

        const monthSequence =
          Array.isArray(payload.months) && payload.months.length
            ? payload.months
            : buildMonthSequence(fromMonth, toMonth);

        const rows = monthSequence.map((monthNumber) => {
          const actualValue = payload.actualByMonth?.[monthNumber];
          const budgetValue = payload.budgetByMonth?.[monthNumber];
          const actual = Number.isFinite(actualValue) ? actualValue : 0;
          const budget = Number.isFinite(budgetValue) ? budgetValue : 0;
          return {
            monthNumber,
            monthLabel: getMonthLabel(monthNumber),
            actual,
            budget,
            difference: actual - budget,
          };
        });

        setBalanceRows(rows);
        setBalancesStatus({ loading: false, error: "" });
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error("[BudgetInput] Failed to load balance summary:", error);
        setBalanceRows([]);
        setBalancesStatus({
          loading: false,
          error: error?.message || "Unable to load balance data.",
        });
      }
    };

    fetchBalances();

    return () => {
      isActive = false;
    };
  }, [
    fromMonth,
    toMonth,
    actualYear,
    budgetYear,
    selectedAccounts,
    expandedSelectedCategories,
    balancesRefreshKey,
  ]);

  // ========== Render ==========

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main">
        <div className="budget-input-grid">
          <BudgetRegionSelectors
            monthOptions={MONTH_OPTIONS}
            yearOptions={YEAR_OPTIONS}
            budgetYearOptions={BUDGET_YEAR_OPTIONS}
            fromMonth={fromMonth}
            toMonth={toMonth}
            actualYear={actualYear}
            budgetYear={budgetYear}
            accountOptions={accountOptions}
            categoryOptions={categoryOptions}
            categoryGroupOptions={categoryGroupSelectOptions}
            selectedAccounts={selectedAccounts}
            selectedCategories={selectedCategories}
            onFromMonthChange={setFromMonth}
            onToMonthChange={setToMonth}
            onActualYearChange={setActualYear}
            onBudgetYearChange={setBudgetYear}
            onAccountsChange={handleAccountsChange}
            onCategoriesChange={handleCategoriesChange}
          />
          <BudgetRegionBalances
            balanceRows={balanceRows}
            balancesStatus={balancesStatus}
            formatCurrencyValue={formatCurrencyValue}
            onActualDoubleClick={handleBalanceActualDoubleClick}
            onBudgetDoubleClick={handleBalanceBudgetDoubleClick}
          />
          <BudgetRegionBudgetEntry
            derivedCategoryIsGroup={derivedCategoryIsGroup}
            derivedCategoryLabel={derivedCategoryLabel}
            monthSelectOptions={monthSelectOptions}
            entryForm={entryForm}
            setEntryForm={setEntryForm}
            filteredAccountOptions={filteredAccountOptions}
            computedBaseAmount={computedBaseAmount}
            formatCurrencyValue={formatCurrencyValue}
            currencyOptions={currencyOptions}
            entryStatus={entryStatus}
            onSubmit={handleBudgetEntrySubmit}
          />
        </div>
      </main>
      <BudgetEntriesAtualPopup request={actualEntriesPopupRequest} />
      <BudgetEntriesBudgetPopup request={budgetEntriesPopupRequest} />
    </div>
  );
}
