import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CategorySelector from "../components/CategorySelector/CategorySelector.jsx";
import { useCoa } from "../hooks/useCoa.js";
import Rest from "../js/rest.js";
import { formatLocalDate } from "../utils/dateHelpers.js";
import "./PageLayout.css";
import "./CategoryTrend.css";

// ============================================================================
// CONSTANTS
// ============================================================================

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth();

const PERIODS = [
  {
    label: "Year to Date",
    key: "ytd",
    range: () => ({
      startDate: `${currentYear}-01-01`,
      endDate: formatMonthEnd(currentYear, currentMonth),
    }),
  },
  {
    label: "This Year",
    key: "this-year",
    range: () => ({
      startDate: `${currentYear}-01-01`,
      endDate: `${currentYear}-12-31`,
    }),
  },
  {
    label: "Last Year",
    key: "last-year",
    range: () => ({
      startDate: `${currentYear - 1}-01-01`,
      endDate: `${currentYear - 1}-12-31`,
    }),
  },
  {
    label: "Last 6 Months",
    key: "last-6m",
    range: () => monthsAgo(6),
  },
  {
    label: "Last 12 Months",
    key: "last-12m",
    range: () => monthsAgo(12),
  },
  {
    label: "Last 24 Months",
    key: "last-24m",
    range: () => monthsAgo(24),
  },
];

const CATEGORY_GROUP_OPTIONS = [
  { value: "__group__income", label: "Income (all)" },
  { value: "__group__expense", label: "Expense (all)" },
];

function formatMonthEnd(year, month) {
  return formatLocalDate(new Date(year, month + 1, 0));
}

function monthsAgo(n) {
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth();
  return {
    startDate: formatLocalDate(new Date(endYear, endMonth - n + 1, 1)),
    endDate: formatMonthEnd(endYear, endMonth),
  };
}

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

const chartCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const ensureNumber = (v) => (Number.isFinite(v) ? v : 0);

const formatCurrencyShort = (value) =>
  chartCurrencyFormatter.format(ensureNumber(value));

