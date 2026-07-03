import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BalanceChartPanel from "../features/Charts/BalanceChartPanel.jsx";
import CashFlowDateSelectorMonthYearOneP from "../features/Charts/BalanceChartDateSelectorMonthYear.jsx";
import Rest from "../js/rest.js";
import {
  buildEndDateSeries,
  planColumns,
  formatColumnHeader,
  getTodayIso,
} from "../utils/periodHelpers.js";
import { getYearStart, getMonthEnd } from "../utils/dateHelpers.js";
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
 * Extracts the year and 1-based month from an ISO date string.
 *
 * @param {string} isoDate - ISO format date string (YYYY-MM-DD)
 * @returns {{year: number, month: number}|null} Parsed parts, or null if invalid
 */
const parseYearMonth = (isoDate) => {
  if (typeof isoDate !== "string") {
    return null;
  }
  const [yearStr, monthStr] = isoDate.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isFinite(year) || year <= 0 || !Number.isFinite(month) || month <= 0) {
    return null;
  }
  return { year, month };
};

/**
 * Builds the series of period columns to render for the chart, given the
 * selected date range and period type (month / quarter / year). Reuses the
 * shared period helpers so the chart matches Balance Sheet Periods etc.:
 * future periods are dropped and an in-progress period is snapshotted as of
 * today and flagged partial.
 *
 * @param {string} startIso - Range start date in ISO format (YYYY-MM-DD)
 * @param {string} endIso - Range end date in ISO format (YYYY-MM-DD)
 * @param {string} period - "month" | "quarter" | "year"
 * @returns {Array<{label: string, asOf: string, isPartial: boolean}>}
 */
const buildPeriodSeries = (startIso, endIso, period) => {
  const start = parseYearMonth(startIso);
  const end = parseYearMonth(endIso);
  if (!start || !end) {
    return [];
  }
  // Year mode is selected by calendar year only, so widen the range to whole
  // years (Jan..Dec) — this keeps both endpoint years' Dec-31 snapshots in the
  // series even when the stored from/to dates carry mid-year months.
  const fromMonth = period === "year" ? 1 : start.month;
  const toMonth = period === "year" ? 12 : end.month;
  const endDates = buildEndDateSeries(
    start.year,
    fromMonth,
    end.year,
    toMonth,
    period
  );
  return planColumns(endDates, period, getTodayIso());
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
 * Builds the two-line x-axis label parts for a period-end date, reflecting the
 * selected period type:
 *   - month:   top = "01".."12", bottom = "YY"
 *   - quarter: top = "Q1".."Q4", bottom = "YY"
 *   - year:    top = "YYYY",      bottom = ""
 *
 * @param {string} isoDate - Period-end date in ISO format (YYYY-MM-DD)
 * @param {string} period - "month" | "quarter" | "year"
 * @returns {{top: string, bottom: string}}
 */
const formatPeriodAxisParts = (isoDate, period) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    return { top: isoDate ?? "", bottom: "" };
  }
  const year = d.getUTCFullYear();
  const monthIdx = d.getUTCMonth();
  if (period === "year") {
    return { top: String(year), bottom: "" };
  }
  if (period === "quarter") {
    return { top: `Q${Math.floor(monthIdx / 3) + 1}`, bottom: String(year).slice(-2) };
  }
  return {
    top: String(monthIdx + 1).padStart(2, "0"),
    bottom: String(year).slice(-2),
  };
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
 * Builds chart data points from balance reports and their corresponding period
 * columns. Each point carries the full-text `label` (tooltip / range summary)
 * plus the two-line `axisTop`/`axisBottom` parts for the x-axis, both derived
 * from the selected period type.
 *
 * @param {Array} reports - Array of balance reports (one per period column)
 * @param {Array<{label: string, asOf: string, isPartial: boolean}>} periods - Planned period columns
 * @param {string} period - "month" | "quarter" | "year"
 * @returns {Array<{date: string, label: string, axisTop: string, axisBottom: string, assets: number, liabilities: number, net: number}>}
 */
const buildChartPoints = (reports, periods, period) => {
  if (!Array.isArray(reports) || !Array.isArray(periods)) {
    return [];
  }

  const length = Math.min(reports.length, periods.length);
  if (length === 0) {
    return [];
  }

  const points = [];
  for (let i = 0; i < length; i += 1) {
    const report = reports[i];
    const column = periods[i] ?? {};
    const endIso = column.label;
    const totals = getBalanceTotals(report);
    const axis = formatPeriodAxisParts(endIso, period);
    points.push({
      date: endIso,
      label: formatColumnHeader(endIso, period, column.isPartial) || `Period ${i + 1}`,
      axisTop: axis.top,
      axisBottom: axis.bottom,
      assets: totals.assets,
      liabilities: totals.liabilities,
      net: ensureNumber(totals.assets) + ensureNumber(totals.liabilities),
    });
  }
  return points;
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
  const [period, setPeriod] = useState("month");
  const [periodCount, setPeriodCount] = useState(1);
  const [balanceReports, setBalanceReports] = useState([]);
  const [reportError, setReportError] = useState("");
  const [isFetchingReport, setIsFetchingReport] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState(() => new Set());
  const [chartPeriods, setChartPeriods] = useState([]);
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
    const periodColumns = buildPeriodSeries(fromDates[0], toDates[0], period);
    try {
      const [reports, periodReports] = await Promise.all([
        Promise.all(activeDates.map((date) => Rest.fetchBalanceReport(date))),
        Promise.all(
          periodColumns.map((column) => Rest.fetchBalanceReport(column.asOf))
        ),
      ]);
      setBalanceReports(reports);
      setChartReports(periodReports);
      setChartPeriods(periodColumns);
      setCollapsedPaths(new Set());
    } catch (error) {
      console.error("Failed to fetch balance report:", error);
      setReportError(error?.message ?? "Failed to fetch balance report");
      setChartReports([]);
      setChartPeriods([]);
    } finally {
      setIsFetchingReport(false);
    }
  }, [periodCount, fromDates, toDates, period]);

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
    () => buildChartPoints(chartReports, chartPeriods, period),
    [chartReports, chartPeriods, period]
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
    <>
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
            period={period}
            onPeriodChange={setPeriod}
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
    </>
  );
}
