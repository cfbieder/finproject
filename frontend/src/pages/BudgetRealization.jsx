import { useCallback, useMemo, useState, useEffect } from "react";
import {
  MONTH_OPTIONS,
  YEAR_OPTIONS,
  BUDGET_YEAR_OPTIONS,
} from "../features/BudgetEntry/utils/budgetInputUtils.js";
import BudgetRealizationContent from "../features/Budgets/BudgetRealizationContent.jsx";
import BudgetDetailModal from "../features/Budgets/BudgetDetailModal.jsx";
import Rest from "../js/rest.js";
import { useCoa } from "../hooks/useCoa.js";
import { exportBudgetRealization } from "../utils/excelExporter.js";
import "../features/CashFlow/CashFlowReport.css";
import "./PageLayout.css";

// ============================================================================
// CURRENCY FORMATTING
// ============================================================================

/**
 * Currency formatter for USD display
 */
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats a currency value with proper sign handling
 * @param {number} value - Numeric value to format
 * @returns {string} Formatted currency string (negative values in parentheses)
 */
const formatCurrencyValue = (value) => {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const formatted = currencyFormatter.format(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
};

/**
 * Determines the CSS class string for table value cells, applying red text for negatives.
 * @param {number} value - Numeric value to evaluate
 * @param {boolean} hasValue - Whether the cell actually contains a numeric value
 * @param {string} extraClass - Additional class names to append
 * @returns {string} Computed class string
 */
const getValueCellClassName = (value, hasValue, extraClass = "") => {
  const classes = ["balance-report-table__value"];
  if (hasValue && Number(value) < 0) {
    classes.push("balance-report-table__value--negative");
  }
  if (extraClass) {
    classes.push(extraClass);
  }
  return classes.join(" ");
};

// ============================================================================
// UTILITY FUNCTIONS - Data Processing
// ============================================================================

/**
 * Builds a map of leaf node names to their total values
 * @param {Array} nodes - Tree nodes to process
 * @param {Map} map - Accumulator map
 * @returns {Map} Map of leaf node names to totals
 */
const buildLeafActualTotalsMap = (nodes, map = new Map()) => {
  if (!Array.isArray(nodes)) {
    return map;
  }

  for (const node of nodes) {
    if (!node || typeof node !== "object" || !node.name) {
      continue;
    }
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    if (!hasChildren) {
      const numericValue = Number.isFinite(Number(node.total))
        ? Number(node.total)
        : 0;
      map.set(node.name, numericValue);
      continue;
    }
    buildLeafActualTotalsMap(node.children, map);
  }

  return map;
};

/**
 * Computes the date range for the selected period
 * @param {string} fromMonth - Start month ("01"-"12")
 * @param {string} toMonth - End month ("01"-"12")
 * @param {number|string} year - Year value
 * @returns {Object|null} Object with start and end dates
 */
const computePeriodRange = (fromMonth, toMonth, year) => {
  const yearNumber = Number.parseInt(year, 10);
  if (!Number.isFinite(yearNumber)) {
    return null;
  }
  const startMonth = Number.parseInt(fromMonth, 10);
  const endMonth = Number.parseInt(toMonth, 10);
  if (!Number.isFinite(startMonth) || !Number.isFinite(endMonth)) {
    return null;
  }
  const start = new Date(yearNumber, startMonth - 1, 1);
  const end = new Date(yearNumber, endMonth, 0);
  return { start, end };
};

/**
 * Formats a Date object to ISO date string (YYYY-MM-DD)
 * @param {Date} value - Date to format
 * @returns {string|null} Formatted date string
 */
const formatDateParam = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Creates a resolver function that computes values with caching
 * @param {Map} leafTotals - Map of leaf node totals
 * @returns {Function} Resolver function
 */
const createActualValueResolver = (leafTotals) => {
  if (!leafTotals || typeof leafTotals.get !== "function") {
    return () => 0;
  }
  const cache = new Map();
  const resolve = (node, pathKey) => {
    if (!node || !pathKey) {
      return 0;
    }
    if (cache.has(pathKey)) {
      return cache.get(pathKey);
    }
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    const total = hasChildren
      ? node.children.reduce(
          (sum, child) => sum + resolve(child, `${pathKey}>${child.name}`),
          0
        )
      : leafTotals.get(node.name) ?? 0;
    cache.set(pathKey, total);
    return total;
  };
  return resolve;
};

/**
 * Safely converts a value to a number
 * @param {*} value - Value to convert
 * @returns {number} Converted number or 0
 */
const safeNumber = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

/**
 * Resolves the value for a top-level node by name
 * @param {Array} nodes - Array of nodes
 * @param {string} name - Node name to find
 * @param {Function} resolver - Value resolver function
 * @returns {number|null} Resolved value
 */
const resolveTopLevelNodeValue = (nodes, name, resolver) => {
  if (!Array.isArray(nodes) || !name || typeof resolver !== "function") {
    return null;
  }
  const node = nodes.find((entry) => entry && entry.name === name);
  if (!node) {
    return null;
  }
  return resolver(node, name);
};

/**
 * Computes total of Income and Expense nodes
 * @param {Array} nodes - Category tree nodes
 * @param {Function} resolver - Value resolver function
 * @returns {number} Combined total
 */
const computeIncomeExpenseTotal = (nodes, resolver) => {
  if (typeof resolver !== "function") {
    return 0;
  }
  const incomeValue = resolveTopLevelNodeValue(nodes, "Income", resolver);
  const expenseValue = resolveTopLevelNodeValue(nodes, "Expense", resolver);
  return safeNumber(incomeValue) + safeNumber(expenseValue);
};

// ============================================================================
// UTILITY FUNCTIONS - Category Tree Operations
// ============================================================================

/**
 * Builds a hierarchical category tree from flat data
 * @param {Array} items - Array of category items
 * @returns {Array} Hierarchical tree structure
 */

/**
 * Collects all paths that have children (can be collapsed)
 * @param {Array} nodes - Category tree nodes
 * @param {Array} path - Current path
 * @param {Set} accumulator - Accumulator set
 * @returns {Set} Set of collapsible path keys
 */
const collectCollapsiblePaths = (nodes, path = [], accumulator = new Set()) => {
  if (!Array.isArray(nodes)) {
    return accumulator;
  }

  for (const node of nodes) {
    if (!node || typeof node !== "object" || !node.name) {
      continue;
    }
    const currentPath = [...path, node.name];
    const pathKey = currentPath.join(">");
    if (Array.isArray(node.children) && node.children.length > 0) {
      accumulator.add(pathKey);
      collectCollapsiblePaths(node.children, currentPath, accumulator);
    }
  }

  return accumulator;
};

/**
 * Checks if a path represents an expense category
 * @param {Array} path - Category path
 * @returns {boolean} True if expense path
 */
const isExpensePath = (path) => {
  if (!Array.isArray(path) || path.length === 0) {
    return false;
  }
  const topLevel = path[0];
  return (
    typeof topLevel === "string" && topLevel.toLowerCase().includes("expense")
  );
};

/**
 * Checks if a path represents an income category
 * @param {Array} path - Category path
 * @returns {boolean} True if income path
 */
const isIncomePath = (path) => {
  if (!Array.isArray(path) || path.length === 0) {
    return false;
  }
  const topLevel = path[0];
  return (
    typeof topLevel === "string" && topLevel.toLowerCase().includes("income")
  );
};

const collectLeafCategoryNames = (node) => {
  if (!node || typeof node !== "object") {
    return [];
  }
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  if (!hasChildren) {
    return node.name ? [node.name] : [];
  }
  return node.children.flatMap((child) => collectLeafCategoryNames(child));
};

// ============================================================================
// UTILITY FUNCTIONS - Rendering
// ============================================================================

/**
 * Renders category rows with budget, actual, and variance values
 * @param {Array} nodes - Category tree nodes
 * @param {Set} collapsedPaths - Set of collapsed path keys
 * @param {Function} handleToggle - Toggle collapse handler
 * @param {Map} leafActualTotals - Map of actual totals
 * @param {Function} getActualValue - Actual value resolver
 * @param {Map} leafBudgetTotals - Map of budget totals
 * @param {Function} getBudgetValue - Budget value resolver
 * @param {Function} onBudgetCellDoubleClick - Callback for budget cell double click
 * @param {Function} onActualCellDoubleClick - Callback for actual cell double click
 * @param {number} level - Indentation level
 * @param {Array} path - Current path
 * @returns {Array} Array of React elements
 */
const renderCategoryRows = (
  nodes,
  collapsedPaths,
  handleToggle,
  leafActualTotals,
  getActualValue,
  leafBudgetTotals,
  getBudgetValue,
  onBudgetCellDoubleClick,
  onActualCellDoubleClick,
  level = 0,
  path = []
) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  return nodes.flatMap((node) => {
    if (!node || typeof node !== "object" || !node.name) {
      return [];
    }
    const currentPath = [...path, node.name];
    const pathKey = currentPath.join(">");
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    const isCollapsed = collapsedPaths.has(pathKey);

    const hasActualData = leafActualTotals !== null;
    const hasBudgetData = leafBudgetTotals !== null;
    const resolvedActualValue =
      hasActualData && typeof getActualValue === "function"
        ? getActualValue(node, pathKey)
        : 0;
    const resolvedBudgetValue =
      hasBudgetData && typeof getBudgetValue === "function"
        ? getBudgetValue(node, pathKey)
        : 0;
    if (
      hasActualData &&
      hasBudgetData &&
      resolvedActualValue === 0 &&
      resolvedBudgetValue === 0
    ) {
      return [];
    }
    const leafCategories = collectLeafCategoryNames(node);
    const actualDisplay = hasActualData
      ? formatCurrencyValue(resolvedActualValue)
      : "—";
    const budgetDisplay = hasBudgetData
      ? formatCurrencyValue(resolvedBudgetValue)
      : "—";
    const hasVarianceData = hasBudgetData || hasActualData;
    const budgetForVariance = hasBudgetData ? resolvedBudgetValue : 0;
    const actualForVariance = hasActualData ? resolvedActualValue : 0;
    const varianceValue =
      isExpensePath(currentPath) || isIncomePath(currentPath)
        ? actualForVariance - budgetForVariance
        : budgetForVariance - actualForVariance;
    const varianceDisplay = hasVarianceData
      ? formatCurrencyValue(varianceValue)
      : "—";
    const pathLabel = currentPath.join(" › ");

    const handleBudgetCellDoubleClick =
      hasBudgetData && typeof onBudgetCellDoubleClick === "function"
        ? (event) => {
            event.stopPropagation();
            onBudgetCellDoubleClick({
              type: "budget",
              name: node.name,
              path: currentPath,
              pathKey,
              pathLabel,
              budgetValue: resolvedBudgetValue,
              budgetDisplay,
              actualValue: resolvedActualValue,
              actualDisplay,
              varianceValue,
              varianceDisplay,
              hasBudgetData,
              hasActualData,
              hasVarianceData,
              categories: leafCategories,
            });
          }
        : undefined;

    const handleActualCellDoubleClick =
      hasActualData && typeof onActualCellDoubleClick === "function"
        ? (event) => {
            event.stopPropagation();
            onActualCellDoubleClick({
              type: "actual",
              name: node.name,
              path: currentPath,
              pathKey,
              pathLabel,
              budgetValue: resolvedBudgetValue,
              budgetDisplay,
              actualValue: resolvedActualValue,
              actualDisplay,
              varianceValue,
              varianceDisplay,
              hasBudgetData,
              hasActualData,
              hasVarianceData,
              categories: leafCategories,
            });
          }
        : undefined;

    const row = (
      <tr key={pathKey} data-level={level}>
        <td
          className="balance-report-table__name"
          style={{ "--cashflow-indent-level": level }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleToggle(pathKey);
            }}
            disabled={!hasChildren}
            className="cash-flow-report__toggle-button"
            aria-label={
              hasChildren
                ? `${isCollapsed ? "Expand" : "Collapse"} ${node.name}`
                : undefined
            }
          >
            {hasChildren ? (isCollapsed ? "+" : "−") : "\u00a0"}
          </button>
          <span className="balance-report-table__name-text">{node.name}</span>
        </td>
        <td
          className={getValueCellClassName(resolvedBudgetValue, hasBudgetData)}
          onDoubleClick={handleBudgetCellDoubleClick}
        >
          {budgetDisplay}
        </td>
        <td
          className={getValueCellClassName(resolvedActualValue, hasActualData)}
          onDoubleClick={handleActualCellDoubleClick}
        >
          {actualDisplay}
        </td>
        <td className={getValueCellClassName(varianceValue, hasVarianceData)}>
          {varianceDisplay}
        </td>
      </tr>
    );

    const childrenRows =
      hasChildren && !isCollapsed
        ? renderCategoryRows(
            node.children,
            collapsedPaths,
            handleToggle,
            leafActualTotals,
            getActualValue,
            leafBudgetTotals,
            getBudgetValue,
            onBudgetCellDoubleClick,
            onActualCellDoubleClick,
            level + 1,
            currentPath
          )
        : [];

    return hasChildren ? [row, ...childrenRows] : [row];
  });
};

