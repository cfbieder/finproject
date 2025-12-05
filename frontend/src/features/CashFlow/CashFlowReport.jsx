import { useEffect, useRef, useState } from "react";
import Rest from "../../js/rest.js";
import TransactionModal from "./TransactionModal.jsx";
import "./CashFlowReport.css";

// Utility to format currency values
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Format currency with parentheses for negative values
const formatCurrency = (value) => {
  const amount = value ?? 0;
  return amount < 0
    ? `(${currencyFormatter.format(Math.abs(amount))})`
    : currencyFormatter.format(amount);
};

// Recursively collect leaf category names from a cash flow node
const collectLeafCategories = (node) => {
  if (!node || typeof node !== "object") {
    return [];
  }

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  if (!hasChildren) {
    return typeof node.name === "string" && node.name.trim() ? [node.name] : [];
  }

  return node.children.flatMap((child) => collectLeafCategories(child));
};

// Build a map of cash flow node paths to their total values
const buildCashFlowValueMap = (nodes, path = [], map = new Map()) => {
  if (!Array.isArray(nodes)) {
    return map;
  }

  for (const node of nodes) {
    const key = [...path, node.name].join(">");
    map.set(key, node.total ?? 0);
    if (Array.isArray(node.children) && node.children.length > 0) {
      buildCashFlowValueMap(node.children, [...path, node.name], map);
    }
  }

  return map;
};

// Render cash flow report rows recursively
const renderCashFlowRows = (
  nodes,
  level = 0,
  path = [],
  comparisonMaps = [],
  collapsedPaths = new Set(),
  onToggle = () => {},
  onValueDoubleClick = () => {},
  highlightedPaths = new Set(),
  onToggleHighlight = () => {}
) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  return nodes.flatMap((node) => {
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    const pathKey = [...path, node.name].join(">");
    const isCollapsed = collapsedPaths.has(pathKey);
    const comparisonValues = comparisonMaps.map(
      (map) => map?.get(pathKey) ?? 0
    );
    const isHighlighted = highlightedPaths.has(pathKey);
    const row = (
      <tr
        key={pathKey}
        className={isHighlighted ? "balance-report-table__row--highlighted" : ""}
      >
        <td
          className="balance-report-table__name"
          style={{ "--cashflow-indent-level": level }}
          onClick={() => onToggleHighlight(pathKey)}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(pathKey);
            }}
            disabled={!hasChildren}
            className="cash-flow-report__toggle-button"
            aria-label={
              hasChildren
                ? `${isCollapsed ? "Expand" : "Collapse"} ${node.name}`
                : undefined
            }
          >
            {hasChildren ? (isCollapsed ? "+" : "−") : "\u00a0"}
          </button>
          <span
            className="balance-report-table__name-text"
            onClick={(event) => {
              event.stopPropagation();
              onToggleHighlight(pathKey);
            }}
          >
            {node.name}
          </span>
        </td>
        <td
          className={`balance-report-table__value ${
            (node.total ?? 0) < 0 ? "balance-report-table__value--negative" : ""
          }`}
          onDoubleClick={() => onValueDoubleClick(node, pathKey, 0)}
        >
          {formatCurrency(node.total ?? 0)}
        </td>
        {comparisonValues.map((value, index) => (
          <td
            key={`${pathKey}-comparison-${index}`}
            className={`balance-report-table__value ${
              value < 0 ? "balance-report-table__value--negative" : ""
            }`}
            onDoubleClick={() => onValueDoubleClick(node, pathKey, index + 1)}
          >
            {formatCurrency(value)}
          </td>
        ))}
      </tr>
    );

    const childrenRows =
      hasChildren && !isCollapsed
        ? renderCashFlowRows(
            node.children,
            level + 1,
            [...path, node.name],
            comparisonMaps,
            collapsedPaths,
            onToggle,
            onValueDoubleClick,
            highlightedPaths,
            onToggleHighlight
          )
        : [];

    return hasChildren ? [row, ...childrenRows] : [row];
  });
};

