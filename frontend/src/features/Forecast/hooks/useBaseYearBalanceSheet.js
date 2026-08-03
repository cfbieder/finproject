import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";
import { aggregateBalanceReport } from "../utils/fcBalanceAggregate.js";

/**
 * Custom hook for loading LastActualYear (PeriodStart - 2) balance sheet actuals.
 * BaseYear (PeriodStart - 1) BS values come from the FC engine, not actuals.
 *
 * @param {number} periodStart - First year of the forecast period
 * @param {Map} balanceAccountMap - Map of account name -> { level1, level2 }
 * @returns {Object} LastActualYear balance sheet state
 * @property {Map} baseBalanceTotalsByYear - Map of year -> { level1, level2, level3 }
 * @property {boolean} loading - Whether balance sheet is being loaded
 * @property {string} error - Error message if loading failed
 */
export function useBaseYearBalanceSheet(periodStart, balanceAccountMap) {
  const [baseBalanceTotalsByYear, setBaseBalanceTotalsByYear] = useState(
    new Map()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!periodStart) {
      setBaseBalanceTotalsByYear(new Map());
      return;
    }

    const lastActualYear = Number(periodStart) - 2;

    let isMounted = true;

    // The roll-up itself lives in `utils/fcBalanceAggregate.js` (CR067 P2) so Multi-Compare,
    // which loads N scenarios through useQueries and cannot call this hook per scenario,
    // reads the report exactly the same way this does.
    const loadBalanceForYear = async (year) => {
      const report = await Rest.fetchBalanceReportV2(`${year}-12-31`);
      return aggregateBalanceReport(report, balanceAccountMap);
    };

    const loadBalance = async () => {
      setLoading(true);
      setError("");
      try {
        const yearDataMap = new Map();

        // Load LastActualYear (PeriodStart - 2) only
        const data = await loadBalanceForYear(lastActualYear);
        if (!isMounted) return;
        yearDataMap.set(Number(lastActualYear), data);

        setBaseBalanceTotalsByYear(yearDataMap);
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Failed to load balance sheet");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadBalance();
    return () => {
      isMounted = false;
    };
  }, [periodStart, balanceAccountMap]);

  return {
    baseBalanceTotalsByYear,
    loading,
    error,
  };
}
