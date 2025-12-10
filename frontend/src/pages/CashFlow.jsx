import { useCallback, useEffect, useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "../features/Balances/BalanceDateSelector.css";
import CashFlowReport from "../features/CashFlow/CashFlowReport.jsx";
import CashFlowDateSelectorMonthYear from "../features/CashFlow/CashFlowDateSelectorMonthYear.jsx";

/**
 * Recursively collects paths to all collapsible nodes in the account tree.
 * A node is collapsible if it has children.
 *
 * @param {Array} nodes - Array of account nodes with name and optional children
 * @param {Array<string>} path - Current path in the tree (for recursion)
 * @param {Set<string>} set - Accumulator for collapsible paths
 * @returns {Set<string>} Set of path strings in format "parent>child>grandchild"
 */
const collectCollapsiblePaths = (nodes, path = [], set = new Set()) => {
  if (!Array.isArray(nodes)) return set;
  for (const node of nodes) {
    if (node && Array.isArray(node.children) && node.children.length > 0) {
      const key = [...path, node.name].join(">");
      set.add(key);
      collectCollapsiblePaths(node.children, [...path, node.name], set);
    }
  }
  return set;
};

/**
 * Adds a "Net cash flow" category to the report if not already present.
 * Calculates net cash flow as the sum of income and expenses.
 *
 * @param {Array} nodes - Array of top-level account nodes
 * @returns {Array} Modified array with Net cash flow category appended
 */
const addNetCashFlowCategory = (nodes) => {
  if (!Array.isArray(nodes)) {
    return [];
  }

  let incomeTotal = 0;
  let expenseTotal = 0;
  let hasNetCashFlow = false;

  const result = nodes.map((node) => {
    if (!node || typeof node !== "object") {
      return node;
    }

    const name = typeof node.name === "string" ? node.name : "";
    const normalized = name.toLowerCase();

    if (normalized === "income") {
      incomeTotal = typeof node.total === "number" ? node.total : 0;
    } else if (normalized === "expense" || normalized === "expenses") {
      expenseTotal = typeof node.total === "number" ? node.total : 0;
    } else if (normalized === "net cash flow") {
      hasNetCashFlow = true;
    }

    return node;
  });

  if (hasNetCashFlow) {
    return result;
  }

  return [
    ...result,
    { name: "Net cash flow", total: incomeTotal + expenseTotal },
  ];
};

/**
 * Formats a Date object to YYYY-MM-DD string in local timezone.
 *
 * @param {Date} date - Date object to format
 * @returns {string} Formatted date string (YYYY-MM-DD)
 */
const formatLocalDate = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
};

/**
 * Gets the first day of January of the current year in local timezone.
 *
 * @returns {string} ISO date string for January 1st of current year
 */
const getMonthStart = () => {
  const now = new Date();
  const januaryFirst = new Date(now.getFullYear(), 0, 1);
  return formatLocalDate(januaryFirst);
};

/**
 * Gets the last day of the current month in local timezone.
 *
 * @returns {string} ISO date string for the last day of current month
 */
const getMonthEnd = () => {
  const now = new Date();
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return formatLocalDate(lastOfMonth);
};

/**
 * Cash Flow Page Component
 *
 * Displays cash flow reports showing income and expenses across multiple periods.
 * Supports period comparison, unrealized gains/losses, and transfer handling options.
 */