// Cash Flow Report Component
export default function CashFlowReport({
  reports,
  periodLabels,
  collapsedPaths,
  onTogglePath,
  periods = [],
}) {
  const activeReports = Array.isArray(reports)
    ? reports.slice(
        0,
        Math.min(periodLabels?.length ?? reports.length, reports.length)
      )
    : [];
  const baseReport = activeReports[0];
  const hasReport = Array.isArray(baseReport) && baseReport.length > 0;
  const comparisonMaps = activeReports
    .slice(1)
    .map((report) => buildCashFlowValueMap(report));
  const activeLabels = Array.isArray(periodLabels)
    ? periodLabels.slice(0, activeReports.length)
    : [];
  const [categoryColumnWidth, setCategoryColumnWidth] = useState(260);
  const [transactionModal, setTransactionModal] = useState({
    isOpen: false,
    isLoading: false,
    transactions: [],
    error: "",
    title: "",
  });
  const [highlightedRows, setHighlightedRows] = useState(new Set());
  const tableRef = useRef(null);
  const dragCleanup = useRef(() => {});
  const activePeriods = Array.isArray(periods)
    ? periods.slice(0, activeReports.length)
    : [];

  const toggleRowHighlight = (pathKey) => {
    setHighlightedRows((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  };

  useEffect(() => {
    return () => {
      dragCleanup.current();
    };
  }, []);

  const closeTransactionModal = () => {
    setTransactionModal((prev) => ({ ...prev, isOpen: false }));
  };

  // Handle double-click on value cells to load transactions
  const handleValueDoubleClick = async (node, pathKey, periodIndex) => {
    const period = activePeriods[periodIndex];
    if (!period || !period.fromDate || !period.toDate) {
      return;
    }

    const categories = Array.from(new Set(collectLeafCategories(node)));
    if (!categories.length) {
      return;
    }

    const pathLabel =
      (pathKey && pathKey.includes(">") && pathKey.split(">").join(" / ")) ||
      node?.name ||
      "Category";
    const periodLabel =
      activeLabels[periodIndex] ??
      period.label ??
      (period.fromDate && period.toDate
        ? `${period.fromDate} to ${period.toDate}`
        : `Period ${periodIndex + 1}`);

    setTransactionModal({
      isOpen: true,
      isLoading: true,
      transactions: [],
      error: "",
      title: `${pathLabel} - ${periodLabel}`,
    });

    try {
      const data = await Rest.fetchCashFlowTransactions({
        categories,
        fromDate: period.fromDate,
        toDate: period.toDate,
      });
      const transactions = Array.isArray(data?.transactions)
        ? data.transactions
        : Array.isArray(data)
        ? data
        : [];
      setTransactionModal((prev) => ({
        ...prev,
        isLoading: false,
        transactions,
      }));
    } catch (error) {
      setTransactionModal((prev) => ({
        ...prev,
        isLoading: false,
        error: error?.message ?? "Failed to load transactions",
      }));
    }
  };

  // Handle column resizing
  const startResizingCategory = (event) => {
    event.preventDefault();
    const tableRect = tableRef.current?.getBoundingClientRect();
    if (!tableRect) {
      return;
    }

    const minWidth = 160;
    const maxWidth = 520;

    const updateWidth = (clientX) => {
      const rect = tableRef.current?.getBoundingClientRect() ?? tableRect;
      if (!rect || rect.width <= 0) {
        return;
      }
      const relativeX = Math.min(Math.max(0, clientX - rect.left), rect.width);
      const clamped = Math.min(maxWidth, Math.max(minWidth, relativeX));
      setCategoryColumnWidth(clamped);
    };

    const handlePointerMove = (moveEvent) => {
      updateWidth(moveEvent.clientX);
    };

    const stopResizing = () => {
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("mouseup", stopResizing);
      dragCleanup.current = () => {};
    };

    dragCleanup.current = stopResizing;

    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", handlePointerMove);
    document.addEventListener("mouseup", stopResizing);
    updateWidth(event.clientX);
  };

  return (
    <section className="balance-content cash-flow-report">
      {hasReport ? (
        <>
          <section className="budget-region realization-header">
            <p className="budget-region__label">Cash Flow Comparison</p>
            <p className="budget-region__description">
              Compare cash flow across multiple periods to analyze income, expenses, and net cash flow trends.
            </p>
          </section>
          <div className="balance-report">
            <div className="balance-report__table-wrapper">
            <table className="balance-report-table" ref={tableRef}>
              <caption className="balance-report-table__caption"></caption>
              <colgroup>
                <col style={{ width: `${categoryColumnWidth}px` }} />
                <col />
                {activeLabels.slice(1).map((_, index) => (
                  <col key={`cashflow-period-col-${index + 2}`} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="balance-report-table__category">
                    <span>Category</span>
                    <span
                      className="balance-report-table__column-resizer"
                      role="presentation"
                      onMouseDown={startResizingCategory}
                    />
                  </th>
                  <th>{activeLabels[0] ?? "Period 1"}</th>
                  {activeLabels.slice(1).map((label, index) => (
                    <th key={`cashflow-period-header-${index + 2}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {renderCashFlowRows(
                  baseReport,
                  0,
                  [],
                  comparisonMaps,
                  collapsedPaths,
                  onTogglePath,
                  handleValueDoubleClick,
                  highlightedRows,
                  toggleRowHighlight
                )}
              </tbody>
            </table>
          </div>
          </div>
        </>
      ) : (
        <p className="balance-report-empty">
          Generate a report to view the cash flow details.
        </p>
      )}
      {transactionModal.isOpen && (
        <TransactionModal
          transactionModal={transactionModal}
          onClose={closeTransactionModal}
          formatCurrency={formatCurrency}
        />
      )}
    </section>
  );
}