/**
 * Filters category tree based on inclusion options
 * @param {Array} nodes - Category tree nodes
 * @param {Object} options - Filter options
 * @param {boolean} options.includeUnrealized - Include unrealized G/L
 * @param {boolean} options.includeTransfers - Include transfers
 * @returns {Array} Filtered category tree
 */
const filterCategoryTree = (nodes, { includeUnrealized, includeTransfers }) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  return nodes
    .map((node) => {
      if (!node || typeof node !== "object" || !node.name) {
        return null;
      }
      if (!includeUnrealized && node.name === "Unrealized G/L") {
        return null;
      }
      if (!includeTransfers && node.name === "Transfers") {
        return null;
      }
      const filteredChildren = filterCategoryTree(node.children, {
        includeUnrealized,
        includeTransfers,
      });
      const nextNode = { ...node };
      if (filteredChildren.length > 0) {
        nextNode.children = filteredChildren;
      } else {
        delete nextNode.children;
      }
      return nextNode;
    })
    .filter(Boolean);
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * BudgetRealization - Budget vs Actual reporting page
 *
 * This component provides functionality for:
 * - Comparing budget to actual performance by category
 * - Viewing variance between budget and actual
 * - Filtering by time period (month, YTD, full year)
 * - Collapsible category tree structure
 * - Optional inclusion of unrealized G/L and transfers
 */
