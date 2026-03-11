import { useMemo, useState, useEffect } from "react";
import Rest from "../js/rest.js";
import { exportCashFlow } from "../utils/excelExporter.js";
import "./PageLayout.css";
import "../features/Balances/BalanceDateSelector.css";
import CashFlowReport from "../features/CashFlow/CashFlowReport.jsx";
import CashFlowDateSelectorMonthYearOne from "../features/CashFlow/CashFlowDateSelectorMonthYearOneP.jsx";

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

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const getMonthlyPeriods = (fromDate, toDate) => {
  if (!fromDate || !toDate) {
    return [];
  }

  const start = new Date(fromDate);
  const end = new Date(toDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }

  const normalizedStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  );
  const normalizedEnd = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1)
  );

  if (normalizedStart > normalizedEnd) {
    return [];
  }

  const periods = [];
  let current = normalizedStart;
  while (current <= normalizedEnd) {
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();
    const firstOfMonth = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
    const lastOfMonthIso = lastOfMonth.toISOString().split("T")[0];
    periods.push({
      label: MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(year, month, 1))),
      fromDate: firstOfMonth,
      toDate: lastOfMonthIso,
    });
    current = new Date(Date.UTC(year, month + 1, 1));
  }

  return periods;
};

// Main Cash Flow Page Component
const formatLocalDate = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
};

export default function CashFlow() {
  const getYearStart = () => {
    const now = new Date();
    const firstOfYear = new Date(now.getFullYear(), 0, 1);
    return formatLocalDate(firstOfYear);
  };
  const getMonthEnd = () => {
    const now = new Date();
    const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return formatLocalDate(lastOfMonth);
  };

  const [fromDates, setFromDates] = useState(() => {
    const start = getYearStart();
    return [start];
  });
  const [toDates, setToDates] = useState(() => {
    const end = getMonthEnd();
    return [end];
  });
  const [reports, setReports] = useState([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [collapsedPaths, setCollapsedPaths] = useState(new Set());
  const [monthlyPeriods, setMonthlyPeriods] = useState([]);
  const [includeUnrealizedGL, setIncludeUnrealizedGL] = useState(false);
  const [transfers, setTransfers] = useState("exclude");
  const activePeriodCount = 1;

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
    const periods = getMonthlyPeriods(fromDates[0], toDates[0]);
    if (!periods.length) {
      setReports([]);
      setMonthlyPeriods([]);
      setCollapsedPaths(new Set());
      setError(
        "Select a valid month range (from date must be on or before to date) to generate the monthly view."
      );
      return;
    }

    setIsLoading(true);
    try {
      const rawReports = await Promise.all(
        periods.map(({ fromDate, toDate }) =>
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
      setMonthlyPeriods(periods);
      const collapsiblePaths = collectCollapsiblePaths(processedReports?.[0]);
      setCollapsedPaths(new Set(collapsiblePaths));
    } catch (err) {
      console.error("Failed to fetch monthly cash flow data:", err);
      setError(err?.message ?? "Failed to fetch cash flow report");
      setReports([]);
      setMonthlyPeriods([]);
      setCollapsedPaths(new Set());
    } finally {
      setIsLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const isFullyExpanded =
    collapsiblePaths.size > 0 && collapsedPaths.size === 0;

  const periodLabels = useMemo(
    () => monthlyPeriods.map((period) => period.label),
    [monthlyPeriods]
  );

  const handleExpandOneLayer = () => {
    setCollapsedPaths((prev) => {
      if (prev.size === 0) return prev;
      let minDepth = Infinity;
      for (const pathKey of prev) {
        const depth = pathKey.split(">").length - 1;
        if (depth < minDepth) minDepth = depth;
      }
      const next = new Set(prev);
      for (const pathKey of prev) {
        if (pathKey.split(">").length - 1 === minDepth) {
          next.delete(pathKey);
        }
      }
      return next;
    });
  };

  const handleCollapseOneLayer = () => {
    setCollapsedPaths((prev) => {
      const expandedPaths = [];
      for (const pathKey of collapsiblePaths) {
        if (!prev.has(pathKey)) expandedPaths.push(pathKey);
      }
      if (expandedPaths.length === 0) return prev;
      let maxDepth = -1;
      for (const pathKey of expandedPaths) {
        const depth = pathKey.split(">").length - 1;
        if (depth > maxDepth) maxDepth = depth;
      }
      const next = new Set(prev);
      for (const pathKey of expandedPaths) {
        if (pathKey.split(">").length - 1 === maxDepth) {
          next.add(pathKey);
        }
      }
      return next;
    });
  };

  const handleExport = () => {
    exportCashFlow(reports, periodLabels);
  };

  const hasReport =
    Array.isArray(reports?.[0]) && (reports?.[0]?.length ?? 0) > 0;

  return (
    <>
      <main className="page-main balance-grid balance-grid--single">
        <div className="report-toolbar-header">
          <div className="report-toolbar-header__text">
            <h1 className="report-toolbar-header__title">Cash Flow Monthly</h1>
            <p className="report-toolbar-header__description">
              Month-by-month cash flow breakdown with export.
            </p>
          </div>
        </div>
        <CashFlowDateSelectorMonthYearOne
          activePeriodCount={activePeriodCount}
          fromDates={fromDates}
          toDates={toDates}
          onFromDateChange={handleFromDateChange}
          onToDateChange={handleToDateChange}
          includeUnrealizedGL={includeUnrealizedGL}
          onIncludeUnrealizedChange={setIncludeUnrealizedGL}
          transfers={transfers}
          onTransfersChange={setTransfers}
          onGenerateReport={handleGenerateReport}
          isLoading={isLoading}
          collapsiblePaths={collapsiblePaths}
          onExpandOneLayer={handleExpandOneLayer}
          onCollapseOneLayer={handleCollapseOneLayer}
          isFullyCollapsed={isFullyCollapsed}
          isFullyExpanded={isFullyExpanded}
          error={error}
          showPeriodSelector={false}
          onExport={handleExport}
          canExport={hasReport}
          layout="toolbar"
        />
        <div className="balance-layout-wrapper">
          <div className="report-scroll-container">
            <CashFlowReport
              reports={reports}
              periodLabels={periodLabels}
              collapsedPaths={collapsedPaths}
              onTogglePath={handleTogglePath}
              periods={monthlyPeriods}
            />
          </div>
        </div>
      </main>
    </>
  );
}
