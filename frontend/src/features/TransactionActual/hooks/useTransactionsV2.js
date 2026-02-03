import { useCallback, useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

const TRANSACTION_BATCH_SIZE = 500;

/**
 * Custom hook for loading and managing actual transactions from PostgreSQL v2 API.
 * Drop-in replacement for useTransactions with same interface.
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
export function useTransactionsV2(filters) {
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

        if (filters.yearEnabled && filters.year) {
          query.set("year", filters.year);
        }
        if (
          filters.monthEnabled &&
          filters.month !== undefined &&
          filters.month !== null
        ) {
          // v2 API expects 1-indexed months
          query.set("month", filters.month + 1);
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
        if (filters.descriptionEnabled && filters.description) {
          query.set("description", filters.description);
        }
        if (
          filters.valueFromEnabled &&
          typeof filters.valueFrom === "number" &&
          Number.isFinite(filters.valueFrom)
        ) {
          query.set("minAmount", filters.valueFrom);
        }
        if (
          filters.valueToEnabled &&
          typeof filters.valueTo === "number" &&
          Number.isFinite(filters.valueTo)
        ) {
          query.set("maxAmount", filters.valueTo);
        }
        query.set("limit", fetchLimit);

        const path = `/api/v2/transactions${query.toString() ? `?${query.toString()}` : ""}`;
        const response = await Rest.fetchJson(path, { signal });
        const data = response?.data ?? [];

        // Transform v2 response to match v1 format for compatibility
        const transformedData = data.map((txn) => ({
          // Map v2 fields to v1 field names for component compatibility
          _id: String(txn.id),
          id: txn.id,
          ps_id: txn.ps_id,
          Date: txn.transaction_date,
          Description1: txn.description1,
          Description2: txn.description2,
          Amount: parseFloat(txn.amount),
          Currency: txn.currency,
          BaseAmount: parseFloat(txn.base_amount),
          BaseCurrency: txn.base_currency,
          Account: txn.account_name,
          account_id: txn.account_id,
          Category: txn.category_name,
          category_id: txn.category_id,
          ClosingBalance: txn.closing_balance ? parseFloat(txn.closing_balance) : null,
          Labels: txn.labels,
          Memo: txn.memo,
          Note: txn.note,
          Bank: txn.bank,
          Source: txn.source,
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
        console.error("[useTransactionsV2] Failed to load transactions:", err);
        setError(err?.message ?? "Failed to load transactions from PostgreSQL");
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
