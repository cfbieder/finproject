import { useCallback, useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

const TRANSACTION_BATCH_SIZE = 500;

/**
 * Custom hook for loading and managing budget transactions from PostgreSQL v2 API.
 * Drop-in replacement for useTransBudgetTransactions with same interface.
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
export function useTransBudgetTransactionsV2(filters) {
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
        // Build v2 API query parameters from filters
        const query = new URLSearchParams();

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
            const fromDate = new Date(Date.UTC(year, fromMonth - 1, 1));
            const toDate = new Date(Date.UTC(year, toMonth, 1)); // First day of next month (exclusive)
            query.set("fromDate", fromDate.toISOString());
            query.set("toDate", toDate.toISOString());
          }
        }

        // Use name-based filtering for v1 compatibility
        if (filters.accountEnabled && filters.account) {
          const accounts = Array.isArray(filters.account)
            ? filters.account
            : [filters.account];
          accounts.forEach((acc) => query.append("account", acc));
        }
        if (filters.categoryEnabled && filters.category) {
          const categories = Array.isArray(filters.category)
            ? filters.category
            : [filters.category];
          categories.forEach((cat) => query.append("category", cat));
        }
        if (filters.currencyEnabled && filters.currency) {
          const curr = Array.isArray(filters.currency)
            ? filters.currency[0]
            : filters.currency;
          query.set("currency", curr);
        }
        query.set("limit", fetchLimit);

        const path = `/api/v2/budget/entries${query.toString() ? `?${query.toString()}` : ""}`;
        const response = await Rest.fetchJson(path, { signal });
        const data = response?.data ?? [];

        // Transform v2 response to match v1 format for compatibility
        const transformedData = data.map((entry) => ({
          // Map v2 fields to v1 field names for component compatibility
          _id: String(entry.id),
          id: entry.id,
          Date: entry.entry_date,
          Description1: entry.description,
          Amount: parseFloat(entry.amount),
          Currency: entry.currency,
          BaseAmount: parseFloat(entry.base_amount),
          BaseCurrency: entry.base_currency,
          Account: entry.account_name,
          account_id: entry.account_id,
          Category: entry.category_name,
          category_id: entry.category_id,
          Labels: entry.labels,
          Note: entry.note,
          version_id: entry.version_id,
          version_name: entry.version_name,
          budget_year: entry.budget_year,
        }));

        const hasMore = transformedData.length === fetchLimit;
        setTransactions(
          hasMore ? transformedData.slice(0, requestedLimit) : transformedData
        );
        setHasMoreTransactions(hasMore);
        setError("");
      } catch (err) {
        if (err?.name === "AbortError") {
          return;
        }
        console.error("[useTransBudgetTransactionsV2] Failed to load transactions:", err);
        setError(err?.message ?? "Failed to load budget transactions from PostgreSQL");
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
