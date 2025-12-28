import { useCallback, useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

const TRANSACTION_BATCH_SIZE = 500;

/**
 * Custom hook for loading and managing budget transactions with filtering.
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
export function useTransBudgetTransactions(filters) {
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

        // Build date range from year and month filters
        if (filters.yearEnabled && filters.year) {
          const year = Number.parseInt(filters.year, 10);
          if (Number.isFinite(year)) {
            let fromMonth = 1;
            let toMonth = 12;

            // If month filter is enabled, use specific month
            if (
              filters.monthEnabled &&
              filters.month !== undefined &&
              filters.month !== null
            ) {
              const month = Number(filters.month);
              if (Number.isFinite(month) && month >= 0 && month <= 11) {
                fromMonth = month + 1; // Convert 0-based to 1-based
                toMonth = month + 1;
              }
            }

            // Create date range for the year/month
            // Backend uses $gte for fromDate and $lt for toDate, so toDate should be first day of next period
            // Use UTC to avoid timezone conversion issues
            const fromDate = new Date(Date.UTC(year, fromMonth - 1, 1));
            const toDate = new Date(Date.UTC(year, toMonth, 1)); // First day of next month (exclusive)
            setParam("fromDate", fromDate.toISOString());
            setParam("toDate", toDate.toISOString());
          }
        }

        if (filters.accountEnabled && filters.account) {
          setParam("account", filters.account);
        }
        if (filters.categoryEnabled && filters.category) {
          setParam("category", filters.category);
        }
        if (
          filters.valueFromEnabled &&
          typeof filters.valueFrom === "number" &&
          Number.isFinite(filters.valueFrom)
        ) {
          // Note: Backend uses BaseAmount for budget entries
          // We'll need to filter on Amount since that's what BudgetData has
          // The backend buildFilters doesn't have BaseAmount range filter for budget
          // so we'll pass it but may need backend changes
        }
        if (
          filters.valueToEnabled &&
          typeof filters.valueTo === "number" &&
          Number.isFinite(filters.valueTo)
        ) {
          // Same as above
        }
        setParam("limit", fetchLimit);

        const path = `/api/budget${
          query.toString() ? `?${query.toString()}` : ""
        }`;
        const payload = await Rest.fetchJson(path, { signal });
        const data = Array.isArray(payload) ? payload : [];
        const hasMore = data.length === fetchLimit;
        setTransactions(hasMore ? data.slice(0, requestedLimit) : data);
        setHasMoreTransactions(hasMore);
        setError("");
      } catch (err) {
        if (err?.name === "AbortError") {
          return;
        }
        console.error("[useTransBudgetTransactions] Failed to load transactions:", err);
        setError(err?.message ?? "Failed to load budget transactions");
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
