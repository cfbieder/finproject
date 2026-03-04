import { useCallback, useEffect, useMemo, useState } from "react";
import BudgetEntriesAtualPopup from "../features/BudgetEntry/BudgetEntriesAtualPopup.jsx";
import BudgetEntriesBudgetPopup from "../features/BudgetEntry/BudgetEntriesBudgetPopup.jsx";
import BudgetRegionBalances from "../features/BudgetEntry/BudgetRegionBalances.jsx";
import BudgetRegionBudgetEntry from "../features/BudgetEntry/BudgetRegionBudgetEntry.jsx";
import BudgetExpenseSignModal from "../features/BudgetEntry/components/BudgetExpenseSignModal.jsx";
import { useFilterOptions } from "../features/BudgetEntry/hooks/useFilterOptions.js";
import { useBalanceData } from "../features/BudgetEntry/hooks/useBalanceData.js";
import { useCurrencyData } from "../features/BudgetEntry/hooks/useCurrencyData.js";
import { useBudgetEntrySubmit } from "../features/BudgetEntry/hooks/useBudgetEntrySubmit.js";
import { useCoa } from "../hooks/useCoa.js";
import AccountSelector from "../components/AccountSelector/AccountSelector.jsx";
import CategorySelector from "../components/CategorySelector/CategorySelector.jsx";
import PeriodSelector from "../components/PeriodSelector/PeriodSelector.jsx";
import "../features/BudgetEntry/BudgetRegionSelectors.css";
import {
  MONTH_OPTIONS,
  YEAR_OPTIONS,
  BUDGET_YEAR_OPTIONS,
  BASE_CURRENCY,
  CATEGORY_GROUP_INCOME,
  CATEGORY_GROUP_EXPENSE,
  CATEGORY_GROUP_EXPENSE_OPERATIONAL,
  CATEGORY_GROUP_LABELS,
  buildBudgetMonthValue,
  getOperationalExpenseCategories,
  isCategoryGroupValue,
  getCategoryDisplayLabel,
  expandSelectedCategories,
  normalizeCurrencyCode,
  formatCurrencyValue,
  normalizeMonthNumber,
  getMonthLabel,
  parseNumericInput,
} from "../features/BudgetEntry/utils/budgetInputUtils.js";
import "./PageLayout.css";

