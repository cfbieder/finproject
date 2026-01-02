import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Custom hook for loading base year balance sheet actuals.
 * Loads balance sheet as of end of two years before the forecast period starts.
 *
 * @param {number} periodStart - First year of the forecast period
 * @param {Map} balanceAccountMap - Map of account name -> { level1, level2 }
 * @returns {Object} Base year balance sheet state
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

    const baseYear1 = Number(periodStart) - 2;
    const baseYear2 = Number(periodStart) - 1;

    let isMounted = true;

    const loadBalanceForYear = async (year) => {
      const asOfDate = `${year}-12-31`;
      const report = await Rest.fetchBalanceReport(asOfDate);

      const level1 = new Map();
      const level2 = new Map();
      const level3Map = new Map();
      let assetTotal = 0;
      let liabilityTotal = 0;

      /**
       * Recursively aggregates balance sheet values.
       *
       * @param {Array} nodes - Balance sheet nodes to process
       * @param {Array} path - Current path in tree (for mapping)
       */
      const aggregateValues = (nodes, path = []) => {
        if (!Array.isArray(nodes)) return;

        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;

          const name = node.name;
          const children = Array.isArray(node.children) ? node.children : [];
          const hasChildren = children.length > 0;
          const newPath = [...path, name].filter(Boolean);

          // Recurse into children first
          if (hasChildren) {
            aggregateValues(children, newPath);
            continue;
          }

          // Process leaf nodes
          const total = Number(node.totalUSD ?? 0);
          const mapping = balanceAccountMap.get(name);
          const l1 = mapping?.level1 || newPath[0];
          const l2 = mapping?.level2 || newPath[1];

          // Aggregate at all three levels
          if (name) {
            level3Map.set(name, (level3Map.get(name) ?? 0) + total);
          }
          if (l1) {
            level1.set(l1, (level1.get(l1) ?? 0) + total);
            if (l1 === "Assets") {
              assetTotal += total;
            } else if (l1 === "Liabilities") {
              liabilityTotal += total;
            }
          }
          if (l2) {
            level2.set(l2, (level2.get(l2) ?? 0) + total);
          }
        }
      };

      const nodes = Array.isArray(report)
        ? report
        : Array.isArray(report?.["Balance Sheet Accounts"])
        ? report["Balance Sheet Accounts"]
        : [];

      aggregateValues(nodes, []);

      // Set final asset and liability totals
      if (assetTotal) {
        level1.set("Assets", assetTotal);
      }
      if (liabilityTotal) {
        level1.set("Liabilities", liabilityTotal);
      }

      return { level1, level2, level3: level3Map };
    };

    const loadBalance = async () => {
      setLoading(true);
      setError("");
      try {
        const yearDataMap = new Map();

        // Load first base year
        const data1 = await loadBalanceForYear(baseYear1);
        if (!isMounted) return;
        yearDataMap.set(Number(baseYear1), data1);

        // Load second base year if it exists
        if (baseYear2) {
          const data2 = await loadBalanceForYear(baseYear2);
          if (!isMounted) return;
          yearDataMap.set(Number(baseYear2), data2);
        }

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
