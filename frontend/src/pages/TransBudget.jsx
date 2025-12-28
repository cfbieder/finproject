import { useCallback, useMemo, useState } from "react";
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
import { useTransBudgetTransactions } from "../features/TransactionBudget/hooks/useTransBudgetTransactions.js";
import { useTransBudgetFilters } from "../features/TransactionBudget/hooks/useTransBudgetFilters.js";
import { useTransBudgetSelection } from "../features/TransactionBudget/hooks/useTransBudgetSelection.js";
import { useTransBudgetDelete } from "../features/TransactionBudget/hooks/useTransBudgetDelete.js";
import { useTransBudgetEdit } from "../features/TransactionBudget/hooks/useTransBudgetEdit.js";
import { normalizeStringOptions, DEFAULT_FILTERS } from "../features/TransactionBudget/utils/transBudgetUtils.js";
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
  } = useTransBudgetTransactions(filters);

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
