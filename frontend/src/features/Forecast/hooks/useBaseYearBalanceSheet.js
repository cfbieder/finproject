import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Custom hook for loading base year balance sheet actuals.
 * Loads balance sheet as of end of first forecast year for comparison.
 *
 * @param {Array} years - Array of forecast years
 * @param {Map} balanceAccountMap - Map of account name -> { level1, level2 }
 * @returns {Object} Base year balance sheet state
 * @property {Object} baseBalanceTotals - Aggregated totals by level
 * @property {Map} baseBalanceTotals.level1 - Level 1 totals (Assets, Liabilities)
 * @property {Map} baseBalanceTotals.level2 - Level 2 totals (sub-categories)
 * @property {Map} baseBalanceTotals.level3 - Level 3 totals (leaf accounts)
 * @property {boolean} loading - Whether balance sheet is being loaded
 * @property {string} error - Error message if loading failed
 */
export function useBaseYearBalanceSheet(years, balanceAccountMap) {
  const [baseBalanceTotals, setBaseBalanceTotals] = useState({
    level1: new Map(),
    level2: new Map(),
    level3: new Map(),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const sortedYears = [...years].sort((a, b) => Number(a) - Number(b));
    const baseYear = sortedYears[0];

    if (!baseYear) {
      setBaseBalanceTotals({
        level1: new Map(),
        level2: new Map(),
        level3: new Map(),
      });
      return;
    }

    let isMounted = true;

    const loadBalance = async () => {
      setLoading(true);
      setError("");
      try {
        const asOfDate = `${baseYear}-12-31`;
        const report = await Rest.fetchBalanceReport(asOfDate);
        if (!isMounted) return;

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

        setBaseBalanceTotals({ level1, level2, level3: level3Map });
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
  }, [years, balanceAccountMap]);

  return {
    baseBalanceTotals,
    loading,
    error,
  };
}