export default function CashFlow() {

  const [fromDates, setFromDates] = useState(() => {
    const start = getMonthStart();
    return [start, start, start];
  });
  const [toDates, setToDates] = useState(() => {
    const end = getMonthEnd();
    return [end, end, end];
  });
  const [periodCount, setPeriodCount] = useState(1);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState(new Set());
  const [includeUnrealizedGL, setIncludeUnrealizedGL] = useState(false);
  const [transfers, setTransfers] = useState("exclude");
  const [reportPeriods, setReportPeriods] = useState([]);

  /**
   * Updates the "from" date for a specific period.
   * @param {number} index - Index of the period to update
   * @param {string} value - New date string in YYYY-MM-DD format
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
   * @param {string} value - New date string in YYYY-MM-DD format
   */
  const handleToDateChange = useCallback((index, value) => {
    setToDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  /**
   * Fetches cash flow reports for all active periods.
   * Processes reports to add net cash flow category and sets initial collapsed state.
   */
  const handleGenerateReport = useCallback(async () => {
    setError("");
    setIsLoading(true);
    try {
      const clampedPeriodCount = Math.min(Math.max(periodCount ?? 1, 1), 3);
      const activePeriods = Array.from({ length: clampedPeriodCount }).map(
        (_, index) => ({
          fromDate: fromDates[index],
          toDate: toDates[index],
          label:
            fromDates[index] && toDates[index]
              ? `${fromDates[index]} to ${toDates[index]}`
              : `Period ${index + 1}`,
        })
      );
      const rawReports = await Promise.all(
        activePeriods.map(({ fromDate, toDate }) =>
          Rest.fetchCashFlowReport({
            fromDate,
            toDate,
            transfers,
            includeUnrealizedGL,
          })
        )
      );
      const processedReports = rawReports.map(addNetCashFlowCategory);
      setReports(processedReports);
      const collapsiblePaths = collectCollapsiblePaths(processedReports?.[0]);
      setCollapsedPaths(new Set(collapsiblePaths));
      setReportPeriods(activePeriods);
    } catch (err) {
      console.error("Failed to fetch cash flow report:", err);
      setError(err?.message ?? "Failed to fetch cash flow report");
      setReports([]);
      setReportPeriods([]);
      setCollapsedPaths(new Set());
    } finally {
      setIsLoading(false);
    }
  }, [periodCount, fromDates, toDates, transfers, includeUnrealizedGL]);

  useEffect(() => {
    handleGenerateReport();
  }, [handleGenerateReport]);

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
    () => collectCollapsiblePaths(reports?.[0]),
    [reports]
  );

  const isFullyCollapsed = useMemo(
    () => collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size,
    [collapsiblePaths, collapsedPaths]
  );

  const activePeriodCount = useMemo(
    () => Math.min(Math.max(periodCount ?? 1, 1), 3),
    [periodCount]
  );

  const displayPeriods = useMemo(
    () =>
      reportPeriods.length > 0
        ? reportPeriods
        : Array.from({ length: activePeriodCount }).map((_, index) => ({
            fromDate: fromDates[index],
            toDate: toDates[index],
            label:
              fromDates[index] && toDates[index]
                ? `${fromDates[index]} to ${toDates[index]}`
                : `Period ${index + 1}`,
          })),
    [reportPeriods, activePeriodCount, fromDates, toDates]
  );

  const periodLabels = useMemo(
    () =>
      displayPeriods.map((period, index) =>
        period?.label && typeof period.label === "string"
          ? period.label
          : period?.fromDate && period?.toDate
          ? `${period.fromDate} to ${period.toDate}`
          : `Period ${index + 1}`
      ),
    [displayPeriods]
  );

  /**
   * Toggles all collapsible paths between fully collapsed and fully expanded.
   */
  const handleToggleCollapseAll = useCallback(() => {
    if (collapsiblePaths.size === 0) return;
    setCollapsedPaths((prev) => {
      if (prev.size === collapsiblePaths.size) {
        return new Set();
      }
      return new Set(collapsiblePaths);
    });
  }, [collapsiblePaths]);

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main balance-grid">
        <div className="balance-layout-wrapper">
          <div className="report-scroll-container">
            <CashFlowReport
              reports={reports}
              periodLabels={periodLabels}
              collapsedPaths={collapsedPaths}
              onTogglePath={handleTogglePath}
              periods={displayPeriods}
            />
          </div>
        </div>
        <div className="balance-layout-holder">
          <CashFlowDateSelectorMonthYear
            activePeriodCount={activePeriodCount}
            fromDates={fromDates}
            toDates={toDates}
            onFromDateChange={handleFromDateChange}
            onToDateChange={handleToDateChange}
            onPeriodCountChange={setPeriodCount}
            includeUnrealizedGL={includeUnrealizedGL}
            onIncludeUnrealizedChange={setIncludeUnrealizedGL}
            transfers={transfers}
            onTransfersChange={setTransfers}
            onGenerateReport={handleGenerateReport}
            isLoading={isLoading}
            collapsiblePaths={collapsiblePaths}
            onToggleCollapseAll={handleToggleCollapseAll}
            isFullyCollapsed={isFullyCollapsed}
            error={error}
          />
        </div>
      </main>
    </div>
  );
}
