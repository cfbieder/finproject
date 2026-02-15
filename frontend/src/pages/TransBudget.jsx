import { useCallback, useEffect, useMemo, useState } from "react";
import { BUDGET_CONFIG } from "../features/Transaction/transactionConfig.js";
import { normalizeStringOptions } from "../features/Transaction/transactionUtils.js";
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

const config = BUDGET_CONFIG;
const TRANSACTION_BATCH_SIZE = 500;

export default function TransBudget() {
  const [filters, setFilters] = useState(() => ({ ...config.defaultFilters }));
  const [filteredTotalsByCurrency, setFilteredTotalsByCurrency] = useState([]);

  const {
    transactions,
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
        console.error("[TransBudget] Failed to load filtered totals:", err);
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
  } = useTransactionSelection(transactions);

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
    const normalized = new Map();
    for (const option of baseOptions) {
      if (typeof option !== "string") continue;
      const trimmed = option.trim();
      if (!trimmed) continue;
      const key = trimmed.toUpperCase();
      if (!normalized.has(key)) {
        normalized.set(key, trimmed);
      }
    }
    const fallbackCurrency = edit.editFormValues.Currency;
    if (typeof fallbackCurrency === "string" && fallbackCurrency.trim()) {
      const fallbackKey = fallbackCurrency.trim().toUpperCase();
      if (!normalized.has(fallbackKey)) {
        normalized.set(fallbackKey, fallbackCurrency.trim());
      }
    }
    return Array.from(normalized.values());
  }, [currencyOptions, edit.editFormValues.Currency]);

  const onFiltersChange = useCallback(
    (nextFilters) => {
      setFilters(nextFilters);
      setTransactionLimit(TRANSACTION_BATCH_SIZE);
    },
    [setTransactionLimit]
  );

  const hasTransactions = transactions.length > 0;

  return (
    <>
      <main className="page-main trans-budget-main">
        <TransactionFilter
          config={config}
          onFiltersChange={onFiltersChange}
          onDeleteClick={del.handleDeleteRequest}
          onEditClick={edit.handleEditRequest}
          onSelectAllToggle={handleSelectAllToggle}
          canDelete={selectedRows.size > 0}
          canEdit={selectedRows.size > 0}
          isAllSelected={isAllSelected}
          filteredTotalsByCurrency={filteredTotalsByCurrency}
        />
        <TransactionTable
          config={config}
          isLoading={isLoading}
          error={error}
          hasTransactions={hasTransactions}
          hasFilteredTransactions={hasTransactions}
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
