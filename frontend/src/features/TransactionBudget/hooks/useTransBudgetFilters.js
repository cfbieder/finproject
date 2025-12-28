import { useState, useCallback } from "react";
import { DEFAULT_FILTERS, filtersAreEqual } from "../utils/transBudgetUtils.js";

const TRANSACTION_BATCH_SIZE = 500;

/**
 * Custom hook for managing transaction budget filters.
 *
 * NOTE: Transactions are already filtered server-side by useTransBudgetTransactions hook.
 * This hook only manages filter state - no client-side filtering is needed.
 *
 * @param {Array} transactions - Server-filtered transactions from useTransBudgetTransactions
 * @returns {Object} Filter state and methods
 */
export function useTransBudgetFilters(transactions) {
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS }));

  // Transactions are already filtered by the server, so just pass them through
  const filteredTransactions = transactions;

  /**
   * Updates filter state, avoiding unnecessary re-renders with equality check.
   */
  const handleFilterChange = useCallback((nextFilters, setTransactionLimit) => {
    if (!nextFilters) {
      return;
    }
    setFilters((previous) => {
      if (filtersAreEqual(previous, nextFilters)) {
        return previous;
      }
      if (setTransactionLimit) {
        setTransactionLimit(TRANSACTION_BATCH_SIZE);
      }
      return { ...nextFilters };
    });
  }, []);

  return {
    filters,
    filteredTransactions,
    handleFilterChange,
  };
}
