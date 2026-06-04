import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Download,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  AlertTriangle,
  Inbox,
  Loader2,
  ChevronDown as ChevronDownIcon,
  SlidersHorizontal,
  Pencil,
  Trash2,
  Plus,
  X,
  Copy,
} from "lucide-react";
import { LEDGER_CONFIG } from "../features/Transaction/transactionConfig.js";
import { useTransactions } from "../features/Transaction/hooks/useTransactions.js";
import { useTransactionSelection } from "../features/Transaction/hooks/useTransactionSelection.js";
import { useTransactionEdit } from "../features/Transaction/hooks/useTransactionEdit.js";
import { useTransactionDelete } from "../features/Transaction/hooks/useTransactionDelete.js";
import { parseEntryDate, normalizeStringOptions } from "../features/Transaction/transactionUtils.js";
import {
  useTransactionCategoryOptions,
  useTransactionAccountOptions,
  useTransactionCurrencyOptions,
  useTransactionExchangeRates,
  computeTransactionBaseAmount,
} from "../features/Transaction/TransactionTable.jsx";
import TransactionEditModal from "../features/Transaction/TransactionEditModal.jsx";
import TransactionDeleteModal from "../features/Transaction/TransactionDeleteModal.jsx";
import CategorySelector from "../components/CategorySelector/CategorySelector.jsx";
import PeriodSelector from "../components/PeriodSelector/PeriodSelector.jsx";
import Rest from "../js/rest.js";
import { useToast } from "../contexts";
import { useCoa } from "../hooks/useCoa.js";
import { exportTransactions } from "../utils/excelExporter.js";
import "./TransactionExplorer.css";
import EmptyState from "../components/EmptyState.jsx";
import "./Ledger.css";

// ─── Editable config for ledger (description + category) ───
const LEDGER_EDIT_CONFIG = {
  ...LEDGER_CONFIG,
  editFields: [
    { key: "Date", label: "Date", type: "date" },
    { key: "Description1", label: "Description", type: "text" },
    { key: "Category", label: "Category", type: "text" },
  ],
  editSuccessMessage: "Transactions updated successfully",
  deleteSuccessMessage: "Transactions deleted successfully",
};

const BATCH_SIZE = 2000;
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
    year: d.getFullYear() !== CURRENT_YEAR ? "numeric" : undefined,
  });
};

const formatAmount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  if (n < 0) return `(${numFmt.format(Math.abs(n))})`;
  return numFmt.format(Math.abs(n));
};

