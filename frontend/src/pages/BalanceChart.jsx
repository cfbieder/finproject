import { useEffect, useMemo, useRef, useState } from "react";
import BalanceChartPanel from "../features/BalanceChartPanel.jsx";
import CashFlowDateSelectorMonthYearOneP from "../features/BalanceChartDateSelectorMonthYear.jsx";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

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

const MAX_CHART_MONTHS = 12;

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

const getMonthEndIso = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const monthEnd = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  );
  return monthEnd.toISOString().split("T")[0];
};

const buildMonthlySeries = (startIso, endIso, limit = MAX_CHART_MONTHS) => {
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

const ensureNumber = (value) => (Number.isFinite(value) ? value : 0);

const chartCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const formatCurrencyShort = (value) =>
  chartCurrencyFormatter.format(ensureNumber(value));

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

export default function Balance() {
  const getMonthStart = () => {
    const today = new Date();
    const januaryUtc = new Date(Date.UTC(today.getFullYear(), 0, 1));
    return januaryUtc.toISOString().split("T")[0];
  };

  const getMonthEnd = () => {
    const lastOfMonth = new Date();
    lastOfMonth.setMonth(lastOfMonth.getMonth() + 1, 0);
    return lastOfMonth.toISOString().split("T")[0];
  };

  const [fromDates, setFromDates] = useState(() => {
    const start = getMonthStart();
    return [start, start, start];
  });
  const [toDates, setToDates] = useState(() => {
    const end = getMonthEnd();
    return [end, end, end];
  });
  const [periodCount, setPeriodCount] = useState(1);
  const [balanceReports, setBalanceReports] = useState([]);
  const [reportError, setReportError] = useState("");
  const [isFetchingReport, setIsFetchingReport] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState(() => new Set());
  const [chartPeriodDates, setChartPeriodDates] = useState([]);
  const [chartReports, setChartReports] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const chartRef = useRef(null);

  const handleFromDateChange = (index, value) => {
    setFromDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleToDateChange = (index, value) => {
    setToDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleGenerateReport = async () => {
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
  };

  useEffect(() => {
    handleGenerateReport();
  }, []);

  const handleBarMouseMove = (event, point, index) => {
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
  };

  const handleBarMouseLeave = () => {
    setTooltip(null);
  };

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

  const collapsiblePaths = collectCollapsiblePaths(balanceReports?.[0]);
  const isFullyCollapsed =
    collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size;

  const handleToggleCollapseAll = () => {
    if (collapsiblePaths.size === 0) {
      return;
    }

    setCollapsedPaths((prev) => {
      if (prev.size === collapsiblePaths.size) {
        return new Set();
      }
      return new Set(collapsiblePaths);
    });
  };

  const activePeriodCount = Math.min(Math.max(periodCount ?? 1, 1), 3);
  const chartPoints = useMemo(
    () => buildChartPoints(chartReports, chartPeriodDates),
    [chartReports, chartPeriodDates]
  );
  const hasChartData = chartPoints.length > 0;
  const latestPoint = chartPoints[chartPoints.length - 1];
  const latestNet = ensureNumber(latestPoint?.net);
  const chartRangeSummary = hasChartData
    ? `From ${chartPoints[0].label} to ${
        latestPoint?.label ?? latestPoint?.date ?? ""
      }`
    : "Select a range and generate a report to visualize net assets for each month.";
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
    const values = chartPoints.map((point) => ensureNumber(point.net));
    const maxValue = Math.max(...values, 0);
    const actualMin = Math.min(...values);
    const axisMin = Math.min(actualMin * 0.95, maxValue * 0.95);
    let valueRange = maxValue - axisMin;
    if (!Number.isFinite(valueRange) || valueRange <= 0) {
      valueRange = 1;
    }

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

    const step =
      chartPoints.length > 0
        ? availableWidth / chartPoints.length
        : availableWidth;
    const gapRatio = 0.18;
    const barWidth = Math.max(16, step * (1 - gapRatio));
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
