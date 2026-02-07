import { useCallback, useEffect, useMemo, useState } from "react";
import Rest from "../js/rest.js";
import BudgetEntriesAtualPopup from "../features/BudgetEntry/BudgetEntriesAtualPopup.jsx";
import BudgetEntriesBudgetPopup from "../features/BudgetEntry/BudgetEntriesBudgetPopup.jsx";
import BudgetRegionBalances from "../features/BudgetEntry/BudgetRegionBalances.jsx";
import BudgetRegionSelectors from "../features/BudgetEntry/BudgetRegionSelectors.jsx";
import BudgetRegionBudgetEntry from "../features/BudgetEntry/BudgetRegionBudgetEntry.jsx";
import BudgetExpenseSignModal from "../features/BudgetEntry/components/BudgetExpenseSignModal.jsx";
import { useFilterOptions } from "../features/BudgetEntry/hooks/useFilterOptions.js";
import { useBalanceData } from "../features/BudgetEntry/hooks/useBalanceData.js";
import { useCurrencyData } from "../features/BudgetEntry/hooks/useCurrencyData.js";
import {
  MONTH_OPTIONS,
  YEAR_OPTIONS,
  BUDGET_YEAR_OPTIONS,
  BASE_CURRENCY,
  CATEGORY_GROUP_INCOME,
  CATEGORY_GROUP_EXPENSE,
  CATEGORY_GROUP_EXPENSE_OPERATIONAL,
  CATEGORY_GROUP_LABELS,
  ensureAllOption,
  buildBudgetMonthValue,
  buildMonthSequence,
  isOperationalExpenseExcluded,
  getOperationalExpenseCategories,
  isCategoryGroupValue,
  getCategoryDisplayLabel,
  expandSelectedCategories,
  normalizeCurrencyCode,
  currencyFormatter,
  formatCurrencyValue,
  normalizeMonthNumber,
  getMonthLabel,
  normalizeTextInput,
  evaluateMathInput,
  parseNumericInput,
} from "../features/BudgetEntry/utils/budgetInputUtils.js";
import "./PageLayout.css";

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
  // ========== Custom Hooks - Data Loading ==========

  // Load filter options (accounts, categories)
  const {
    accountOptions,
    categoryOptions,
    selectedAccounts,
    selectedCategories,
    categoryGroups,
    setSelectedAccounts,
    setSelectedCategories,
  } = useFilterOptions();

  // Load currency options and exchange rates
  const { currencyOptions, budgetRates } = useCurrencyData();

  // ========== State: Date Range ==========
  const [fromMonth, setFromMonth] = useState(MONTH_OPTIONS[0].value);
  const [toMonth, setToMonth] = useState(MONTH_OPTIONS[11].value);
  const [actualYear, setActualYear] = useState(YEAR_OPTIONS[0]);
  const [budgetYear, setBudgetYear] = useState(BUDGET_YEAR_OPTIONS[2]);

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
  const [expenseSignModal, setExpenseSignModal] = useState(null);

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

  // Load balance data based on filters
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
  const resolveBudgetEntryDateSelection = () => {
    if (!Array.isArray(monthSelectOptions) || !monthSelectOptions.length) {
      return "";
    }
    const validValues = new Set(
      monthSelectOptions
        .map((option) => option?.value)
        .filter((value) => value !== undefined && value !== null)
    );
    if (validValues.has(entryForm.date)) {
      return entryForm.date;
    }
    if (validValues.has("All")) {
      return "All";
    }
    const firstOption = monthSelectOptions.find(
      (option) => option && option.value
    );
    return firstOption ? firstOption.value : "";
  };

  const handleBudgetEntrySubmit = async (event) => {
    event.preventDefault();
    const resolvedDateSelection = resolveBudgetEntryDateSelection();
    if (!resolvedDateSelection) {
      setEntryStatus({
        loading: false,
        error: "Please select a valid period for the budget entry.",
        message: "",
      });
      return;
    }
    if (resolvedDateSelection !== entryForm.date) {
      setEntryForm((previous) => ({
        ...previous,
        date: resolvedDateSelection,
      }));
    }
    const parsedAmount = parseNumericInput(entryForm.amount);
    const normalizedCategory = normalizeTextInput(entryForm.category);
    const isExpenseCategory =
      normalizedCategory &&
      Array.isArray(categoryGroups?.Expense) &&
      categoryGroups.Expense.some(
        (category) =>
          typeof category === "string" &&
          category.trim().toLowerCase() === normalizedCategory.toLowerCase()
      );

    if (isExpenseCategory && Number.isFinite(parsedAmount) && parsedAmount > 0) {
      setExpenseSignModal({
        amount: parsedAmount,
        baseAmount: computedBaseAmount,
      });
      return;
    }

    await performBudgetEntrySubmit(
      parsedAmount,
      computedBaseAmount,
      resolvedDateSelection
    );
  };

  const performBudgetEntrySubmit = async (
    amountOverride,
    baseAmountOverride,
    selectedDateValue
  ) => {
    setEntryStatus({ loading: true, error: "", message: "" });

    const resolvedDateSelection =
      selectedDateValue ?? resolveBudgetEntryDateSelection();
    if (!resolvedDateSelection) {
      setEntryStatus({
        loading: false,
        error: "Please select a valid period for the budget entry.",
        message: "",
      });
      return;
    }

    const normalizedCurrency = normalizeCurrencyCode(entryForm.currency);
    const isAllMonthsSelected = resolvedDateSelection === "All";
    const amountToUse = amountOverride ?? parseNumericInput(entryForm.amount);
    const baseAmountToUse = Number.isFinite(baseAmountOverride)
      ? baseAmountOverride
      : Number.isFinite(computedBaseAmount)
      ? computedBaseAmount
      : undefined;
    const payload = {
      Date:
        resolvedDateSelection && resolvedDateSelection !== "All"
          ? `${resolvedDateSelection}-01`
          : undefined,
      Description1: normalizeTextInput(entryForm.description),
      Account: (() => {
        const normalized = normalizeTextInput(entryForm.account);
        return normalized && normalized.toLowerCase() === "none"
          ? undefined
          : normalized;
      })(),
      Category: normalizeTextInput(entryForm.category),
      Amount: amountToUse,
      BaseAmount: Number.isFinite(baseAmountToUse)
        ? baseAmountToUse
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
      // Using v2 API (PostgreSQL)
      await Rest.fetchJson("/api/v2/budget/entries", {
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
      setBudgetEntriesPopupRequest(null);
      refreshBalances();
    } catch (error) {
      console.error("[BudgetInput] Failed to submit budget entry:", error);
      setEntryStatus({
        loading: false,
        error: error?.message || "Unable to submit budget entry.",
        message: "",
      });
    }
  };

  const handleExpenseSignModalClose = () => {
    if (entryStatus.loading) {
      return;
    }
    setExpenseSignModal(null);
  };

  const handleExpenseSignModalConfirmNegative = async () => {
    if (!expenseSignModal) {
      return;
    }
    const negativeAmount = -Math.abs(expenseSignModal.amount);
    const negativeBaseAmount = Number.isFinite(expenseSignModal.baseAmount)
      ? -Math.abs(expenseSignModal.baseAmount)
      : undefined;
    setExpenseSignModal(null);
    setEntryForm((previous) => ({
      ...previous,
      amount: String(negativeAmount),
    }));
    await performBudgetEntrySubmit(negativeAmount, negativeBaseAmount);
  };

  const handleExpenseSignModalKeepPositive = async () => {
    if (!expenseSignModal) {
      return;
    }
    const positiveAmount = expenseSignModal.amount;
    const baseAmountToUse = Number.isFinite(expenseSignModal.baseAmount)
      ? expenseSignModal.baseAmount
      : undefined;
    setExpenseSignModal(null);
    await performBudgetEntrySubmit(positiveAmount, baseAmountToUse);
  };

  const handleActualEntryCopy = useCallback(
    (entry, rowMonthNumber) => {
      if (!entry || derivedCategoryIsGroup) {
        return;
      }

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
      budgetEntryAvailable: !derivedCategoryIsGroup,
      onActualEntryCopy: handleActualEntryCopy,
      onClose: () => setActualEntriesPopupRequest(null),
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
            totals={balanceTotals}
            formatCurrencyValue={formatCurrencyValue}
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
