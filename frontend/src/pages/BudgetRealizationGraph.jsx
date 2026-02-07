import { useMemo, useState, useEffect } from "react";
import BudgetBalancePanel, {
  MONTH_OPTIONS,
  YEAR_OPTIONS,
} from "../features/Budgets/BudgetBalancePanel.jsx";
import BudgetGraphModal from "../features/Budgets/BudgetGraphModal.jsx";
import Rest from "../js/rest.js";
import "../features/CashFlow/CashFlowReport.css";
import coaData from "../../../components/data/coa.json";
import "./PageLayout.css";
import "./BudgetRealizationGraph.css";

// ============================================================================
// CURRENCY FORMATTING
// ============================================================================

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrencyValue = (value) => {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const formatted = currencyFormatter.format(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
};

const chartCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const formatCurrencyShort = (value) =>
  chartCurrencyFormatter.format(Number.isFinite(Number(value)) ? Number(value) : 0);

const formatAxisLabel = (value) => {
  const normalized = Number.isFinite(Number(value)) ? Number(value) : 0;
  const absValue = Math.abs(normalized);
  if (absValue >= 1_000_000) {
    const fractional = normalized / 1_000_000;
    return `${fractional.toLocaleString("en-US", {
      maximumFractionDigits: fractional % 1 === 0 ? 0 : 1,
      minimumFractionDigits: 0,
    })}M`;
  }
  if (absValue >= 1_000) {
    const fractional = normalized / 1_000;
    return `${fractional.toLocaleString("en-US", {
      maximumFractionDigits: fractional % 1 === 0 ? 0 : 1,
      minimumFractionDigits: 0,
    })}k`;
  }
  return normalized.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
};

// ============================================================================
// UTILITY FUNCTIONS - Data Processing
// ============================================================================

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

const formatDateParam = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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

const safeNumber = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

// ============================================================================
// UTILITY FUNCTIONS - Category Tree Operations
// ============================================================================

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
// CHART DATA BUILDING
// ============================================================================

const buildChartData = (
  nodes,
  leafActualTotals,
  getActualValue,
  leafBudgetTotals,
  getBudgetValue,
  path = []
) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const hasActualData = leafActualTotals !== null;
  const hasBudgetData = leafBudgetTotals !== null;

  return nodes.flatMap((node) => {
    if (!node || typeof node !== "object" || !node.name) {
      return [];
    }

    const currentPath = [...path, node.name];
    const pathKey = currentPath.join(">");
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;

    // Only include top-level categories (Income and Expense)
    if (path.length > 0) {
      return buildChartData(
        node.children,
        leafActualTotals,
        getActualValue,
        leafBudgetTotals,
        getBudgetValue,
        currentPath
      );
    }

    const resolvedActualValue =
      hasActualData && typeof getActualValue === "function"
        ? getActualValue(node, pathKey)
        : 0;
    const resolvedBudgetValue =
      hasBudgetData && typeof getBudgetValue === "function"
        ? getBudgetValue(node, pathKey)
        : 0;

    // Skip if both values are zero
    if (
      hasActualData &&
      hasBudgetData &&
      resolvedActualValue === 0 &&
      resolvedBudgetValue === 0
    ) {
      return [];
    }

    // Get children for nested chart with their own children (grandchildren)
    const childData = hasChildren
      ? node.children.flatMap((child) => {
          const childPathKey = `${pathKey}>${child.name}`;
          const childActual =
            hasActualData && typeof getActualValue === "function"
              ? getActualValue(child, childPathKey)
              : 0;
          const childBudget =
            hasBudgetData && typeof getBudgetValue === "function"
              ? getBudgetValue(child, childPathKey)
              : 0;

          if (childActual === 0 && childBudget === 0) {
            return [];
          }

          // Check if child has its own children (grandchildren)
          const childHasChildren = Array.isArray(child.children) && child.children.length > 0;
          const grandchildData = childHasChildren
            ? child.children.flatMap((grandchild) => {
                const grandchildPathKey = `${childPathKey}>${grandchild.name}`;
                const grandchildActual =
                  hasActualData && typeof getActualValue === "function"
                    ? getActualValue(grandchild, grandchildPathKey)
                    : 0;
                const grandchildBudget =
                  hasBudgetData && typeof getBudgetValue === "function"
                    ? getBudgetValue(grandchild, grandchildPathKey)
                    : 0;

                if (grandchildActual === 0 && grandchildBudget === 0) {
                  return [];
                }

                return [
                  {
                    name: grandchild.name,
                    actual: grandchildActual,
                    budget: grandchildBudget,
                    variance: grandchildActual - grandchildBudget,
                  },
                ];
              })
            : [];

          return [
            {
              name: child.name,
              actual: childActual,
              budget: childBudget,
              variance: childActual - childBudget,
              children: grandchildData,
            },
          ];
        })
      : [];

    return [
      {
        name: node.name,
        actual: resolvedActualValue,
        budget: resolvedBudgetValue,
        variance: resolvedActualValue - resolvedBudgetValue,
        children: childData,
      },
    ];
  });
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function BudgetRealizationGraph() {
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
  const [tooltip, setTooltip] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);

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

  // ========== Computed Values: Chart Data ==========
  const chartData = useMemo(() => {
    return buildChartData(
      filteredCategoryTree,
      leafActualTotals,
      actualValueResolver,
      leafBudgetTotals,
      budgetValueResolver
    );
  }, [
    filteredCategoryTree,
    leafActualTotals,
    actualValueResolver,
    leafBudgetTotals,
    budgetValueResolver,
  ]);

  const hasChartData = chartData.length > 0;

  // ========== Effects: Data Fetching ==========

  // Fetch actuals
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
        console.error("[BudgetRealizationGraph] Failed to load actuals:", error);
        setLeafActualTotals(null);
      }
    };

    fetchActuals();

    return () => {
      isActive = false;
    };
  }, [actualPeriodRange, includeTransfers, includeUnrealized]);

  // Fetch budgets
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
          "[BudgetRealizationGraph] Failed to load budget totals:",
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

  const handleCategoryClick = (category) => {
    setSelectedCategory(category);
  };

  const handleModalClose = () => {
    setSelectedCategory(null);
  };

  // ========== Chart Rendering ==========

  const renderChart = () => {
    if (!hasChartData) {
      return (
        <div className="budget-graph-empty">
          <p>Loading chart data...</p>
        </div>
      );
    }

    return (
      <div className="budget-graph-container">
        {chartData.map((category, index) => (
          <div key={index} className="budget-graph-section">
            <h3
              className="budget-graph-section-title budget-graph-section-title--clickable"
              onClick={() => handleCategoryClick(category)}
              title="Click to view subcategories"
            >
              {category.name}
            </h3>
            <div className="budget-graph-category-summary">
              <div className="budget-graph-summary-item">
                <span className="budget-graph-summary-label">Budget:</span>
                <span className="budget-graph-summary-value">
                  {formatCurrencyValue(category.budget)}
                </span>
              </div>
              <div className="budget-graph-summary-item">
                <span className="budget-graph-summary-label">Actual:</span>
                <span className="budget-graph-summary-value">
                  {formatCurrencyValue(category.actual)}
                </span>
              </div>
              <div className="budget-graph-summary-item">
                <span className="budget-graph-summary-label">Variance:</span>
                <span
                  className={`budget-graph-summary-value ${
                    category.variance < 0
                      ? "budget-graph-summary-value--negative"
                      : ""
                  }`}
                >
                  {formatCurrencyValue(category.variance)}
                </span>
              </div>
            </div>

            {category.children && category.children.length > 0 && (
              <div className="budget-graph-bars">
                {category.children.map((child, childIndex) => {
                  const maxValue = Math.max(
                    Math.abs(child.budget),
                    Math.abs(child.actual)
                  );
                  const budgetWidth =
                    maxValue > 0 ? (Math.abs(child.budget) / maxValue) * 100 : 0;
                  const actualWidth =
                    maxValue > 0 ? (Math.abs(child.actual) / maxValue) * 100 : 0;

                  const hasSubcategories = child.children && child.children.length > 0;

                  return (
                    <div key={childIndex} className="budget-graph-bar-group">
                      <div
                        className={`budget-graph-bar-label ${
                          hasSubcategories ? "budget-graph-bar-label--clickable" : ""
                        }`}
                        onClick={hasSubcategories ? () => handleCategoryClick(child) : undefined}
                        title={hasSubcategories ? "Click to view subcategories" : undefined}
                      >
                        {child.name}
                      </div>
                      <div className="budget-graph-bars-wrapper">
                        <div className="budget-graph-bar-row">
                          <span className="budget-graph-bar-type">Budget</span>
                          <div className="budget-graph-bar-container">
                            <div
                              className="budget-graph-bar budget-graph-bar--budget"
                              style={{ width: `${budgetWidth}%` }}
                              onMouseEnter={(e) => {
                                const rect = e.target.getBoundingClientRect();
                                setTooltip({
                                  x: rect.left + rect.width / 2,
                                  y: rect.top,
                                  label: `${child.name} - Budget`,
                                  value: child.budget,
                                });
                              }}
                              onMouseLeave={() => setTooltip(null)}
                            />
                          </div>
                          <span className="budget-graph-bar-value">
                            {formatCurrencyShort(child.budget)}
                          </span>
                        </div>
                        <div className="budget-graph-bar-row">
                          <span className="budget-graph-bar-type">Actual</span>
                          <div className="budget-graph-bar-container">
                            <div
                              className="budget-graph-bar budget-graph-bar--actual"
                              style={{ width: `${actualWidth}%` }}
                              onMouseEnter={(e) => {
                                const rect = e.target.getBoundingClientRect();
                                setTooltip({
                                  x: rect.left + rect.width / 2,
                                  y: rect.top,
                                  label: `${child.name} - Actual`,
                                  value: child.actual,
                                });
                              }}
                              onMouseLeave={() => setTooltip(null)}
                            />
                          </div>
                          <span className="budget-graph-bar-value">
                            {formatCurrencyShort(child.actual)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {tooltip && (
          <div
            className="budget-graph-tooltip"
            style={{
              left: tooltip.x,
              top: tooltip.y - 40,
            }}
          >
            <div className="budget-graph-tooltip-label">{tooltip.label}</div>
            <div className="budget-graph-tooltip-value">
              {formatCurrencyValue(tooltip.value)}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ========== Render ==========

  return (
    <>
      <main className="budget-realization-main">
        <div className="budget-graph-content">
          <div className="budget-graph-header">
            <h1 className="budget-graph-title">Budget Realization Chart</h1>
            <p className="budget-graph-subtitle">
              Visual comparison of budgeted vs actual performance by category
            </p>
          </div>
          {renderChart()}
        </div>
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
            isFullyCollapsed={false}
            onToggleCollapseAll={() => {}}
            hasCollapsiblePaths={false}
          />
        </div>
      </main>
      <BudgetGraphModal
        category={selectedCategory}
        onClose={handleModalClose}
        onCategoryClick={handleCategoryClick}
      />
    </>
  );
}
