import { useMemo, useState, useEffect } from "react";
import BudgetBalancePanel, {
  MONTH_OPTIONS,
  YEAR_OPTIONS,
} from "../features/Budgets/BudgetBalancePanel.jsx";
import BudgetGraphModal from "../features/Budgets/BudgetGraphModal.jsx";
import Rest from "../js/rest.js";
import { useCoa } from "../hooks/useCoa.js";
import {
  useLatestEstimate,
  chartSeries,
  chartVariances,
  varianceOf,
  createLePresenceResolver,
} from "../features/Budgets/latestEstimate.js";
import { LeCompareControl, LeCompareNotes } from "../features/Budgets/LeCompare.jsx";
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

// `null` is an UNKNOWN figure (an LE with no line, a variance with a missing
// operand) and renders `—`, never `$0.00` (CR087 §4c).
const formatCurrencyValue = (value) => {
  if (value == null) return "—";
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
  value == null
    ? "—"
    : chartCurrencyFormatter.format(Number.isFinite(Number(value)) ? Number(value) : 0);

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

// ============================================================================
// UTILITY FUNCTIONS - Category Tree Operations
// ============================================================================

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

/**
 * One node per category — `{ name, budget, actual, le, children }`, recursively.
 * Top-level nodes are the sections; their children are the bar groups, and any
 * deeper level is what the drill-down modal shows.
 *
 * `le` is `null` where the LE has no line (or has not loaded) — ABSENT, not
 * zero (CR088 P2). A node is dropped only when every subject on screen is zero
 * or absent; a top-level node additionally needs those subjects loaded, so a
 * section does not vanish while its data is still arriving.
 */
const buildChartData = (nodes, ctx, path = []) => {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const { resolvers, loaded, series } = ctx;

  return nodes.flatMap((node) => {
    if (!node || typeof node !== "object" || !node.name) return [];
    const currentPath = [...path, node.name];
    const pathKey = currentPath.join(">");

    const values = {
      budget: resolvers.budget ? resolvers.budget(node, pathKey) : 0,
      actual: resolvers.actual ? resolvers.actual(node, pathKey) : 0,
      le:
        resolvers.le && resolvers.lePresent && resolvers.lePresent(node, pathKey)
          ? resolvers.le(node, pathKey)
          : null,
    };

    const isTop = path.length === 0;
    const blank = series.every(
      ({ key }) => (!isTop || loaded[key]) && (values[key] == null || values[key] === 0)
    );
    if (blank) return [];

    return [
      {
        name: node.name,
        ...values,
        children: buildChartData(node.children, ctx, currentPath),
      },
    ];
  });
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function BudgetRealizationGraph() {
  // ========== COA Data ==========
  const { plTree } = useCoa();

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
  // (defined before the LE hook, which needs both ranges)
  const budgetPeriodRange = useMemo(
    () => computePeriodRange(reportType, selectedMonth, selectedYear),
    [reportType, selectedMonth, selectedYear]
  );
  const actualPeriodRange = useMemo(
    () => computePeriodRange(reportType, selectedMonth, actualYear),
    [reportType, selectedMonth, actualYear]
  );

  // ---- CR088: the same compare modes as the Realization tab --------------
  const le = useLatestEstimate({
    budgetYear: selectedYear,
    lePeriodRange: budgetPeriodRange,
    actualPeriodRange,
    includeTransfers,
    logTag: "BudgetRealizationGraph",
  });
  const { compareProps, leafLeTotals, leafLePresent } = le;
  const leName = le.leHeader ? le.leHeader.name : "LE";
  const series = useMemo(() => chartSeries(compareProps), [compareProps]);
  const variances = useMemo(() => chartVariances(compareProps), [compareProps]);

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

  const leValueResolver = useMemo(
    () => (leafLeTotals ? createActualValueResolver(leafLeTotals) : null),
    [leafLeTotals]
  );
  const lePresenceResolver = useMemo(
    () => createLePresenceResolver(leafLePresent),
    [leafLePresent]
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

  // ========== Computed Values: Chart Data ==========
  const chartData = useMemo(
    () =>
      buildChartData(filteredCategoryTree, {
        resolvers: {
          actual: actualValueResolver,
          budget: budgetValueResolver,
          le: leValueResolver,
          lePresent: lePresenceResolver,
        },
        loaded: {
          actual: leafActualTotals !== null,
          budget: leafBudgetTotals !== null,
          le: leafLeTotals !== null,
        },
        series,
      }),
    [
      filteredCategoryTree,
      actualValueResolver,
      budgetValueResolver,
      leValueResolver,
      lePresenceResolver,
      leafActualTotals,
      leafBudgetTotals,
      leafLeTotals,
      series,
    ]
  );

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
              {series.map((sub) => (
                <div key={sub.key} className="budget-graph-summary-item">
                  <span className="budget-graph-summary-label">
                    {sub.key === "le" ? leName : sub.label}:
                  </span>
                  <span className="budget-graph-summary-value">
                    {formatCurrencyValue(category[sub.key])}
                  </span>
                </div>
              ))}
              {variances.map((v) => {
                const value = varianceOf(category, v);
                return (
                  <div key={v.key} className="budget-graph-summary-item">
                    <span className="budget-graph-summary-label">{v.label}:</span>
                    <span
                      className={`budget-graph-summary-value ${
                        value < 0 ? "budget-graph-summary-value--negative" : ""
                      }`}
                    >
                      {formatCurrencyValue(value)}
                    </span>
                  </div>
                );
              })}
            </div>

            {category.children && category.children.length > 0 && (
              <div className="budget-graph-bars">
                {category.children.map((child, childIndex) => {
                  const maxValue = Math.max(
                    ...series.map(({ key }) => Math.abs(child[key] ?? 0))
                  );
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
                        {series.map((sub) => {
                          const width =
                            maxValue > 0 ? (Math.abs(child[sub.key] ?? 0) / maxValue) * 100 : 0;
                          const subLabel = sub.key === "le" ? leName : sub.label;
                          return (
                            <div key={sub.key} className="budget-graph-bar-row">
                              <span className="budget-graph-bar-type">{sub.label}</span>
                              <div className="budget-graph-bar-container">
                                <div
                                  className={`budget-graph-bar budget-graph-bar--${sub.key}`}
                                  style={{ width: `${width}%` }}
                                  onMouseEnter={(e) => {
                                    const rect = e.target.getBoundingClientRect();
                                    setTooltip({
                                      x: rect.left + rect.width / 2,
                                      y: rect.top,
                                      label: `${child.name} - ${subLabel}`,
                                      value: child[sub.key],
                                    });
                                  }}
                                  onMouseLeave={() => setTooltip(null)}
                                />
                              </div>
                              <span className="budget-graph-bar-value">
                                {formatCurrencyShort(child[sub.key])}
                              </span>
                            </div>
                          );
                        })}
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
          {/* CR088 P6: the LAST rival title treatment — `budget-graph-title` at
              28px, found by sweeping all ELEVEN report pages rather than the
              nine P4 knew about. Same defect BalanceV2 had: a page built on its
              own and never reconciled. The WORDS stay (this tab is a chart and
              says so, exactly as the Variances tab keeps its own title); only
              the treatment joins the shared header. */}
          <div className="report-toolbar-header">
            <div className="report-toolbar-header__text">
              <h1 className="report-toolbar-header__title">Budget Realization Chart</h1>
              <p className="report-toolbar-header__description">
                Visual comparison of budget, actual and latest estimate by category.
              </p>
            </div>
          </div>
          {compareProps.leAvailable && (
            <div className="budget-graph-compare">
              <LeCompareControl compareProps={compareProps} />
            </div>
          )}
          <LeCompareNotes compareProps={compareProps} />
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
        series={series}
        variances={variances}
        leName={leName}
        onClose={handleModalClose}
        onCategoryClick={handleCategoryClick}
      />
    </>
  );
}
