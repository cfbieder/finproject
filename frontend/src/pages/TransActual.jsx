import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTUAL_CONFIG } from "../features/Transaction/transactionConfig.js";
import { parseEntryDate, normalizeStringOptions } from "../features/Transaction/transactionUtils.js";
import { useTransactions } from "../features/Transaction/hooks/useTransactions.js";
import { useTransactionSelection } from "../features/Transaction/hooks/useTransactionSelection.js";
import { useTransactionEdit } from "../features/Transaction/hooks/useTransactionEdit.js";
import { useTransactionDelete } from "../features/Transaction/hooks/useTransactionDelete.js";
import TransactionFilterActual from "../features/Transaction/TransactionFilterActual.jsx";
import TransactionTable, {
  useTransactionCategoryOptions,
  useTransactionAccountOptions,
  useTransactionCurrencyOptions,
  useTransactionExchangeRates,
  computeTransactionBaseAmount,
} from "../features/Transaction/TransactionTable.jsx";
import TransactionEditModal from "../features/Transaction/TransactionEditModal.jsx";
import TransactionDeleteModal from "../features/Transaction/TransactionDeleteModal.jsx";
import CategorySelector from "../components/CategorySelector/CategorySelector.jsx";
import Rest from "../js/rest.js";
import { useToast } from "../contexts";
import { useCoa } from "../hooks/useCoa.js";
import "./PageLayout.css";

const config = ACTUAL_CONFIG;
const TRANSACTION_BATCH_SIZE = 500;

const formatSplitDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : "";
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
  const { plTree } = useCoa();

  // Client-side filtering (Actual-specific: server returns broader results)
  const locallyFilteredTransactions = useMemo(() => {
    const accountList = Array.isArray(filters.account)
      ? filters.account
      : filters.account
      ? [filters.account]
      : [];
    const categoryList = Array.isArray(filters.category)
      ? filters.category
      : filters.category
      ? [filters.category]
      : [];
    const currencyList = Array.isArray(filters.currency)
      ? filters.currency
      : filters.currency
      ? [filters.currency]
      : [];
    return transactions.filter((entry) => {
      if (filters.yearEnabled) {
        const date = parseEntryDate(entry);
        if (!date || date.getFullYear().toString() !== filters.year) {
          return false;
        }
        if (filters.monthEnabled && Number.isFinite(filters.month)) {
          if (date.getMonth() !== Number(filters.month)) {
            return false;
          }
        } else if (filters.fromMonth && filters.toMonth) {
          // Month range filtering (from PeriodSelector custom mode)
          const monthNum = date.getMonth() + 1;
          const from = Number(filters.fromMonth);
          const to = Number(filters.toMonth);
          if (Number.isFinite(from) && Number.isFinite(to) && from !== 1 && to !== 12) {
            if (monthNum < from || monthNum > to) {
              return false;
            }
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
        const haystack = `${entry?.Description1 ?? ""} ${
          entry?.Description2 ?? ""
        }`.toLowerCase();
        if (!haystack.includes(filters.description.toLowerCase())) {
          return false;
        }
      }
      if (filters.valueFromEnabled && typeof filters.valueFrom === "number") {
        if (!(Number(entry?.Amount) >= filters.valueFrom)) {
          return false;
        }
      }
      if (filters.valueToEnabled && typeof filters.valueTo === "number") {
        if (!(Number(entry?.Amount) <= filters.valueTo)) {
          return false;
        }
      }
      return true;
    });
  }, [transactions, filters]);

  // Load filtered totals
  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;

    const loadFilteredTotals = async () => {
      try {
        const query = new URLSearchParams();
        config.buildTotalsQuery(query, filters);
        const path = `${config.totalsEndpoint}${
          query.toString() ? `?${query.toString()}` : ""
        }`;
        const payload = await Rest.fetchJson(path, {
          signal: controller.signal,
        });
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
            Array.from(totals.entries()).map(([currency, amount]) => ({
              currency,
              amount,
            }))
          );
        }
      } catch (err) {
        if (err?.name === "AbortError") return;
        console.error("[TransActual] Failed to load filtered totals:", err);
        if (isActive) setFilteredTotalsByCurrency([]);
      }
    };

    loadFilteredTotals();
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [filters]);

  const {
    selectedRows,
    sortConfig,
    sortedTransactions,
    isAllSelected,
    clearSelection,
    toggleRowSelection,
    handleSort,
    handleSelectAllToggle,
  } = useTransactionSelection(locallyFilteredTransactions);

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

  // Split transaction state
  const [splitTransaction, setSplitTransaction] = useState(null);
  const [splitCount, setSplitCount] = useState(2);
  const [splits, setSplits] = useState([]);
  const [isSavingSplit, setIsSavingSplit] = useState(false);

  const handleSplitClick = useCallback(() => {
    if (selectedRows.size !== 1) return;
    const entry = [...selectedRows.values()][0];
    const originalAmount = Number(entry.Amount);
    if (!Number.isFinite(originalAmount)) return;

    setSplitTransaction(entry);
    setSplitCount(2);
    setSplits([
      { amount: originalAmount, categoryName: entry.Category ?? "" },
      { amount: 0, categoryName: entry.Category ?? "" },
    ]);
  }, [selectedRows]);

  const handleSplitCountChange = useCallback(
    (newCount) => {
      const count = Math.max(2, Math.min(5, newCount));
      setSplitCount(count);
      setSplits((prev) => {
        const next = [];
        for (let i = 0; i < count; i++) {
          if (i < prev.length) {
            next.push(prev[i]);
          } else {
            next.push({ amount: 0, categoryName: splitTransaction?.Category ?? "" });
          }
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
      const response = await fetch(
        Rest.buildUrl(`${config.endpoint}/${id}/split`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            splits: splits.map((s) => ({
              amount: Number(s.amount),
              category_name: s.categoryName || undefined,
            })),
          }),
        }
      );
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

  const handleSplitCancel = useCallback(() => {
    setSplitTransaction(null);
    setSplits([]);
  }, []);

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

  const handleFilterChange = useCallback(
    (nextFilters) => {
      if (!nextFilters) return;
      setFilters(nextFilters);
      setTransactionLimit(TRANSACTION_BATCH_SIZE);
    },
    [setTransactionLimit]
  );

  const handleLoadMore = useCallback(() => {
    setTransactionLimit((prev) => prev + TRANSACTION_BATCH_SIZE);
  }, [setTransactionLimit]);

  const handleLoadPrevious = useCallback(() => {
    setTransactionLimit((prev) =>
      Math.max(TRANSACTION_BATCH_SIZE, prev - TRANSACTION_BATCH_SIZE)
    );
  }, [setTransactionLimit]);

  const canLoadPrevious = transactionLimit > TRANSACTION_BATCH_SIZE;

  return (
    <>
      <main className="page-main trans-budget-main">
        <TransactionFilterActual
          config={config}
          onFiltersChange={handleFilterChange}
          onDeleteClick={del.handleDeleteRequest}
          onEditClick={edit.handleEditRequest}
          onSplitClick={handleSplitClick}
          onSelectAllToggle={handleSelectAllToggle}
          canDelete={selectedRows.size > 0}
          canEdit={selectedRows.size > 0}
          canSplit={selectedRows.size === 1}
          isAllSelected={isAllSelected}
          filteredTotalsByCurrency={filteredTotalsByCurrency}
        />
        <div
          className="trans-budget-load-more"
          style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
        >
          <button
            className="generate-report-button"
            type="button"
            onClick={handleLoadPrevious}
            disabled={isLoading || !canLoadPrevious}
            style={{ minWidth: "150px", whiteSpace: "nowrap" }}
          >
            {isLoading ? "Loading…" : "Previous batch"}
          </button>
          <button
            className="generate-report-button"
            type="button"
            onClick={handleLoadMore}
            disabled={isLoading || !hasMoreTransactions}
            style={{ minWidth: "150px", whiteSpace: "nowrap" }}
          >
            {isLoading ? "Loading…" : "Next batch"}
          </button>
        </div>
        <TransactionTable
          config={config}
          isLoading={isLoading}
          error={error}
          hasTransactions={transactions.length > 0}
          hasFilteredTransactions={locallyFilteredTransactions.length > 0}
          sortedTransactions={sortedTransactions}
          sortConfig={sortConfig}
          onSort={handleSort}
          onRowToggle={toggleRowSelection}
        />
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
        <TransactionDeleteModal
          isOpen={del.showDeleteConfirmation}
          selectedCount={selectedRows.size}
          isDeleting={del.isDeleting}
          error={del.deleteError}
          onCancel={del.handleDeleteCancel}
          onConfirm={del.handleConfirmDelete}
        />
        {splitTransaction && (
          <div
            className="trans-budget-edit-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Split transaction"
          >
            <div className="trans-budget-edit-modal split-modal">
              <h3>Split Transaction</h3>
              <div className="split-modal__summary">
                <span><strong>Date:</strong> {formatSplitDate(splitTransaction.Date)}</span>
                <span><strong>Description:</strong> {splitTransaction.Description1 ?? ""}</span>
                <span><strong>Amount:</strong> {formatSplitAmount(splitTransaction.Amount)} {splitTransaction.Currency}</span>
                <span><strong>Account:</strong> {splitTransaction.Account ?? ""}</span>
              </div>
              <label className="split-modal__count-label">
                <span>Number of splits:</span>
                <select
                  className="form-input split-modal__count-select"
                  value={splitCount}
                  onChange={(e) => handleSplitCountChange(Number(e.target.value))}
                  disabled={isSavingSplit}
                >
                  {[2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <div className="split-modal__entries">
                {splits.map((split, index) => (
                  <div key={index} className="split-modal__entry">
                    <label className="split-modal__entry-label">
                      <span>Split {index + 1} Amount</span>
                      <input
                        className="form-input"
                        type="text"
                        inputMode="decimal"
                        value={split.amount}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
                            handleSplitAmountChange(index, raw);
                          } else {
                            const parsed = parseFloat(raw);
                            if (!Number.isNaN(parsed)) {
                              handleSplitAmountChange(index, raw);
                            }
                          }
                        }}
                        disabled={isSavingSplit}
                      />
                    </label>
                    <div className="split-modal__entry-category">
                      <span>Category</span>
                      {plTree?.length > 0 ? (
                        <CategorySelector
                          plTree={plTree}
                          selectedCategories={
                            split.categoryName ? [split.categoryName] : []
                          }
                          onCategoriesChange={(selected) =>
                            handleSplitCategoryChange(index, selected)
                          }
                          categoryGroupOptions={[]}
                        />
                      ) : (
                        <p className="trans-budget-edit-modal__count">
                          Loading categories…
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {(() => {
                const unallocated =
                  Number(splitTransaction.Amount) -
                  splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
                return (
                  <p
                    className={`split-modal__unallocated${
                      Math.abs(unallocated) > 0.01
                        ? " split-modal__unallocated--warning"
                        : ""
                    }`}
                  >
                    Unallocated: {formatSplitAmount(unallocated)} {splitTransaction.Currency}
                  </p>
                );
              })()}
              <div className="trans-budget-edit-modal__actions">
                <button
                  className="generate-report-button"
                  type="button"
                  onClick={handleSplitCancel}
                  disabled={isSavingSplit}
                >
                  Cancel
                </button>
                <button
                  className="generate-report-button"
                  type="button"
                  onClick={handleSplitSave}
                  disabled={
                    isSavingSplit ||
                    Math.abs(
                      Number(splitTransaction.Amount) -
                        splits.reduce(
                          (sum, s) => sum + (Number(s.amount) || 0),
                          0
                        )
                    ) > 0.01
                  }
                >
                  {isSavingSplit ? "Saving\u2026" : "Save Split"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
