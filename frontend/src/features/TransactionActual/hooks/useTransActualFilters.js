import { useCallback, useState } from "react";
import { DEFAULT_FILTERS, filtersAreEqual } from "../transActualUtils.js";

const TRANSACTION_BATCH_SIZE = 500;

/**
 * Custom hook for managing transaction filters.
 *
 * NOTE: Transactions are already filtered server-side by useTransactions hook.
 * This hook only manages filter state - no client-side filtering is needed.
 *
 * @param {Array} transactions - Server-filtered transactions from useTransactions
 * @returns {Object} Filter state and handlers
 */
export function useTransActualFilters(transactions) {
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS }));

  // Transactions are already filtered by the server, so just pass them through
  const filteredTransactions = transactions;

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
