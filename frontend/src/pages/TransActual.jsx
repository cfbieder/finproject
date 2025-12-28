import { useCallback, useMemo, useState } from "react";
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
import { useTransactions } from "../features/TransactionActual/hooks/useTransactions.js";
import { useTransActualFilters } from "../features/TransactionActual/hooks/useTransActualFilters.js";
import { useTransActualSelection } from "../features/TransactionActual/hooks/useTransActualSelection.js";
import { useTransActualEdit } from "../features/TransactionActual/hooks/useTransActualEdit.js";
import { useTransActualDelete } from "../features/TransactionActual/hooks/useTransActualDelete.js";
import { DEFAULT_FILTERS } from "../features/TransactionActual/transActualUtils.js";
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
  } = useTransActualSelection(filteredTransactions);

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
  const hasFilteredTransactions = filteredTransactions.length > 0;

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
