import { useCallback, useEffect, useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import TransactionActualFilter from "../features/TransactionActual/TransactionActualFilter.jsx";
import TransactionActualTable, {
  useTransactionActualAccountOptions,
  useTransactionActualCategoryOptions,
  useTransactionActualCurrencyOptions,
  useTransactionActualExchangeRates,
} from "../features/TransactionActual/TransactionActualTable.jsx";
import TransActualEditModal from "../features/TransactionActual/TransActualEditModal.jsx";
import TransActualDeleteModal from "../features/TransactionActual/TransActualDeleteModal.jsx";
// Using v2 API (PostgreSQL)
import { useTransactionsV2 as useTransactions } from "../features/TransactionActual/hooks/useTransactionsV2.js";
import { useTransActualFilters } from "../features/TransactionActual/hooks/useTransActualFilters.js";
import { useTransActualSelection } from "../features/TransactionActual/hooks/useTransActualSelection.js";
import { useTransActualEdit } from "../features/TransactionActual/hooks/useTransActualEdit.js";
import { useTransActualDelete } from "../features/TransactionActual/hooks/useTransActualDelete.js";
import {
  DEFAULT_FILTERS,
  parseEntryDate,
} from "../features/TransactionActual/transActualUtils.js";
import Rest from "../js/rest.js";
import "./PageLayout.css";

const EDIT_FIELDS = [
  { key: "Date", label: "Date", type: "date" },
  { key: "Description1", label: "Description", type: "text" },
  { key: "Amount", label: "LC Amount", type: "number" },
  { key: "Currency", label: "Currency", type: "text" },
  { key: "BaseAmount", label: "USD Amount", type: "number" },
  { key: "Account", label: "Account", type: "text" },
  { key: "Category", label: "Category", type: "text" },
];

const TRANSACTION_BATCH_SIZE = 500;

/**
 * TransActual component manages the actual transaction history page.
 * Provides functionality to view, filter, edit, and delete actual transactions.
 */
export default function TransActual() {
  // Get filter state first so we can pass to useTransactions
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS }));
  const [filteredTotalsByCurrency, setFilteredTotalsByCurrency] = useState([]);

  // Load transactions with current filters
  const {
    transactions,
    transactionLimit,
    hasMoreTransactions,
    isLoading,
    error,
    setTransactionLimit,
    reload,
  } = useTransactions(filters);

  // Get reference data from custom hooks
  const categoryOptions = useTransactionActualCategoryOptions();
  const accountOptions = useTransactionActualAccountOptions();
  const currencyOptions = useTransactionActualCurrencyOptions();
  const actualRates = useTransactionActualExchangeRates();

  // Normalize options with current edit form values
  const safeCategoryOptions = useMemo(() => {
    const baseOptions = Array.isArray(categoryOptions) ? categoryOptions : [];
    return [...new Set(baseOptions.filter((opt) => typeof opt === "string"))];
  }, [categoryOptions]);

  const safeAccountOptions = useMemo(() => {
    const baseOptions = Array.isArray(accountOptions) ? accountOptions : [];
    return [...new Set(baseOptions.filter((opt) => typeof opt === "string"))];
  }, [accountOptions]);

  const safeCurrencyOptions = useMemo(() => {
    const baseOptions = Array.isArray(currencyOptions) ? currencyOptions : [];
    return [...new Set(baseOptions.filter((opt) => typeof opt === "string"))];
  }, [currencyOptions]);

  // Apply client-side filters (for additional filtering beyond API)
  const { filteredTransactions } = useTransActualFilters(transactions);

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
    return filteredTransactions.filter((entry) => {
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
  }, [filteredTransactions, filters]);

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    const appendListParam = (params, key, values) => {
      const list = Array.isArray(values) ? values : values ? [values] : [];
      list.forEach((value) => {
        if (value !== undefined && value !== null && value !== "") {
          params.append(key, String(value));
        }
      });
    };

    const loadFilteredTotals = async () => {
      try {
        const query = new URLSearchParams();
        const setParam = (key, value) => {
          if (value !== undefined && value !== null && value !== "") {
            query.set(key, String(value));
          }
        };
        if (filters.yearEnabled && filters.year) {
          setParam("actualYear", filters.year);
        }
        if (
          filters.monthEnabled &&
          filters.month !== undefined &&
          filters.month !== null
        ) {
          setParam("month", filters.month + 1);
        }
        if (filters.accountEnabled && filters.account) {
          appendListParam(query, "account", filters.account);
        }
        if (filters.categoryEnabled && filters.category) {
          appendListParam(query, "category", filters.category);
        }
        if (filters.currencyEnabled && filters.currency) {
          appendListParam(query, "currency", filters.currency);
        }
        if (filters.descriptionEnabled && filters.description) {
          setParam("description", filters.description);
        }
        if (
          filters.valueFromEnabled &&
          typeof filters.valueFrom === "number" &&
          Number.isFinite(filters.valueFrom)
        ) {
          setParam("valueFrom", filters.valueFrom);
        }
        if (
          filters.valueToEnabled &&
          typeof filters.valueTo === "number" &&
          Number.isFinite(filters.valueTo)
        ) {
          setParam("valueTo", filters.valueTo);
        }
        setParam("limit", 2000);

        // Using v2 API (PostgreSQL)
        const path = `/api/v2/budget/actual-entries${
          query.toString() ? `?${query.toString()}` : ""
        }`;
        const payload = await Rest.fetchJson(path, {
          signal: controller.signal,
        });
        const entries = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.entries)
          ? payload.entries
          : [];
        const totals = new Map();
        entries.forEach((entry) => {
          const currency = entry?.Currency || "Unknown";
          const amount = Number(entry?.Amount);
          if (!Number.isFinite(amount)) {
            return;
          }
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
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }
        console.error(
          "[TransActual] Failed to load filtered totals:",
          error
        );
        if (isActive) {
          setFilteredTotalsByCurrency([]);
        }
      }
    };

    loadFilteredTotals();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [filters]);

  // Selection and sorting
  const {
    selectedRows,
    sortConfig,
    sortedTransactions,
    isAllSelected,
    clearSelection,
    toggleRowSelection,
    handleSort,
    handleSelectAllToggle,
  } = useTransActualSelection(locallyFilteredTransactions);

  // Success callback: reload data and clear selection
  const handleSuccess = useCallback(async () => {
    clearSelection();
    await reload();
  }, [clearSelection, reload]);

  // Edit modal
  const {
    showEditModal,
    editFormValues,
    setEditFormValues,
    isEditing,
    editError,
    handleEditRequest,
    handleEditFieldChange,
    handleEditCancel,
    handleEditSubmit,
  } = useTransActualEdit(EDIT_FIELDS, actualRates, handleSuccess);

  // Delete modal
  const {
    showDeleteConfirmation,
    isDeleting,
    deleteError,
    handleDeleteRequest,
    handleDeleteCancel,
    handleConfirmDelete,
  } = useTransActualDelete(handleSuccess);

  // Filter change handler
  const handleFilterChange = useCallback(
    (nextFilters) => {
      if (!nextFilters) {
        return;
      }
      setFilters(nextFilters);
      setTransactionLimit(TRANSACTION_BATCH_SIZE);
    },
    [setTransactionLimit]
  );

  // Batch loading handlers
  const handleLoadMoreTransactions = useCallback(() => {
    setTransactionLimit((previous) => previous + TRANSACTION_BATCH_SIZE);
  }, [setTransactionLimit]);

  const handleLoadPreviousTransactions = useCallback(() => {
    setTransactionLimit((previous) =>
      Math.max(TRANSACTION_BATCH_SIZE, previous - TRANSACTION_BATCH_SIZE)
    );
  }, [setTransactionLimit]);

  const canLoadPrevious = transactionLimit > TRANSACTION_BATCH_SIZE;
  const hasTransactions = transactions.length > 0;
  const hasFilteredTransactions = locallyFilteredTransactions.length > 0;

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        <TransactionActualFilter
          onFiltersChange={handleFilterChange}
          onDeleteClick={() => handleDeleteRequest()}
          onEditClick={() => handleEditRequest(selectedRows)}
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
            onClick={handleLoadPreviousTransactions}
            disabled={isLoading || !canLoadPrevious}
            style={{ minWidth: "150px", whiteSpace: "nowrap" }}
          >
            {isLoading ? "Loading…" : "Previous batch"}
          </button>
          <button
            className="generate-report-button"
            type="button"
            onClick={handleLoadMoreTransactions}
            disabled={isLoading || !hasMoreTransactions}
            style={{ minWidth: "150px", whiteSpace: "nowrap" }}
          >
            {isLoading ? "Loading…" : "Next batch"}
          </button>
        </div>
        <TransactionActualTable
          isLoading={isLoading}
          error={error}
          hasTransactions={hasTransactions}
          hasFilteredTransactions={hasFilteredTransactions}
          sortedTransactions={sortedTransactions}
          sortConfig={sortConfig}
          onSort={handleSort}
          onRowToggle={toggleRowSelection}
        />
        <TransActualEditModal
          isOpen={showEditModal}
          selectedCount={selectedRows.size}
          editFields={EDIT_FIELDS}
          editFormValues={editFormValues}
          safeCategoryOptions={safeCategoryOptions}
          safeAccountOptions={safeAccountOptions}
          safeCurrencyOptions={safeCurrencyOptions}
          categoryOptions={categoryOptions}
          accountOptions={accountOptions}
          currencyOptions={currencyOptions}
          actualRates={actualRates}
          isEditing={isEditing}
          editError={editError}
          onFieldChange={handleEditFieldChange}
          onCancel={handleEditCancel}
          onSubmit={(e) => handleEditSubmit(e, selectedRows)}
          setEditFormValues={setEditFormValues}
        />
        <TransActualDeleteModal
          isOpen={showDeleteConfirmation}
          selectedCount={selectedRows.size}
          isDeleting={isDeleting}
          deleteError={deleteError}
          onCancel={handleDeleteCancel}
          onConfirm={() => handleConfirmDelete(selectedRows)}
        />
      </main>
    </div>
  );
}
