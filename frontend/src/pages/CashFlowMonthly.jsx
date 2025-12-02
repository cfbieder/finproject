import { useMemo, useState, useEffect } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import Rest from "../js/rest.js";
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

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrency = (value) => {
  const amount = Number.isFinite(value) ? value : 0;
  return amount < 0
    ? `(${currencyFormatter.format(Math.abs(amount))})`
    : currencyFormatter.format(amount);
};

const buildCashFlowValueMap = (nodes, path = [], map = new Map()) => {
  if (!Array.isArray(nodes)) {
    return map;
  }

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const name =
      typeof node.name === "string" ? node.name : String(node.name ?? "");
    const pathKey = [...path, name].join(">");
    const total = Number.isFinite(node.total) ? node.total : 0;
    map.set(pathKey, total);
    if (Array.isArray(node.children) && node.children.length > 0) {
      buildCashFlowValueMap(node.children, [...path, name], map);
    }
  }

  return map;
};

const buildExportRows = (
  nodes,
  collapsedPaths,
  valueMaps,
  path = [],
  depth = 0
) => {
  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.flatMap((node) => {
    if (!node || typeof node !== "object") {
      return [];
    }
    const name =
      typeof node.name === "string" ? node.name : String(node.name ?? "");
    const pathKey = [...path, name].join(">");
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    const row = {
      name,
      depth,
      values: valueMaps.map((map) => map.get(pathKey) ?? 0),
    };
    const children =
      hasChildren && !collapsedPaths.has(pathKey)
        ? buildExportRows(
            node.children,
            collapsedPaths,
            valueMaps,
            [...path, name],
            depth + 1
          )
        : [];
    return [row, ...children];
  });
};

const escapeCsvValue = (value) => {
  const stringValue = String(value ?? "");
  const escaped = stringValue.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
};

const buildCsvContent = (labels, rows) => {
  const header = ["Category", ...labels];
  const lines = [
    header,
    ...rows.map((row) => [
      `${" ".repeat(row.depth * 2)}${row.name}`,
      ...row.values.map((value) => formatCurrency(value)),
    ]),
  ];
  return lines.map((line) => line.map(escapeCsvValue).join(",")).join("\r\n");
};

const downloadBlob = async (blob, suggestedName) => {
  if (typeof window === "undefined") return;

  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: "Excel (CSV)",
          accept: {
            "text/csv": [".csv"],
            "application/vnd.ms-excel": [".xls"],
          },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

// Main Cash Flow Page Component
export default function CashFlow() {
  const getYearStart = () => {
    const firstOfYear = new Date();
    firstOfYear.setMonth(0, 1);
    return firstOfYear.toISOString().split("T")[0];
  };
  const getMonthEnd = () => {
    const lastOfMonth = new Date();
    lastOfMonth.setMonth(lastOfMonth.getMonth() + 1, 0);
    return lastOfMonth.toISOString().split("T")[0];
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

  const periodLabels = useMemo(
    () => monthlyPeriods.map((period) => period.label),
    [monthlyPeriods]
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

  const handleExport = async () => {
    const activeReports = Array.isArray(reports)
      ? reports.slice(
          0,
          Math.min(monthlyPeriods.length || reports.length, reports.length)
        )
      : [];
    const baseReport = activeReports[0];
    if (!Array.isArray(baseReport) || baseReport.length === 0) {
      return;
    }

    const valueMaps = activeReports.map((report) =>
      buildCashFlowValueMap(report)
    );
    const rows = buildExportRows(baseReport, collapsedPaths, valueMaps);
    const labels =
      monthlyPeriods.length > 0
        ? monthlyPeriods
            .slice(0, activeReports.length)
            .map((period) => period.label)
        : activeReports.map((_, index) => `Period ${index + 1}`);
    const csv = buildCsvContent(labels, rows);
    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });
    try {
      await downloadBlob(blob, `cash-flow-${Date.now()}.csv`);
    } catch (err) {
      if (err?.name === "AbortError") {
        return;
      }
      console.error("Failed to export cash flow report", err);
    }
  };

  const hasReport =
    Array.isArray(reports?.[0]) && (reports?.[0]?.length ?? 0) > 0;

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
              periods={monthlyPeriods}
            />
          </div>
        </div>
        <div className="balance-layout-holder">
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
            onToggleCollapseAll={handleToggleCollapseAll}
            isFullyCollapsed={isFullyCollapsed}
            error={error}
            showPeriodSelector={false}
            onExport={handleExport}
            canExport={hasReport}
          />
        </div>
      </main>
    </div>
  );
}
