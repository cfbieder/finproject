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
  AlertTriangle,
  Inbox,
  Loader2,
  ChevronDown as ChevronDownIcon,
} from "lucide-react";
import { BUDGET_CONFIG } from "../features/Transaction/transactionConfig.js";
import { normalizeStringOptions } from "../features/Transaction/transactionUtils.js";
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
import PeriodSelector, { buildPeriodChipLabel } from "../components/PeriodSelector/PeriodSelector.jsx";
import Rest from "../js/rest.js";
import { useCoa } from "../hooks/useCoa.js";
import { useFilterOptions } from "../features/BudgetEntry/hooks/useFilterOptions.js";
import { exportTransactions } from "../utils/excelExporter.js";
import EmptyState from "../components/EmptyState.jsx";
import "./TransactionExplorer.css";

const config = BUDGET_CONFIG;
const BATCH_SIZE = 500;
const CURRENT_YEAR = new Date().getFullYear();

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

export default function TransBudget() {
  const [filters, setFilters] = useState(() => ({ ...config.defaultFilters }));
  const [filteredTotalsByCurrency, setFilteredTotalsByCurrency] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [searchText, setSearchText] = useState("");

  // Period state — budget defaults to full year
  const [periodValues, setPeriodValues] = useState({
    fromMonth: "01",
    toMonth: "12",
    actualYear: CURRENT_YEAR,
    toYear: CURRENT_YEAR,
    budgetYear: CURRENT_YEAR,
  });

  // Value range
  const [valueFrom, setValueFrom] = useState("");
  const [valueTo, setValueTo] = useState("");

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
  const { plTree, bsTree } = useCoa();
  const {
    setSelectedAccounts,
    setSelectedCategories,
  } = useFilterOptions();

  // Reset category/account selection on mount
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!initialized) {
      setSelectedCategories([]);
      setSelectedAccounts(["All"]);
      setInitialized(true);
    }
  }, [initialized, setSelectedCategories, setSelectedAccounts]);

  // ─── HierarchyFilter groups ───
  const categoryHierarchyGroups = useMemo(() => {
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

  const accountHierarchyGroups = useMemo(() => {
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

  // Additional search-bar filter (instant, client-side)
  const searchFilteredTransactions = useMemo(() => {
    if (!searchText.trim()) return transactions;
    const q = searchText.trim().toLowerCase();
    return transactions.filter((entry) => {
      const haystack = [
        entry?.Description1,
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
  }, [transactions, searchText]);

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

  // ─── Filter management ───
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.accountEnabled) count++;
    if (filters.categoryEnabled) count++;
    if (filters.valueFromEnabled) count++;
    if (filters.valueToEnabled) count++;
    return count;
  }, [filters]);

  const activeChips = useMemo(() => {
    const chips = [];
    if (filters.yearEnabled) {
      chips.push({ key: "period", label: buildPeriodChipLabel(filters), removable: false });
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
        next.toYear = String(vals.toYear ?? vals.actualYear);
        const sameYear = next.year === next.toYear;
        if (sameYear && vals.fromMonth === vals.toMonth) {
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
      }));
      setTransactionLimit(BATCH_SIZE);
    },
    [setTransactionLimit]
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
    setSearchText("");
    setPeriodValues({
      fromMonth: "01",
      toMonth: "12",
      actualYear: CURRENT_YEAR,
      budgetYear: CURRENT_YEAR,
    });
    setTransactionLimit(BATCH_SIZE);
  }, [setTransactionLimit, setSelectedAccounts, setSelectedCategories]);

  const handleLoadMore = useCallback(() => {
    setTransactionLimit((prev) => prev + BATCH_SIZE);
  }, [setTransactionLimit]);

  const handleExport = useCallback(() => {
    exportTransactions(sortedTransactions, "Budget Transactions", "budget-transactions");
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
    const normalized = new Map();
    for (const option of baseOptions) {
      if (typeof option !== "string") continue;
      const trimmed = option.trim();
      if (!trimmed) continue;
      const key = trimmed.toUpperCase();
      if (!normalized.has(key)) normalized.set(key, trimmed);
    }
    const fallbackCurrency = edit.editFormValues.Currency;
    if (typeof fallbackCurrency === "string" && fallbackCurrency.trim()) {
      const fallbackKey = fallbackCurrency.trim().toUpperCase();
      if (!normalized.has(fallbackKey)) normalized.set(fallbackKey, fallbackCurrency.trim());
    }
    return Array.from(normalized.values());
  }, [currencyOptions, edit.editFormValues.Currency]);

  // ─── KPI computations ───
  const kpis = useMemo(() => {
    const result = { totalIncome: 0, totalExpenses: 0 };
    for (const { amount } of filteredTotalsByCurrency) {
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
          Budget Transactions
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
          className={`btn btn--sm btn--outline ${showFilters ? "btn--active" : ""}`}
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal size={14} />
          Filters
          {activeFilterCount > 0 && <span className="txv2-badge">{activeFilterCount}</span>}
        </button>

        <button
          type="button"
          className="btn btn--sm btn--outline"
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
                  className="btn btn--sm btn--outline"
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
                toYear={periodValues.toYear}
                budgetYear={periodValues.budgetYear}
                onChange={handlePeriodChange}
                hideBudgetYear
                enableYearRange
                defaultPreset="this-year"
              />
            </div>

            {/* Categories */}
            <div className="txv2-filters__section">
              {categoryHierarchyGroups.length > 0 ? (
                <HierarchyFilter
                  label="Categories"
                  groups={categoryHierarchyGroups}
                  onSelectionChange={handleCategorySelection}
                />
              ) : (
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Loading...</span>
              )}
            </div>

            {/* Accounts */}
            <div className="txv2-filters__section">
              {accountHierarchyGroups.length > 0 ? (
                <HierarchyFilter
                  label="Accounts"
                  groups={accountHierarchyGroups}
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
            <button type="button" className="btn btn--sm btn--outline" onClick={clearAllFilters}>
              Reset
            </button>
            <button type="button" className="btn btn--sm btn--primary" onClick={applyValueRange}>
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
            className="btn btn--sm btn--outline"
            onClick={edit.handleEditRequest}
          >
            <Pencil size={13} />
            Edit
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            className="btn btn--sm btn--outline btn--danger-soft"
            onClick={del.handleDeleteRequest}
          >
            <Trash2 size={13} />
            Delete
          </button>
          <button
            type="button"
            className="btn btn--sm btn--outline"
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
            <span className="txv2-state__text">Loading budget entries...</span>
          </div>
        )}

        {!isLoading && error && (
          <div className="txv2-state">
            <AlertTriangle size={28} className="txv2-state__icon" />
            <span className="txv2-state__text txv2-state__text--error">{error}</span>
          </div>
        )}

        {!isLoading && !error && sortedTransactions.length === 0 && (
          <EmptyState
            variant={transactions.length === 0 ? "finance" : "searching"}
            message={transactions.length === 0 ? "No budget entries found" : "No entries match current filters"}
          />
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
                  className="btn btn--sm btn--primary"
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
