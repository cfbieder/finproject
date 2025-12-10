import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BalanceDateSelector from "../features/Balances/BalanceDateSelector.jsx";
import BalanceReport from "../features/Balances/BalanceReport.jsx";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

/**
 * Recursively collects paths to all accounts that have children (collapsible nodes).
 * @param {Array} accounts - Array of account objects with potential children
 * @param {Array} path - Current path being traversed
 * @param {Set} result - Accumulated set of collapsible path keys
 * @returns {Set} Set of path strings in format "parent>child>grandchild"
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

export default function Balance() {
  const getToday = () => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  };

  const [periodDates, setPeriodDates] = useState(() => {
    const today = getToday();
    return [today, today, today];
  });
  const [periodCount, setPeriodCount] = useState(1);
  const [balanceReports, setBalanceReports] = useState([]);
  const [reportError, setReportError] = useState("");
  const [isFetchingReport, setIsFetchingReport] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState(() => new Set());
  // Prevents duplicate API calls on mount
  const initialReportRequested = useRef(false);

  // Normalize period count to valid range (1-3)
  const activePeriodCount = useMemo(
    () => Math.min(Math.max(periodCount ?? 1, 1), 3),
    [periodCount]
  );

  const handlePeriodDateChange = useCallback((index, value) => {
    setPeriodDates((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const handleGenerateReport = useCallback(async () => {
    setReportError("");
    setIsFetchingReport(true);
    const activeDates = periodDates.slice(0, activePeriodCount);
    try {
      const reports = await Promise.all(
        activeDates.map((date) => Rest.fetchBalanceReport(date))
      );
      setBalanceReports(reports);
      const collapsiblePaths = collectCollapsiblePaths(reports[0]);
      setCollapsedPaths(new Set(collapsiblePaths));
    } catch (error) {
      console.error("Failed to fetch balance report:", error);
      setReportError(error?.message ?? "Failed to fetch balance report");
    } finally {
      setIsFetchingReport(false);
    }
  }, [periodDates, activePeriodCount]);

  // Fetch initial report on mount
  useEffect(() => {
    if (initialReportRequested.current) {
      return;
    }

    initialReportRequested.current = true;
    handleGenerateReport();
  }, [handleGenerateReport]);

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

  // Memoize collapsible paths calculation to avoid recalculating on every render
  const collapsiblePaths = useMemo(
    () => collectCollapsiblePaths(balanceReports?.[0]),
    [balanceReports]
  );

  const isFullyCollapsed =
    collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size;

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

  const hasLoadedReport = balanceReports.length > 0;

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main balance-grid">
        <div className="balance-layout-wrapper">
          <div className="report-scroll-container">
            <BalanceReport
              balanceReports={balanceReports}
              periodDates={periodDates}
              periodCount={activePeriodCount}
              collapsedPaths={collapsedPaths}
              onTogglePath={handleTogglePath}
            />
          </div>
        </div>
        <div className="balance-layout-holder">
          <BalanceDateSelector
            periodDates={periodDates}
            onPeriodDateChange={handlePeriodDateChange}
            onGenerateReport={handleGenerateReport}
            isLoading={isFetchingReport}
            error={reportError}
            report={balanceReports[0]}
            periodCount={activePeriodCount}
            onPeriodCountChange={setPeriodCount}
            onToggleCollapseAll={handleToggleCollapseAll}
            collapseToggleLabel={
              isFullyCollapsed ? "Expand All" : "Collapse All"
            }
            collapseToggleDisabled={
              collapsiblePaths.size === 0 || isFetchingReport
            }
            showCollapseToggle={hasLoadedReport}
          />
        </div>
      </main>
    </div>
  );
}
