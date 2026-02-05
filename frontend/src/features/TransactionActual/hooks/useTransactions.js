import { useCallback, useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

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
        const appendListParam = (key, values) => {
          const list = Array.isArray(values) ? values : values ? [values] : [];
          list.forEach((value) => {
            if (value !== undefined && value !== null && value !== "") {
              query.append(key, String(value));
            }
          });
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
          appendListParam("account", filters.account);
        }
        if (filters.categoryEnabled && filters.category) {
          appendListParam("category", filters.category);
        }
        if (filters.currencyEnabled && filters.currency) {
          appendListParam("currency", filters.currency);
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
        // Using v2 API (PostgreSQL)
        const path = `/api/v2/budget/actual-entries${
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
