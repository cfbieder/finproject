import { useMemo, useState, useEffect } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";
import "../features/BalanceDateSelector.css";
import CashFlowReport from "../features/CashFlowReport.jsx";
import CashFlowDateSelectorMonthYear from "../features/CashFlowDateSelectorMonthYear.jsx";

// Recursively collect paths of collapsible nodes
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

// Add "Net cash flow" category if not present
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
// Main Cash Flow Page Component
export default function CashFlow() {
  const getMonthStart = () => {
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    return firstOfMonth.toISOString().split("T")[0];
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
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState(new Set());
  const [includeUnrealizedGL, setIncludeUnrealizedGL] = useState(false);
  const [transfers, setTransfers] = useState("exclude");
  const [reportPeriods, setReportPeriods] = useState([]);

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
  };

  useEffect(() => {
    handleGenerateReport();
  }, []);

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

  const collapsiblePaths = useMemo(
    () => collectCollapsiblePaths(reports?.[0]),
    [reports]
  );
  const isFullyCollapsed =
    collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size;
  const activePeriodCount = Math.min(Math.max(periodCount ?? 1, 1), 3);
  const displayPeriods =
    reportPeriods.length > 0
      ? reportPeriods
      : Array.from({ length: activePeriodCount }).map((_, index) => ({
          fromDate: fromDates[index],
          toDate: toDates[index],
          label:
            fromDates[index] && toDates[index]
              ? `${fromDates[index]} to ${toDates[index]}`
              : `Period ${index + 1}`,
        }));
  const periodLabels = displayPeriods.map((period, index) =>
    period?.label && typeof period.label === "string"
      ? period.label
      : period?.fromDate && period?.toDate
      ? `${period.fromDate} to ${period.toDate}`
      : `Period ${index + 1}`
  );

  const handleToggleCollapseAll = () => {
    if (collapsiblePaths.size === 0) return;
    setCollapsedPaths((prev) => {
      if (prev.size === collapsiblePaths.size) {
        return new Set();
      }
      return new Set(collapsiblePaths);
    });
  };

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
