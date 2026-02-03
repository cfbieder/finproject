import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";
import { parseLevelAccounts } from "../utils/fcReviewUtils.js";

/**
 * Custom hook for loading Cash Flow Chart of Accounts.
 * Loads Income, Expense, and Transfer accounts with hierarchical structure.
 * Creates mapping from leaf accounts to parent categories for aggregation.
 *
 * @returns {Object} Cash flow accounts state
 * @property {Array} cashAccounts - Flat array of { label, level } objects
 * @property {Map} cashAccountMap - Map of account name -> { level1, level2 }
 * @property {boolean} loading - Whether accounts are being loaded
 * @property {string} error - Error message if loading failed
 */
export function useCashFlowAccounts() {
  const [cashAccounts, setCashAccounts] = useState([]);
  const [cashAccountMap, setCashAccountMap] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadCashAccounts = async () => {
      setLoading(true);
      setError("");
      try {
        // Using v2 API (PostgreSQL)
        const data = await Rest.fetchJson("/api/v2/util/coa/CashFlow");
        if (!isMounted) return;

        const parsed = parseLevelAccounts(data, true);
        setCashAccounts(parsed.rows);
        setCashAccountMap(parsed.mapping);
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Failed to load cash accounts");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadCashAccounts();
    return () => {
      isMounted = false;
    };
  }, []);

  return {
    cashAccounts,
    cashAccountMap,
    loading,
    error,
  };
}
