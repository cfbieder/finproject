import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  SlidersHorizontal,
  Download,
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Pencil,
  Trash2,
  Scissors,
  Ban,
  AlertTriangle,
  Inbox,
  Loader2,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";
import { ACTUAL_CONFIG } from "../features/Transaction/transactionConfig.js";
import { parseEntryDate, normalizeStringOptions } from "../features/Transaction/transactionUtils.js";
import { useTransactions } from "../features/Transaction/hooks/useTransactions.js";
import { useTransactionSelection } from "../features/Transaction/hooks/useTransactionSelection.js";
import { useTransactionEdit } from "../features/Transaction/hooks/useTransactionEdit.js";
import { useTransactionDelete } from "../features/Transaction/hooks/useTransactionDelete.js";
import {
  useTransactionCategoryOptions,
  useTransactionAccountOptions,
  useTransactionCurrencyOptions,
  useTransactionExchangeRates,
  computeTransactionBaseAmount,
} from "../features/Transaction/TransactionTable.jsx";
import TransactionEditModal from "../features/Transaction/TransactionEditModal.jsx";
import TransactionDeleteModal from "../features/Transaction/TransactionDeleteModal.jsx";
import HierarchyFilter from "../components/HierarchyFilter/HierarchyFilter.jsx";
import PeriodSelector from "../components/PeriodSelector/PeriodSelector.jsx";
import Rest from "../js/rest.js";
import { useToast } from "../contexts";
import { useCoa } from "../hooks/useCoa.js";
import { useFilterOptions } from "../features/BudgetEntry/hooks/useFilterOptions.js";
import { exportTransactions } from "../utils/excelExporter.js";
import "./TransactionExplorer.css";

const config = ACTUAL_CONFIG;
const BATCH_SIZE = 500;
const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = String(new Date().getMonth() + 1).padStart(2, "0");
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const numFmt = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatDate = (value) => {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
};

const formatAmount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return numFmt.format(Math.abs(n));
};

const formatSplitAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "";
};

