import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SlidersHorizontal,
  X,
  AlertTriangle,
  Inbox,
  Loader2,
  RotateCcw,
} from "lucide-react";
import BudgetEntriesAtualPopup from "../features/BudgetEntry/BudgetEntriesAtualPopup.jsx";
import BudgetEntriesBudgetPopup from "../features/BudgetEntry/BudgetEntriesBudgetPopup.jsx";
import BudgetExpenseSignModal from "../features/BudgetEntry/components/BudgetExpenseSignModal.jsx";
import { useFilterOptions } from "../features/BudgetEntry/hooks/useFilterOptions.js";
import { useBalanceData } from "../features/BudgetEntry/hooks/useBalanceData.js";
import { useCurrencyData } from "../features/BudgetEntry/hooks/useCurrencyData.js";
import { useBudgetEntrySubmit } from "../features/BudgetEntry/hooks/useBudgetEntrySubmit.js";
import { useCoa } from "../hooks/useCoa.js";
import HierarchyFilter from "../components/HierarchyFilter/HierarchyFilter.jsx";
import CategorySelector from "../components/CategorySelector/CategorySelector.jsx";
import PeriodSelector from "../components/PeriodSelector/PeriodSelector.jsx";
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
import EmptyState from "../components/EmptyState.jsx";
import "./BudgetWorksheetV2.css";

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default function BudgetWorksheetV2() {
  // ========== Data Hooks ==========
  const {
    accountOptions,
    categoryOptions,
    selectedAccounts,
    selectedCategories,
    categoryGroups,
    setSelectedAccounts,
    setSelectedCategories,
  } = useFilterOptions();

  const { currencyOptions, budgetRates, budgetRatesByMonth, defaultBudgetYear } =
    useCurrencyData();
  const { expenseAccountNames, accountCurrencyMap, plTree, bsTree } = useCoa();

  // ========== State: Date Range ==========
  const [fromMonth, setFromMonth] = useState(MONTH_OPTIONS[0].value);
  const [toMonth, setToMonth] = useState(MONTH_OPTIONS[11].value);
  const [actualYear, setActualYear] = useState(YEAR_OPTIONS[0]);
  const [budgetYear, setBudgetYear] = useState(
    () => defaultBudgetYear ?? new Date().getFullYear()
  );

  // Apply default budget year from settings
  useEffect(() => {
    if (
      defaultBudgetYear != null &&
      BUDGET_YEAR_OPTIONS.includes(defaultBudgetYear)
    ) {
      setBudgetYear(defaultBudgetYear);
    }
  }, [defaultBudgetYear]);

  // ========== State: UI ==========
  const [showFilters, setShowFilters] = useState(false);

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

  // ========== State: Popups ==========
  const [actualEntriesPopupRequest, setActualEntriesPopupRequest] =
    useState(null);
  const [budgetEntriesPopupRequest, setBudgetEntriesPopupRequest] =
    useState(null);

  // ========== Computed ==========
  const filteredAccountOptions = useMemo(
    () => accountOptions.filter((o) => o && o.toLowerCase() !== "all"),
    [accountOptions]
  );

  const operationalExpenseCategories = useMemo(
    () => getOperationalExpenseCategories(categoryGroups?.Expense),
    [categoryGroups]
  );

  const categoryGroupSelectOptions = useMemo(
    () => [
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
    ],
    [categoryGroups, operationalExpenseCategories]
  );

  // ========== HierarchyFilter groups (pill-style) ==========
  const hfCategoryGroups = useMemo(() => {
    if (!plTree?.length) return [];
    const groups = [];
    for (const node of plTree) {
      if (node.name === "Income") {
        groups.push({ key: "income", label: "Income", node });
      } else if (node.name === "Expense") {
        const transferNode = node.children?.find((c) => c.name === "Transfers");
        const expenseChildren = (node.children || []).filter((c) => c.name !== "Transfers");
        groups.push({
          key: "expense",
          label: "Expense",
          node: { ...node, children: expenseChildren },
        });
        if (transferNode) {
          groups.push({ key: "transfers", label: "Transfers", node: transferNode });
        }
      } else {
        groups.push({ key: node.name, label: node.name, node });
      }
    }
    return groups;
  }, [plTree]);

  const hfAccountGroups = useMemo(() => {
    if (!bsTree?.length) return [];
    const groups = [];
    for (const topNode of bsTree) {
      if (topNode.children?.length) {
        for (const child of topNode.children) {
          groups.push({ key: child.name, label: child.name, node: child });
        }
      } else {
        groups.push({ key: topNode.name, label: topNode.name, node: topNode });
      }
    }
    return groups;
  }, [bsTree]);

  const activeMonthRange = useMemo(() => {
    const start = normalizeMonthNumber(fromMonth, 1);
    const end = normalizeMonthNumber(toMonth, 12);
    return start <= end ? { start, end } : { start: end, end: start };
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
    const normalized = Array.isArray(selectedCategories)
      ? selectedCategories.filter(Boolean)
      : [];
    const meaningful = normalized.filter(
      (c) => typeof c === "string" && c.trim().length && c.toLowerCase() !== "all"
    );
    const explicit = meaningful.find((c) => !isCategoryGroupValue(c));
    if (explicit) return explicit;
    const group = meaningful.find((c) => isCategoryGroupValue(c));
    if (group) return group;
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
    const nc = normalizeCurrencyCode(entryForm.currency);
    if (!nc) return undefined;
    if (nc === BASE_CURRENCY) return 1;
    if (budgetRatesByMonth[nc] && entryForm.date) {
      const em = parseInt(entryForm.date.substring(5, 7));
      if (Number.isFinite(em)) {
        const mr = budgetRatesByMonth[nc][em];
        if (Number.isFinite(mr)) return mr;
        for (let m = em - 1; m >= 1; m--) {
          const fb = budgetRatesByMonth[nc][m];
          if (Number.isFinite(fb)) return fb;
        }
      }
    }
    const rate = budgetRates[nc];
    return Number.isFinite(rate) ? rate : undefined;
  }, [entryForm.currency, entryForm.date, budgetRates, budgetRatesByMonth]);

  const computedBaseAmount = useMemo(() => {
    const pa = parseNumericInput(entryForm.amount);
    if (!Number.isFinite(pa) || !Number.isFinite(currentExchangeRate))
      return undefined;
    return pa / currentExchangeRate;
  }, [entryForm.amount, currentExchangeRate]);

  const balanceTotals = useMemo(() => {
    if (!Array.isArray(balanceRows) || !balanceRows.length)
      return { actual: 0, budget: 0, difference: 0 };
    return balanceRows.reduce(
      (t, r) => {
        const a = Number.isFinite(r.actual) ? r.actual : 0;
        const b = Number.isFinite(r.budget) ? r.budget : 0;
        return {
          actual: t.actual + a,
          budget: t.budget + b,
          difference: t.difference + (a - b),
        };
      },
      { actual: 0, budget: 0, difference: 0 }
    );
  }, [balanceRows]);

  // ========== Budget Entry Submit ==========
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
    const defaultOpt =
      monthSelectOptions.find((o) => o.value !== "All") ??
      monthSelectOptions[0];
    setEntryForm((prev) => {
      if (
        prev.date &&
        monthSelectOptions.some((o) => o.value === prev.date)
      )
        return prev;
      return { ...prev, date: defaultOpt?.value ?? "" };
    });
  }, [monthSelectOptions]);

  useEffect(() => {
    setEntryForm((prev) => {
      if (prev.category === derivedCategoryLabel) return prev;
      return { ...prev, category: derivedCategoryLabel };
    });
  }, [derivedCategoryLabel]);

  useEffect(() => {
    if (!currencyOptions.length) return;
    setEntryForm((prev) => {
      if (currencyOptions.includes(prev.currency)) return prev;
      return { ...prev, currency: currencyOptions[0] };
    });
  }, [currencyOptions]);

  // ========== Handlers ==========
  const handlePeriodChange = useCallback(
    ({ fromMonth: fm, toMonth: tm, actualYear: ay, budgetYear: by }) => {
      setFromMonth(fm);
      setToMonth(tm);
      setActualYear(ay);
      setBudgetYear(by);
    },
    []
  );

  const handleAccountsChange = useCallback(
    (next) => setSelectedAccounts(next),
    [setSelectedAccounts]
  );

  const handleCategoriesChange = useCallback(
    (next) => setSelectedCategories(next),
    [setSelectedCategories]
  );

  // HierarchyFilter handlers — bridge leaf-name arrays to selected state
  const handleHfCategorySelection = useCallback(
    (leafNames) => {
      // empty array from HierarchyFilter means "All" selected — clear filter
      setSelectedCategories(leafNames.length > 0 ? leafNames : []);
    },
    [setSelectedCategories]
  );

  const handleHfAccountSelection = useCallback(
    (leafNames) => {
      setSelectedAccounts(leafNames.length > 0 ? leafNames : ["All"]);
    },
    [setSelectedAccounts]
  );

  const handleClearAll = useCallback(() => {
    setFromMonth(MONTH_OPTIONS[0].value);
    setToMonth(MONTH_OPTIONS[11].value);
    setActualYear(YEAR_OPTIONS[0]);
    setBudgetYear(defaultBudgetYear ?? new Date().getFullYear());
    setSelectedCategories([]);
    setSelectedAccounts(["All"]);
  }, [setSelectedCategories, setSelectedAccounts, defaultBudgetYear]);

  const handleActualEntryCopy = useCallback(
    (entry, rowMonthNumber) => {
      if (!entry || derivedCategoryIsGroup) return;
      const budgetMonthValue = buildBudgetMonthValue(budgetYear, rowMonthNumber);
      const monthValueExists =
        budgetMonthValue &&
        monthSelectOptions.some((o) => o.value === budgetMonthValue);
      setEntryForm((prev) => ({
        ...prev,
        account:
          entry.Account && entry.Account.trim() ? entry.Account : prev.account,
        amount:
          entry.Amount !== undefined && entry.Amount !== null
            ? String(entry.Amount)
            : prev.amount,
        currency: entry.Currency || prev.currency,
        date: monthValueExists ? budgetMonthValue : prev.date,
      }));
    },
    [derivedCategoryIsGroup, budgetYear, monthSelectOptions]
  );

  const handleBalanceActualDoubleClick = useCallback(
    (row) => {
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
    },
    [
      actualYear,
      selectedAccounts,
      expandedSelectedCategories,
      derivedCategoryIsGroup,
      handleActualEntryCopy,
    ]
  );

  const handleBalanceBudgetDoubleClick = useCallback(
    (row) => {
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
    },
    [
      budgetYear,
      selectedAccounts,
      expandedSelectedCategories,
      filteredAccountOptions,
      categoryOptions,
      currencyOptions,
      budgetRates,
      refreshBalances,
    ]
  );

  const handleClearForm = useCallback(() => {
    setEntryForm((prev) => ({
      ...prev,
      description: "",
      amount: "",
      note: "",
    }));
  }, []);

  const handleAccountSelect = useCallback(
    (selected) => {
      const accountName =
        selected.length > 0
          ? selected.find((a) => a !== "All" && a !== "None") || "None"
          : "None";

      setEntryForm((prev) => {
        const next = { ...prev, account: accountName };
        if (accountName !== "None" && accountCurrencyMap) {
          const accCurrency = accountCurrencyMap.get(accountName);
          if (accCurrency) next.currency = accCurrency;
        }
        // Auto-negate for expense accounts
        if (
          accountName !== "None" &&
          expenseAccountNames?.has(accountName) &&
          prev.amount &&
          parseNumericInput(prev.amount) > 0
        ) {
          next.amount = String(-Math.abs(parseNumericInput(prev.amount)));
        }
        return next;
      });
    },
    [accountCurrencyMap, expenseAccountNames]
  );

  // ========== Filter chips ==========
  const activeFilterCount = useMemo(() => {
    let count = 0;
    const hasAccounts =
      selectedAccounts.length > 0 &&
      !selectedAccounts.includes("All");
    if (hasAccounts) count++;
    const hasCats = selectedCategories.length > 0;
    if (hasCats) count++;
    return count;
  }, [selectedAccounts, selectedCategories]);

  const activeChips = useMemo(() => {
    const chips = [];
    // Period
    const fm = Number(fromMonth);
    const tm = Number(toMonth);
    if (fm === 1 && tm === 12) {
      chips.push({ key: "period", label: `${actualYear} / Budget ${budgetYear}`, removable: false });
    } else if (fm === tm) {
      chips.push({
        key: "period",
        label: `${MONTH_NAMES_SHORT[fm - 1]} ${actualYear} / Budget ${budgetYear}`,
        removable: false,
      });
    } else {
      chips.push({
        key: "period",
        label: `${MONTH_NAMES_SHORT[fm - 1]}-${MONTH_NAMES_SHORT[tm - 1]} ${actualYear} / Budget ${budgetYear}`,
        removable: false,
      });
    }
    // Accounts
    const effectiveAccounts = selectedAccounts.filter(
      (a) => a && a.toLowerCase() !== "all"
    );
    if (effectiveAccounts.length > 0) {
      chips.push({
        key: "account",
        label:
          effectiveAccounts.length === 1
            ? effectiveAccounts[0]
            : `${effectiveAccounts.length} accounts`,
        removable: true,
      });
    }
    // Categories
    if (selectedCategories.length > 0) {
      const display = derivedCategoryLabel || `${selectedCategories.length} categories`;
      chips.push({ key: "category", label: display, removable: true });
    }
    return chips;
  }, [
    fromMonth,
    toMonth,
    actualYear,
    budgetYear,
    selectedAccounts,
    selectedCategories,
    derivedCategoryLabel,
  ]);

  const removeChip = useCallback(
    (key) => {
      if (key === "account") setSelectedAccounts(["All"]);
      else if (key === "category") setSelectedCategories([]);
    },
    [setSelectedAccounts, setSelectedCategories]
  );

  // ========== Category Quick-Pick (right-click) ==========
  const [catPickerPos, setCatPickerPos] = useState(null);
  const catPickerRef = useRef(null);

  const handleCategoryContextMenu = useCallback((e) => {
    e.preventDefault();
    setCatPickerPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCatPickerSelect = useCallback(
    (next) => {
      setSelectedCategories(next);
      setCatPickerPos(null);
    },
    [setSelectedCategories]
  );

  // Close on click-outside or Escape
  useEffect(() => {
    if (!catPickerPos) return;
    const handleClick = (e) => {
      if (catPickerRef.current && !catPickerRef.current.contains(e.target)) {
        setCatPickerPos(null);
      }
    };
    const handleKey = (e) => {
      if (e.key === "Escape") setCatPickerPos(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [catPickerPos]);

  // ────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────
  return (
    <div className="bwv2">
      {/* ── Header ── */}
      <div className="bwv2-header">
        <h1 className="bwv2-header__title">Budget Worksheet</h1>
      </div>

      {/* ── KPI Cards ── */}
      <div className="bwv2-kpis">
        <div className="bwv2-kpi">
          <span className="bwv2-kpi__label">Total Actual</span>
          <span
            className={`bwv2-kpi__value${
              balanceTotals.actual < 0 ? " bwv2-kpi__value--negative" : ""
            }`}
          >
            {formatCurrencyValue(balanceTotals.actual)}
          </span>
        </div>
        <div className="bwv2-kpi">
          <span className="bwv2-kpi__label">Total Budget</span>
          <span
            className={`bwv2-kpi__value${
              balanceTotals.budget < 0 ? " bwv2-kpi__value--negative" : ""
            }`}
          >
            {formatCurrencyValue(balanceTotals.budget)}
          </span>
        </div>
        <div className="bwv2-kpi">
          <span className="bwv2-kpi__label">Difference</span>
          <span
            className={`bwv2-kpi__value${
              balanceTotals.difference < 0
                ? " bwv2-kpi__value--negative"
                : balanceTotals.difference > 0
                ? " bwv2-kpi__value--positive"
                : ""
            }`}
          >
            {formatCurrencyValue(balanceTotals.difference)}
          </span>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="bwv2-toolbar">
        <button
          type="button"
          className={`bwv2-btn${showFilters ? " bwv2-btn--active" : ""}`}
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal size={14} />
          Filters
          {activeFilterCount > 0 && (
            <span className="bwv2-badge">{activeFilterCount}</span>
          )}
        </button>

        <button type="button" className="bwv2-btn" onClick={handleClearAll}>
          <RotateCcw size={13} />
          Reset
        </button>

        {activeChips.length > 0 && (
          <>
            <div className="bwv2-toolbar__sep" />
            <div className="bwv2-chips">
              {activeChips.map((chip) => (
                <span
                  className={`bwv2-chip${chip.key === "category" ? " bwv2-chip--contextable" : ""}`}
                  key={chip.key}
                  onContextMenu={chip.key === "category" ? handleCategoryContextMenu : undefined}
                  title={chip.key === "category" ? "Right-click to change category" : undefined}
                >
                  {chip.label}
                  {chip.removable && (
                    <button
                      type="button"
                      className="bwv2-chip__remove"
                      onClick={() => removeChip(chip.key)}
                      aria-label={`Remove ${chip.label} filter`}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Collapsible Filter Panel ── */}
      {showFilters && (
        <div className="bwv2-filters">
          <div className="bwv2-filters__body">
            <div className="bwv2-filters__section">
              <span className="bwv2-filters__label">Period</span>
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
            <div className="bwv2-filters__section">
              {hfCategoryGroups.length > 0 ? (
                <HierarchyFilter
                  label="Categories"
                  groups={hfCategoryGroups}
                  onSelectionChange={handleHfCategorySelection}
                />
              ) : (
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  Loading...
                </span>
              )}
            </div>
            <div className="bwv2-filters__section">
              {hfAccountGroups.length > 0 ? (
                <HierarchyFilter
                  label="Accounts"
                  groups={hfAccountGroups}
                  onSelectionChange={handleHfAccountSelection}
                />
              ) : (
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  Loading...
                </span>
              )}
            </div>
          </div>
          <div className="bwv2-filters__footer">
            <button
              type="button"
              className="bwv2-btn"
              onClick={handleClearAll}
            >
              Reset
            </button>
            <button
              type="button"
              className="bwv2-btn bwv2-btn--primary"
              onClick={() => setShowFilters(false)}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* ── Two-Panel Content ── */}
      <div className="bwv2-content">
        {/* ── Left: Balance Table ── */}
        <div className="bwv2-table-wrap">
          {balancesStatus.loading && (
            <div className="bwv2-state">
              <Loader2
                size={28}
                className="bwv2-state__icon"
                style={{ animation: "bwv2-spin 1s linear infinite" }}
              />
              <span className="bwv2-state__text">Loading balances...</span>
            </div>
          )}

          {!balancesStatus.loading && balancesStatus.error && (
            <div className="bwv2-state">
              <AlertTriangle size={28} className="bwv2-state__icon" />
              <span className="bwv2-state__text bwv2-state__text--error">
                {balancesStatus.error}
              </span>
            </div>
          )}

          {!balancesStatus.loading &&
            !balancesStatus.error &&
            (!balanceRows || balanceRows.length === 0) && (
              <EmptyState variant="finance" message="No balance data for current filters" />
            )}

          {!balancesStatus.loading &&
            !balancesStatus.error &&
            balanceRows &&
            balanceRows.length > 0 && (
              <>
                <div className="bwv2-table-scroll">
                  <table className="bwv2-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th className="bwv2-th--right">Actual</th>
                        <th className="bwv2-th--right">Budget</th>
                        <th className="bwv2-th--right">Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {balanceRows.map((row) => {
                        const actual = Number.isFinite(row.actual)
                          ? row.actual
                          : 0;
                        const budget = Number.isFinite(row.budget)
                          ? row.budget
                          : 0;
                        const diff = actual - budget;
                        return (
                          <tr key={row.monthNumber}>
                            <td className="bwv2-td--month">
                              {row.monthLabel}
                            </td>
                            <td
                              className={`bwv2-td--numeric bwv2-td--interactive${
                                actual < 0 ? " bwv2-td--negative" : ""
                              }`}
                              onDoubleClick={() =>
                                handleBalanceActualDoubleClick(row)
                              }
                              title="Double-click to view actual entries"
                            >
                              {formatCurrencyValue(actual)}
                            </td>
                            <td
                              className={`bwv2-td--numeric bwv2-td--interactive${
                                budget < 0 ? " bwv2-td--negative" : ""
                              }`}
                              onDoubleClick={() =>
                                handleBalanceBudgetDoubleClick(row)
                              }
                              title="Double-click to view/edit budget entries"
                            >
                              {formatCurrencyValue(budget)}
                            </td>
                            <td
                              className={`bwv2-td--numeric${
                                diff < 0 ? " bwv2-td--negative" : ""
                              }`}
                            >
                              {formatCurrencyValue(diff)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="bwv2-td--month">Total</td>
                        <td
                          className={`bwv2-td--numeric${
                            balanceTotals.actual < 0
                              ? " bwv2-td--negative"
                              : ""
                          }`}
                        >
                          {formatCurrencyValue(balanceTotals.actual)}
                        </td>
                        <td
                          className={`bwv2-td--numeric${
                            balanceTotals.budget < 0
                              ? " bwv2-td--negative"
                              : ""
                          }`}
                        >
                          {formatCurrencyValue(balanceTotals.budget)}
                        </td>
                        <td
                          className={`bwv2-td--numeric${
                            balanceTotals.difference < 0
                              ? " bwv2-td--negative"
                              : ""
                          }`}
                        >
                          {formatCurrencyValue(balanceTotals.difference)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="bwv2-table-hint">
                  Double-click Actual or Budget cells to drill into entries
                </div>
              </>
            )}
        </div>

        {/* ── Right: Entry Form ── */}
        <div
          className={`bwv2-entry${
            derivedCategoryIsGroup ? " bwv2-entry--disabled" : ""
          }`}
        >
          <div className="bwv2-entry__header">
            <h3 className="bwv2-entry__title">New Entry</h3>
            {derivedCategoryLabel && (
              <span
                className="bwv2-entry__category-badge bwv2-chip--contextable"
                title="Right-click to change category"
                onContextMenu={handleCategoryContextMenu}
              >
                {derivedCategoryLabel}
              </span>
            )}
          </div>

          {derivedCategoryIsGroup ? (
            <div className="bwv2-entry__body">
              <div className="bwv2-entry__disabled-msg">
                Select a specific category (not a group) to enter budget data
              </div>
            </div>
          ) : (
            <>
              <div className="bwv2-entry__body">
                {/* Month + Currency */}
                <div className="bwv2-entry__row">
                  <div className="bwv2-field">
                    <label className="bwv2-field__label">Month</label>
                    <select
                      className="bwv2-field__input"
                      value={entryForm.date}
                      onChange={(e) =>
                        setEntryForm((p) => ({ ...p, date: e.target.value }))
                      }
                    >
                      {monthSelectOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="bwv2-field">
                    <label className="bwv2-field__label">Currency</label>
                    <select
                      className="bwv2-field__input"
                      value={entryForm.currency}
                      onChange={(e) =>
                        setEntryForm((p) => ({
                          ...p,
                          currency: e.target.value,
                        }))
                      }
                      disabled={entryForm.account !== "None"}
                    >
                      {currencyOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    {entryForm.account !== "None" && (
                      <span className="bwv2-field__hint">
                        Set by account
                      </span>
                    )}
                  </div>
                </div>

                {/* Account */}
                <div className="bwv2-entry__row bwv2-entry__row--full">
                  <div className="bwv2-field">
                    <label className="bwv2-field__label">Account</label>
                    <select
                      className="bwv2-field__input"
                      value={entryForm.account}
                      onChange={(e) => {
                        const val = e.target.value;
                        handleAccountSelect(val === "None" ? [] : [val]);
                      }}
                    >
                      <option value="None">None</option>
                      {filteredAccountOptions.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Amount + Base Amount */}
                <div className="bwv2-entry__row">
                  <div className="bwv2-field">
                    <label className="bwv2-field__label">
                      Amount ({entryForm.currency})
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="bwv2-field__input"
                      placeholder="0.00 or math (100+50)"
                      value={entryForm.amount}
                      onChange={(e) =>
                        setEntryForm((p) => ({
                          ...p,
                          amount: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="bwv2-field">
                    <label className="bwv2-field__label">
                      Base Amount (USD)
                    </label>
                    <div
                      className={`bwv2-field__input bwv2-field__input--readonly${
                        Number.isFinite(computedBaseAmount) &&
                        computedBaseAmount < 0
                          ? " bwv2-field__input--negative"
                          : ""
                      }`}
                    >
                      {Number.isFinite(computedBaseAmount)
                        ? formatCurrencyValue(computedBaseAmount)
                        : "-"}
                    </div>
                  </div>
                </div>

                {/* Category (derived, read-only — right-click to change) */}
                <div className="bwv2-entry__row bwv2-entry__row--full">
                  <div className="bwv2-field">
                    <label className="bwv2-field__label">Category</label>
                    <div
                      className="bwv2-field__derived bwv2-chip--contextable"
                      onContextMenu={handleCategoryContextMenu}
                      title="Right-click to change category"
                    >
                      {derivedCategoryLabel || "-"}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div className="bwv2-entry__row bwv2-entry__row--full">
                  <div className="bwv2-field">
                    <label className="bwv2-field__label">Description</label>
                    <textarea
                      className="bwv2-field__input bwv2-field__input--textarea"
                      rows={2}
                      value={entryForm.description}
                      onChange={(e) =>
                        setEntryForm((p) => ({
                          ...p,
                          description: e.target.value,
                        }))
                      }
                      placeholder="Optional description"
                    />
                  </div>
                </div>

                {/* Note */}
                <div className="bwv2-entry__row bwv2-entry__row--full">
                  <div className="bwv2-field">
                    <label className="bwv2-field__label">Note</label>
                    <textarea
                      className="bwv2-field__input bwv2-field__input--textarea"
                      rows={2}
                      value={entryForm.note}
                      onChange={(e) =>
                        setEntryForm((p) => ({
                          ...p,
                          note: e.target.value,
                        }))
                      }
                      placeholder="Optional note"
                    />
                  </div>
                </div>

                {/* Status */}
                {entryStatus.error && (
                  <div className="bwv2-entry__status bwv2-entry__status--error">
                    {entryStatus.error}
                  </div>
                )}
                {entryStatus.message && !entryStatus.error && (
                  <div className="bwv2-entry__status bwv2-entry__status--success">
                    {entryStatus.message}
                  </div>
                )}
              </div>

              <div className="bwv2-entry__actions">
                <button
                  type="button"
                  className="bwv2-btn"
                  onClick={handleClearForm}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="bwv2-btn bwv2-btn--primary"
                  onClick={handleBudgetEntrySubmit}
                  disabled={
                    entryStatus.loading ||
                    !entryForm.amount ||
                    !entryForm.date
                  }
                >
                  {entryStatus.loading ? "Saving..." : "Save Entry"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Expense Sign Modal ── */}
      <BudgetExpenseSignModal
        isOpen={!!expenseSignModal}
        isSubmitting={entryStatus.loading}
        onClose={handleExpenseSignModalClose}
        onConfirmNegative={handleExpenseSignModalConfirmNegative}
        onKeepPositive={handleExpenseSignModalKeepPositive}
      />

      {/* ── Drill-down Popups (reuse existing) ── */}
      <BudgetEntriesAtualPopup request={actualEntriesPopupRequest} />
      <BudgetEntriesBudgetPopup request={budgetEntriesPopupRequest} />

      {/* ── Category Quick-Pick Popover ── */}
      {catPickerPos && (
        <>
          <div className="bwv2-catpicker-backdrop" />
          <div
            ref={catPickerRef}
            className="bwv2-catpicker"
            style={{
              left: Math.min(catPickerPos.x, window.innerWidth - 320),
              top: Math.min(catPickerPos.y, window.innerHeight - 400),
            }}
          >
            <div className="bwv2-catpicker__header">
              <span className="bwv2-catpicker__title">Change Category</span>
              <button
                type="button"
                className="bwv2-catpicker__close"
                onClick={() => setCatPickerPos(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="bwv2-catpicker__body">
              {plTree?.length > 0 ? (
                <CategorySelector
                  plTree={plTree}
                  selectedCategories={selectedCategories}
                  onCategoriesChange={handleCatPickerSelect}
                  categoryGroupOptions={categoryGroupSelectOptions}
                  categoryOptions={categoryOptions}
                />
              ) : (
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  Loading...
                </span>
              )}
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes bwv2-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
