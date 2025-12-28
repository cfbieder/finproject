import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";
import { parseLevelAccounts } from "../utils/fcReviewUtils.js";

/**
 * Custom hook for loading Balance Sheet Chart of Accounts.
 * Loads Assets and Liabilities accounts with hierarchical structure.
 * Creates mapping from leaf accounts to parent categories for aggregation.
 *
 * @returns {Object} Balance sheet accounts state
 * @property {Array} balanceAccounts - Flat array of { label, level } objects
 * @property {Map} balanceAccountMap - Map of account name -> { level1, level2 }
 * @property {boolean} loading - Whether accounts are being loaded
 * @property {string} error - Error message if loading failed
 */
export function useBalanceSheetAccounts() {
  const [balanceAccounts, setBalanceAccounts] = useState([]);
  const [balanceAccountMap, setBalanceAccountMap] = useState(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    const loadBalanceAccounts = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await Rest.fetchJson("/api/coa/BalanceSheet");
        if (!isMounted) return;

        const parsed = parseLevelAccounts(data, true);
        setBalanceAccounts(parsed.rows);
        setBalanceAccountMap(parsed.mapping);
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Failed to load balance sheet accounts");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadBalanceAccounts();
    return () => {
      isMounted = false;
    };
  }, []);

  return {
    balanceAccounts,
    balanceAccountMap,
    loading,
    error,
  };
}
