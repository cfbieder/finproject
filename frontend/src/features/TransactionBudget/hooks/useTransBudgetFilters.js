import { useState, useCallback, useMemo } from "react";
import { DEFAULT_FILTERS, filtersAreEqual, parseEntryDate } from "../utils/transBudgetUtils.js";

/**
 * Custom hook for managing transaction budget filters.
 * Handles filter state, updates, and applying filters to transactions.
 *
 * @param {Array} transactions - All transactions to filter
 * @returns {Object} Filter state and methods
 */
export function useTransBudgetFilters(transactions) {
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS }));

  /**
   * Updates filter state, avoiding unnecessary re-renders with equality check.
   */
  const handleFilterChange = useCallback((nextFilters) => {
    if (!nextFilters) {
      return;
    }
    setFilters((previous) => {
      if (filtersAreEqual(previous, nextFilters)) {
        return previous;
      }
      return { ...nextFilters };
    });
  }, []);

  // Memoize parsed filter values to avoid recalculating on every render
  const parsedFilters = useMemo(() => {
    const {
      yearEnabled,
      monthEnabled,
      accountEnabled,
      categoryEnabled,
      valueFromEnabled,
      valueToEnabled,
      year,
      month,
      account,
      category,
      valueFrom,
      valueTo,
    } = filters;

    const yearValue =
      yearEnabled && year ? Number.parseInt(year, 10) : undefined;
    const hasYearFilter = Number.isFinite(yearValue);
    const monthValue =
      monthEnabled && month !== null && month !== undefined
        ? Number(month)
        : null;
    const hasMonthFilter = monthEnabled && Number.isFinite(monthValue);
    const normalizedAccount = accountEnabled
      ? (account ?? "").trim().toLowerCase()
      : "";
    const normalizedCategory = categoryEnabled
      ? (category ?? "").trim().toLowerCase()
      : "";
    const hasAccountFilter = !!(accountEnabled && normalizedAccount.length > 0);
    const hasCategoryFilter = !!(
      categoryEnabled && normalizedCategory.length > 0
    );
    const hasBaseFromFilter =
      valueFromEnabled &&
      typeof valueFrom === "number" &&
      Number.isFinite(valueFrom);
    const hasBaseToFilter =
      valueToEnabled && typeof valueTo === "number" && Number.isFinite(valueTo);
    const normalizedFromValue = hasBaseFromFilter ? valueFrom : 0;
    const normalizedToValue = hasBaseToFilter ? valueTo : 0;

    return {
      yearValue,
      hasYearFilter,
      monthValue,
      hasMonthFilter,
      normalizedAccount,
      hasAccountFilter,
      normalizedCategory,
      hasCategoryFilter,
      hasBaseFromFilter,
      hasBaseToFilter,
      normalizedFromValue,
      normalizedToValue,
    };
  }, [filters]);

  // Apply all active filters to the transaction list
  const filteredTransactions = useMemo(() => {
    if (!transactions.length) {
      return [];
    }

    const {
      yearValue,
      hasYearFilter,
      monthValue,
      hasMonthFilter,
      normalizedAccount,
      hasAccountFilter,
      normalizedCategory,
      hasCategoryFilter,
      hasBaseFromFilter,
      hasBaseToFilter,
      normalizedFromValue,
      normalizedToValue,
    } = parsedFilters;

    return transactions.filter((entry) => {
      const entryDate = parseEntryDate(entry);
      if (hasYearFilter) {
        const entryYear = entryDate ? entryDate.getUTCFullYear() : null;
        if (!entryDate || entryYear !== yearValue) {
          return false;
        }
      }
      if (hasMonthFilter) {
        const entryMonth = entryDate ? entryDate.getUTCMonth() : null;
        if (!entryDate || entryMonth !== monthValue) {
          return false;
        }
      }
      if (hasAccountFilter) {
        const entryAccount = (entry?.Account ?? "")
          .toString()
          .trim()
          .toLowerCase();
        if (entryAccount !== normalizedAccount) {
          return false;
        }
      }
      if (hasCategoryFilter) {
        const entryCategory = (entry?.Category ?? "")
          .toString()
          .trim()
          .toLowerCase();
        if (entryCategory !== normalizedCategory) {
          return false;
        }
      }
      if (hasBaseFromFilter || hasBaseToFilter) {
        const entryBase = entry?.BaseAmount ?? entry?.baseAmount;
        const baseValue =
          typeof entryBase === "number" ? entryBase : Number(entryBase);
        const hasValidBase = Number.isFinite(baseValue);

        if (hasBaseFromFilter) {
          if (!hasValidBase || baseValue < normalizedFromValue) {
            return false;
          }
        }
        if (hasBaseToFilter) {
          if (!hasValidBase || baseValue > normalizedToValue) {
            return false;
          }
        }
      }
      return true;
    });
  }, [transactions, parsedFilters]);

  return {
    filters,
    filteredTransactions,
    handleFilterChange,
  };
}
