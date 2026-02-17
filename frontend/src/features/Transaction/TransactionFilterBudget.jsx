import { useCallback, useEffect, useMemo, useState } from "react";
import PeriodSelector from "../../components/PeriodSelector/PeriodSelector.jsx";
import CategorySelector from "../../components/CategorySelector/CategorySelector.jsx";
import AccountSelector from "../../components/AccountSelector/AccountSelector.jsx";
import { useCoa } from "../../hooks/useCoa.js";
import { useFilterOptions } from "../BudgetEntry/hooks/useFilterOptions.js";
import {
  CATEGORY_GROUP_INCOME,
  CATEGORY_GROUP_EXPENSE,
  CATEGORY_GROUP_EXPENSE_OPERATIONAL,
  CATEGORY_GROUP_LABELS,
  getOperationalExpenseCategories,
  expandSelectedCategories,
} from "../BudgetEntry/utils/budgetInputUtils.js";
import "../BudgetEntry/BudgetRegionSelectors.css";
import "./TransactionFilterActual.css";

const CURRENT_MONTH = String(new Date().getMonth() + 1).padStart(2, "0");
const CURRENT_YEAR = new Date().getFullYear();

const parseAmountValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatAmount = (amount) =>
  new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

export default function TransactionFilterBudget({
  config,
  onFiltersChange,
  onDeleteClick,
  onSelectAllToggle,
  onEditClick,
  canDelete,
  canEdit,
  isAllSelected,
  filteredTotalsByCurrency = [],
}) {
  // ========== Data Hooks ==========
  const { accountCurrencyMap, plTree } = useCoa();
  const {
    accountOptions,
    categoryGroups,
    selectedAccounts,
    selectedCategories,
    setSelectedAccounts,
    setSelectedCategories,
  } = useFilterOptions();

  // ========== State: Period ==========
  const [periodValues, setPeriodValues] = useState({
    fromMonth: "01",
    toMonth: "12",
    actualYear: CURRENT_YEAR,
    budgetYear: CURRENT_YEAR,
  });

  // ========== State: Value Range ==========
  const [valueFromEnabled, setValueFromEnabled] = useState(false);
  const [valueToEnabled, setValueToEnabled] = useState(false);
  const [valueFrom, setValueFrom] = useState("");
  const [valueTo, setValueTo] = useState("");

  // ========== State: UI ==========
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);

  // Reset category/account selection for transaction page (start with no filters)
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!initialized) {
      setSelectedCategories([]);
      setSelectedAccounts(["All"]);
      setInitialized(true);
    }
  }, [initialized, setSelectedCategories, setSelectedAccounts]);

  // ========== Derived: Category Group Options ==========
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
      },
      {
        value: CATEGORY_GROUP_EXPENSE,
        label: CATEGORY_GROUP_LABELS[CATEGORY_GROUP_EXPENSE],
        disabled: !categoryGroups?.Expense?.length,
      },
      {
        value: CATEGORY_GROUP_EXPENSE_OPERATIONAL,
        label: CATEGORY_GROUP_LABELS[CATEGORY_GROUP_EXPENSE_OPERATIONAL],
        disabled: !operationalExpenseCategories.length,
      },
    ];
  }, [categoryGroups, operationalExpenseCategories]);

  // ========== Derived: Expanded Categories ==========
  const expandedCategories = useMemo(
    () =>
      expandSelectedCategories(
        selectedCategories,
        categoryGroups?.Expense,
        operationalExpenseCategories,
        categoryGroups
      ),
    [selectedCategories, categoryGroups, operationalExpenseCategories]
  );

  // ========== Set Page Title ==========
  useEffect(() => {
    document.title = "Budget Transaction";
  }, []);

  // ========== Emit Filter Payload ==========
  useEffect(() => {
    if (typeof onFiltersChange !== "function") return;

    const { fromMonth, toMonth, actualYear } = periodValues;
    const isSingleMonth = fromMonth === toMonth;
    const monthIndex = isSingleMonth ? Number(fromMonth) - 1 : null;

    const effectiveAccounts = selectedAccounts.filter(
      (a) => a && a.toLowerCase() !== "all"
    );
    const accountEnabled = effectiveAccounts.length > 0;
    const categoryEnabled = expandedCategories.length > 0;

    const filterPayload = {
      yearEnabled: true,
      year: String(actualYear),
      monthEnabled: isSingleMonth,
      month: monthIndex,
      fromMonth,
      toMonth,
      accountEnabled,
      account: accountEnabled ? effectiveAccounts : [],
      categoryEnabled,
      category: categoryEnabled ? expandedCategories : [],
      currencyEnabled: false,
      currency: [],
      valueFromEnabled,
      valueFrom: valueFromEnabled ? parseAmountValue(valueFrom) : null,
      valueToEnabled,
      valueTo: valueToEnabled ? parseAmountValue(valueTo) : null,
    };

    onFiltersChange(filterPayload);
  }, [
    periodValues,
    selectedAccounts,
    expandedCategories,
    valueFromEnabled,
    valueFrom,
    valueToEnabled,
    valueTo,
    onFiltersChange,
  ]);

  // ========== Event Handlers ==========
  const handlePeriodChange = useCallback(
    ({ fromMonth, toMonth, actualYear, budgetYear }) => {
      setPeriodValues({ fromMonth, toMonth, actualYear, budgetYear });
    },
    []
  );

  const handleAccountsChange = useCallback(
    (nextValues) => setSelectedAccounts(nextValues),
    [setSelectedAccounts]
  );

  const handleCategoriesChange = useCallback(
    (nextValues) => setSelectedCategories(nextValues),
    [setSelectedCategories]
  );

  const handleClearFilters = useCallback(() => {
    setPeriodValues({
      fromMonth: "01",
      toMonth: "12",
      actualYear: CURRENT_YEAR,
      budgetYear: CURRENT_YEAR,
    });
    setValueFromEnabled(false);
    setValueToEnabled(false);
    setValueFrom("");
    setValueTo("");
    setSelectedCategories([]);
    setSelectedAccounts(["All"]);
  }, [setSelectedCategories, setSelectedAccounts]);

  // ========== Render ==========
  return (
    <section
      className="trans-filter-actual"
      aria-label="Budget Transaction filters"
    >
      {/* Header row: title + totals + toggle */}
      <div className="trans-filter-actual__header">
        <div className="trans-filter-actual__header-left">
          <h2 className="section-filters-title">Budget Transaction</h2>
          <div className="trans-filter-actual__totals">
            <strong className="trans-filter-actual__totals-label">
              Filtered totals:
            </strong>
            {filteredTotalsByCurrency.length ? (
              filteredTotalsByCurrency.map(({ currency, amount }) => (
                <span key={currency} className="trans-filter-actual__total-badge">
                  {currency}: {formatAmount(amount)}
                </span>
              ))
            ) : (
              <span className="trans-filter-actual__total-empty">
                No totals available
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="selector-area__toggle"
          onClick={() => setFiltersCollapsed((prev) => !prev)}
          aria-expanded={!filtersCollapsed}
        >
          {filtersCollapsed ? "Show Filters" : "Hide Filters"}
        </button>
      </div>

      {/* Collapsible filter grid */}
      {!filtersCollapsed && (
        <div className="trans-filter-actual__grid">
          {/* Column 1: Period + Value Range + Actions */}
          <div className="trans-filter-actual__column trans-filter-actual__column--period">
            <div className="selector-control">
              <span className="selector-control__label">Period</span>
              <PeriodSelector
                fromMonth={periodValues.fromMonth}
                toMonth={periodValues.toMonth}
                actualYear={periodValues.actualYear}
                budgetYear={periodValues.budgetYear}
                onChange={handlePeriodChange}
                defaultPreset="this-year"
                hideBudgetYear
              />
            </div>

            <div className="trans-filter-actual__range-row">
              <div className="selector-control trans-filter-actual__range-field">
                <span className="selector-control__label">Value From</span>
                <div className="trans-filter-actual__range-controls">
                  <input
                    type="checkbox"
                    className="trans-filter-actual__range-checkbox"
                    checked={valueFromEnabled}
                    aria-label="Enable lower bound"
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setValueFromEnabled(checked);
                      if (!checked) setValueFrom("");
                    }}
                  />
                  <input
                    className="trans-filter-actual__input"
                    type="number"
                    placeholder="0.00"
                    inputMode="decimal"
                    step="any"
                    value={valueFromEnabled ? valueFrom : ""}
                    disabled={!valueFromEnabled}
                    onChange={(e) => {
                      if (valueFromEnabled) setValueFrom(e.target.value);
                    }}
                  />
                </div>
              </div>
              <div className="selector-control trans-filter-actual__range-field">
                <span className="selector-control__label">Value To</span>
                <div className="trans-filter-actual__range-controls">
                  <input
                    type="checkbox"
                    className="trans-filter-actual__range-checkbox"
                    checked={valueToEnabled}
                    aria-label="Enable upper bound"
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setValueToEnabled(checked);
                      if (!checked) setValueTo("");
                    }}
                  />
                  <input
                    className="trans-filter-actual__input"
                    type="number"
                    placeholder="0.00"
                    inputMode="decimal"
                    step="any"
                    value={valueToEnabled ? valueTo : ""}
                    disabled={!valueToEnabled}
                    onChange={(e) => {
                      if (valueToEnabled) setValueTo(e.target.value);
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="trans-filter-actual__actions">
              <button
                className="trans-filter-actual__action-btn"
                type="button"
                onClick={onEditClick}
                disabled={!canEdit}
              >
                Edit
              </button>
              <button
                className="trans-filter-actual__action-btn"
                type="button"
                onClick={onSelectAllToggle}
              >
                All
              </button>
              <button
                className={`trans-filter-actual__action-btn trans-filter-actual__action-btn--delete${
                  canDelete ? " trans-filter-actual__action-btn--delete-active" : ""
                }`}
                type="button"
                onClick={onDeleteClick}
                disabled={!canDelete}
              >
                Delete
              </button>
              <button
                className="trans-filter-actual__action-btn trans-filter-actual__action-btn--clear"
                type="button"
                onClick={handleClearFilters}
              >
                Clear Filters
              </button>
            </div>
          </div>

          {/* Column 2: Categories */}
          <div className="trans-filter-actual__column trans-filter-actual__column--categories">
            <div className="selector-control selector-control--fill">
              <span className="selector-control__label">Categories</span>
              <CategorySelector
                plTree={plTree}
                selectedCategories={selectedCategories}
                onCategoriesChange={handleCategoriesChange}
                categoryGroupOptions={categoryGroupSelectOptions}
              />
            </div>
          </div>

          {/* Column 3: Accounts */}
          <div className="trans-filter-actual__column trans-filter-actual__column--accounts">
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
      )}
    </section>
  );
}
