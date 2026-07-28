import { useCallback, useMemo, useState } from "react";
import { getSortValue, DEFAULT_SORT } from "../transactionUtils.js";

/**
 * Shared hook for managing row selection and sorting.
 *
 * @param {Array} transactions - Filtered transactions
 * @returns {Object} Selection and sorting state and handlers
 */
export function useTransactionSelection(transactions) {
  const [rawSelectedRows, setSelectedRows] = useState(() => new Map());
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);

  // Selections are pruned to rows that are STILL VISIBLE.
  //
  // The Map used to persist untouched across data reloads, so a row selected
  // before a filter/period/account change stayed counted while rendering nowhere:
  // the bar read "2 selected" with one row ticked, `isAllSelected` went true
  // (size === rows.length) so the header ticked itself, and any action gated on a
  // single selection silently disappeared. It also meant Edit/Delete could act on
  // a row the user could no longer see.
  //
  // Latent for as long as the hook existed, but v3.6.0 made it routine: the Ledger
  // category filter became a server-side refetch, so changing it now replaces the
  // whole list where it used to filter the loaded array in place.
  //
  // Derived rather than pruned in an effect — no extra render pass, and no
  // set-state-in-effect debt.
  const visibleRowIds = useMemo(
    () => new Set(transactions.map((entry, index) => entry._id ?? `${entry.Date ?? ""}-${index}`)),
    [transactions]
  );

  const selectedRows = useMemo(() => {
    if (rawSelectedRows.size === 0) return rawSelectedRows;
    const live = new Map();
    for (const [rowId, entry] of rawSelectedRows) {
      if (visibleRowIds.has(rowId)) live.set(rowId, entry);
    }
    return live.size === rawSelectedRows.size ? rawSelectedRows : live;
  }, [rawSelectedRows, visibleRowIds]);

  const clearSelection = useCallback(() => {
    setSelectedRows(new Map());
  }, []);

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