export default function BudgetRealization() {
  // ========== COA Data ==========
  const { plTree } = useCoa();

  // ========== State: Report Parameters ==========
  const currentMonthValue = MONTH_OPTIONS[new Date().getMonth()].value;
  const [fromMonth, setFromMonth] = useState(currentMonthValue);
  const [toMonth, setToMonth] = useState(currentMonthValue);
  const [actualYear, setActualYear] = useState(YEAR_OPTIONS[0]);
  const [budgetYear, setBudgetYear] = useState(YEAR_OPTIONS[0]);
  const [includeUnrealized, setIncludeUnrealized] = useState(false);
  const [includeTransfers, setIncludeTransfers] = useState(false);

  // ========== State: Data ==========
  const [leafActualTotals, setLeafActualTotals] = useState(null);
  const [leafBudgetTotals, setLeafBudgetTotals] = useState(null);

  // ========== State: UI ==========
  // Tracks what the user has EXPANDED. `collapsedPaths` is DERIVED from it below.
  //
  // It used to be the other way round — `collapsedPaths` was state, re-seeded by an effect
  // (`setCollapsedPaths(new Set(collapsiblePaths))`) every time `collapsiblePaths` changed.
  // But that memo recomputes whenever the tree OR the filters change, so toggling "include
  // transfers" — or any data reload — silently slammed every row you had opened shut again.
  // Storing the deviations instead means the default ("everything collapsed") is derived,
  // not re-imposed, and your expansions survive a reload.
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [entryDetail, setEntryDetail] = useState(null);

  // ========== Computed Values: Date Range ==========
  const budgetPeriodRange = useMemo(
    () => computePeriodRange(fromMonth, toMonth, budgetYear),
    [fromMonth, toMonth, budgetYear]
  );
  const actualPeriodRange = useMemo(
    () => computePeriodRange(fromMonth, toMonth, actualYear),
    [fromMonth, toMonth, actualYear]
  );

  // ========== Computed Values: Resolvers ==========
  const actualValueResolver = useMemo(
    () =>
      leafActualTotals ? createActualValueResolver(leafActualTotals) : null,
    [leafActualTotals]
  );

  const budgetValueResolver = useMemo(
    () =>
      leafBudgetTotals ? createActualValueResolver(leafBudgetTotals) : null,
    [leafBudgetTotals]
  );

  // ========== Computed Values: Category Tree ==========
  // plTree from useCoa() is already in { name, children } shape
  const categoryTree = plTree;

  const filteredCategoryTree = useMemo(
    () =>
      filterCategoryTree(categoryTree, {
        includeUnrealized,
        includeTransfers,
      }),
    [categoryTree, includeUnrealized, includeTransfers]
  );

  const collapsiblePaths = useMemo(
    () => collectCollapsiblePaths(filteredCategoryTree),
    [filteredCategoryTree]
  );

  // Collapsed by default: every collapsible path the user has not explicitly opened.
  const collapsedPaths = useMemo(() => {
    const next = new Set();
    for (const pathKey of collapsiblePaths) {
      if (!expandedPaths.has(pathKey)) next.add(pathKey);
    }
    return next;
  }, [collapsiblePaths, expandedPaths]);

  // ========== Computed Values: Net Totals ==========
  const hasActualData = leafActualTotals !== null;
  const hasBudgetData = leafBudgetTotals !== null;

  const netActualValue =
    hasActualData && actualValueResolver
      ? computeIncomeExpenseTotal(filteredCategoryTree, actualValueResolver)
      : null;

  const netBudgetValue =
    hasBudgetData && budgetValueResolver
      ? computeIncomeExpenseTotal(filteredCategoryTree, budgetValueResolver)
      : null;

  const showNetRow = hasActualData || hasBudgetData;

  const netBudgetDisplay = hasBudgetData
    ? formatCurrencyValue(netBudgetValue)
    : "—";

  const netActualDisplay = hasActualData
    ? formatCurrencyValue(netActualValue)
    : "—";

  const showNetVariance = hasBudgetData || hasActualData;
  const netVarianceValue =
    (hasActualData ? netActualValue : 0) - (hasBudgetData ? netBudgetValue : 0);
  const netVarianceDisplay = showNetVariance
    ? formatCurrencyValue(netVarianceValue)
    : "—";

  // ========== Computed Values: Per-Category KPI Values ==========
  const incomeActual =
    hasActualData && actualValueResolver
      ? resolveTopLevelNodeValue(filteredCategoryTree, "Income", actualValueResolver)
      : null;
  const incomeBudget =
    hasBudgetData && budgetValueResolver
      ? resolveTopLevelNodeValue(filteredCategoryTree, "Income", budgetValueResolver)
      : null;
  const expenseActual =
    hasActualData && actualValueResolver
      ? resolveTopLevelNodeValue(filteredCategoryTree, "Expense", actualValueResolver)
      : null;
  const expenseBudget =
    hasBudgetData && budgetValueResolver
      ? resolveTopLevelNodeValue(filteredCategoryTree, "Expense", budgetValueResolver)
      : null;

  const kpiData = useMemo(() => {
    if (!hasActualData && !hasBudgetData) return null;
    return {
      incomeActual: safeNumber(incomeActual),
      incomeBudget: safeNumber(incomeBudget),
      expenseActual: safeNumber(expenseActual),
      expenseBudget: safeNumber(expenseBudget),
      netActualValue: safeNumber(netActualValue),
      netBudgetValue: safeNumber(netBudgetValue),
      netVarianceValue,
    };
  }, [
    hasActualData, hasBudgetData,
    incomeActual, incomeBudget,
    expenseActual, expenseBudget,
    netActualValue, netBudgetValue, netVarianceValue,
  ]);

  const netBudgetHasValue =
    netBudgetValue !== null && netBudgetValue !== undefined;
  const netActualHasValue =
    netActualValue !== null && netActualValue !== undefined;
  const netVarianceHasValue = showNetVariance;

  const netBudgetCellClass = getValueCellClassName(
    netBudgetValue ?? 0,
    netBudgetHasValue,
    "balance-report-table__value--bold"
  );
  const netActualCellClass = getValueCellClassName(
    netActualValue ?? 0,
    netActualHasValue,
    "balance-report-table__value--bold"
  );
  const netVarianceCellClass = getValueCellClassName(
    netVarianceValue,
    netVarianceHasValue,
    "balance-report-table__value--bold"
  );

  // ========== Effects: Initialization ==========

  // ========== Effects: Data Fetching ==========

  // Fetch actuals when the selected actual period or filters change
  useEffect(() => {
    if (!actualPeriodRange) {
      setLeafActualTotals(null);
      return;
    }

    const fromDateParam = formatDateParam(actualPeriodRange.start);
    const toDateParam = formatDateParam(actualPeriodRange.end);
    if (!fromDateParam || !toDateParam) {
      setLeafActualTotals(null);
      return;
    }

    let isActive = true;
    setLeafActualTotals(null);
    const transfersMode = includeTransfers ? "include" : "exclude";

    const fetchActuals = async () => {
      try {
        const report = await Rest.fetchCashFlowReportV2({
          fromDate: fromDateParam,
          toDate: toDateParam,
          transfers: transfersMode,
          includeUnrealizedGL: includeUnrealized,
        });
        const nodes = Array.isArray(report) ? report : [];
        const totalsMap = buildLeafActualTotalsMap(nodes);
        if (!isActive) {
          return;
        }
        setLeafActualTotals(totalsMap);
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error("[BudgetRealization] Failed to load actuals:", error);
        setLeafActualTotals(null);
      }
    };

    fetchActuals();

    return () => {
      isActive = false;
    };
  }, [actualPeriodRange, includeTransfers, includeUnrealized]);

  // Fetch budgets when the selected budget period or filters change
  useEffect(() => {
    if (!budgetPeriodRange) {
      setLeafBudgetTotals(null);
      return;
    }

    const fromDateParam = formatDateParam(budgetPeriodRange.start);
    const toDateParam = formatDateParam(budgetPeriodRange.end);
    if (!fromDateParam || !toDateParam) {
      setLeafBudgetTotals(null);
      return;
    }

    let isActive = true;
    setLeafBudgetTotals(null);
    const transfersMode = includeTransfers ? "include" : "exclude";

    const fetchBudgets = async () => {
      try {
        const report = await Rest.fetchBudgetCashFlowReport({
          fromDate: fromDateParam,
          toDate: toDateParam,
          transfers: transfersMode,
          includeUnrealizedGL: includeUnrealized,
        });
        const nodes = Array.isArray(report) ? report : [];
        const totalsMap = buildLeafActualTotalsMap(nodes);
        if (!isActive) {
          return;
        }
        setLeafBudgetTotals(totalsMap);
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error(
          "[BudgetRealization] Failed to load budget totals:",
          error
        );
        setLeafBudgetTotals(null);
      }
    };

    fetchBudgets();

    return () => {
      isActive = false;
    };
  }, [budgetPeriodRange, includeTransfers, includeUnrealized]);

  // ========== Event Handlers ==========

  /**
   * Toggles collapse state for a category path
   */
  const handleTogglePath = (pathKey) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey); // was expanded ⇒ collapse it
      } else {
        next.add(pathKey); // was collapsed ⇒ expand it
      }
      return next;
    });
  };

  const isFullyCollapsed =
    collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size;

  const isFullyExpanded =
    collapsiblePaths.size > 0 && collapsedPaths.size === 0;

  /**
   * Expands one layer of collapsed paths (shallowest collapsed depth)
   */
  const handleExpandOneLayer = () => {
    if (collapsedPaths.size === 0) return;
    let minDepth = Infinity;
    for (const pathKey of collapsedPaths) {
      const depth = pathKey.split(">").length - 1;
      if (depth < minDepth) minDepth = depth;
    }
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (const pathKey of collapsedPaths) {
        if (pathKey.split(">").length - 1 === minDepth) next.add(pathKey);
      }
      return next;
    });
  };

  /**
   * Collapses one layer of expanded paths (deepest expanded depth)
   */
  const handleCollapseOneLayer = () => {
    const open = [...collapsiblePaths].filter((pathKey) => expandedPaths.has(pathKey));
    if (open.length === 0) return;
    let maxDepth = -1;
    for (const pathKey of open) {
      const depth = pathKey.split(">").length - 1;
      if (depth > maxDepth) maxDepth = depth;
    }
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (const pathKey of open) {
        if (pathKey.split(">").length - 1 === maxDepth) next.delete(pathKey);
      }
      return next;
    });
  };

  const handleBudgetCellDoubleClick = (detail) => {
    if (!detail) {
      setEntryDetail(null);
      return;
    }
    const categories =
      Array.isArray(detail.categories) && detail.categories.length
        ? detail.categories
        : detail.name
        ? [detail.name]
        : [];
    setEntryDetail({
      ...detail,
      categories,
      period: budgetPeriodRange,
    });
  };

  const handleActualCellDoubleClick = (detail) => {
    if (!detail) {
      setEntryDetail(null);
      return;
    }
    const categories =
      Array.isArray(detail.categories) && detail.categories.length
        ? detail.categories
        : detail.name
        ? [detail.name]
        : [];
    setEntryDetail({
      ...detail,
      categories,
      period: actualPeriodRange,
    });
  };

  const handleBudgetDetailClose = () => {
    setEntryDetail(null);
  };

  // ========== Event Handlers: Period ==========
  const handlePeriodChange = useCallback(
    ({ fromMonth, toMonth, actualYear, budgetYear }) => {
      setFromMonth(fromMonth);
      setToMonth(toMonth);
      setActualYear(actualYear);
      setBudgetYear(budgetYear);
    },
    []
  );

  // ========== Computed Values: Toolbar Props ==========
  const periodProps = useMemo(
    () => ({
      fromMonth,
      toMonth,
      actualYear,
      budgetYear,
      monthOptions: MONTH_OPTIONS,
      yearOptions: YEAR_OPTIONS,
      budgetYearOptions: BUDGET_YEAR_OPTIONS,
      onChange: handlePeriodChange,
      defaultPreset: "this-month",
    }),
    [fromMonth, toMonth, actualYear, budgetYear, handlePeriodChange]
  );

  const toggleProps = useMemo(
    () => ({
      includeUnrealized,
      onIncludeUnrealizedChange: setIncludeUnrealized,
      includeTransfers,
      onIncludeTransfersChange: setIncludeTransfers,
      isFullyCollapsed,
      isFullyExpanded,
      onExpandOneLayer: handleExpandOneLayer,
      onCollapseOneLayer: handleCollapseOneLayer,
      hasCollapsiblePaths: collapsiblePaths.size > 0,
    }),
    [
      includeUnrealized,
      includeTransfers,
      isFullyCollapsed,
      isFullyExpanded,
      handleExpandOneLayer,
      handleCollapseOneLayer,
      collapsiblePaths.size,
    ]
  );

  // ========== Export ==========
  const handleExport = useCallback(() => {
    exportBudgetRealization(
      filteredCategoryTree,
      actualValueResolver,
      budgetValueResolver,
      hasActualData,
      hasBudgetData
    );
  }, [filteredCategoryTree, actualValueResolver, budgetValueResolver, hasActualData, hasBudgetData]);

  // ========== Render ==========

  return (
    <>
      <main className="budget-realization-main budget-realization-main--single">
        <BudgetRealizationContent
          filteredCategoryTree={filteredCategoryTree}
          collapsedPaths={collapsedPaths}
          onTogglePath={handleTogglePath}
          leafActualTotals={leafActualTotals}
          actualValueResolver={actualValueResolver}
          leafBudgetTotals={leafBudgetTotals}
          budgetValueResolver={budgetValueResolver}
          showNetRow={showNetRow}
          netBudgetDisplay={netBudgetDisplay}
          netActualDisplay={netActualDisplay}
          netVarianceDisplay={netVarianceDisplay}
          netBudgetCellClass={netBudgetCellClass}
          netActualCellClass={netActualCellClass}
          netVarianceCellClass={netVarianceCellClass}
          renderCategoryRows={renderCategoryRows}
          onBudgetCellDoubleClick={handleBudgetCellDoubleClick}
          onActualCellDoubleClick={handleActualCellDoubleClick}
          periodProps={periodProps}
          toggleProps={toggleProps}
          onExport={handleExport}
          canExport={hasActualData || hasBudgetData}
          kpiData={kpiData}
        />
      </main>
      <BudgetDetailModal
        detail={entryDetail}
        onClose={handleBudgetDetailClose}
      />
    </>
  );
}
