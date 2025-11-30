import { useEffect, useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
import BudgetEntriesAtualPopup from "../features/BudgetEntriesAtualPopup.jsx";
import BudgetEntriesBudgetPopup from "../features/BudgetEntriesBudgetPopup.jsx";
import BudgetRegionBalances from "../features/BudgetRegionBalances.jsx";
import BudgetRegionSelectors from "../features/BudgetRegionSelectors.jsx";
import BudgetRegionBudgetEntry from "../features/BudgetRegionBudgetEntry.jsx";
import "./BudgetInput.css";

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
const YEAR_OPTIONS = Array.from(
  { length: 6 },
  (_, index) => CURRENT_YEAR - index
);

const BUDGET_YEAR_OPTIONS = Array.from(
  { length: 6 },
  (_, index) => CURRENT_YEAR - 1 + index
);

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

const DEFAULT_ACCOUNT_OPTIONS = ensureAllOption([
  "Checking",
  "Savings",
  "Credit Card",
  "Investments",
  "Payables",
]);

const DEFAULT_CATEGORY_OPTIONS = [
  "Revenue",
  "Cost of Goods Sold",
  "Operating Expenses",
  "Investments",
  "Other Income",
];

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

const CATEGORY_GROUP_INCOME = "__group__income";
const CATEGORY_GROUP_EXPENSE = "__group__expense";
const CATEGORY_GROUP_LABELS = {
  [CATEGORY_GROUP_INCOME]: "Income (all)",
  [CATEGORY_GROUP_EXPENSE]: "Expense (all)",
};

const isCategoryGroupValue = (value) =>
  value === CATEGORY_GROUP_INCOME || value === CATEGORY_GROUP_EXPENSE;

const getCategoryDisplayLabel = (value) =>
  CATEGORY_GROUP_LABELS[value] ?? value;

const normalizeCurrencyCode = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

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

const getMonthLabel = (monthNumber) => {
  const found = MONTH_OPTIONS.find(
    (option) => Number(option.value) === monthNumber
  );
  return found ? found.label : `Month ${monthNumber}`;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const BASE_CURRENCY = "USD";

const formatCurrencyValue = (value) => {
  const normalized = Number.isFinite(value) ? value : 0;
  const absolute = Math.abs(normalized);
  const formatted = currencyFormatter.format(absolute);
  return normalized < 0 ? `(${formatted})` : formatted;
};

export default function BudgetInput() {
  const [fromMonth, setFromMonth] = useState(MONTH_OPTIONS[0].value);
  const [toMonth, setToMonth] = useState(MONTH_OPTIONS[11].value);
  const [actualYear, setActualYear] = useState(YEAR_OPTIONS[0]);
  const [budgetYear, setBudgetYear] = useState(BUDGET_YEAR_OPTIONS[2]);
  const [accountOptions, setAccountOptions] = useState(DEFAULT_ACCOUNT_OPTIONS);
  const [categoryOptions, setCategoryOptions] = useState(
    DEFAULT_CATEGORY_OPTIONS
  );
  const [selectedAccounts, setSelectedAccounts] = useState(["All"]);
  const [selectedCategories, setSelectedCategories] = useState([
    CATEGORY_GROUP_EXPENSE,
  ]);
  const [balanceRows, setBalanceRows] = useState([]);
  const [balancesStatus, setBalancesStatus] = useState({
    loading: true,
    error: "",
  });
  const [balancesRefreshKey, setBalancesRefreshKey] = useState(0);
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
  const [currencyOptions, setCurrencyOptions] = useState([BASE_CURRENCY]);
  const [categoryGroups, setCategoryGroups] = useState({
    Income: [],
    Expense: [],
  });
  const [budgetRates, setBudgetRates] = useState({ USD: 1 });
  const [actualEntriesPopupRequest, setActualEntriesPopupRequest] =
    useState(null);
  const [budgetEntriesPopupRequest, setBudgetEntriesPopupRequest] =
    useState(null);
  const filteredAccountOptions = useMemo(
    () =>
      accountOptions.filter(
        (option) => option && option.toLowerCase() !== "all"
      ),
    [accountOptions]
  );
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
    ];
  }, [categoryGroups]);
  const activeMonthRange = useMemo(() => {
    const start = normalizeMonthNumber(fromMonth, 1);
    const end = normalizeMonthNumber(toMonth, 12);
    if (start <= end) {
      return { start, end };
    }

    return { start: end, end: start };
  }, [fromMonth, toMonth]);

  const buildMonthIsoValue = (yearValue, monthNumber) => {
    const normalizedYear = Number.isFinite(Number(yearValue))
      ? Math.floor(Number(yearValue))
      : null;
    const normalizedMonth = Number.isFinite(Number(monthNumber))
      ? Math.floor(Number(monthNumber))
      : null;
    if (
      normalizedYear === null ||
      Number.isNaN(normalizedYear) ||
      normalizedMonth === null ||
      Number.isNaN(normalizedMonth)
    ) {
      return "";
    }
    const paddedYear = String(normalizedYear).padStart(4, "0");
    const clampedMonth = Math.max(1, Math.min(12, normalizedMonth));
    const paddedMonth = String(clampedMonth).padStart(2, "0");
    return `${paddedYear}-${paddedMonth}`;
  };

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
    return options;
  }, [activeMonthRange, budgetYear]);

  useEffect(() => {
    if (!monthSelectOptions.length) {
      return;
    }

    setEntryForm((previous) => {
      if (
        previous.date &&
        monthSelectOptions.some((option) => option.value === previous.date)
      ) {
        return previous;
      }
      return { ...previous, date: monthSelectOptions[0].value };
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

  useEffect(() => {
    setEntryForm((previous) => {
      if (previous.account) {
        return previous;
      }
      return { ...previous, account: "None" };
    });
  }, []);

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

  useEffect(() => {
    setEntryForm((previous) => {
      if (previous.category === derivedCategoryLabel) {
        return previous;
      }
      return { ...previous, category: derivedCategoryLabel };
    });
  }, [derivedCategoryLabel]);

  const derivedCategoryIsGroup = isCategoryGroupValue(derivedCategoryValue);

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

  const handleAccountsChange = (event) => {
    const nextValues = Array.from(
      event.target.selectedOptions,
      (option) => option.value
    );
    setSelectedAccounts(nextValues);
  };

  const handleCategoriesChange = (event) => {
    const nextValues = Array.from(
      event.target.selectedOptions,
      (option) => option.value
    );
    setSelectedCategories(nextValues);
  };

  const expandSelectedCategories = (values) => {
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
        (categoryGroups?.Expense ?? []).forEach((category) => {
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

  const expandedSelectedCategories = useMemo(
    () => expandSelectedCategories(selectedCategories),
    [selectedCategories, categoryGroups]
  );

  const normalizeTextInput = (value) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : undefined;
  };

  const parseNumericInput = (value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const computedBaseAmount = useMemo(() => {
    const parsedAmount = parseNumericInput(entryForm.amount);
    if (!Number.isFinite(parsedAmount)) {
      return undefined;
    }
    if (!Number.isFinite(currentExchangeRate)) {
      return undefined;
    }
    return parsedAmount * currentExchangeRate;
  }, [entryForm.amount, currentExchangeRate]);

  const handleBudgetEntrySubmit = async (event) => {
    event.preventDefault();
    setEntryStatus({ loading: true, error: "", message: "" });

    const normalizedCurrency = normalizeCurrencyCode(entryForm.currency);
    const payload = {
      Date: entryForm.date ? `${entryForm.date}-01` : undefined,
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

    try {
      await Rest.fetchJson("/api/budget", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(sanitizedPayload),
      });

      setEntryStatus({
        loading: false,
        error: "",
        message: "Budget entry saved successfully.",
      });
      setEntryForm((previous) => ({
        ...previous,
        date: "",
        description: "",
        amount: "",
        note: "",
      }));
    } catch (error) {
      console.error("[BudgetInput] Failed to submit budget entry:", error);
      setEntryStatus({
        loading: false,
        error: error?.message || "Unable to submit budget entry.",
        message: "",
      });
    }
  };

  useEffect(() => {
    let isActive = true;

    const fetchBalances = async () => {
      setBalancesStatus({ loading: true, error: "" });
      setBalanceRows([]);

      try {
        const accountsToFilter = selectedAccounts.filter(
          (account) => account && account !== "All"
        );

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
      categoryOptions,
      currencyOptions,
      formatCurrencyValue,
      budgetRates,
      baseCurrency: BASE_CURRENCY,
      onClose: () => setBalancesRefreshKey((prev) => prev + 1),
    });
  };

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