const formatAxisLabel = (value) => {
  const n = ensureNumber(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const f = n / 1_000_000;
    return `${f.toLocaleString("en-US", { maximumFractionDigits: f % 1 === 0 ? 0 : 1, minimumFractionDigits: 0 })}M`;
  }
  if (abs >= 1_000) {
    const f = n / 1_000;
    return `${f.toLocaleString("en-US", { maximumFractionDigits: f % 1 === 0 ? 0 : 1, minimumFractionDigits: 0 })}k`;
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const formatMonthLabel = (monthKey) => {
  if (!monthKey) return "";
  const [y, m] = monthKey.split("-");
  const mi = parseInt(m, 10) - 1;
  return `${MONTH_NAMES[mi] || m} ${y}`;
};

// ============================================================================
// HELPERS
// ============================================================================

const ACTUAL_COLOR = "#6B8E6B";
const BUDGET_COLOR = "#C4923A";

/** Collect all leaf names from a plTree */
function collectLeafNames(nodes, results = []) {
  if (!Array.isArray(nodes)) return results;
  for (const node of nodes) {
    if (node.children?.length) {
      collectLeafNames(node.children, results);
    } else if (node.name?.trim()) {
      results.push(node.name.trim());
    }
  }
  return results;
}

/** Find a node by name */
function findNode(nodes, name) {
  for (const node of nodes) {
    if (node.name === name) return node;
    if (node.children?.length) {
      const found = findNode(node.children, name);
      if (found) return found;
    }
  }
  return null;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function CategoryTrend() {
  const { plTree } = useCoa();

  // State
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("ytd");
  const [trendData, setTrendData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [tooltip, setTooltip] = useState(null);
  const [isExpenseMode, setIsExpenseMode] = useState(false);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const chartRef = useRef(null);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!categoryDropdownOpen) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setCategoryDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [categoryDropdownOpen]);

  // Resolve group selections to actual leaf names
  const resolvedCategories = useMemo(() => {
    const resolved = [];
    for (const cat of selectedCategories) {
      if (cat === "__group__income") {
        const incomeNode = findNode(plTree, "Income");
        if (incomeNode) collectLeafNames([incomeNode], resolved);
      } else if (cat === "__group__expense") {
        const expenseNode = findNode(plTree, "Expense");
        if (expenseNode) collectLeafNames([expenseNode], resolved);
      } else if (!cat.startsWith("__group__")) {
        resolved.push(cat);
      }
    }
    return [...new Set(resolved)];
  }, [selectedCategories, plTree]);

  // Determine if all selected categories are expense
  useEffect(() => {
    if (resolvedCategories.length === 0) {
      setIsExpenseMode(false);
      return;
    }
    const expenseNode = findNode(plTree, "Expense");
    if (!expenseNode) { setIsExpenseMode(false); return; }
    const expenseLeaves = new Set(collectLeafNames([expenseNode]));
    setIsExpenseMode(resolvedCategories.every((c) => expenseLeaves.has(c)));
  }, [resolvedCategories, plTree]);

  // Fetch trend data
  const handleGenerate = useCallback(async () => {
    if (resolvedCategories.length === 0) {
      setError("Please select at least one category.");
      return;
    }
    setError("");
    setIsLoading(true);
    const period = PERIODS.find((p) => p.key === selectedPeriod);
    const { startDate, endDate } = period ? period.range() : PERIODS[0].range();
    try {
      const result = await Rest.fetchCategoryTrend({
        startDate,
        endDate,
        categories: resolvedCategories,
      });
      setTrendData(result);
    } catch (err) {
      console.error("Failed to fetch category trend:", err);
      setError(err?.message || "Failed to fetch trend data");
      setTrendData(null);
    } finally {
      setIsLoading(false);
    }
  }, [resolvedCategories, selectedPeriod]);

  // Auto-fetch when parameters change
  useEffect(() => {
    if (resolvedCategories.length > 0) {
      handleGenerate();
    } else {
      setTrendData(null);
    }
  }, [handleGenerate]);

  // Category selection summary text
  const categorySummary = useMemo(() => {
    if (selectedCategories.length === 0) return "Select categories...";
    // Check for group selections
    const hasIncomeGroup = selectedCategories.includes("__group__income");
    const hasExpenseGroup = selectedCategories.includes("__group__expense");
    const individualCount = selectedCategories.filter((c) => !c.startsWith("__group__")).length;

    const parts = [];
    if (hasIncomeGroup) parts.push("All Income");
    if (hasExpenseGroup) parts.push("All Expense");
    if (individualCount > 0) parts.push(`${individualCount} categor${individualCount === 1 ? "y" : "ies"}`);
    return parts.join(", ");
  }, [selectedCategories]);

  // Chart data processing
  const chartPoints = useMemo(() => {
    if (!trendData?.months) return [];
    return trendData.months.map((month) => {
      let actual = ensureNumber(trendData.actual?.[month]);
      let budget = ensureNumber(trendData.budget?.[month]);
      if (isExpenseMode) {
        actual = Math.abs(actual);
        budget = Math.abs(budget);
      }
      return { month, actual, budget };
    });
  }, [trendData, isExpenseMode]);

  const hasChartData = chartPoints.length > 0;

  // Compute averages (exclude months with zero budget from budget average)
  const averages = useMemo(() => {
    if (!hasChartData) return { actual: null, budget: null };

    // Actual average: all months
    const actualSum = chartPoints.reduce((s, p) => s + p.actual, 0);
    const avgActual = chartPoints.length > 0 ? actualSum / chartPoints.length : null;

    // Budget average: only months where budget is non-zero
    const budgetMonths = chartPoints.filter((p) => p.budget !== 0);
    const avgBudget = budgetMonths.length > 0
      ? budgetMonths.reduce((s, p) => s + p.budget, 0) / budgetMonths.length
      : null;

    return { actual: avgActual, budget: avgBudget };
  }, [chartPoints, hasChartData]);

  // Chart layout calculation
  const chartLayout = useMemo(() => {
    if (!hasChartData) return null;

    const width = 700;
    const height = 420;
    const verticalPadding = 44;
    const gridLeft = 76;
    const gridRight = 62;
    const availableWidth = width - gridLeft - gridRight;
    const availableHeight = height - verticalPadding * 2;

    // Include average lines in the value range calculation
    const allValues = chartPoints.flatMap((p) => [p.actual, p.budget]);
    if (averages.actual !== null) allValues.push(averages.actual);
    if (averages.budget !== null) allValues.push(averages.budget);

    const maxValue = Math.max(...allValues, 0);
    const minValue = Math.min(...allValues, 0);
    let valueRange = maxValue - minValue;
    if (!Number.isFinite(valueRange) || valueRange <= 0) valueRange = 1;

    const axisMax = maxValue + valueRange * 0.05;
    const axisMin = Math.min(minValue, 0);
    let axisRange = axisMax - axisMin;
    if (axisRange <= 0) axisRange = 1;

    const yCoord = (v) =>
      height - verticalPadding - ((v - axisMin) / axisRange) * availableHeight;

    const tickCount = 5;
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
      const ratio = i / tickCount;
      const value = axisMin + ratio * axisRange;
      return { value, y: yCoord(value) };
    });

    const step = availableWidth / chartPoints.length;
    const gapRatio = 0.25;
    const groupWidth = step * (1 - gapRatio);
    const barWidth = groupWidth / 2 - 1;
    const zeroY = yCoord(0);

    const groups = chartPoints.map((point, index) => {
      const groupX = gridLeft + index * step + (step - groupWidth) / 2;
      const makeBar = (value, offset) => {
        const yTop = yCoord(Math.max(value, 0));
        const yBottom = yCoord(Math.min(value, 0));
        return {
          x: groupX + offset,
          y: yTop,
          width: barWidth,
          height: Math.max(yBottom - yTop, 1),
          value,
        };
      };
      return {
        actualBar: makeBar(point.actual, 0),
        budgetBar: makeBar(point.budget, barWidth + 2),
        centerX: groupX + groupWidth / 2,
      };
    });

    // Average line Y positions
    const avgActualY = averages.actual !== null ? yCoord(averages.actual) : null;
    const avgBudgetY = averages.budget !== null ? yCoord(averages.budget) : null;

    return {
      width, height, verticalPadding, gridLeft, gridRight,
      ticks, groups, zeroY, showZeroLine: axisMin < 0,
      avgActualY, avgBudgetY,
    };
  }, [chartPoints, hasChartData, averages]);

  // Tooltip handlers
  const handleBarMouseMove = useCallback((event, point) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      month: formatMonthLabel(point.month),
      actual: point.actual,
      budget: point.budget,
    });
  }, []);

  const handleBarMouseLeave = useCallback(() => setTooltip(null), []);

  // Period label for summary
  const periodLabel = PERIODS.find((p) => p.key === selectedPeriod)?.label || "";
  const chartSummary = hasChartData
    ? `${periodLabel} — ${formatMonthLabel(chartPoints[0].month)} to ${formatMonthLabel(chartPoints[chartPoints.length - 1].month)}`
    : "Select categories and a period to view trends.";

  return (
    <main className="page-main balance-grid--single ct-page">
      <div className="ct-chart-panel">
        {/* Header */}
        <div className="ct-chart-header">
          <div>
            <p className="ct-chart-title">Category Trend</p>
            <p className="ct-chart-subtitle">{chartSummary}</p>
          </div>
        </div>

        {/* Toolbar: Period + Category dropdowns */}
        <div className="ct-toolbar">
          {/* Period dropdown */}
          <div className="ct-toolbar__field">
            <label className="ct-toolbar__label" htmlFor="ct-period">Period</label>
            <select
              id="ct-period"
              className="ct-toolbar__select"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
            >
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Category dropdown */}
          <div className="ct-toolbar__field ct-toolbar__field--grow" ref={dropdownRef}>
            <label className="ct-toolbar__label">Categories</label>
            <button
              type="button"
              className={`ct-toolbar__dropdown-trigger${categoryDropdownOpen ? " ct-toolbar__dropdown-trigger--open" : ""}`}
              onClick={() => setCategoryDropdownOpen((o) => !o)}
            >
              <span className="ct-toolbar__dropdown-text">{categorySummary}</span>
              <span className="ct-toolbar__dropdown-chevron">{categoryDropdownOpen ? "\u25B2" : "\u25BC"}</span>
            </button>
            {categoryDropdownOpen && (
              <div className="ct-toolbar__dropdown-panel">
                <CategorySelector
                  plTree={plTree}
                  selectedCategories={selectedCategories}
                  onCategoriesChange={setSelectedCategories}
                  categoryGroupOptions={CATEGORY_GROUP_OPTIONS}
                  multiSelect
                  id="ct-cat-selector"
                  className="ct-toolbar__category-selector"
                />
                <div className="ct-toolbar__dropdown-actions">
                  <button
                    type="button"
                    className="ct-toolbar__dropdown-clear"
                    onClick={() => setSelectedCategories([])}
                  >
                    Clear All
                  </button>
                  <button
                    type="button"
                    className="ct-toolbar__dropdown-done"
                    onClick={() => setCategoryDropdownOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Chart */}
        <div className="ct-chart-graph" ref={chartRef}>
          {hasChartData && chartLayout ? (
            <svg
              viewBox={`0 0 ${chartLayout.width} ${chartLayout.height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label="Category trend chart showing actual vs budget by month"
              className="ct-chart-svg"
            >
              <defs>
                <linearGradient id="ct-actual-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={ACTUAL_COLOR} stopOpacity="0.95" />
                  <stop offset="100%" stopColor={ACTUAL_COLOR} stopOpacity="0.75" />
                </linearGradient>
                <linearGradient id="ct-budget-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={BUDGET_COLOR} stopOpacity="0.95" />
                  <stop offset="100%" stopColor={BUDGET_COLOR} stopOpacity="0.75" />
                </linearGradient>
              </defs>

              <g>
                {chartLayout.ticks.map((tick, i) => (
                  <g key={`tick-${i}`}>
                    <line
                      className="ct-grid-line"
                      x1={chartLayout.gridLeft}
                      x2={chartLayout.width - chartLayout.gridRight}
                      y1={tick.y}
                      y2={tick.y}
                    />
                    <text
                      className="ct-grid-label"
                      x={chartLayout.gridLeft - 8}
                      y={tick.y + 4}
                      textAnchor="end"
                    >
                      {formatAxisLabel(tick.value)}
                    </text>
                  </g>
                ))}
              </g>

              {chartLayout.showZeroLine && (
                <line
                  className="ct-zero-line"
                  x1={chartLayout.gridLeft}
                  x2={chartLayout.width - chartLayout.gridRight}
                  y1={chartLayout.zeroY}
                  y2={chartLayout.zeroY}
                />
              )}

              {chartLayout.groups.map((group, index) => (
                <g key={`group-${index}`}>
                  <rect
                    className="ct-bar ct-bar--actual"
                    x={group.actualBar.x}
                    y={group.actualBar.y}
                    width={group.actualBar.width}
                    height={group.actualBar.height}
                    onMouseMove={(e) => handleBarMouseMove(e, chartPoints[index])}
                    onMouseLeave={handleBarMouseLeave}
                  />
                  <rect
                    className="ct-bar ct-bar--budget"
                    x={group.budgetBar.x}
                    y={group.budgetBar.y}
                    width={group.budgetBar.width}
                    height={group.budgetBar.height}
                    onMouseMove={(e) => handleBarMouseMove(e, chartPoints[index])}
                    onMouseLeave={handleBarMouseLeave}
                  />
                </g>
              ))}

              {/* Average actual line */}
              {chartLayout.avgActualY !== null && (
                <g>
                  <line
                    className="ct-avg-line ct-avg-line--actual"
                    x1={chartLayout.gridLeft}
                    x2={chartLayout.width - chartLayout.gridRight}
                    y1={chartLayout.avgActualY}
                    y2={chartLayout.avgActualY}
                  />
                  <text
                    className="ct-avg-label ct-avg-label--actual"
                    x={chartLayout.width - chartLayout.gridRight + 4}
                    y={chartLayout.avgActualY + 4}
                    textAnchor="start"
                  >
                    Avg {formatAxisLabel(averages.actual)}
                  </text>
                </g>
              )}

              {/* Average budget line */}
              {chartLayout.avgBudgetY !== null && (
                <g>
                  <line
                    className="ct-avg-line ct-avg-line--budget"
                    x1={chartLayout.gridLeft}
                    x2={chartLayout.width - chartLayout.gridRight}
                    y1={chartLayout.avgBudgetY}
                    y2={chartLayout.avgBudgetY}
                  />
                  <text
                    className="ct-avg-label ct-avg-label--budget"
                    x={chartLayout.width - chartLayout.gridRight + 4}
                    y={chartLayout.avgBudgetY + 4}
                    textAnchor="start"
                  >
                    Avg {formatAxisLabel(averages.budget)}
                  </text>
                </g>
              )}

              {chartPoints.map((point, index) => {
                const group = chartLayout.groups[index];
                const [y, m] = point.month.split("-");
                const mi = parseInt(m, 10) - 1;
                return (
                  <text
                    key={`xlabel-${index}`}
                    className="ct-xlabel"
                    x={group.centerX}
                    y={chartLayout.height - chartLayout.verticalPadding / 2}
                    textAnchor="middle"
                  >
                    <tspan x={group.centerX} dy="0">{MONTH_NAMES[mi] || m}</tspan>
                    <tspan x={group.centerX} dy="1.2em">{y.slice(-2)}</tspan>
                  </text>
                );
              })}
            </svg>
          ) : (
            <div className="ct-chart-empty">
              <p>{isLoading ? "Loading..." : "Select categories and period to generate chart"}</p>
            </div>
          )}

          {tooltip && (
            <div
              className="ct-tooltip"
              style={{
                left: Math.min(Math.max(tooltip.x + 12, 8), (chartLayout?.width || 600) - 180),
                top: Math.max(tooltip.y - 50, 8),
              }}
            >
              <div className="ct-tooltip__label">{tooltip.month}</div>
              <div><strong>Actual:</strong> {formatCurrencyShort(tooltip.actual)}</div>
              <div><strong>Budget:</strong> {formatCurrencyShort(tooltip.budget)}</div>
              <div>
                <strong>Variance:</strong>{" "}
                {formatCurrencyShort(tooltip.actual - tooltip.budget)}
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="ct-legend">
          <div className="ct-legend__item">
            <span className="ct-legend__swatch ct-legend__swatch--actual" />
            Actual
          </div>
          <div className="ct-legend__item">
            <span className="ct-legend__swatch ct-legend__swatch--budget" />
            Budget
          </div>
          {averages.actual !== null && (
            <div className="ct-legend__item">
              <span className="ct-legend__line ct-legend__line--actual" />
              Avg Actual ({formatCurrencyShort(averages.actual)})
            </div>
          )}
          {averages.budget !== null && (
            <div className="ct-legend__item">
              <span className="ct-legend__line ct-legend__line--budget" />
              Avg Budget ({formatCurrencyShort(averages.budget)})
            </div>
          )}
        </div>

        {error && <p className="balance-report-empty">{error}</p>}
      </div>
    </main>
  );
}
