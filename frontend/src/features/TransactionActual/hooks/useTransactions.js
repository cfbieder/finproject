import { useCallback, useEffect, useState } from "react";
import Rest from "../../../js/rest.js";
import { parseEntryDate } from "../transActualUtils.js";

const TRANSACTION_BATCH_SIZE = 500;

/**
 * Custom hook for loading and managing actual transactions with filtering.
 * Provides transactions data, loading state, and batch loading controls.
 *
 * @param {Object} filters - Filter configuration
 * @returns {Object} Transactions state
 * @property {Array} transactions - Raw transactions from API
 * @property {number} transactionLimit - Current batch size limit
 * @property {boolean} hasMoreTransactions - Whether more transactions are available
 * @property {boolean} isLoading - Whether transactions are loading
 * @property {string} error - Error message if loading failed
 * @property {Function} setTransactionLimit - Update transaction limit
 * @property {Function} reload - Manually reload transactions
 */
export function useTransactions(filters) {
  const [transactions, setTransactions] = useState([]);
  const [transactionLimit, setTransactionLimit] = useState(
    TRANSACTION_BATCH_SIZE
  );
  const [hasMoreTransactions, setHasMoreTransactions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const loadTransactions = useCallback(
    async (signal) => {
      setIsLoading(true);
      const requestedLimit = Math.max(
        1,
        transactionLimit ?? TRANSACTION_BATCH_SIZE
      );
      const fetchLimit = requestedLimit + 1;
      try {
        const query = new URLSearchParams();
        const setParam = (key, value) => {
          if (value !== undefined && value !== null && value !== "") {
            query.set(key, String(value));
          }
        };
        if (filters.yearEnabled && filters.year) {
          setParam("actualYear", filters.year);
        }
        if (
          filters.monthEnabled &&
          filters.month !== undefined &&
          filters.month !== null
        ) {
          setParam("month", filters.month + 1);
        }
        if (filters.accountEnabled && filters.account) {
          setParam("account", filters.account);
        }
        if (filters.categoryEnabled && filters.category) {
          setParam("category", filters.category);
        }
        if (filters.descriptionEnabled && filters.description) {
          setParam("description", filters.description);
        }
        if (
          filters.valueFromEnabled &&
          typeof filters.valueFrom === "number" &&
          Number.isFinite(filters.valueFrom)
        ) {
          setParam("valueFrom", filters.valueFrom);
        }
        if (
          filters.valueToEnabled &&
          typeof filters.valueTo === "number" &&
          Number.isFinite(filters.valueTo)
        ) {
          setParam("valueTo", filters.valueTo);
        }
        setParam("limit", fetchLimit);
        const path = `/api/budget/actual-entries${
          query.toString() ? `?${query.toString()}` : ""
        }`;
        const payload = await Rest.fetchJson(path, { signal });
        const data = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.entries)
          ? payload.entries
          : [];
        const hasMore = data.length === fetchLimit;
        setTransactions(hasMore ? data.slice(0, requestedLimit) : data);
        setHasMoreTransactions(hasMore);
        setError("");
      } catch (err) {
        if (err?.name === "AbortError") {
          return;
        }
        console.error("[useTransactions] Failed to load transactions:", err);
        setError(err?.message ?? "Failed to load actual transactions");
        setTransactions([]);
        setHasMoreTransactions(false);
      } finally {
        setIsLoading(false);
      }
    },
    [filters, transactionLimit]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadTransactions(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadTransactions]);

  const reload = useCallback(() => {
    const controller = new AbortController();
    loadTransactions(controller.signal);
  }, [loadTransactions]);

  return {
    transactions,
    transactionLimit,
    hasMoreTransactions,
    isLoading,
    error,
    setTransactionLimit,
    reload,
  };
}

/**
 * Filters transactions based on filter configuration.
 * This is a pure function that can be used with useMemo.
 *
 * @param {Array} transactions - Raw transactions
 * @param {Object} filters - Filter configuration
 * @returns {Array} Filtered transactions
 */
export function filterTransactions(transactions, filters) {
  if (!transactions.length) {
    return [];
  }

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
    monthEnabled && month !== null && month !== undefined ? Number(month) : null;
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
  const descriptionText =
    filters.descriptionEnabled && filters.description
      ? filters.description.toString().trim().toLowerCase()
      : "";
  const hasDescriptionFilter =
    typeof descriptionText === "string" && descriptionText.length > 0;
  const hasBaseToFilter =
    valueToEnabled && typeof valueTo === "number" && Number.isFinite(valueTo);
  const normalizedFromValue = hasBaseFromFilter ? valueFrom : 0;
  const normalizedToValue = hasBaseToFilter ? valueTo : 0;

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
    if (hasDescriptionFilter) {
      const entryDescription = (
        entry?.Description1 ??
        entry?.description1 ??
        entry?.Description2 ??
        entry?.description ??
        ""
      )
        .toString()
        .trim()
        .toLowerCase();
      if (!entryDescription.includes(descriptionText)) {
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
}
