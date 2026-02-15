import { useCallback, useState } from "react";
import { filtersAreEqual } from "../transactionUtils.js";

const TRANSACTION_BATCH_SIZE = 500;

/**
 * Shared hook for managing transaction filter state.
 * Transactions are already filtered server-side; this manages the state only.
 *
 * @param {Array} transactions - Server-filtered transactions
 * @param {Object} defaultFilters - Default filter values from config
 * @returns {Object} Filter state and handlers
 */
export function useTransactionFilters(transactions, defaultFilters) {
  const [filters, setFilters] = useState(() => ({ ...defaultFilters }));

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