export default function Ledger() {
  const { showSuccess, showError: showErrorToast } = useToast();
  const { bsTree, accountCurrencyMap, plTree } = useCoa();

  // ─── Dynamic cascading account selection ───
  // selections[0] = "Assets", selections[1] = "Bank Accounts", selections[2] = "USD Bank Accounts", etc.
  const [selections, setSelections] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");

  // ─── Filter panel visibility ───
  const [showFilters, setShowFilters] = useState(true);

  // ─── Period state ───
  const [usePeriodFilter, setUsePeriodFilter] = useState(false);
  const [periodValues, setPeriodValues] = useState({
    fromMonth: "01",
    toMonth: "12",
    actualYear: CURRENT_YEAR,
    budgetYear: CURRENT_YEAR,
  });

  // ─── Search ───
  const [searchText, setSearchText] = useState("");

  // ─── Category filter ───
  const [selectedCategory, setSelectedCategory] = useState("");

  // ─── Filters derived from account + period selection ───
  const [filters, setFilters] = useState(() => ({ ...LEDGER_CONFIG.defaultFilters }));

  // ─── Dynamic cascade: compute dropdown levels from bsTree + selections ───
  // Each level is { label, options: [{ name, isLeaf }], value }
  const cascadeLevels = useMemo(() => {
    if (!bsTree?.length) return [];
    const levels = [];
    const labels = ["Type", "Group", "Sub-Group", "Account", "Account"];

    // Walk down the tree following selections
    let currentChildren = bsTree;
    for (let i = 0; i <= selections.length; i++) {
      if (!currentChildren?.length) break;

      // Separate groups and leaves at this level
      const groups = currentChildren.filter((n) => n.children?.length > 0);
      const leaves = currentChildren.filter((n) => !n.children?.length);

      // Build options: groups first, then leaves
      const options = [
        ...groups.map((n) => ({ name: n.name, isLeaf: false })),
        ...leaves.map((n) => ({ name: n.name, isLeaf: true })),
      ];

      if (options.length === 0) break;

      const selectedValue = selections[i] || "";
      const label = labels[Math.min(i, labels.length - 1)];
      levels.push({ label, options, value: selectedValue });

      // If user picked a value at this level, drill into it for the next level
      if (!selectedValue) break;
      const pickedNode = currentChildren.find((n) => n.name === selectedValue);
      if (!pickedNode || !pickedNode.children?.length) break; // selected a leaf or no children
      currentChildren = pickedNode.children;
    }

    return levels;
  }, [bsTree, selections]);

  // ─── Account currency for display ───
  const accountCurrency = useMemo(() => {
    if (!selectedAccount) return "";
    return accountCurrencyMap.get(selectedAccount) || "";
  }, [selectedAccount, accountCurrencyMap]);

  // ─── Cascading selection handler ───
  const handleCascadeChange = useCallback((levelIndex, value) => {
    // Truncate selections at this level and set the new value
    const next = selections.slice(0, levelIndex);
    if (value) next.push(value);
    setSelections(next);

    // Check if the selected value is a leaf account
    // Walk the tree to find the node
    let node = null;
    let children = bsTree || [];
    for (const sel of next) {
      node = children.find((n) => n.name === sel);
      if (!node) break;
      children = node.children || [];
    }

    const isLeaf = node && (!node.children || node.children.length === 0);
    if (isLeaf && value) {
      setSelectedAccount(value);
      setFilters((prev) => ({ ...prev, accountEnabled: true, account: [value] }));
    } else {
      setSelectedAccount("");
      setFilters((prev) => ({ ...prev, accountEnabled: false, account: [] }));
    }
  }, [selections, bsTree]);

  const handlePeriodChange = useCallback((vals) => {
    setPeriodValues(vals);
    setFilters((prev) => ({
      ...prev,
      yearEnabled: true,
      year: String(vals.actualYear),
      fromMonth: vals.fromMonth,
      toMonth: vals.toMonth,
    }));
  }, []);

  const handleTogglePeriod = useCallback(() => {
    setUsePeriodFilter((prev) => {
      const next = !prev;
      if (!next) {
        setFilters((f) => ({
          ...f,
          yearEnabled: false,
          year: "",
          fromMonth: "",
          toMonth: "",
        }));
      } else {
        setFilters((f) => ({
          ...f,
          yearEnabled: true,
          year: String(periodValues.actualYear),
          fromMonth: periodValues.fromMonth,
          toMonth: periodValues.toMonth,
        }));
      }
      return next;
    });
  }, [periodValues]);

  // ─── Data loading (only when account selected) ───
  const hasAccount = !!selectedAccount;
  const {
    transactions,
    transactionLimit,
    hasMoreTransactions,
    isLoading,
    error,
    setTransactionLimit,
    reload,
  } = useTransactions(
    LEDGER_CONFIG,
    hasAccount ? filters : { ...LEDGER_CONFIG.defaultFilters, accountEnabled: false, account: [] }
  );

  // ─── Unique category list from loaded transactions ───
  const transactionCategories = useMemo(() => {
    const cats = new Set();
    for (const t of transactions) {
      if (t.Category) cats.add(t.Category);
    }
    return [...cats].sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  // ─── Duplicate detection ───
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);

  const duplicateIds = useMemo(() => {
    if (!showDuplicatesOnly || transactions.length === 0) return new Set();

    const ids = new Set();
    const groups = new Map();
    for (const txn of transactions) {
      const amount = Number(txn.Amount);
      if (!Number.isFinite(amount)) continue;
      const key = `${amount.toFixed(2)}|${txn.Currency || ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(txn);
    }

    for (const [, group] of groups) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          const dateA = a.Date ? new Date(a.Date) : null;
          const dateB = b.Date ? new Date(b.Date) : null;
          let closeDates = false;
          if (dateA && dateB) {
            const diffDays = Math.abs(dateA - dateB) / (1000 * 60 * 60 * 24);
            closeDates = diffDays <= 3;
          }
          const descA = (a.Description1 || "").toLowerCase().trim();
          const descB = (b.Description1 || "").toLowerCase().trim();
          const sameDesc = descA && descB && descA === descB;
          if (closeDates || sameDesc) {
            ids.add(String(a.id || a._id));
            ids.add(String(b.id || b._id));
          }
        }
      }
    }
    return ids;
  }, [showDuplicatesOnly, transactions]);

  const handleToggleDuplicates = useCallback(() => {
    setShowDuplicatesOnly((prev) => !prev);
  }, []);

  // ─── Search + category + duplicate filtering ───
  const searchFiltered = useMemo(() => {
    let filtered = transactions;

    // Duplicate filter — show only flagged duplicates
    if (showDuplicatesOnly && duplicateIds.size > 0) {
      filtered = filtered.filter((entry) =>
        duplicateIds.has(String(entry.id || entry._id))
      );
    }

    if (selectedCategory) {
      filtered = filtered.filter((entry) => entry?.Category === selectedCategory);
    }

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      filtered = filtered.filter((entry) => {
        const haystack = [
          entry?.Description1,
          entry?.Description2,
          entry?.Category,
          String(entry?.Amount),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return filtered;
  }, [transactions, searchText, selectedCategory, showDuplicatesOnly, duplicateIds]);

  // ─── Sort + Selection ───
  const {
    selectedRows,
    sortConfig,
    sortedTransactions,
    isAllSelected,
    clearSelection,
    toggleRowSelection,
    handleSort,
    handleSelectAllToggle,
  } = useTransactionSelection(searchFiltered);

  // ─── Edit / Delete hooks ───
  const handleSuccess = useCallback(async () => {
    clearSelection();
    await reload();
  }, [clearSelection, reload]);

  const computeBase = useCallback(
    (amount, currency, r) => computeTransactionBaseAmount(amount, currency, r),
    []
  );

  const categoryOptions = useTransactionCategoryOptions();
  const accountOptions = useTransactionAccountOptions();
  const currencyOptions = useTransactionCurrencyOptions();
  const rates = useTransactionExchangeRates();

  const edit = useTransactionEdit(LEDGER_EDIT_CONFIG, selectedRows, rates, computeBase, handleSuccess);
  const del = useTransactionDelete(LEDGER_EDIT_CONFIG, selectedRows, handleSuccess);

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

  // ─── Compute running balance ───
  const transactionsWithBalance = useMemo(() => {
    if (sortedTransactions.length === 0) return [];

    const chronological = [...sortedTransactions].sort((a, b) => {
      const dateA = parseEntryDate(a.entry);
      const dateB = parseEntryDate(b.entry);
      if (!dateA || !dateB) return 0;
      const diff = dateA.getTime() - dateB.getTime();
      if (diff !== 0) return diff;
      return (a.entry.id || 0) - (b.entry.id || 0);
    });

    let runningBalance = 0;
    const balanceMap = new Map();
    for (const item of chronological) {
      const amount = Number(item.entry.Amount);
      if (Number.isFinite(amount)) runningBalance += amount;
      balanceMap.set(item.rowId, runningBalance);
    }

    return sortedTransactions.map((item) => ({
      ...item,
      runningBalance: balanceMap.get(item.rowId) ?? 0,
    }));
  }, [sortedTransactions]);

  // ─── Total amount for displayed transactions ───
  const totalAmount = useMemo(() => {
    let sum = 0;
    for (const { entry } of transactionsWithBalance) {
      const n = Number(entry.Amount);
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }, [transactionsWithBalance]);

  const handleLoadMore = useCallback(() => {
    setTransactionLimit((prev) => prev + BATCH_SIZE);
  }, [setTransactionLimit]);

  const handleExport = useCallback(() => {
    const exportData = transactionsWithBalance.map(({ entry, runningBalance }) => ({
      ...entry,
      RunningBalance: runningBalance,
    }));
    exportTransactions(exportData, "Account Ledger", "ledger");
  }, [transactionsWithBalance]);

  // ─── Add Transaction state ───
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    transaction_date: new Date().toISOString().slice(0, 10),
    description1: "",
    amount: "",
    currency: "",
    category: "",
  });
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // Pre-fill currency from selected account
  const openAddModal = useCallback(() => {
    setAddForm({
      transaction_date: new Date().toISOString().slice(0, 10),
      description1: "",
      amount: "",
      currency: accountCurrency || "USD",
      category: "",
    });
    setAddError("");
    setShowAddModal(true);
  }, [accountCurrency]);

  const handleAddFieldChange = useCallback((field, value) => {
    setAddForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleAddSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!selectedAccount) return;

    const amount = parseFloat(addForm.amount);
    if (!Number.isFinite(amount)) {
      setAddError("Please enter a valid amount.");
      return;
    }
    if (!addForm.transaction_date) {
      setAddError("Please enter a date.");
      return;
    }

    setIsAdding(true);
    setAddError("");
    try {
      // Look up account_id and category_id by name
      const accountData = await Rest.fetchAccountsV2({ activeOnly: true, leafOnly: true });
      const acct = accountData.find((a) => a.name === selectedAccount);
      if (!acct) throw new Error("Account not found");

      let category_id = null;
      if (addForm.category) {
        const cats = await Rest.fetchCategoriesV2({ activeOnly: true });
        const cat = cats.find((c) => c.name === addForm.category);
        category_id = cat?.id || null;
      }

      const body = {
        transaction_date: addForm.transaction_date,
        description1: addForm.description1 || null,
        amount,
        currency: addForm.currency || accountCurrency || "USD",
        base_amount: amount, // will be same if same currency
        base_currency: "USD",
        account_id: acct.id,
        category_id,
        source: "manual",
      };

      // Compute base_amount if different currency
      if (body.currency !== "USD" && rates) {
        const base = computeTransactionBaseAmount(amount, body.currency, rates);
        if (Number.isFinite(base)) body.base_amount = base;
      }

      const response = await fetch(Rest.buildUrl("/api/v2/transactions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const res = await response.json().catch(() => null);
        throw new Error(res?.error || "Failed to create transaction");
      }

      setShowAddModal(false);
      showSuccess("Transaction added successfully");
      await reload();
    } catch (err) {
      setAddError(err?.message ?? "Failed to add transaction");
    } finally {
      setIsAdding(false);
    }
  }, [selectedAccount, addForm, accountCurrency, rates, reload, showSuccess]);

  // ────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────
  return (
    <div className="txv2 ledger">
      {/* ── Header ── */}
      <div className="txv2-header">
        <h1 className="txv2-header__title">Ledger</h1>
      </div>

      {/* ── Account Banner (5) ── */}
      {hasAccount && (
        <div className="ledger-account-banner">
          <div className="ledger-account-banner__name">{selectedAccount}</div>
          <div className="ledger-account-banner__meta">
            {accountCurrency && <span className="ledger-account-banner__ccy">{accountCurrency}</span>}
            <span className="ledger-account-banner__count">
              {transactionsWithBalance.length.toLocaleString()} record{transactionsWithBalance.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {/* ── Toolbar: Search + Filter toggle + Add + Export ── */}
      <div className="txv2-toolbar">
        <div className="txv2-search">
          <Search size={16} className="txv2-search__icon" />
          <input
            type="text"
            className="txv2-search__input"
            placeholder="Search descriptions, categories..."
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
        </button>

        {hasAccount && (
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={openAddModal}
          >
            <Plus size={14} />
            Add
          </button>
        )}

        {hasAccount && (
          <button
            type="button"
            className={`btn btn--sm btn--outline ${showDuplicatesOnly ? "btn--active" : ""}`}
            onClick={handleToggleDuplicates}
            disabled={transactions.length === 0}
            title="Find potential duplicate entries"
          >
            <Copy size={14} />
            {showDuplicatesOnly ? "Show All" : "Find Duplicates"}
          </button>
        )}

        <button
          type="button"
          className="btn btn--sm btn--outline"
          onClick={handleExport}
          disabled={transactionsWithBalance.length === 0}
        >
          <Download size={14} />
          Export
        </button>
      </div>

      {/* ── Collapsible Filter Panel (1 + 2) ── */}
      {showFilters && (
        <div className="txv2-filters">
          <div className="ledger-filters__body">
            {/* Dynamic cascading account selectors */}
            <div className="ledger-cascade">
              {cascadeLevels.map((level, idx) => (
                <div className="ledger-cascade__field" key={idx}>
                  <span className="txv2-filters__label">{level.label}</span>
                  <select
                    className="ledger-cascade__select"
                    value={level.value}
                    onChange={(e) => handleCascadeChange(idx, e.target.value)}
                  >
                    <option value="">Select...</option>
                    {level.options.map(({ name, isLeaf }) => {
                      const ccy = isLeaf ? accountCurrencyMap.get(name) : null;
                      return (
                        <option key={name} value={name}>
                          {name}{ccy ? ` (${ccy})` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              ))}
            </div>

            {/* Period filter */}
            <div className="ledger-filters__period">
              <label className="txv2-filters__label ledger-filters__period-toggle">
                <input
                  type="checkbox"
                  checked={usePeriodFilter}
                  onChange={handleTogglePeriod}
                />
                Period Filter
              </label>
              {usePeriodFilter && (
                <PeriodSelector
                  fromMonth={periodValues.fromMonth}
                  toMonth={periodValues.toMonth}
                  actualYear={periodValues.actualYear}
                  budgetYear={periodValues.budgetYear}
                  onChange={handlePeriodChange}
                  hideBudgetYear
                  defaultPreset="this-year"
                />
              )}
            </div>

            {/* Category filter */}
            {hasAccount && transactionCategories.length > 0 && (
              <div className="ledger-filters__category">
                <span className="txv2-filters__label">Category</span>
                <select
                  className="ledger-cascade__select"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="">All Categories</option>
                  {transactionCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Duplicate Detection Banner ── */}
      {showDuplicatesOnly && hasAccount && (
        <div className="ledger-duplicate-banner">
          <AlertTriangle size={14} />
          {duplicateIds.size > 0 ? (
            <span>
              Found <strong>{duplicateIds.size}</strong> potential duplicate transactions
              (same amount &amp; currency, within 3 days or identical description)
            </span>
          ) : (
            <span>No potential duplicates found in the loaded transactions.</span>
          )}
          <button
            type="button"
            className="btn btn--xs"
            onClick={handleToggleDuplicates}
            style={{ marginLeft: "auto" }}
          >
            <X size={12} />
            Clear
          </button>
        </div>
      )}

      {/* ── Selection Action Bar (4) ── */}
      {selectedRows.size > 0 && (
        <div className="txv2-selection-bar">
          <input
            type="checkbox"
            className="txv2-checkbox"
            checked={isAllSelected}
            onChange={handleSelectAllToggle}
          />
          <span className="txv2-selection-bar__count">
            {selectedRows.size} selected
          </span>
          <div className="txv2-selection-bar__sep" />
          <button type="button" className="btn btn--sm btn--outline" onClick={edit.handleEditRequest}>
            <Pencil size={13} />
            Edit
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn--sm btn--outline btn--danger-soft" onClick={del.handleDeleteRequest}>
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

      {/* ── Prompt to select account ── */}
      {!hasAccount && (
        <div className="txv2-table-wrap">
          <div className="txv2-state">
            <Inbox size={32} className="txv2-state__icon" />
            <span className="txv2-state__text">
              Select an account to view its ledger
            </span>
          </div>
        </div>
      )}

      {/* ── Data Table ── */}
      {hasAccount && (
        <div className="txv2-table-wrap">
          {isLoading && (
            <div className="txv2-state">
              <Loader2 size={28} className="txv2-state__icon" style={{ animation: "spin 1s linear infinite" }} />
              <span className="txv2-state__text">Loading ledger...</span>
            </div>
          )}

          {!isLoading && error && (
            <div className="txv2-state">
              <AlertTriangle size={28} className="txv2-state__icon" />
              <span className="txv2-state__text txv2-state__text--error">{error}</span>
            </div>
          )}

          {!isLoading && !error && transactionsWithBalance.length === 0 && (
            <EmptyState
              variant={transactions.length === 0 ? "wallet" : "searching"}
              message={transactions.length === 0
                ? "No transactions found for this account"
                : "No transactions match current search"}
            />
          )}

          {!isLoading && !error && transactionsWithBalance.length > 0 && (
            <>
              <div className="txv2-table-scroll">
                <table className="txv2-table ledger-table">
                  <thead>
                    <tr>
                      <th className="txv2-th--center" style={{ width: "2.5rem" }}>
                        <input
                          type="checkbox"
                          className="txv2-checkbox"
                          checked={isAllSelected && transactionsWithBalance.length > 0}
                          onChange={handleSelectAllToggle}
                        />
                      </th>
                      <LedgerSortTh label="Date" colKey="Date" sortConfig={sortConfig} onSort={handleSort} />
                      <LedgerSortTh label="Description" colKey="Description1" sortConfig={sortConfig} onSort={handleSort} />
                      <LedgerSortTh label="Amount" colKey="Amount" sortConfig={sortConfig} onSort={handleSort} right />
                      <th className="txv2-th--center ledger-th--ccy">Ccy</th>
                      <LedgerSortTh label="Category" colKey="Category" sortConfig={sortConfig} onSort={handleSort} />
                      <th className="txv2-th--right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactionsWithBalance.map(({ entry, rowId, isSelected, runningBalance }) => {
                      const amount = Number(entry.Amount);
                      const isNeg = Number.isFinite(amount) && amount < 0;
                      const isBalNeg = Number.isFinite(runningBalance) && runningBalance < 0;
                      return (
                        <tr
                          key={rowId}
                          className={isSelected ? "txv2-row--selected" : ""}
                          onClick={() => toggleRowSelection(rowId, entry)}
                        >
                          <td className="txv2-td--center">
                            <input type="checkbox" className="txv2-checkbox" checked={isSelected} readOnly />
                          </td>
                          <td className="txv2-td--date">{formatDate(entry.Date)}</td>
                          <td className="txv2-td--desc" title={entry.Description1 ?? ""}>
                            {entry.Description1 || "-"}
                          </td>
                          <td className="txv2-td--right">
                            <span className={isNeg ? "txv2-amount--negative" : "txv2-amount--positive"}>
                              {Number.isFinite(amount) ? formatAmount(amount) : "-"}
                            </span>
                          </td>
                          <td className="txv2-td--currency">{entry.Currency || "-"}</td>
                          <td className="txv2-td--category">{entry.Category || "-"}</td>
                          <td className="txv2-td--right ledger-td--balance">
                            <span className={isBalNeg ? "txv2-amount--negative" : ""}>
                              {Number.isFinite(runningBalance) ? formatAmount(runningBalance) : "-"}
                            </span>
                            {accountCurrency && (
                              <span className="ledger-td--balance-ccy">{accountCurrency}</span>
                            )}
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
                  Showing {transactionsWithBalance.length.toLocaleString()} of{" "}
                  {hasMoreTransactions
                    ? `${transactionLimit.toLocaleString()}+`
                    : transactionsWithBalance.length.toLocaleString()}
                </span>
                <span className={`ledger-total-amount ${totalAmount < 0 ? "txv2-amount--negative" : "txv2-amount--positive"}`}>
                  Total: {formatAmount(totalAmount)}
                  {accountCurrency && <span className="ledger-total-amount__ccy">{accountCurrency}</span>}
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
      )}

      {/* ── Edit Modal (4) ── */}
      <TransactionEditModal
        config={LEDGER_EDIT_CONFIG}
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

      {/* ── Delete Modal ── */}
      <TransactionDeleteModal
        isOpen={del.showDeleteConfirmation}
        selectedCount={selectedRows.size}
        isDeleting={del.isDeleting}
        error={del.deleteError}
        onCancel={del.handleDeleteCancel}
        onConfirm={del.handleConfirmDelete}
      />

      {/* ── Add Transaction Modal (6) ── */}
      {showAddModal && (
        <>
          <div className="txv2-drawer-overlay" onClick={() => setShowAddModal(false)} />
          <div className="txv2-drawer" role="dialog" aria-modal="true" aria-label="Add transaction">
            <div className="txv2-drawer__header">
              <h3 className="txv2-drawer__title">Add Transaction</h3>
              <button
                type="button"
                className="txv2-drawer__close"
                onClick={() => setShowAddModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit}>
              <div className="txv2-drawer__body">
                <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "1rem" }}>
                  Adding to <strong>{selectedAccount}</strong>
                </p>

                {addError && (
                  <p style={{ color: "var(--danger, #C0504D)", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
                    {addError}
                  </p>
                )}

                <div className="txv2-field">
                  <label className="txv2-field__label">Date</label>
                  <input
                    className="txv2-field__input"
                    type="date"
                    value={addForm.transaction_date}
                    onChange={(e) => handleAddFieldChange("transaction_date", e.target.value)}
                    disabled={isAdding}
                    required
                  />
                </div>

                <div className="txv2-field">
                  <label className="txv2-field__label">Description</label>
                  <input
                    className="txv2-field__input"
                    type="text"
                    value={addForm.description1}
                    onChange={(e) => handleAddFieldChange("description1", e.target.value)}
                    disabled={isAdding}
                    placeholder="Transaction description"
                    autoComplete="off"
                  />
                </div>

                <div className="txv2-field">
                  <label className="txv2-field__label">Amount</label>
                  <input
                    className="txv2-field__input"
                    type="text"
                    inputMode="decimal"
                    value={addForm.amount}
                    onChange={(e) => handleAddFieldChange("amount", e.target.value)}
                    disabled={isAdding}
                    placeholder="0.00 (negative for debits)"
                    required
                  />
                </div>

                <div className="txv2-field">
                  <label className="txv2-field__label">Currency</label>
                  <input
                    className="txv2-field__input"
                    type="text"
                    value={addForm.currency}
                    onChange={(e) => handleAddFieldChange("currency", e.target.value.toUpperCase())}
                    disabled={isAdding}
                    maxLength={3}
                    style={{ width: "5rem" }}
                  />
                </div>

                <div className="txv2-field">
                  <label className="txv2-field__label">Category</label>
                  {plTree?.length > 0 ? (
                    <CategorySelector
                      plTree={plTree}
                      selectedCategories={addForm.category ? [addForm.category] : []}
                      onCategoriesChange={(selected) => {
                        const picked = selected.length > 0 ? selected[selected.length - 1] : "";
                        handleAddFieldChange("category", picked);
                      }}
                      categoryGroupOptions={[]}
                    />
                  ) : (
                    <input
                      className="txv2-field__input"
                      type="text"
                      value={addForm.category}
                      onChange={(e) => handleAddFieldChange("category", e.target.value)}
                      disabled={isAdding}
                      placeholder="Category name"
                    />
                  )}
                </div>
              </div>

              <div className="txv2-drawer__footer">
                <button
                  type="button"
                  className="btn btn--sm btn--outline"
                  onClick={() => setShowAddModal(false)}
                  disabled={isAdding}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--sm btn--primary"
                  disabled={isAdding}
                >
                  {isAdding ? "Saving..." : "Add Transaction"}
                </button>
              </div>
            </form>
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
function LedgerSortTh({ label, colKey, sortConfig, onSort, right = false }) {
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
