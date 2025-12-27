import { useState, useCallback, useMemo } from "react";
import { getSortValue, DEFAULT_SORT } from "../utils/transBudgetUtils.js";

/**
 * Custom hook for managing transaction selection and sorting.
 * Handles row selection state, sort configuration, and sorted transaction list.
 *
 * @param {Array} filteredTransactions - Filtered transactions to sort and select
 * @returns {Object} Selection and sorting state and methods
 */
export function useTransBudgetSelection(filteredTransactions) {
  const [selectedRows, setSelectedRows] = useState(() => new Map());
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);

  /**
   * Clears all selected rows.
   */
  const clearSelection = useCallback(() => {
    setSelectedRows(new Map());
  }, []);

  /**
   * Toggles selection state for a single row.
   */
  const toggleRowSelection = useCallback((rowId, entry) => {
    setSelectedRows((previous) => {
      const next = new Map(previous);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else if (entry) {
        next.set(rowId, entry);
      }
      return next;
    });
  }, []);

  /**
   * Updates sort configuration. Toggles direction if same key, otherwise defaults to descending.
   */
  const handleSort = useCallback((key) => {
    setSortConfig((previous) => {
      if (previous.key === key) {
        const direction = previous.direction === "desc" ? "asc" : "desc";
        return { key, direction };
      }
      return { key, direction: "desc" };
    });
  }, []);

  // Sort filtered transactions based on current sort configuration
  const sortedTransactions = useMemo(() => {
    const entries = filteredTransactions.map((entry, index) => {
      const rowId = entry._id ?? `${entry.Date ?? ""}-${index}`;
      return {
        entry,
        rowId,
        isSelected: selectedRows.has(rowId),
      };
    });

    if (!sortConfig?.key) {
      return entries;
    }

    const direction = sortConfig.direction === "desc" ? -1 : 1;
    entries.sort((left, right) => {
      const leftValue = getSortValue(left.entry, sortConfig.key, left);
      const rightValue = getSortValue(right.entry, sortConfig.key, right);
      if (leftValue === rightValue) {
        return 0;
      }
      if (leftValue === null || leftValue === undefined) {
        return 1 * direction;
      }
      if (rightValue === null || rightValue === undefined) {
        return -1 * direction;
      }
      if (leftValue < rightValue) {
        return -1 * direction;
      }
      if (leftValue > rightValue) {
        return 1 * direction;
      }
      return 0;
    });

    return entries;
  }, [filteredTransactions, selectedRows, sortConfig]);

  const isAllSelected =
    sortedTransactions.length > 0 &&
    selectedRows.size === sortedTransactions.length;

  /**
   * Toggles selection of all visible transactions.
   */
  const handleSelectAllToggle = useCallback(() => {
    if (isAllSelected) {
      setSelectedRows(new Map());
      return;
    }
    const nextSelection = new Map();
    sortedTransactions.forEach(({ rowId, entry }) => {
      nextSelection.set(rowId, entry);
    });
    setSelectedRows(nextSelection);
  }, [sortedTransactions, isAllSelected]);

  return {
    selectedRows,
    sortConfig,
    sortedTransactions,
    isAllSelected,
    clearSelection,
    toggleRowSelection,
    handleSort,
    handleSelectAllToggle,
  };
}
