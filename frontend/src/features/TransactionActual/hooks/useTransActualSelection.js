import { useCallback, useMemo, useState } from "react";
import { getSortValue } from "../transActualUtils.js";

const DEFAULT_SORT = { key: "Date", direction: "desc" };

/**
 * Custom hook for managing row selection and sorting.
 *
 * @param {Array} transactions - Filtered transactions
 * @returns {Object} Selection and sorting state and handlers
 */
export function useTransActualSelection(transactions) {
  const [selectedRows, setSelectedRows] = useState(() => new Map());
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);

  const sortedTransactions = useMemo(() => {
    const entries = transactions.map((entry, index) => {
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
  }, [transactions, selectedRows, sortConfig]);

  const isAllSelected =
    sortedTransactions.length > 0 &&
    selectedRows.size === sortedTransactions.length;

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

  const handleSort = useCallback((key) => {
    setSortConfig((previous) => {
      if (previous.key === key) {
        const direction = previous.direction === "desc" ? "asc" : "desc";
        return { key, direction };
      }
      return { key, direction: "desc" };
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedRows(new Map());
  }, []);

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
