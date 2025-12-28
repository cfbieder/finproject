import { useCallback, useEffect, useState } from "react";
import Rest from "../../../js/rest.js";
import {
  getSelectedAccountFilters,
  buildMonthSequence,
  getMonthLabel,
} from "../utils/budgetInputUtils.js";

/**
 * Custom hook for loading budget balance data.
 * Fetches actual vs budget balances by month based on filter criteria.
 *
 * @param {Object} params - Balance loading parameters
 * @param {string} params.fromMonth - Start month (01-12)
 * @param {string} params.toMonth - End month (01-12)
 * @param {string} params.actualYear - Year for actual data
 * @param {string} params.budgetYear - Year for budget data
 * @param {Array} params.selectedAccounts - Selected account filters
 * @param {Array} params.expandedCategories - Expanded category filters
 * @returns {Object} Balance data state
 * @property {Array} balanceRows - Monthly balance rows with actual, budget, difference
 * @property {Object} status - Loading status
 * @property {boolean} status.loading - Whether data is being loaded
 * @property {string} status.error - Error message if loading failed
 * @property {Function} refresh - Manually triggers a data refresh
 */
export function useBalanceData({
  fromMonth,
  toMonth,
  actualYear,
  budgetYear,
  selectedAccounts,
  expandedCategories,
}) {
  const [balanceRows, setBalanceRows] = useState([]);
  const [status, setStatus] = useState({
    loading: true,
    error: "",
  });
  const [refreshKey, setRefreshKey] = useState(0);

  /**
   * Manually triggers a refresh of balance data.
   * Useful after creating/editing budget entries.
   */
  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  /**
   * Fetches balance data when filter parameters change.
   */
  useEffect(() => {
    let isActive = true;

    const fetchBalances = async () => {
      setStatus({ loading: true, error: "" });
      setBalanceRows([]);

      try {
        const accountsToFilter = getSelectedAccountFilters(selectedAccounts);
        const categoryFilters = expandedCategories;

        const payload = await Rest.fetchBudgetBalances({
          fromMonth,
          toMonth,
          actualYear,
          budgetYear,
          categories: categoryFilters,
          accounts: accountsToFilter,
        });

        if (!isActive) return;

        const monthSequence =
          Array.isArray(payload.months) && payload.months.length
            ? payload.months
            : buildMonthSequence(fromMonth, toMonth);

        const rows = monthSequence.map((monthNumber) => {
          const actualValue = payload.actualByMonth?.[monthNumber];
          const budgetValue = payload.budgetByMonth?.[monthNumber];
          const actual = Number.isFinite(actualValue) ? actualValue : 0;
          const budget = Number.isFinite(budgetValue) ? budgetValue : 0;
          return {
            monthNumber,
            monthLabel: getMonthLabel(monthNumber),
            actual,
            budget,
            difference: actual - budget,
          };
        });

        setBalanceRows(rows);
        setStatus({ loading: false, error: "" });
      } catch (error) {
        if (!isActive) return;

        console.error("[useBalanceData] Failed to load balance summary:", error);
        setBalanceRows([]);
        setStatus({
          loading: false,
          error: error?.message || "Unable to load balance data.",
        });
      }
    };

    fetchBalances();

    return () => {
      isActive = false;
    };
  }, [
    fromMonth,
    toMonth,
    actualYear,
    budgetYear,
    selectedAccounts,
    expandedCategories,
    refreshKey,
  ]);

  return {
    balanceRows,
    status,
    refresh,
  };
}
