import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BalanceChartPanel from "../features/Charts/BalanceChartPanel.jsx";
import CashFlowDateSelectorMonthYearOneP from "../features/Charts/BalanceChartDateSelectorMonthYear.jsx";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

/**
 * Recursively collects paths to all collapsible account nodes in the account tree.
 * A node is collapsible if it has children.
 *
 * @param {Array} accounts - Array of account objects with name and optional children
 * @param {Array<string>} path - Current path in the tree (for recursion)
 * @param {Set<string>} result - Accumulator for collapsible paths
 * @returns {Set<string>} Set of path strings in format "parent>child>grandchild"
 */
const collectCollapsiblePaths = (accounts, path = [], result = new Set()) => {
  if (!Array.isArray(accounts)) {
    return result;
  }

  for (const account of accounts) {
    const hasChildren =
      Array.isArray(account.children) && account.children.length > 0;
    if (hasChildren) {
      const key = [...path, account.name].join(">");
      result.add(key);
      collectCollapsiblePaths(
        account.children,
        [...path, account.name],
        result
      );
    }
  }

  return result;
};

/**
 * Converts an ISO date string to a UTC Date object with time set to midnight.
 *
 * @param {string} isoDate - ISO format date string (YYYY-MM-DD)
 * @returns {Date|null} UTC Date object at midnight, or null if invalid
 */
const toUtcDate = (isoDate) => {
  if (typeof isoDate !== "string") {
    return null;
  }
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
  );
};

/**
 * Gets the last day of the month for a given date in ISO format.
 *
 * @param {Date} date - Date object
 * @returns {string} ISO date string (YYYY-MM-DD) for the last day of the month, or empty string if invalid
 */
const getMonthEndIso = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const monthEnd = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  );
  return monthEnd.toISOString().split("T")[0];
};

/**
 * Builds an array of month-end dates between start and end dates.
 *
 * @param {string} startIso - Start date in ISO format (YYYY-MM-DD)
 * @param {string} endIso - End date in ISO format (YYYY-MM-DD)
 * @param {number} limit - Maximum number of periods to generate (default: unlimited)
 * @returns {Array<string>} Array of ISO date strings representing month-end dates
 */
