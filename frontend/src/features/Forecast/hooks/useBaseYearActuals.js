import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Custom hook for loading base year actual cash flow data.
 * Loads P&L actuals for two years before the forecast period starts.
 *
 * @param {number} periodStart - First year of the forecast period
 * @returns {Object} Base year actuals state
 * @property {Map} baseActualTotalsByYear - Map of year -> { level1, level2, net }
 * @property {boolean} loading - Whether actuals are being loaded
 * @property {string} error - Error message if loading failed
 */
export function useBaseYearActuals(periodStart) {
  const [baseActualTotalsByYear, setBaseActualTotalsByYear] = useState(
    new Map()
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!periodStart) {
      setBaseActualTotalsByYear(new Map());
      return;
    }

    const baseYear1 = Number(periodStart) - 2;
    const baseYear2 = Number(periodStart) - 1;

    let isMounted = true;

    const loadActualsForYear = async (year) => {
      const fromDate = `${year}-01-01`;
      const toDate = `${year}-12-31`;
      const report = await Rest.fetchCashFlowReport({
        fromDate,
        toDate,
        transfers: "exclude",
        includeUnrealizedGL: false,
      });

      const level1 = new Map();
      const level2 = new Map();
      let unrealizedAdjustment = 0;
      let unrealizedLevel2 = "";

      /**
       * Recursively traverses cash flow report tree to aggregate totals.
       *
       * @param {Array} nodes - Report nodes to traverse
       * @param {number} level - Current depth in tree (1, 2, 3, ...)
       * @param {string} parentLevel1 - Parent level 1 category name
       * @param {string} parentLevel2 - Parent level 2 category name
       */
      const traverse = (
        nodes,
        level = 1,
        parentLevel1 = "",
        parentLevel2 = ""
      ) => {
        if (!Array.isArray(nodes)) return;

        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;

          const name = node.name;
          const total = Number(
            node.totalUSD !== undefined && node.totalUSD !== null
              ? node.totalUSD
              : node.total ?? 0
          );
          const nextLevel1 = level === 1 && name ? name : parentLevel1;
          const nextLevel2 =
            level === 2 && name ? name : level === 1 ? "" : parentLevel2;

          // Track unrealized G/L separately to exclude from expense
          if (name === "Unrealized G/L") {
            unrealizedAdjustment += total;
            unrealizedLevel2 = nextLevel2 || unrealizedLevel2;
            continue;
          }

          // Aggregate level 1 and level 2 totals
          if (level === 1 && name) {
            level1.set(name, total);
          } else if (level === 2 && name) {
            level2.set(name, total);
          }

          // Recurse into children
          if (Array.isArray(node.children) && node.children.length > 0) {
            traverse(node.children, level + 1, nextLevel1, nextLevel2);
          }
        }
      };

      traverse(report, 1, "", "");

      // Adjust expense totals to exclude unrealized G/L
      if (unrealizedAdjustment) {
        const expenseTotal = level1.get("Expense") ?? 0;
        level1.set("Expense", expenseTotal - unrealizedAdjustment);
        if (unrealizedLevel2) {
          const l2Total = level2.get(unrealizedLevel2) ?? 0;
          level2.set(unrealizedLevel2, l2Total - unrealizedAdjustment);
        }
      }

      const income = level1.get("Income") ?? 0;
      const expense = level1.get("Expense") ?? 0;
      return { level1, level2, net: income + expense };
    };

    const loadActuals = async () => {
      setLoading(true);
      setError("");
      try {
        const yearDataMap = new Map();

        // Load first base year
        const data1 = await loadActualsForYear(baseYear1);
        if (!isMounted) return;
        yearDataMap.set(Number(baseYear1), data1);

        // Load second base year if it exists
        if (baseYear2) {
          const data2 = await loadActualsForYear(baseYear2);
          if (!isMounted) return;
          yearDataMap.set(Number(baseYear2), data2);
        }

        setBaseActualTotalsByYear(yearDataMap);
      } catch (err) {
        if (isMounted) {
          setError(err.message || "Failed to load base year actuals");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadActuals();
    return () => {
      isMounted = false;
    };
  }, [periodStart]);

  return {
    baseActualTotalsByYear,
    loading,
    error,
  };
}