export default function BudgetInput() {
  // ========== Custom Hooks - Data Loading ==========
  const {
    accountOptions,
    categoryOptions,
    selectedAccounts,
    selectedCategories,
    categoryGroups,
    setSelectedAccounts,
    setSelectedCategories,
  } = useFilterOptions();

  const { currencyOptions, budgetRates, defaultBudgetYear } = useCurrencyData();
  const { expenseAccountNames, accountCurrencyMap, plTree } = useCoa();

  // ========== State: Date Range ==========
  const [fromMonth, setFromMonth] = useState(MONTH_OPTIONS[0].value);
  const [toMonth, setToMonth] = useState(MONTH_OPTIONS[11].value);
  const [actualYear, setActualYear] = useState(YEAR_OPTIONS[0]);
  const [budgetYear, setBudgetYear] = useState(BUDGET_YEAR_OPTIONS[2]);

  // Apply default budget year from program settings once loaded
  useEffect(() => {
    if (defaultBudgetYear != null && BUDGET_YEAR_OPTIONS.includes(defaultBudgetYear)) {
      setBudgetYear(defaultBudgetYear);
    }
  }, [defaultBudgetYear]);

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

  // ========== State: UI ==========
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState("balances");

  // ========== State: Popups ==========
  const [actualEntriesPopupRequest, setActualEntriesPopupRequest] =
    useState(null);
  const [budgetEntriesPopupRequest, setBudgetEntriesPopupRequest] =
    useState(null);

  // ========== Computed Values ==========

  const filteredAccountOptions = useMemo(
    () =>
      accountOptions.filter(
        (option) => option && option.toLowerCase() !== "all"
      ),
    [accountOptions]
  );

  const operationalExpenseCategories = useMemo(
    () => getOperationalExpenseCategories(categoryGroups?.Expense),
    [categoryGroups]
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
      {
        value: CATEGORY_GROUP_EXPENSE_OPERATIONAL,
        label: CATEGORY_GROUP_LABELS[CATEGORY_GROUP_EXPENSE_OPERATIONAL],
        disabled: !operationalExpenseCategories.length,
        className:
          "category-group-option category-group-option--expense category-group-option--expense-operational",
      },
    ];
  }, [categoryGroups, operationalExpenseCategories]);

  const activeMonthRange = useMemo(() => {
    const start = normalizeMonthNumber(fromMonth, 1);
    const end = normalizeMonthNumber(toMonth, 12);
    if (start <= end) return { start, end };
    return { start: end, end: start };
  }, [fromMonth, toMonth]);

  const monthSelectOptions = useMemo(() => {
    const yearNumber = Number(budgetYear);
    if (!Number.isFinite(yearNumber)) return [];

    const paddedYear = String(Math.floor(yearNumber)).padStart(4, "0");
    const { start, end } = activeMonthRange;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
      return [];

    const options = [];
    for (let month = start; month <= end; month += 1) {
      const label = getMonthLabel(month);
      const paddedMonth = String(month).padStart(2, "0");
      options.push({
        value: `${paddedYear}-${paddedMonth}`,
        label: `${label} ${paddedYear}`,
      });
    }

    if (!options.length) return [];
    return [{ value: "All", label: "All" }, ...options];
  }, [activeMonthRange, budgetYear]);

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
    if (explicitCategory) return explicitCategory;

    const groupCategory = meaningfulSelections.find((category) =>
      isCategoryGroupValue(category)
    );
    if (groupCategory) return groupCategory;

    return categoryOptions.length ? categoryOptions[0] : "";
  }, [selectedCategories, categoryOptions]);

  const derivedCategoryLabel = getCategoryDisplayLabel(derivedCategoryValue);
  const derivedCategoryIsGroup = isCategoryGroupValue(derivedCategoryValue);

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

  const {
    balanceRows,
    status: balancesStatus,
    refresh: refreshBalances,
  } = useBalanceData({
    fromMonth,
    toMonth,
    actualYear,
    budgetYear,
    selectedAccounts,
    expandedCategories: expandedSelectedCategories,
  });

  const currentExchangeRate = useMemo(() => {
    const normalizedCurrency = normalizeCurrencyCode(entryForm.currency);
    if (!normalizedCurrency) return undefined;
    if (normalizedCurrency === BASE_CURRENCY) return 1;
    const rate = budgetRates[normalizedCurrency];
    return Number.isFinite(rate) ? rate : undefined;
  }, [entryForm.currency, budgetRates]);

  const computedBaseAmount = useMemo(() => {
    const parsedAmount = parseNumericInput(entryForm.amount);
    if (!Number.isFinite(parsedAmount)) return undefined;
    if (!Number.isFinite(currentExchangeRate)) return undefined;
    return parsedAmount / currentExchangeRate;
  }, [entryForm.amount, currentExchangeRate]);

  const balanceTotals = useMemo(() => {
    if (!Array.isArray(balanceRows) || !balanceRows.length) {
      return { actual: 0, budget: 0, difference: 0 };
    }
    return balanceRows.reduce(
      (totals, row) => {
        const actual = Number.isFinite(row.actual) ? row.actual : 0;
        const budget = Number.isFinite(row.budget) ? row.budget : 0;
        return {
          actual: totals.actual + actual,
          budget: totals.budget + budget,
          difference: totals.difference + (actual - budget),
        };
      },
      { actual: 0, budget: 0, difference: 0 }
    );
  }, [balanceRows]);

  // ========== Budget Entry Submit Hook ==========
  const {
    entryStatus,
    expenseSignModal,
    handleBudgetEntrySubmit,
    handleExpenseSignModalClose,
    handleExpenseSignModalConfirmNegative,
    handleExpenseSignModalKeepPositive,
  } = useBudgetEntrySubmit({
    entryForm,
    setEntryForm,
    monthSelectOptions,
    computedBaseAmount,
    categoryGroups,
    budgetYear,
    activeMonthRange,
    refreshBalances,
    setBudgetEntriesPopupRequest,
  });

  // ========== Effects: Initialization ==========

  useEffect(() => {
    if (!monthSelectOptions.length) return;

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
    setEntryForm((previous) => {
      if (previous.category === derivedCategoryLabel) return previous;
      return { ...previous, category: derivedCategoryLabel };
    });
  }, [derivedCategoryLabel]);

  useEffect(() => {
    if (!currencyOptions.length) return;
    setEntryForm((previous) => {
      if (currencyOptions.includes(previous.currency)) return previous;
      return { ...previous, currency: currencyOptions[0] };
    });
  }, [currencyOptions]);

  // ========== Event Handlers ==========

  const handleAccountsChange = useCallback(
    (nextValues) => {
      setSelectedAccounts(nextValues);
    },
    [setSelectedAccounts]
  );

  const handleCategoriesChange = useCallback(
    (nextValues) => {
      setSelectedCategories(nextValues);
    },
    [setSelectedCategories]
  );

  const handleClearAll = useCallback(() => {
    setFromMonth(MONTH_OPTIONS[0].value);
    setToMonth(MONTH_OPTIONS[11].value);
    setActualYear(YEAR_OPTIONS[0]);
    setBudgetYear(BUDGET_YEAR_OPTIONS[2]);
    setSelectedCategories([]);
    setSelectedAccounts(["All"]);
  }, [setSelectedCategories, setSelectedAccounts]);

  const handlePeriodChange = useCallback(
    ({ fromMonth, toMonth, actualYear, budgetYear }) => {
      setFromMonth(fromMonth);
      setToMonth(toMonth);
      setActualYear(actualYear);
      setBudgetYear(budgetYear);
    },
    []
  );

  const handleActualEntryCopy = useCallback(
    (entry, rowMonthNumber) => {
      if (!entry || derivedCategoryIsGroup) return;

      const budgetMonthValue = buildBudgetMonthValue(
        budgetYear,
        rowMonthNumber
      );
      const monthValueExists =
        budgetMonthValue &&
        monthSelectOptions.some((option) => option.value === budgetMonthValue);

      setEntryForm((previous) => {
        const nextAccount =
          entry.Account && entry.Account.trim()
            ? entry.Account
            : previous.account;
        const nextAmount =
          entry.Amount !== undefined && entry.Amount !== null
            ? String(entry.Amount)
            : previous.amount;
        const nextCurrency = entry.Currency || previous.currency;
        const nextDate = monthValueExists ? budgetMonthValue : previous.date;
        return {
          ...previous,
          account: nextAccount,
          amount: nextAmount,
          currency: nextCurrency,
          date: nextDate,
        };
      });
    },
    [derivedCategoryIsGroup, budgetYear, monthSelectOptions, setEntryForm]
  );

  const handleBalanceActualDoubleClick = (row) => {
    if (!row?.monthNumber) return;

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
      budgetEntryAvailable: !derivedCategoryIsGroup,
      onActualEntryCopy: handleActualEntryCopy,
      onClose: () => setActualEntriesPopupRequest(null),
    });
  };

  const handleBalanceBudgetDoubleClick = (row) => {
    if (!row?.monthNumber) return;

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
      onClose: () => {
        refreshBalances();
        setBudgetEntriesPopupRequest(null);
      },
    });
  };

  // ========== Render ==========

  return (
    <>
      <main className="page-main">
        <div className="budget-input-grid">
          <section className="budget-region selector-area">
            <div className="selector-area__header">
              <p className="budget-region__label">Filter Controls</p>
              <div className="selector-area__header-actions">
                <button
                  type="button"
                  className="selector-area__toggle"
                  onClick={handleClearAll}
                >
                  Clear All
                </button>
                <button
                  type="button"
                  className="selector-area__toggle"
                  onClick={() => setFiltersCollapsed((prev) => !prev)}
                  aria-expanded={!filtersCollapsed}
                >
                  {filtersCollapsed ? "Show Filters" : "Hide Filters"}
                </button>
              </div>
            </div>
            {!filtersCollapsed && (
              <p className="budget-region__description">
                Choose the period and slices that drive the budget comparison.
              </p>
            )}
            <div
              className={`selector-grid selector-grid--three${filtersCollapsed ? " selector-grid--collapsed" : ""}`}
            >
              {/* Column 1: Period + Totals */}
              <div className="selector-column">
                <div className="selector-control">
                  <span className="selector-control__label">Period</span>
                  <PeriodSelector
                    fromMonth={fromMonth}
                    toMonth={toMonth}
                    actualYear={actualYear}
                    budgetYear={budgetYear}
                    monthOptions={MONTH_OPTIONS}
                    yearOptions={YEAR_OPTIONS}
                    budgetYearOptions={BUDGET_YEAR_OPTIONS}
                    onChange={handlePeriodChange}
                  />
                </div>
                <div className="selector-summary-group selector-summary-group--inline">
                  <div className="selector-summary selector-summary--compact selector-summary--inline">
                    <span className="selector-summary__label">Total Actual</span>
                    <span className="selector-summary__value">
                      {formatCurrencyValue(balanceTotals.actual)}
                    </span>
                  </div>
                  <div className="selector-summary selector-summary--compact selector-summary--inline">
                    <span className="selector-summary__label">Total Budget</span>
                    <span className="selector-summary__value">
                      {formatCurrencyValue(balanceTotals.budget)}
                    </span>
                  </div>
                  <div className="selector-summary selector-summary--compact selector-summary--inline selector-summary--muted">
                    <span className="selector-summary__label">Difference</span>
                    <span className="selector-summary__value">
                      {formatCurrencyValue(balanceTotals.difference)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Column 2: Categories */}
              <div className="selector-column selector-column--category">
                <div className="selector-control selector-control--fill">
                  <span className="selector-control__label">Categories</span>
                  <CategorySelector
                    plTree={plTree}
                    selectedCategories={selectedCategories}
                    onCategoriesChange={handleCategoriesChange}
                    categoryGroupOptions={categoryGroupSelectOptions}
                    categoryOptions={categoryOptions}
                  />
                </div>
              </div>

              {/* Column 3: Accounts */}
              <div className="selector-column selector-column--accounts">
                <div className="selector-control selector-control--fill">
                  <span className="selector-control__label">Accounts</span>
                  <AccountSelector
                    accountOptions={accountOptions}
                    accountCurrencyMap={accountCurrencyMap}
                    selectedAccounts={selectedAccounts}
                    onAccountsChange={handleAccountsChange}
                  />
                </div>
              </div>
            </div>
          </section>
          <section className="budget-region budget-tabs">
            <div className="budget-tabs__header">
              <button
                type="button"
                className={`budget-tabs__tab${activeTab === "balances" ? " budget-tabs__tab--active" : ""}`}
                onClick={() => setActiveTab("balances")}
              >
                Balances
              </button>
              <button
                type="button"
                className={`budget-tabs__tab${activeTab === "entry" ? " budget-tabs__tab--active" : ""}`}
                onClick={() => setActiveTab("entry")}
              >
                Budget Entry
              </button>
              <span className="budget-tabs__category" title={derivedCategoryLabel}>
                {derivedCategoryLabel}
              </span>
            </div>
            <div className="budget-tabs__body">
              {activeTab === "balances" && (
                <BudgetRegionBalances
                  balanceRows={balanceRows}
                  balancesStatus={balancesStatus}
                  formatCurrencyValue={formatCurrencyValue}
                  onActualDoubleClick={handleBalanceActualDoubleClick}
                  onBudgetDoubleClick={handleBalanceBudgetDoubleClick}
                />
              )}
              {activeTab === "entry" && (
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
                  expenseAccountNames={expenseAccountNames}
                  accountCurrencyMap={accountCurrencyMap}
                />
              )}
            </div>
          </section>
        </div>
      </main>
      <BudgetExpenseSignModal
        isOpen={!!expenseSignModal}
        isSubmitting={entryStatus.loading}
        onClose={handleExpenseSignModalClose}
        onConfirmNegative={handleExpenseSignModalConfirmNegative}
        onKeepPositive={handleExpenseSignModalKeepPositive}
      />
      <BudgetEntriesAtualPopup request={actualEntriesPopupRequest} />
      <BudgetEntriesBudgetPopup request={budgetEntriesPopupRequest} />
    </>
  );
}
