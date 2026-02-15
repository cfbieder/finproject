import { useCallback, useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

const TRANSACTION_BATCH_SIZE = 500;

/**
 * Shared hook for loading transactions from the API.
 * Uses config to parameterize endpoint, query building, and response transformation.
 *
 * @param {Object} config - Transaction config (ACTUAL_CONFIG or BUDGET_CONFIG)
 * @param {Object} filters - Filter state
 * @returns {Object} Transactions state and controls
 */
export function useTransactions(config, filters) {
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
        config.buildFilterQuery(query, filters, fetchLimit);

        const path = `${config.endpoint}${query.toString() ? `?${query.toString()}` : ""}`;
        const response = await Rest.fetchJson(path, { signal });
        const data = response?.data ?? [];

        const transformedData = data.map(config.transformEntry);

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
        console.error(`[${config.logPrefix}] Failed to load transactions:`, err);
        setError(err?.message ?? config.loadErrorMessage);
        setTransactions([]);
        setHasMoreTransactions(false);
      } finally {
        setIsLoading(false);
      }
    },
    [config, filters, transactionLimit]
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
