import { useMemo, useState, useEffect } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import BudgetBalancePanel, {
  MONTH_OPTIONS,
  YEAR_OPTIONS,
} from "../features/Budgets/BudgetBalancePanel.jsx";
import BudgetRealizationContent from "../features/Budgets/BudgetRealizationContent.jsx";
import BudgetDetailModal from "../features/Budgets/BudgetDetailModal.jsx";
import Rest from "../js/rest.js";
import "../features/CashFlow/CashFlowReport.css";
import coaData from "../../../components/data/coa.json";
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
 * @param {string} reportType - Type of report (month, ytd, full-year)
 * @param {string} selectedMonth - Selected month value
 * @param {string} selectedYear - Selected year value
 * @returns {Object|null} Object with start and end dates
 */
const computePeriodRange = (reportType, selectedMonth, selectedYear) => {
  const yearNumber = Number.parseInt(selectedYear, 10);
  if (!Number.isFinite(yearNumber)) {
    return null;
  }

  const normalizedReportType =
    typeof reportType === "string" ? reportType : "month";
  let startMonth = 1;
  let endMonth = 12;

  if (normalizedReportType === "month") {
    const monthNumber = Number.parseInt(selectedMonth, 10);
    if (!Number.isFinite(monthNumber)) {
      return null;
    }
    startMonth = monthNumber;
    endMonth = monthNumber;
  } else if (normalizedReportType === "ytd") {
    const monthNumber = Number.parseInt(selectedMonth, 10);
    if (!Number.isFinite(monthNumber)) {
      return null;
    }
    startMonth = 1;
    endMonth = Math.min(Math.max(monthNumber, 1), 12);
  } else if (normalizedReportType === "full-year") {
    startMonth = 1;
    endMonth = 12;
  } else {
    const monthNumber = Number.parseInt(selectedMonth, 10);
    if (!Number.isFinite(monthNumber)) {
      return null;
    }
    startMonth = monthNumber;
    endMonth = monthNumber;
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
  return value.toISOString().split("T")[0];
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
const buildCategoryTree = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item) => {
    if (typeof item === "string") {
      const name = item.trim();
      return name ? [{ name }] : [];
    }

    if (item && typeof item === "object") {
      return Object.entries(item)
        .map(([key, value]) => {
          const name = key?.trim();
          if (!name) {
            return null;
          }
          const node = { name };
          if (typeof value === "string") {
            const childName = value?.trim();
            if (childName) {
              node.children = [{ name: childName }];
            }
          } else if (Array.isArray(value)) {
            node.children = buildCategoryTree(value);
          } else if (value && typeof value === "object") {
            node.children = buildCategoryTree([value]);
          }
          return node;
        })
        .filter(Boolean);
    }

    return [];
  });
};

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
      <tr key={pathKey}>
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
  // ========== State: Report Parameters ==========
  const [reportType, setReportType] = useState("month");
  const [selectedMonth, setSelectedMonth] = useState(
    MONTH_OPTIONS[new Date().getMonth()].value
  );
  const [selectedYear, setSelectedYear] = useState(YEAR_OPTIONS[3]);
  const [actualYear, setActualYear] = useState(YEAR_OPTIONS[3]);
  const [includeUnrealized, setIncludeUnrealized] = useState(false);
  const [includeTransfers, setIncludeTransfers] = useState(false);

  // ========== State: Data ==========
  const [leafActualTotals, setLeafActualTotals] = useState(null);
  const [leafBudgetTotals, setLeafBudgetTotals] = useState(null);

  // ========== State: UI ==========
  const [collapsedPaths, setCollapsedPaths] = useState(new Set());
  const [entryDetail, setEntryDetail] = useState(null);

  // ========== Computed Values: Date Range ==========
  const budgetPeriodRange = useMemo(
    () => computePeriodRange(reportType, selectedMonth, selectedYear),
    [reportType, selectedMonth, selectedYear]
  );
  const actualPeriodRange = useMemo(
    () => computePeriodRange(reportType, selectedMonth, actualYear),
    [reportType, selectedMonth, actualYear]
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
  const categoryTree = useMemo(() => {
    const profitLossSection = coaData.find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        Object.prototype.hasOwnProperty.call(entry, "Profit & Loss Accounts")
    );
    const profitLossNodes = profitLossSection
      ? profitLossSection["Profit & Loss Accounts"]
      : [];
    return buildCategoryTree(profitLossNodes);
  }, []);

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

  // Sync collapsed paths when collapsible paths change
  useEffect(() => {
    setCollapsedPaths(new Set(collapsiblePaths));
  }, [collapsiblePaths]);

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
        const report = await Rest.fetchCashFlowReport({
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
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  };

  /**
   * Collapses all category paths
   */
  const handleCollapseAll = () => {
    setCollapsedPaths(new Set(collapsiblePaths));
  };

  /**
   * Expands all category paths
   */
  const handleExpandAll = () => {
    setCollapsedPaths(new Set());
  };

  const isFullyCollapsed =
    collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size;

  /**
   * Toggles between fully collapsed and fully expanded states
   */
  const handleToggleCollapseAll = () => {
    if (isFullyCollapsed) {
      handleExpandAll();
    } else {
      handleCollapseAll();
    }
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

  // ========== Render ==========

  return (
    <div className="budget-realization-shell">
      <NavigationMenu />
      <main className="budget-realization-main">
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
        />
        <div className="budget-realization-sidebar">
          <BudgetBalancePanel
            includeUnrealized={includeUnrealized}
            onIncludeUnrealizedChange={setIncludeUnrealized}
            includeTransfers={includeTransfers}
            onIncludeTransfersChange={setIncludeTransfers}
            reportType={reportType}
            onReportTypeChange={setReportType}
            year={selectedYear}
            actualYear={actualYear}
            onYearChange={setSelectedYear}
            onActualYearChange={setActualYear}
            month={selectedMonth}
            onMonthChange={setSelectedMonth}
            isFullyCollapsed={isFullyCollapsed}
            onToggleCollapseAll={handleToggleCollapseAll}
            hasCollapsiblePaths={collapsiblePaths.size > 0}
          />
        </div>
      </main>
      <BudgetDetailModal
        detail={entryDetail}
        onClose={handleBudgetDetailClose}
      />
    </div>
  );
}
