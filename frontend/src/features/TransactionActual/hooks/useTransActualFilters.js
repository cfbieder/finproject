import { useCallback, useMemo, useState } from "react";
import { DEFAULT_FILTERS, filtersAreEqual } from "../transActualUtils.js";
import { filterTransactions } from "./useTransactions.js";

const TRANSACTION_BATCH_SIZE = 500;

/**
 * Custom hook for managing transaction filters.
 *
 * @param {Array} transactions - Raw transactions
 * @returns {Object} Filter state and handlers
 */
export function useTransActualFilters(transactions) {
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS }));

  const filteredTransactions = useMemo(
    () => filterTransactions(transactions, filters),
    [transactions, filters]
  );

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
