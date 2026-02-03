import { useCallback, useEffect, useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import TransactionBudgetFilter from "../features/TransactionBudget/TransactionBudgetFilter.jsx";
import TransactionBudgetTable, {
  useTransactionBudgetAccountOptions,
  useTransactionBudgetCategoryOptions,
  useTransactionBudgetCurrencyOptions,
  useTransactionBudgetExchangeRates,
} from "../features/TransactionBudget/TransactionBudgetTable.jsx";
import TransBudgetDeleteModal from "../features/TransactionBudget/components/TransBudgetDeleteModal.jsx";
import TransBudgetEditModal from "../features/TransactionBudget/components/TransBudgetEditModal.jsx";
import { useTransBudgetTransactionsV2 } from "../features/TransactionBudget/hooks/useTransBudgetTransactionsV2.js";
import { useTransBudgetFilters } from "../features/TransactionBudget/hooks/useTransBudgetFilters.js";
import { useTransBudgetSelection } from "../features/TransactionBudget/hooks/useTransBudgetSelection.js";
import { useTransBudgetDelete } from "../features/TransactionBudget/hooks/useTransBudgetDelete.js";
import { useTransBudgetEdit } from "../features/TransactionBudget/hooks/useTransBudgetEdit.js";
import { normalizeStringOptions, DEFAULT_FILTERS } from "../features/TransactionBudget/utils/transBudgetUtils.js";
import Rest from "../js/rest.js";
import "./PageLayout.css";

/**
 * TransBudget component manages the budget transaction page.
 * Provides functionality to view, filter, edit, and delete budget transactions.
 * Features include:
 * - Loading and displaying budget transactions from the API
 * - Filtering by year, month, account, category, and amount range
 * - Sorting transactions by any column
 * - Multi-select for bulk editing and deletion
 * - Edit modal with automatic base currency conversion
 * - Delete confirmation modal
 */
export default function TransBudget() {
  // Get filter state first so we can pass to useTransBudgetTransactions
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS }));
  const [filteredTotalsByCurrency, setFilteredTotalsByCurrency] = useState([]);

  // Get reference data from custom hooks
  const categoryOptions = useTransactionBudgetCategoryOptions();
  const accountOptions = useTransactionBudgetAccountOptions();
  const currencyOptions = useTransactionBudgetCurrencyOptions();
  const budgetRates = useTransactionBudgetExchangeRates();

  // Load transactions with current filters
  const {
    transactions,
    transactionLimit,
    hasMoreTransactions,
    isLoading,
    error,
    setTransactionLimit,
    reload,
  } = useTransBudgetTransactionsV2(filters);

  // Use custom hooks for feature management
  const { filteredTransactions, handleFilterChange } =
    useTransBudgetFilters(transactions);

  const {
    selectedRows,
    sortConfig,
    sortedTransactions,
    isAllSelected,
    clearSelection,
    toggleRowSelection,
    handleSort,
    handleSelectAllToggle,
  } = useTransBudgetSelection(filteredTransactions);

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
          const year = Number.parseInt(filters.year, 10);
          if (Number.isFinite(year)) {
            let fromMonth = 1;
            let toMonth = 12;
            if (
              filters.monthEnabled &&
              filters.month !== undefined &&
              filters.month !== null
            ) {
              const month = Number(filters.month);
              if (Number.isFinite(month) && month >= 0 && month <= 11) {
                fromMonth = month + 1;
                toMonth = month + 1;
              }
            }
            const fromDate = new Date(Date.UTC(year, fromMonth - 1, 1));
            const toDate = new Date(Date.UTC(year, toMonth, 1));
            setParam("fromDate", fromDate.toISOString());
            setParam("toDate", toDate.toISOString());
          }
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
        setParam("limit", 2000);

        // Using v2 API (PostgreSQL)
        const path = `/api/v2/budget/entries${
          query.toString() ? `?${query.toString()}` : ""
        }`;
        const payload = await Rest.fetchJson(path, {
          signal: controller.signal,
        });
        // v2 API returns { data: [...] }
        const entries = Array.isArray(payload?.data) ? payload.data : [];
        const totals = new Map();
        entries.forEach((entry) => {
          // v2 API uses snake_case field names
          const currency = entry?.currency || "Unknown";
          const amount = Number(entry?.amount);
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
          "[TransBudget] Failed to load filtered totals:",
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

  // Success callback: reload data and clear selection
  const handleSuccess = useCallback(async () => {
    clearSelection();
    await reload();
  }, [clearSelection, reload]);

  // Wrapper for handleFilterChange to update filters state
  const onFiltersChange = useCallback((nextFilters) => {
    setFilters(nextFilters);
    handleFilterChange(nextFilters, setTransactionLimit);
  }, [handleFilterChange, setTransactionLimit]);

  const {
    showDeleteConfirmation,
    isDeleting,
    deleteError,
    handleDeleteRequest,
    handleDeleteCancel,
    handleConfirmDelete,
  } = useTransBudgetDelete(selectedRows, handleSuccess);

  const {
    showEditModal,
    editFormValues,
    isEditing,
    editError,
    handleEditRequest,
    handleEditFieldChange,
    handleEditCancel,
    handleEditSubmit,
  } = useTransBudgetEdit(selectedRows, budgetRates, handleSuccess);

  // Normalize select options for the edit modal
  const safeCategoryOptions = useMemo(
    () =>
      normalizeStringOptions(categoryOptions, editFormValues.Category ?? ""),
    [categoryOptions, editFormValues.Category]
  );

  const safeAccountOptions = useMemo(
    () => normalizeStringOptions(accountOptions, editFormValues.Account ?? ""),
    [accountOptions, editFormValues.Account]
  );

  // Currency options normalized with case-insensitive deduplication
  const safeCurrencyOptions = useMemo(() => {
    const baseOptions = Array.isArray(currencyOptions) ? currencyOptions : [];
    const normalized = new Map();
    for (const option of baseOptions) {
      if (typeof option !== "string") {
        continue;
      }
      const trimmed = option.trim();
      if (!trimmed) {
        continue;
      }
      const key = trimmed.toUpperCase();
      if (!normalized.has(key)) {
        normalized.set(key, trimmed);
      }
    }
    const fallbackCurrency = editFormValues.Currency;
    if (typeof fallbackCurrency === "string" && fallbackCurrency.trim()) {
      const fallbackKey = fallbackCurrency.trim().toUpperCase();
      if (!normalized.has(fallbackKey)) {
        normalized.set(fallbackKey, fallbackCurrency.trim());
      }
    }
    return Array.from(normalized.values());
  }, [currencyOptions, editFormValues.Currency]);

  const hasTransactions = transactions.length > 0;
  const hasFilteredTransactions = filteredTransactions.length > 0;

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        <TransactionBudgetFilter
          onFiltersChange={onFiltersChange}
          onDeleteClick={handleDeleteRequest}
          onEditClick={handleEditRequest}
          onSelectAllToggle={handleSelectAllToggle}
          canDelete={selectedRows.size > 0}
          canEdit={selectedRows.size > 0}
          isAllSelected={isAllSelected}
          filteredTotalsByCurrency={filteredTotalsByCurrency}
        />
        <TransactionBudgetTable
          isLoading={isLoading}
          error={error}
          hasTransactions={hasTransactions}
          hasFilteredTransactions={hasFilteredTransactions}
          sortedTransactions={sortedTransactions}
          sortConfig={sortConfig}
          onSort={handleSort}
          onRowToggle={toggleRowSelection}
        />
        <TransBudgetEditModal
          isOpen={showEditModal}
          selectedCount={selectedRows.size}
          isEditing={isEditing}
          error={editError}
          formValues={editFormValues}
          categoryOptions={categoryOptions}
          accountOptions={accountOptions}
          currencyOptions={currencyOptions}
          safeCategoryOptions={safeCategoryOptions}
          safeAccountOptions={safeAccountOptions}
          safeCurrencyOptions={safeCurrencyOptions}
          onFieldChange={handleEditFieldChange}
          onCancel={handleEditCancel}
          onSubmit={handleEditSubmit}
        />
        <TransBudgetDeleteModal
          isOpen={showDeleteConfirmation}
          selectedCount={selectedRows.size}
          isDeleting={isDeleting}
          error={deleteError}
          onCancel={handleDeleteCancel}
          onConfirm={handleConfirmDelete}
        />
      </main>
    </div>
  );
}
