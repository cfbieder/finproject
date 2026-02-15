import { useCallback, useEffect, useMemo, useState } from "react";
import { ACTUAL_CONFIG } from "../features/Transaction/transactionConfig.js";
import { parseEntryDate, normalizeStringOptions } from "../features/Transaction/transactionUtils.js";
import { useTransactions } from "../features/Transaction/hooks/useTransactions.js";
import { useTransactionSelection } from "../features/Transaction/hooks/useTransactionSelection.js";
import { useTransactionEdit } from "../features/Transaction/hooks/useTransactionEdit.js";
import { useTransactionDelete } from "../features/Transaction/hooks/useTransactionDelete.js";
import TransactionFilter from "../features/Transaction/TransactionFilter.jsx";
import TransactionTable, {
  useTransactionCategoryOptions,
  useTransactionAccountOptions,
  useTransactionCurrencyOptions,
  useTransactionExchangeRates,
  computeTransactionBaseAmount,
} from "../features/Transaction/TransactionTable.jsx";
import TransactionEditModal from "../features/Transaction/TransactionEditModal.jsx";
import TransactionDeleteModal from "../features/Transaction/TransactionDeleteModal.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

const config = ACTUAL_CONFIG;
const TRANSACTION_BATCH_SIZE = 500;

export default function TransActual() {
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
        <TransactionFilter
          config={config}
          onFiltersChange={handleFilterChange}
          onDeleteClick={del.handleDeleteRequest}
          onEditClick={edit.handleEditRequest}
          onSelectAllToggle={handleSelectAllToggle}
          canDelete={selectedRows.size > 0}
          canEdit={selectedRows.size > 0}
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
        />
        <TransactionDeleteModal
          isOpen={del.showDeleteConfirmation}
          selectedCount={selectedRows.size}
          isDeleting={del.isDeleting}
          error={del.deleteError}
          onCancel={del.handleDeleteCancel}
          onConfirm={del.handleConfirmDelete}
        />
      </main>
    </>
  );
}