export default function TransActual() {
  const { showSuccess, showError: showErrorToast } = useToast();
  const [filters, setFilters] = useState(() => ({ ...config.defaultFilters }));
  const [filteredTotalsByCurrency, setFilteredTotalsByCurrency] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [searchText, setSearchText] = useState("");

  // Period state for PeriodSelector
  const [periodValues, setPeriodValues] = useState({
    fromMonth: CURRENT_MONTH,
    toMonth: CURRENT_MONTH,
    actualYear: CURRENT_YEAR,
    budgetYear: CURRENT_YEAR,
  });

  // Value range
  const [valueFrom, setValueFrom] = useState("");
  const [valueTo, setValueTo] = useState("");

  // Transfer match status
  const [transferMatched, setTransferMatched] = useState("");

  // Data hooks
  const {
    transactions,
    transactionLimit,
    hasMoreTransactions,
    isLoading,
    error,
    setTransactionLimit,
    reload,
  } = useTransactions(config, filters);

  const categoryOptions = useTransactionCategoryOptions();
  const accountOptions = useTransactionAccountOptions();
  const currencyOptions = useTransactionCurrencyOptions();
  const rates = useTransactionExchangeRates();
  const { accountCurrencyMap, plTree, bsTree } = useCoa();
  const {
    accountOptions: filterAccountOptions,
    selectedAccounts,
    selectedCategories,
    setSelectedAccounts,
    setSelectedCategories,
  } = useFilterOptions();

  // ─── HierarchyFilter groups ───
  const categoryGroups = useMemo(() => {
    if (!plTree?.length) return [];
    const groups = [];
    for (const node of plTree) {
      // Income, Expense are top-level. "Transfers" is nested under Expense.
      if (node.name === "Income") {
        groups.push({ key: "income", label: "Income", node });
      } else if (node.name === "Expense") {
        // Split Expense into non-transfer children + a separate Transfers group
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

  const accountGroups = useMemo(() => {
    if (!bsTree?.length) return [];
    const groups = [];
    for (const topNode of bsTree) {
      // Assets, Liabilities are top-level
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

  // Track which category group is active for conditional transfer match UI
  const [activeCategoryGroup, setActiveCategoryGroup] = useState("__all__");

  // ─── Client-side filtering ───
  const locallyFilteredTransactions = useMemo(() => {
    const accountList = Array.isArray(filters.account) ? filters.account : filters.account ? [filters.account] : [];
    const categoryList = Array.isArray(filters.category) ? filters.category : filters.category ? [filters.category] : [];
    const currencyList = Array.isArray(filters.currency) ? filters.currency : filters.currency ? [filters.currency] : [];

    return transactions.filter((entry) => {
      if (filters.yearEnabled) {
        const date = parseEntryDate(entry);
        if (!date || date.getFullYear().toString() !== filters.year) return false;
        if (filters.monthEnabled && Number.isFinite(filters.month)) {
          if (date.getMonth() !== Number(filters.month)) return false;
        } else if (filters.fromMonth && filters.toMonth) {
          const monthNum = date.getMonth() + 1;
          const from = Number(filters.fromMonth);
          const to = Number(filters.toMonth);
          if (Number.isFinite(from) && Number.isFinite(to) && from !== 1 && to !== 12) {
            if (monthNum < from || monthNum > to) return false;
          }
        }
      }
      if (filters.accountEnabled && accountList.length) {
        if (!accountList.includes(entry?.Account)) return false;
      }
      if (filters.categoryEnabled && categoryList.length) {
        if (!categoryList.includes(entry?.Category)) return false;
      }
      if (filters.currencyEnabled && currencyList.length) {
        if (!currencyList.includes(entry?.Currency)) return false;
      }
      if (filters.descriptionEnabled && filters.description) {
        const haystack = `${entry?.Description1 ?? ""} ${entry?.Description2 ?? ""}`.toLowerCase();
        if (!haystack.includes(filters.description.toLowerCase())) return false;
      }
      if (filters.valueFromEnabled && typeof filters.valueFrom === "number") {
        if (!(Number(entry?.Amount) >= filters.valueFrom)) return false;
      }
      if (filters.valueToEnabled && typeof filters.valueTo === "number") {
        if (!(Number(entry?.Amount) <= filters.valueTo)) return false;
      }
      return true;
    });
  }, [transactions, filters]);

  // Additional search-bar filter (instant, client-side)
  const searchFilteredTransactions = useMemo(() => {
    if (!searchText.trim()) return locallyFilteredTransactions;
    const q = searchText.trim().toLowerCase();
    return locallyFilteredTransactions.filter((entry) => {
      const haystack = [
        entry?.Description1,
        entry?.Description2,
        entry?.Category,
        entry?.Account,
        entry?.Currency,
        String(entry?.Amount),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [locallyFilteredTransactions, searchText]);

  // ─── Filtered totals ───
  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    const loadTotals = async () => {
      try {
        const query = new URLSearchParams();
        config.buildTotalsQuery(query, filters);
        const path = `${config.totalsEndpoint}${query.toString() ? `?${query.toString()}` : ""}`;
        const payload = await Rest.fetchJson(path, { signal: controller.signal });
        const entries = config.parseTotalsEntries(payload);
        const totals = new Map();
        entries.forEach((entry) => {
          const currency = config.getTotalsCurrency(entry);
          const amount = config.getTotalsAmount(entry);
          if (!Number.isFinite(amount)) return;
          totals.set(currency, (totals.get(currency) || 0) + amount);
        });
        if (isActive) {
          setFilteredTotalsByCurrency(
            Array.from(totals.entries()).map(([currency, amount]) => ({ currency, amount }))
          );
        }
      } catch (err) {
        if (err?.name === "AbortError") return;
        if (isActive) setFilteredTotalsByCurrency([]);
      }
    };
    loadTotals();
    return () => { isActive = false; controller.abort(); };
  }, [filters]);

  // ─── Selection / Sort ───
  const {
    selectedRows,
    sortConfig,
    sortedTransactions,
    isAllSelected,
    clearSelection,
    toggleRowSelection,
    handleSort,
    handleSelectAllToggle,
  } = useTransactionSelection(searchFilteredTransactions);

  const handleSuccess = useCallback(async () => {
    clearSelection();
    await reload();
  }, [clearSelection, reload]);

  const computeBase = useCallback(
    (amount, currency, r) => computeTransactionBaseAmount(amount, currency, r),
    []
  );

  const edit = useTransactionEdit(config, selectedRows, rates, computeBase, handleSuccess);
  const del = useTransactionDelete(config, selectedRows, handleSuccess);

  // ─── Split state ───
  const [splitTransaction, setSplitTransaction] = useState(null);
  const [splitCount, setSplitCount] = useState(2);
  const [splits, setSplits] = useState([]);
  const [isSavingSplit, setIsSavingSplit] = useState(false);

  const handleSplitClick = useCallback(
    (_rowId, entryArg) => {
      const entry = entryArg || (selectedRows.size === 1 ? [...selectedRows.values()][0] : null);
      if (!entry) return;
      const originalAmount = Number(entry.Amount);
      if (!Number.isFinite(originalAmount)) return;
      setSplitTransaction(entry);
      setSplitCount(2);
      setSplits([
        { amount: originalAmount, categoryName: entry.Category ?? "" },
        { amount: 0, categoryName: entry.Category ?? "" },
      ]);
    },
    [selectedRows]
  );

  const handleSplitCountChange = useCallback(
    (newCount) => {
      const count = Math.max(2, Math.min(5, newCount));
      setSplitCount(count);
      setSplits((prev) => {
        const next = [];
        for (let i = 0; i < count; i++) {
          next.push(i < prev.length ? prev[i] : { amount: 0, categoryName: splitTransaction?.Category ?? "" });
        }
        return next;
      });
    },
    [splitTransaction]
  );

  const handleSplitAmountChange = useCallback((index, value) => {
    setSplits((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], amount: value };
      return next;
    });
  }, []);

  const handleSplitCategoryChange = useCallback((index, selected) => {
    const categoryName = selected.length > 0 ? selected[selected.length - 1] : "";
    setSplits((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], categoryName };
      return next;
    });
  }, []);

  const handleSplitSave = useCallback(async () => {
    if (!splitTransaction) return;
    const id = splitTransaction.id ?? splitTransaction._id;
    if (!id || typeof id !== "number") return;
    const originalAmount = Number(splitTransaction.Amount);
    const splitSum = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    if (Math.abs(splitSum - originalAmount) > 0.01) {
      showErrorToast("Split amounts must equal the original amount");
      return;
    }
    for (const s of splits) {
      if (!Number.isFinite(Number(s.amount)) || Number(s.amount) === 0) {
        showErrorToast("All splits must have a non-zero amount");
        return;
      }
    }
    setIsSavingSplit(true);
    try {
      const response = await fetch(Rest.buildUrl(`${config.endpoint}/${id}/split`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splits: splits.map((s) => ({
            amount: Number(s.amount),
            category_name: s.categoryName || undefined,
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to split transaction");
      }
      setSplitTransaction(null);
      setSplits([]);
      showSuccess("Transaction split successfully");
      await handleSuccess();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to split transaction");
    } finally {
      setIsSavingSplit(false);
    }
  }, [splitTransaction, splits, handleSuccess, showSuccess, showErrorToast]);

  // ─── Neutralize ───
  const [isNeutralizing, setIsNeutralizing] = useState(false);

  const handleNeutralizeClick = useCallback(
    async (_rowId, entryArg) => {
      const entry = entryArg || (selectedRows.size === 1 ? [...selectedRows.values()][0] : null);
      if (!entry) return;
      const id = entry?.id ?? entry?._id;
      if (!id || typeof id !== "number") {
        showErrorToast("Cannot neutralize: transaction not synced");
        return;
      }
      setIsNeutralizing(true);
      try {
        const response = await fetch(Rest.buildUrl(`${config.endpoint}/${id}/neutralize`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Failed to neutralize");
        }
        showSuccess("Transaction neutralized");
        await handleSuccess();
      } catch (err) {
        showErrorToast(err?.message ?? "Failed to neutralize");
      } finally {
        setIsNeutralizing(false);
      }
    },
    [selectedRows, handleSuccess, showSuccess, showErrorToast]
  );

  // ─── Filter management ───
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.accountEnabled) count++;
    if (filters.categoryEnabled) count++;
    if (filters.currencyEnabled) count++;
    if (filters.valueFromEnabled) count++;
    if (filters.valueToEnabled) count++;
    if (filters.transferMatched) count++;
    return count;
  }, [filters]);

  const activeChips = useMemo(() => {
    const chips = [];
    // Period is always shown
    if (filters.yearEnabled) {
      if (filters.monthEnabled && Number.isFinite(filters.month)) {
        chips.push({
          key: "period",
          label: `${MONTH_NAMES[filters.month]} ${filters.year}`,
          removable: false,
        });
      } else if (filters.fromMonth && filters.toMonth && filters.fromMonth !== filters.toMonth) {
        chips.push({
          key: "period",
          label: `${MONTH_NAMES[Number(filters.fromMonth) - 1]}-${MONTH_NAMES[Number(filters.toMonth) - 1]} ${filters.year}`,
          removable: false,
        });
      } else {
        chips.push({ key: "period", label: `${filters.year}`, removable: false });
      }
    }
    if (filters.accountEnabled && filters.account?.length) {
      const accounts = Array.isArray(filters.account) ? filters.account : [filters.account];
      chips.push({
        key: "account",
        label: accounts.length === 1 ? accounts[0] : `${accounts.length} accounts`,
        removable: true,
      });
    }
    if (filters.categoryEnabled && filters.category?.length) {
      const cats = Array.isArray(filters.category) ? filters.category : [filters.category];
      chips.push({
        key: "category",
        label: cats.length === 1 ? cats[0] : `${cats.length} categories`,
        removable: true,
      });
    }
    if (filters.valueFromEnabled) {
      chips.push({
        key: "valueFrom",
        label: `Min: ${numFmt.format(filters.valueFrom)}`,
        removable: true,
      });
    }
    if (filters.valueToEnabled) {
      chips.push({
        key: "valueTo",
        label: `Max: ${numFmt.format(filters.valueTo)}`,
        removable: true,
      });
    }
    if (filters.descriptionEnabled && filters.description) {
      chips.push({
        key: "description",
        label: `"${filters.description}"`,
        removable: true,
      });
    }
    if (filters.transferMatched) {
      chips.push({
        key: "transferMatched",
        label: `Transfers: ${filters.transferMatched === "true" ? "Matched" : "Unmatched"}`,
        removable: true,
      });
    }
    return chips;
  }, [filters]);

  const removeChip = useCallback((key) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (key === "account") {
        next.accountEnabled = false;
        next.account = [];
        setSelectedAccounts(["All"]);
      } else if (key === "category") {
        next.categoryEnabled = false;
        next.category = [];
        setSelectedCategories([]);
      } else if (key === "valueFrom") {
        next.valueFromEnabled = false;
        next.valueFrom = null;
        setValueFrom("");
      } else if (key === "valueTo") {
        next.valueToEnabled = false;
        next.valueTo = null;
        setValueTo("");
      } else if (key === "description") {
        next.descriptionEnabled = false;
        next.description = "";
      } else if (key === "transferMatched") {
        next.transferMatched = "";
        setTransferMatched("");
      }
      return next;
    });
    setTransactionLimit(BATCH_SIZE);
  }, [setTransactionLimit, setSelectedAccounts, setSelectedCategories]);

  // ─── Period change handler ───
  const handlePeriodChange = useCallback(
    (vals) => {
      setPeriodValues(vals);
      setFilters((prev) => {
        const next = { ...prev };
        next.yearEnabled = true;
        next.year = String(vals.actualYear);
        if (vals.fromMonth === vals.toMonth) {
          next.monthEnabled = true;
          next.month = Number(vals.fromMonth) - 1;
          next.fromMonth = vals.fromMonth;
          next.toMonth = vals.toMonth;
        } else {
          next.monthEnabled = false;
          next.month = undefined;
          next.fromMonth = vals.fromMonth;
          next.toMonth = vals.toMonth;
        }
        return next;
      });
      setTransactionLimit(BATCH_SIZE);
    },
    [setTransactionLimit]
  );

  // ─── Account change handler (HierarchyFilter) ───
  const handleAccountSelection = useCallback(
    (leafNames) => {
      const hasSelection = leafNames.length > 0;
      setFilters((prev) => ({
        ...prev,
        accountEnabled: hasSelection,
        account: leafNames,
      }));
      setTransactionLimit(BATCH_SIZE);
    },
    [setTransactionLimit]
  );

  // ─── Category change handler (HierarchyFilter) ───
  const handleCategorySelection = useCallback(
    (leafNames) => {
      const hasSelection = leafNames.length > 0;
      setFilters((prev) => ({
        ...prev,
        categoryEnabled: hasSelection,
        category: leafNames,
        // Clear transfer match filter if not on transfers group
        transferMatched: hasSelection ? prev.transferMatched : "",
      }));
      setTransactionLimit(BATCH_SIZE);
    },
    [setTransactionLimit]
  );

  // ─── Category group change handler — track active group for transfer match toggle ───
  const handleCategoryGroupChange = useCallback(
    (groupKey) => {
      setActiveCategoryGroup(groupKey);
      // Clear transfer match filter when switching away from transfers
      if (groupKey !== "transfers") {
        setTransferMatched("");
        setFilters((prev) => ({ ...prev, transferMatched: "" }));
      }
    },
    []
  );

  // ─── Value range apply ───
  const applyValueRange = useCallback(() => {
    setFilters((prev) => {
      const next = { ...prev };
      const from = parseFloat(valueFrom);
      const to = parseFloat(valueTo);
      next.valueFromEnabled = Number.isFinite(from);
      next.valueFrom = Number.isFinite(from) ? from : null;
      next.valueToEnabled = Number.isFinite(to);
      next.valueTo = Number.isFinite(to) ? to : null;
      return next;
    });
    setTransactionLimit(BATCH_SIZE);
    setShowFilters(false);
  }, [valueFrom, valueTo, setTransactionLimit]);

  const clearAllFilters = useCallback(() => {
    const defaults = { ...config.defaultFilters };
    setFilters(defaults);
    setSelectedAccounts(["All"]);
    setSelectedCategories([]);
    setValueFrom("");
    setValueTo("");
    setTransferMatched("");
    setActiveCategoryGroup("__all__");
    setSearchText("");
    setPeriodValues({
      fromMonth: CURRENT_MONTH,
      toMonth: CURRENT_MONTH,
      actualYear: CURRENT_YEAR,
      budgetYear: CURRENT_YEAR,
    });
    setTransactionLimit(BATCH_SIZE);
  }, [setTransactionLimit, setSelectedAccounts, setSelectedCategories]);

  const handleLoadMore = useCallback(() => {
    setTransactionLimit((prev) => prev + BATCH_SIZE);
  }, [setTransactionLimit]);

  const handleExport = useCallback(() => {
    exportTransactions(sortedTransactions, "Actual Transactions", "actual-transactions");
  }, [sortedTransactions]);

  // ─── Form helpers ───
  const safeCategoryOptions = useMemo(
    () => normalizeStringOptions(categoryOptions, edit.editFormValues.Category ?? ""),
    [categoryOptions, edit.editFormValues.Category]
  );
  const safeAccountOptions = useMemo(
    () => normalizeStringOptions(accountOptions, edit.editFormValues.Account ?? ""),
    [accountOptions, edit.editFormValues.Account]
  );
  const safeCurrencyOptions = useMemo(() => {
    const baseOptions = Array.isArray(currencyOptions) ? currencyOptions : [];
    return [...new Set(baseOptions.filter((opt) => typeof opt === "string"))];
  }, [currencyOptions]);

  // ─── KPI computations ───
  const kpis = useMemo(() => {
    const result = { totalIncome: 0, totalExpenses: 0 };
    for (const { currency, amount } of filteredTotalsByCurrency) {
      if (amount > 0) result.totalIncome += amount;
      else result.totalExpenses += amount;
    }
    return {
      ...result,
      net: result.totalIncome + result.totalExpenses,
      count: searchFilteredTransactions.length,
      byCurrency: filteredTotalsByCurrency,
    };
  }, [filteredTotalsByCurrency, searchFilteredTransactions]);

  // ────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────
  return (
    <div className="txv2">
      {/* ── Header ── */}
      <div className="txv2-header">
        <h1 className="txv2-header__title">
          Transactions
          <span className="txv2-header__subtitle">
            {kpis.count.toLocaleString()} record{kpis.count !== 1 ? "s" : ""}
          </span>
        </h1>
      </div>

      {/* ── KPI Cards ── */}
      <div className="txv2-kpis">
        {kpis.byCurrency.map(({ currency, amount }) => (
          <div className="txv2-kpi" key={currency}>
            <span className="txv2-kpi__label">{currency} Total</span>
            <span
              className={`txv2-kpi__value ${
                amount >= 0 ? "txv2-kpi__value--positive" : "txv2-kpi__value--negative"
              }`}
            >
              {amount < 0 ? `(${numFmt.format(Math.abs(amount))})` : numFmt.format(amount)}
            </span>
          </div>
        ))}
        {kpis.byCurrency.length > 1 && (
          <>
            <div className="txv2-kpi">
              <span className="txv2-kpi__label">Income (base)</span>
              <span className="txv2-kpi__value txv2-kpi__value--positive">
                {numFmt.format(kpis.totalIncome)}
              </span>
            </div>
            <div className="txv2-kpi">
              <span className="txv2-kpi__label">Expenses (base)</span>
              <span className="txv2-kpi__value txv2-kpi__value--negative">
                ({numFmt.format(Math.abs(kpis.totalExpenses))})
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Toolbar: Search + Filter Toggle + Export ── */}
      <div className="txv2-toolbar">
        <div className="txv2-search">
          <Search size={16} className="txv2-search__icon" />
          <input
            type="text"
            className="txv2-search__input"
            placeholder="Search descriptions, accounts, categories..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>

        <div className="txv2-toolbar__sep" />

        <button
          type="button"
          className={`txv2-btn ${showFilters ? "txv2-btn--active" : ""}`}
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal size={14} />
          Filters
          {activeFilterCount > 0 && <span className="txv2-badge">{activeFilterCount}</span>}
        </button>

        <button
          type="button"
          className="txv2-btn"
          onClick={handleExport}
          disabled={sortedTransactions.length === 0}
        >
          <Download size={14} />
          Export
        </button>

        {activeChips.length > 0 && (
          <>
            <div className="txv2-toolbar__sep" />
            <div className="txv2-chips">
              {activeChips.map((chip) => (
                <span className="txv2-chip" key={chip.key}>
                  {chip.label}
                  {chip.removable && (
                    <button
                      type="button"
                      className="txv2-chip__remove"
                      onClick={() => removeChip(chip.key)}
                      aria-label={`Remove ${chip.label} filter`}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
              {activeChips.some((c) => c.removable) && (
                <button
                  type="button"
                  className="txv2-btn"
                  style={{ fontSize: "0.7rem", padding: "0.25rem 0.5rem" }}
                  onClick={clearAllFilters}
                >
                  Clear all
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Collapsible Filter Panel ── */}
      {showFilters && (
        <div className="txv2-filters">
          <div className="txv2-filters__body">
            {/* Period */}
            <div className="txv2-filters__section">
              <span className="txv2-filters__label">Period</span>
              <PeriodSelector
                fromMonth={periodValues.fromMonth}
                toMonth={periodValues.toMonth}
                actualYear={periodValues.actualYear}
                budgetYear={periodValues.budgetYear}
                onChange={handlePeriodChange}
                hideBudgetYear
                defaultPreset="this-month"
              />
            </div>

            {/* Categories */}
            <div className="txv2-filters__section">
              {categoryGroups.length > 0 ? (
                <HierarchyFilter
                  label="Categories"
                  groups={categoryGroups}
                  onSelectionChange={handleCategorySelection}
                  onGroupChange={handleCategoryGroupChange}
                  extraSlot={
                    activeCategoryGroup === "transfers" ? (
                      <div className="hf__sub-toggle">
                        <span className="hf__sub-toggle-label">Match Status:</span>
                        {["", "true", "false"].map((val) => (
                          <button
                            key={val}
                            type="button"
                            className={`hf__sub-pill ${transferMatched === val ? "hf__sub-pill--active" : ""}`}
                            onClick={() => {
                              setTransferMatched(val);
                              setFilters((prev) => ({ ...prev, transferMatched: val }));
                            }}
                          >
                            {val === "" ? "All" : val === "true" ? "Matched" : "Unmatched"}
                          </button>
                        ))}
                      </div>
                    ) : null
                  }
                />
              ) : (
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Loading...</span>
              )}
            </div>

            {/* Accounts */}
            <div className="txv2-filters__section">
              {accountGroups.length > 0 ? (
                <HierarchyFilter
                  label="Accounts"
                  groups={accountGroups}
                  onSelectionChange={handleAccountSelection}
                />
              ) : (
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Loading...</span>
              )}
            </div>
          </div>

          <div className="txv2-filters__footer">
            {/* Value range */}
            <div className="txv2-filters__range" style={{ marginRight: "auto" }}>
              <div className="txv2-filters__range-field">
                <label>Min Amount</label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={valueFrom}
                  onChange={(e) => setValueFrom(e.target.value)}
                />
              </div>
              <div className="txv2-filters__range-field">
                <label>Max Amount</label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={valueTo}
                  onChange={(e) => setValueTo(e.target.value)}
                />
              </div>
            </div>
            <button type="button" className="txv2-btn" onClick={clearAllFilters}>
              Reset
            </button>
            <button type="button" className="txv2-btn txv2-btn--primary" onClick={applyValueRange}>
              Apply
            </button>
          </div>
        </div>
      )}

      {/* ── Selection Action Bar ── */}
      {selectedRows.size > 0 && (
        <div className="txv2-selection-bar">
          <input
            type="checkbox"
            className="txv2-checkbox"
            checked={isAllSelected}
            onChange={handleSelectAllToggle}
            aria-label="Select all"
          />
          <span className="txv2-selection-bar__count">
            {selectedRows.size} selected
          </span>
          <div className="txv2-selection-bar__sep" />
          <button
            type="button"
            className="txv2-btn"
            onClick={edit.handleEditRequest}
          >
            <Pencil size={13} />
            Edit
          </button>
          {selectedRows.size === 1 && (
            <>
              <button
                type="button"
                className="txv2-btn txv2-btn--split"
                onClick={() => handleSplitClick(null, null)}
              >
                <Scissors size={13} />
                Split
              </button>
              <button
                type="button"
                className="txv2-btn txv2-btn--neutralize"
                onClick={() => handleNeutralizeClick(null, null)}
                disabled={isNeutralizing}
              >
                <Ban size={13} />
                Neutralize
              </button>
            </>
          )}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="txv2-btn txv2-btn--danger"
            onClick={del.handleDeleteRequest}
          >
            <Trash2 size={13} />
            Delete
          </button>
          <button
            type="button"
            className="txv2-btn"
            onClick={clearSelection}
            style={{ fontSize: "0.72rem" }}
          >
            Deselect
          </button>
        </div>
      )}

      {/* ── Data Table ── */}
      <div className="txv2-table-wrap">
        {isLoading && (
          <div className="txv2-state">
            <Loader2 size={28} className="txv2-state__icon" style={{ animation: "spin 1s linear infinite" }} />
            <span className="txv2-state__text">Loading transactions...</span>
          </div>
        )}

        {!isLoading && error && (
          <div className="txv2-state">
            <AlertTriangle size={28} className="txv2-state__icon" />
            <span className="txv2-state__text txv2-state__text--error">{error}</span>
          </div>
        )}

        {!isLoading && !error && sortedTransactions.length === 0 && (
          <div className="txv2-state">
            <Inbox size={32} className="txv2-state__icon" />
            <span className="txv2-state__text">
              {transactions.length === 0 ? "No transactions found" : "No transactions match current filters"}
            </span>
          </div>
        )}

        {!isLoading && !error && sortedTransactions.length > 0 && (
          <>
            <div className="txv2-table-scroll">
              <table className="txv2-table">
                <thead>
                  <tr>
                    <th className="txv2-th--center">
                      <input
                        type="checkbox"
                        className="txv2-checkbox"
                        checked={isAllSelected && sortedTransactions.length > 0}
                        onChange={handleSelectAllToggle}
                        aria-label="Select all"
                      />
                    </th>
                    <SortTh label="Date" colKey="Date" sortConfig={sortConfig} onSort={handleSort} />
                    <SortTh label="Description" colKey="Description1" sortConfig={sortConfig} onSort={handleSort} />
                    <SortTh label="Amount" colKey="Amount" sortConfig={sortConfig} onSort={handleSort} right />
                    <SortTh label="Ccy" colKey="Currency" sortConfig={sortConfig} onSort={handleSort} />
                    <SortTh label="Base Amt" colKey="BaseAmount" sortConfig={sortConfig} onSort={handleSort} right />
                    <SortTh label="Account" colKey="Account" sortConfig={sortConfig} onSort={handleSort} />
                    <SortTh label="Category" colKey="Category" sortConfig={sortConfig} onSort={handleSort} />
                    <th style={{ width: "3.5rem" }} />
                  </tr>
                </thead>
                <tbody>
                  {sortedTransactions.map(({ entry, rowId, isSelected }) => {
                    const amount = Number(entry.Amount);
                    const baseAmount = Number(entry.BaseAmount);
                    const isNeg = Number.isFinite(amount) && amount < 0;
                    const isBaseNeg = Number.isFinite(baseAmount) && baseAmount < 0;
                    return (
                      <tr
                        key={rowId}
                        className={isSelected ? "txv2-row--selected" : ""}
                        onClick={() => toggleRowSelection(rowId, entry)}
                      >
                        <td className="txv2-td--center">
                          <input
                            type="checkbox"
                            className="txv2-checkbox"
                            checked={isSelected}
                            readOnly
                          />
                        </td>
                        <td className="txv2-td--date">{formatDate(entry.Date)}</td>
                        <td className="txv2-td--desc" title={entry.Description1 ?? ""}>
                          {entry.Description1 || "-"}
                        </td>
                        <td className="txv2-td--right">
                          <span className={isNeg ? "txv2-amount--negative" : "txv2-amount--positive"}>
                            {Number.isFinite(amount)
                              ? isNeg
                                ? `(${formatAmount(amount)})`
                                : formatAmount(amount)
                              : "-"}
                          </span>
                        </td>
                        <td className="txv2-td--currency">{entry.Currency || "-"}</td>
                        <td className="txv2-td--right">
                          <span className={isBaseNeg ? "txv2-amount--negative" : "txv2-amount--positive"}>
                            {Number.isFinite(baseAmount)
                              ? isBaseNeg
                                ? `(${formatAmount(baseAmount)})`
                                : formatAmount(baseAmount)
                              : "-"}
                          </span>
                        </td>
                        <td className="txv2-td--account">{entry.Account || "-"}</td>
                        <td className="txv2-td--category">{entry.Category || "-"}</td>
                        <td className="txv2-td--center">
                          <div className="txv2-row-actions">
                            <button
                              type="button"
                              className="txv2-row-action txv2-row-action--split"
                              title="Split"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSplitClick(rowId, entry);
                              }}
                            >
                              <Scissors size={13} />
                            </button>
                            <button
                              type="button"
                              className="txv2-row-action txv2-row-action--neutralize"
                              title="Neutralize"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleNeutralizeClick(rowId, entry);
                              }}
                            >
                              <Ban size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="txv2-table-footer">
              <span className="txv2-table-footer__count">
                Showing {sortedTransactions.length.toLocaleString()} of{" "}
                {hasMoreTransactions ? `${transactionLimit.toLocaleString()}+` : sortedTransactions.length.toLocaleString()}
              </span>
              {hasMoreTransactions && (
                <button
                  type="button"
                  className="txv2-btn txv2-btn--primary"
                  onClick={handleLoadMore}
                  disabled={isLoading}
                  style={{ fontSize: "0.72rem", padding: "0.3rem 0.75rem" }}
                >
                  <ChevronDownIcon size={12} />
                  Load more
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Edit Modal (reuse existing) ── */}
      <TransactionEditModal
        config={config}
        isOpen={edit.showEditModal}
        selectedCount={selectedRows.size}
        isEditing={edit.isEditing}
        error={edit.editError}
        formValues={edit.editFormValues}
        categoryOptions={categoryOptions}
        accountOptions={accountOptions}
        currencyOptions={currencyOptions}
        safeCategoryOptions={safeCategoryOptions}
        safeAccountOptions={safeAccountOptions}
        safeCurrencyOptions={safeCurrencyOptions}
        onFieldChange={edit.handleEditFieldChange}
        onCancel={edit.handleEditCancel}
        onSubmit={edit.handleEditSubmit}
        plTree={plTree}
      />

      {/* ── Delete Modal (reuse existing) ── */}
      <TransactionDeleteModal
        isOpen={del.showDeleteConfirmation}
        selectedCount={selectedRows.size}
        isDeleting={del.isDeleting}
        error={del.deleteError}
        onCancel={del.handleDeleteCancel}
        onConfirm={del.handleConfirmDelete}
      />

      {/* ── Split Drawer ── */}
      {splitTransaction && (
        <>
          <div className="txv2-drawer-overlay" onClick={() => { setSplitTransaction(null); setSplits([]); }} />
          <div className="txv2-drawer" role="dialog" aria-modal="true" aria-label="Split transaction">
            <div className="txv2-drawer__header">
              <h3 className="txv2-drawer__title">Split Transaction</h3>
              <button
                type="button"
                className="txv2-drawer__close"
                onClick={() => { setSplitTransaction(null); setSplits([]); }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="txv2-drawer__body">
              {/* Summary */}
              <dl className="txv2-split-summary">
                <dt>Date</dt>
                <dd>{formatDate(splitTransaction.Date)}</dd>
                <dt>Description</dt>
                <dd>{splitTransaction.Description1 ?? "-"}</dd>
                <dt>Amount</dt>
                <dd>
                  {formatSplitAmount(splitTransaction.Amount)} {splitTransaction.Currency}
                </dd>
                <dt>Account</dt>
                <dd>{splitTransaction.Account ?? "-"}</dd>
              </dl>

              {/* Split count */}
              <div className="txv2-field">
                <label className="txv2-field__label">Number of Splits</label>
                <select
                  className="txv2-field__input"
                  value={splitCount}
                  onChange={(e) => handleSplitCountChange(Number(e.target.value))}
                  disabled={isSavingSplit}
                  style={{ width: "5rem" }}
                >
                  {[2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              {/* Split entries */}
              {splits.map((split, index) => (
                <div key={index} className="txv2-split-entry">
                  <div className="txv2-field">
                    <label className="txv2-field__label">Split {index + 1}</label>
                    <input
                      className="txv2-field__input"
                      type="text"
                      inputMode="decimal"
                      value={split.amount}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
                          handleSplitAmountChange(index, raw);
                        } else {
                          const parsed = parseFloat(raw);
                          if (!Number.isNaN(parsed)) handleSplitAmountChange(index, raw);
                        }
                      }}
                      disabled={isSavingSplit}
                    />
                  </div>
                  <div className="txv2-field">
                    <label className="txv2-field__label">Category</label>
                    {plTree?.length > 0 ? (
                      <CategorySelector
                        plTree={plTree}
                        selectedCategories={split.categoryName ? [split.categoryName] : []}
                        onCategoriesChange={(selected) => handleSplitCategoryChange(index, selected)}
                        categoryGroupOptions={[]}
                      />
                    ) : (
                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Loading...</span>
                    )}
                  </div>
                </div>
              ))}

              {/* Unallocated */}
              {(() => {
                const unallocated =
                  Number(splitTransaction.Amount) -
                  splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
                return (
                  <p
                    className={`txv2-unallocated${
                      Math.abs(unallocated) > 0.01 ? " txv2-unallocated--warning" : ""
                    }`}
                  >
                    Unallocated: {formatSplitAmount(unallocated)} {splitTransaction.Currency}
                  </p>
                );
              })()}
            </div>

            <div className="txv2-drawer__footer">
              <button
                type="button"
                className="txv2-btn"
                onClick={() => { setSplitTransaction(null); setSplits([]); }}
                disabled={isSavingSplit}
              >
                Cancel
              </button>
              <button
                type="button"
                className="txv2-btn txv2-btn--primary"
                onClick={handleSplitSave}
                disabled={
                  isSavingSplit ||
                  Math.abs(
                    Number(splitTransaction.Amount) -
                      splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0)
                  ) > 0.01
                }
              >
                {isSavingSplit ? "Saving..." : "Save Split"}
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

/* ── Sort Header Cell ── */
function SortTh({ label, colKey, sortConfig, onSort, right = false }) {
  const isActive = sortConfig.key === colKey;
  return (
    <th className={right ? "txv2-th--right" : ""}>
      <button
        type="button"
        className={`txv2-th__sort${isActive ? " txv2-th__sort--active" : ""}`}
        onClick={() => onSort?.(colKey)}
      >
        <span>{label}</span>
        <span className="txv2-th__sort-icon">
          {isActive ? (
            sortConfig.direction === "desc" ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronUp size={12} />
            )
          ) : (
            <ChevronsUpDown size={12} />
          )}
        </span>
      </button>
    </th>
  );
}
