import { useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import Rest from "../../js/rest.js";
import TransactionModal from "./TransactionModal.jsx";
import "./CashFlowReport.css";

// Build a currency/decimal formatter. A currency code (e.g. "USD", "PLN")
// formats with that symbol; null formats a plain decimal — used when an
// original-currency report mixes currencies and no single symbol is correct.
const makeValueFormatter = (currencyCode) => {
  const nf = currencyCode
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  // Parentheses for negative values, matching the ledger convention.
  return (value) => {
    const amount = value ?? 0;
    return amount < 0
      ? `(${nf.format(Math.abs(amount))})`
      : nf.format(amount);
  };
};

// Default USD formatter (Summary / By Period tabs pass no currencyCode).
const formatCurrency = makeValueFormatter("USD");

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
  onToggleHighlight = () => {},
  formatValue = formatCurrency
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
    const hasNonZeroValue =
      (node.total ?? 0) !== 0 ||
      comparisonValues.some((value) => (value ?? 0) !== 0);
    const isHighlighted = highlightedPaths.has(pathKey);

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
            onToggleHighlight,
            formatValue
          )
        : [];

    if (!hasNonZeroValue && childrenRows.length === 0) {
      return [];
    }

    const row = (
      <tr
        key={pathKey}
        data-level={level}
        className={
          isHighlighted ? "balance-report-table__row--highlighted" : ""
        }
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
          {formatValue(node.total ?? 0)}
        </td>
        {comparisonValues.map((value, index) => (
          <td
            key={`${pathKey}-comparison-${index}`}
            className={`balance-report-table__value ${
              value < 0 ? "balance-report-table__value--negative" : ""
            }`}
            onDoubleClick={() => onValueDoubleClick(node, pathKey, index + 1)}
          >
            {formatValue(value)}
          </td>
        ))}
      </tr>
    );

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
  currencyCode = "USD",
}) {
  const formatValue = useMemo(
    () => makeValueFormatter(currencyCode),
    [currencyCode]
  );
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
            <p className="budget-region__label cash-flow-report__title">
              Cash Flow Comparison
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
                      <th key={`cashflow-period-header-${index + 2}`}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {renderCashFlowRows(
                    baseReport.filter(
                      (n) => (n.name ?? "").toLowerCase() !== "net cash flow"
                    ),
                    0,
                    [],
                    comparisonMaps,
                    collapsedPaths,
                    onTogglePath,
                    handleValueDoubleClick,
                    highlightedRows,
                    toggleRowHighlight,
                    formatValue
                  )}
                </tbody>
                <tfoot>
                  {(() => {
                    const netNode = baseReport.find(
                      (n) => (n.name ?? "").toLowerCase() === "net cash flow"
                    );
                    if (!netNode) return null;
                    const baseValue = netNode.total ?? 0;
                    return (
                      <tr className="balance-report-table__net-cash-flow">
                        <td className="balance-report-table__name">
                          <span className="balance-report-table__name-text">
                            Net Cash Flow
                          </span>
                        </td>
                        <td
                          className={`balance-report-table__value ${
                            baseValue < 0
                              ? "balance-report-table__value--negative"
                              : ""
                          }`}
                        >
                          {formatValue(baseValue)}
                        </td>
                        {comparisonMaps.map((map, index) => {
                          const val = (() => {
                            const compReport = activeReports[index + 1];
                            if (!Array.isArray(compReport)) return 0;
                            const node = compReport.find(
                              (n) =>
                                (n.name ?? "").toLowerCase() === "net cash flow"
                            );
                            return node?.total ?? 0;
                          })();
                          return (
                            <td
                              key={`net-cash-flow-${index}`}
                              className={`balance-report-table__value ${
                                val < 0
                                  ? "balance-report-table__value--negative"
                                  : ""
                              }`}
                            >
                              {formatValue(val)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })()}
                </tfoot>
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
          formatCurrency={formatValue}
        />
      )}
    </section>
  );
}

CashFlowReport.propTypes = {
  reports: PropTypes.arrayOf(PropTypes.array),
  periodLabels: PropTypes.arrayOf(PropTypes.string),
  collapsedPaths: PropTypes.instanceOf(Set),
  onTogglePath: PropTypes.func,
  periods: PropTypes.arrayOf(PropTypes.object),
  currencyCode: PropTypes.string,
};
