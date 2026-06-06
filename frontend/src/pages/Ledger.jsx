import { useCallback, useMemo, useState } from "react";
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
  Scale,
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
import HierarchyFilter from "../components/HierarchyFilter/HierarchyFilter.jsx";
import Rest from "../js/rest.js";
import ConfirmModal from "../components/ConfirmModal/ConfirmModal.jsx";
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

  // ─── Account selection (single account — running balance needs one) ───
  const [selectedAccount, setSelectedAccount] = useState("");

  // ─── Filter panel visibility ───
  const [showFilters, setShowFilters] = useState(true);

  // ─── Period state — defaults to "This Year" ───
  const [periodValues, setPeriodValues] = useState({
    fromMonth: "01",
    toMonth: "12",
    actualYear: CURRENT_YEAR,
    toYear: CURRENT_YEAR,
    budgetYear: CURRENT_YEAR,
  });

  // ─── Search ───
  const [searchText, setSearchText] = useState("");

  // ─── Category filter ───
  const [selectedCategory, setSelectedCategory] = useState("");

  // ─── Filters derived from account + period selection ───
  // Period defaults to the current year (always-on, like Transactions/Budget).
  const [filters, setFilters] = useState(() => ({
    ...LEDGER_CONFIG.defaultFilters,
    yearEnabled: true,
    year: String(CURRENT_YEAR),
    toYear: String(CURRENT_YEAR),
    fromMonth: "01",
    toMonth: "12",
  }));

  // ─── Account groups for the HierarchyFilter (Bank Accounts, Fidelity Stock, …) ───
  const accountGroups = useMemo(() => {
    if (!bsTree?.length) return [];
    const groups = [];
    for (const topNode of bsTree) {
      // Assets, Liabilities are top-level; expose their children as groups
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

  // ─── Account currency for display ───
  const accountCurrency = useMemo(() => {
    if (!selectedAccount) return "";
    return accountCurrencyMap.get(selectedAccount) || "";
  }, [selectedAccount, accountCurrencyMap]);

  const accountSuffix = useCallback(
    (name) => accountCurrencyMap.get(name) || "",
    [accountCurrencyMap]
  );

  // ─── Single-account selection handler (from HierarchyFilter) ───
  const handleAccountSelect = useCallback((leafNames) => {
    const acct = leafNames[0] || "";
    setSelectedAccount(acct);
    setSelectedCategory("");
    setFilters((prev) => ({
      ...prev,
      accountEnabled: !!acct,
      account: acct ? [acct] : [],
    }));
  }, []);

  const handlePeriodChange = useCallback((vals) => {
    setPeriodValues(vals);
    setFilters((prev) => ({
      ...prev,
      yearEnabled: true,
      year: String(vals.actualYear),
      toYear: String(vals.toYear ?? vals.actualYear),
      fromMonth: vals.fromMonth,
      toMonth: vals.toMonth,
    }));
  }, []);

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

  // ─── Neutralize (brokerage securities trade → Transfer) ───
  // Smart: pairs an existing offsetting leg into "Transfer - Securities Trades"
  // with no new entry; only INSERTS a mirror when no offset exists — and warns
  // first (an unwanted insert is what creates the orphan double-counts).
  const [isNeutralizing, setIsNeutralizing] = useState(false);
  const [neutralizeConfirm, setNeutralizeConfirm] = useState(null); // {ids, message, danger}

  const postNeutralize = useCallback((id, dryRun) =>
    fetch(Rest.buildUrl(`/api/v2/transactions/${id}/neutralize`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    }).then(async (r) => {
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error || "Failed to neutralize");
      return body?.data;
    }), []);

  // Step 1: preview (dry-run) each selected row, then confirm — warning if any
  // would CREATE a new offsetting entry (no existing leg to pair with).
  const handleNeutralizeRequest = useCallback(async () => {
    const ids = [...selectedRows.values()].map((e) => e?.id ?? e?._id).filter(Boolean);
    if (!ids.length) { showErrorToast("Cannot neutralize: transaction not synced"); return; }
    setIsNeutralizing(true);
    try {
      const plans = await Promise.all(ids.map((id) => postNeutralize(id, true)));
      const mirrors = plans.filter((p) => p?.action === "mirror").length;
      const pairs = plans.length - mirrors;
      const message = mirrors > 0
        ? `⚠ ${mirrors} of ${plans.length} selected have NO matching offsetting leg nearby — neutralizing will CREATE ${mirrors} new offsetting entr${mirrors === 1 ? "y" : "ies"} (only do this for a genuine single-leg trade; otherwise it can double-count).` +
          (pairs > 0 ? ` The other ${pairs} will pair with an existing leg.` : "") + `\n\nContinue?`
        : `Pair ${pairs} transaction${pairs === 1 ? "" : "s"} with their existing offsetting leg (both become "Transfer - Securities Trades"). No new entries.\n\nContinue?`;
      setNeutralizeConfirm({ ids, message, danger: mirrors > 0, confirmLabel: "Neutralize" });
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to preview neutralize");
    } finally {
      setIsNeutralizing(false);
    }
  }, [selectedRows, postNeutralize, showErrorToast]);

  // Step 2: apply (on confirm).
  const doNeutralize = useCallback(async () => {
    const ids = neutralizeConfirm?.ids || [];
    setIsNeutralizing(true);
    try {
      const results = await Promise.all(ids.map((id) => postNeutralize(id, false)));
      const paired = results.filter((r) => r?.paired).length;
      showSuccess(
        ids.length === 1
          ? (paired ? "Neutralized (paired with offsetting leg)" : "Neutralized (offset entry created)")
          : `Neutralized ${ids.length} transactions (${paired} paired)`
      );
      setNeutralizeConfirm(null);
      clearSelection();
      await handleSuccess();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to neutralize");
    } finally {
      setIsNeutralizing(false);
    }
  }, [neutralizeConfirm, postNeutralize, handleSuccess, clearSelection, showSuccess, showErrorToast]);

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

            {/* Account — single-select (running balance needs one account) */}
            <div className="txv2-filters__section">
              {accountGroups.length > 0 ? (
                <HierarchyFilter
                  label="Account"
                  groups={accountGroups}
                  singleSelect
                  selectedLeaf={selectedAccount}
                  getItemSuffix={accountSuffix}
                  onSelectionChange={handleAccountSelect}
                />
              ) : (
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Loading...</span>
              )}
            </div>

            {/* Category filter (derived from loaded transactions) */}
            {hasAccount && transactionCategories.length > 0 && (
              <div className="txv2-filters__section ledger-filters__category">
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
          <button
            type="button"
            className="btn btn--sm btn--outline"
            onClick={handleNeutralizeRequest}
            disabled={isNeutralizing}
            title="Neutralize: mark a securities trade as a transfer (pairs an existing offsetting leg, else creates the offset — with a warning)"
          >
            <Scale size={13} />
            {isNeutralizing ? "Neutralizing…" : "Neutralize"}
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

      {/* ── Neutralize confirm (warns before creating a new offsetting entry) ── */}
      <ConfirmModal
        state={neutralizeConfirm ? { title: "Neutralize", message: neutralizeConfirm.message, confirmLabel: neutralizeConfirm.confirmLabel, danger: neutralizeConfirm.danger } : null}
        busy={isNeutralizing}
        onConfirm={doNeutralize}
        onCancel={() => setNeutralizeConfirm(null)}
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