const buildMonthlySeries = (
  startIso,
  endIso,
  limit = Number.POSITIVE_INFINITY
) => {
  const startDate = toUtcDate(startIso);
  const endDate = toUtcDate(endIso);
  if (!startDate || !endDate || startDate > endDate || limit <= 0) {
    return [];
  }

  const series = [];
  const cursor = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1)
  );
  const lastCursor = new Date(
    Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1)
  );
  while (cursor.getTime() <= lastCursor.getTime() && series.length < limit) {
    series.push(getMonthEndIso(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return series;
};

/**
 * Ensures a value is a finite number, returning 0 for invalid values.
 *
 * @param {*} value - Value to validate
 * @returns {number} The value if it's a finite number, otherwise 0
 */
const ensureNumber = (value) => (Number.isFinite(value) ? value : 0);

/**
 * Number formatter for currency display in charts (no decimal places).
 */
const chartCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Formats a numeric value as USD currency with no decimal places.
 *
 * @param {number} value - Numeric value to format
 * @returns {string} Formatted currency string (e.g., "$1,234")
 */
const formatCurrencyShort = (value) =>
  chartCurrencyFormatter.format(ensureNumber(value));

/**
 * Formats an ISO date string as a short month-year label.
 *
 * @param {string} isoDate - ISO format date string (YYYY-MM-DD)
 * @returns {string} Formatted label (e.g., "Jan 2024") or original string if invalid
 */
const formatMonthYearLabel = (isoDate) => {
  if (!isoDate) {
    return "";
  }

  const parsed = new Date(isoDate);
  if (!Number.isFinite(parsed.getTime())) {
    return isoDate;
  }

  return parsed.toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
};

/**
 * Formats numeric values for chart axis labels with K/M suffixes for large numbers.
 *
 * @param {number} value - Numeric value to format
 * @returns {string} Formatted label (e.g., "1.5M", "250k", "1,234")
 */
const formatAxisLabel = (value) => {
  const normalized = ensureNumber(value);
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

/**
 * Extracts and sums asset and liability totals from a balance report.
 *
 * @param {Array} report - Array of account nodes with name and totalUSD properties
 * @returns {{assets: number, liabilities: number}} Object with total assets and liabilities
 */
const getBalanceTotals = (report) => {
  if (!Array.isArray(report)) {
    return { assets: 0, liabilities: 0 };
  }

  let assets = 0;
  let liabilities = 0;
  for (const node of report) {
    if (!node || typeof node !== "object") {
      continue;
    }
    const total = ensureNumber(node.totalUSD);
    const name = typeof node.name === "string" ? node.name.toLowerCase() : "";
    if (name.includes("asset")) {
      assets += total;
    } else if (name.includes("liabil")) {
      liabilities += total;
    }
  }

  return { assets, liabilities };
};

/**
 * Builds chart data points from multiple balance reports and their corresponding date labels.
 *
 * @param {Array} reports - Array of balance reports
 * @param {Array<string>} labels - Array of date labels in ISO format
 * @returns {Array<{date: string, label: string, assets: number, liabilities: number, net: number}>} Chart data points
 */
const buildChartPoints = (reports, labels) => {
  if (!Array.isArray(reports) || !Array.isArray(labels)) {
    return [];
  }

  const length = Math.min(reports.length, labels.length);
  if (length === 0) {
    return [];
  }

  const points = [];
  for (let i = 0; i < length; i += 1) {
    const report = reports[i];
    const date = labels[i];
    const totals = getBalanceTotals(report);
    points.push({
      date,
      label: formatMonthYearLabel(date) || `Period ${i + 1}`,
      assets: totals.assets,
      liabilities: totals.liabilities,
      net: ensureNumber(totals.assets) + ensureNumber(totals.liabilities),
    });
  }
  return points;
};

/**
 * Gets the first day of the current year in ISO format.
 * @returns {string} ISO date string for January 1st of current year
 */
const getYearStart = () => {
  const today = new Date();
  const januaryUtc = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  return januaryUtc.toISOString().split("T")[0];
};

/**
 * Gets the last day of the current month in ISO format.
 * @returns {string} ISO date string for the last day of current month
 */
const getMonthEnd = () => {
  const today = new Date();
  const lastOfMonthUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
  );
  return lastOfMonthUtc.toISOString().split("T")[0];
};

/**
 * Balance Chart Component
 *
 * Displays a visual chart of balance trends over time, showing assets, liabilities,
 * and net worth across multiple periods. Includes interactive date selection and
 * collapsible account hierarchy views.
 */
export default function Balance() {
  const [fromDates, setFromDates] = useState(() => [getYearStart()]);
  const [toDates, setToDates] = useState(() => [getMonthEnd()]);
  const [periodCount, setPeriodCount] = useState(1);
  const [balanceReports, setBalanceReports] = useState([]);
  const [reportError, setReportError] = useState("");
  const [isFetchingReport, setIsFetchingReport] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState(() => new Set());
  const [chartPeriodDates, setChartPeriodDates] = useState([]);
  const [chartReports, setChartReports] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const chartRef = useRef(null);

  /**
   * Updates the "from" date for a specific period.
   * @param {number} index - Index of the period to update
   * @param {string} value - New ISO date string
   */
  const handleFromDateChange = useCallback((index, value) => {
    setFromDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  /**
   * Updates the "to" date for a specific period.
   * @param {number} index - Index of the period to update
   * @param {string} value - New ISO date string
   */
  const handleToDateChange = useCallback((index, value) => {
    setToDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  /**
   * Fetches balance reports for selected periods and chart data for monthly series.
   * Runs in parallel to optimize loading time.
   */
  const handleGenerateReport = useCallback(async () => {
    setReportError("");
    setIsFetchingReport(true);
    const activeCount = Math.min(Math.max(periodCount ?? 1, 1), 3);
    const activeDates = toDates.slice(0, activeCount);
    const monthlyDates = buildMonthlySeries(fromDates[0], toDates[0]);
    try {
      const [reports, monthlyReports] = await Promise.all([
        Promise.all(activeDates.map((date) => Rest.fetchBalanceReport(date))),
        Promise.all(monthlyDates.map((date) => Rest.fetchBalanceReport(date))),
      ]);
      setBalanceReports(reports);
      setChartReports(monthlyReports);
      setChartPeriodDates(monthlyDates);
      setCollapsedPaths(new Set());
    } catch (error) {
      console.error("Failed to fetch balance report:", error);
      setReportError(error?.message ?? "Failed to fetch balance report");
      setChartReports([]);
      setChartPeriodDates([]);
    } finally {
      setIsFetchingReport(false);
    }
  }, [periodCount, fromDates, toDates]);

  useEffect(() => {
    handleGenerateReport();
  }, [handleGenerateReport]);

  /**
   * Handles mouse movement over chart bars to show tooltip.
   * @param {MouseEvent} event - Mouse event
   * @param {Object} point - Data point for the bar
   * @param {number} index - Index of the data point
   */
  const handleBarMouseMove = useCallback((event, point, index) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const label = point.label || point.date || `Period ${index + 1}`;
    setTooltip({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      label,
      assets: ensureNumber(point.assets),
      liabilities: ensureNumber(point.liabilities),
    });
  }, []);

  /**
   * Hides the tooltip when mouse leaves a chart bar.
   */
  const handleBarMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  /**
   * Toggles the collapsed state of an account path in the hierarchy view.
   * @param {string} pathKey - Path identifier in format "parent>child>grandchild"
   */
  const handleTogglePath = useCallback((pathKey) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  }, []);

  const collapsiblePaths = useMemo(
    () => collectCollapsiblePaths(balanceReports?.[0]),
    [balanceReports]
  );
  const isFullyCollapsed = useMemo(
    () => collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size,
    [collapsiblePaths, collapsedPaths]
  );

  /**
   * Toggles all collapsible paths between fully collapsed and fully expanded.
   */
  const handleToggleCollapseAll = useCallback(() => {
    if (collapsiblePaths.size === 0) {
      return;
    }

    setCollapsedPaths((prev) => {
      if (prev.size === collapsiblePaths.size) {
        return new Set();
      }
      return new Set(collapsiblePaths);
    });
  }, [collapsiblePaths]);

  const activePeriodCount = useMemo(
    () => Math.min(Math.max(periodCount ?? 1, 1), 3),
    [periodCount]
  );

  const chartPoints = useMemo(
    () => buildChartPoints(chartReports, chartPeriodDates),
    [chartReports, chartPeriodDates]
  );

  const hasChartData = chartPoints.length > 0;
  const latestPoint = useMemo(
    () => chartPoints[chartPoints.length - 1],
    [chartPoints]
  );
  const latestNet = ensureNumber(latestPoint?.net);

  const chartRangeSummary = useMemo(
    () =>
      hasChartData
        ? `From ${chartPoints[0].label} to ${
            latestPoint?.label ?? latestPoint?.date ?? ""
          }`
        : "Select a range and generate a report to visualize net assets for each month.",
    [hasChartData, chartPoints, latestPoint]
  );

  /**
   * Calculates the complete chart layout including dimensions, scales, ticks, and bar positions.
   * This is memoized to avoid expensive recalculations on every render.
   */
  const chartLayout = useMemo(() => {
    if (!hasChartData) {
      return null;
    }

    const width = 640;
    const height = 420;
    const verticalPadding = 36;
    const gridLeft = 76;
    const gridRight = 32;
    const availableWidth = width - gridLeft - gridRight;
    const availableHeight = height - verticalPadding * 2;

    // Calculate value range for y-axis scaling
    const values = chartPoints.map((point) => ensureNumber(point.net));
    const maxValue = Math.max(...values, 0);
    const actualMin = Math.min(...values);
    const axisMin = Math.min(actualMin * 0.95, maxValue * 0.95);
    let valueRange = maxValue - axisMin;
    if (!Number.isFinite(valueRange) || valueRange <= 0) {
      valueRange = 1;
    }

    // Generate y-axis tick marks
    const tickCount = 4;
    const ticks = Array.from({ length: tickCount + 1 }, (_, index) => {
      const ratio = index / tickCount;
      const value = axisMin + ratio * valueRange;
      const y =
        height -
        verticalPadding -
        ((value - axisMin) / valueRange) * availableHeight;
      return { value, y };
    });

    const yCoordinate = (value) =>
      height -
      verticalPadding -
      ((value - axisMin) / valueRange) * availableHeight;
    const zeroRatio = (0 - axisMin) / valueRange;
    const zeroY = yCoordinate(0);
    const showZeroLine = 0 >= axisMin && 0 <= maxValue;

    // Calculate bar positions and dimensions
    const step =
      chartPoints.length > 0
        ? availableWidth / chartPoints.length
        : availableWidth;
    const gapRatio = 0.18;
    const minBarWidth = 4;
    const barWidth = Math.max(minBarWidth, step * (1 - gapRatio));
    const getX = (index) => {
      if (chartPoints.length === 1) {
        return gridLeft + (availableWidth - barWidth) / 2;
      }
      return gridLeft + index * step + barWidth / 2;
    };
    const yBase = yCoordinate(axisMin);
    const bars = chartPoints.map((point, index) => {
      const x = getX(index);
      const netValue = ensureNumber(point.net);
      const yTop = yCoordinate(netValue);
      const barTop = Math.min(yTop, yBase);
      const barHeight = Math.max(Math.abs(yTop - yBase), 0);
      return {
        x: x - barWidth / 2,
        y: barTop,
        width: barWidth,
        height: barHeight,
        value: netValue,
        isPositive: netValue >= axisMin,
      };
    });

    return {
      width,
      height,
      verticalPadding,
      ticks,
      bars,
      zeroY,
      gridLeft,
      gridRight,
      showZeroLine,
    };
  }, [chartPoints, hasChartData]);

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main balance-grid">
        <div className="balance-layout-wrapper">
          <BalanceChartPanel
            chartRangeSummary={chartRangeSummary}
            hasChartData={hasChartData}
            chartLayout={chartLayout}
            chartPoints={chartPoints}
            tooltip={tooltip}
            chartRef={chartRef}
            onBarMouseMove={handleBarMouseMove}
            onBarMouseLeave={handleBarMouseLeave}
            latestNet={latestNet}
            formatCurrencyShort={formatCurrencyShort}
            formatAxisLabel={formatAxisLabel}
          />
        </div>
        <div className="balance-layout-holder">
          <CashFlowDateSelectorMonthYearOneP
            activePeriodCount={activePeriodCount}
            fromDates={fromDates}
            toDates={toDates}
            onFromDateChange={handleFromDateChange}
            onToDateChange={handleToDateChange}
            onPeriodCountChange={setPeriodCount}
            onGenerateReport={handleGenerateReport}
            isLoading={isFetchingReport}
            collapsiblePaths={collapsiblePaths}
            onToggleCollapseAll={handleToggleCollapseAll}
            isFullyCollapsed={isFullyCollapsed}
            error={reportError}
          />
        </div>
      </main>
    </div>
  );
}
