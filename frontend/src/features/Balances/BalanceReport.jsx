import { useEffect, useRef, useState } from "react";
import "./BalanceReport.css";
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Formats a number as USD currency, handling negative values with parentheses
const formatCurrency = (value) => {
  const amount = value ?? 0;
  return amount < 0
    ? `(${currencyFormatter.format(Math.abs(amount))})`
    : currencyFormatter.format(amount);
};

// Builds a map of account paths to their total USD values for quick lookup
const buildAccountValueMap = (accounts, path = [], map = new Map()) => {
  if (!Array.isArray(accounts)) {
    return map;
  }

  for (const account of accounts) {
    const key = [...path, account.name].join(">");
    map.set(key, account.totalUSD);
    if (Array.isArray(account.children) && account.children.length > 0) {
      buildAccountValueMap(account.children, [...path, account.name], map);
    }
  }

  return map;
};

// Recursively renders account rows with indentation and expand/collapse functionality
const renderAccountRows = (
  accounts,
  level = 0,
  path = [],
  comparisonMaps = [],
  collapsedPaths = new Set(),
  onToggle = () => {},
  highlightedPaths = new Set(),
  onToggleHighlight = () => {}
) => {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return [];
  }

  return accounts.flatMap((account) => {
    const hasChildren =
      Array.isArray(account.children) && account.children.length > 0;
    const pathKey = [...path, account.name].join(">");
    const isCollapsed = collapsedPaths.has(pathKey);
    const comparisonValues = comparisonMaps.map(
      (map) => map?.get(pathKey) ?? 0
    );
    const isHighlighted = highlightedPaths.has(pathKey);
    const highlightBackground = "rgba(87, 188, 103, 1)";
    const highlightedCellStyle = isHighlighted
      ? { backgroundColor: highlightBackground }
      : undefined;
    const nameCellStyle = {
      "--balance-indent-level": level,
      ...(highlightedCellStyle || {}),
    };

    const row = (
      <tr
        key={`${account.name}-${level}-${account.totalUSD}`}
        className={
          isHighlighted ? "balance-report-table__row--highlighted" : ""
        }
      >
        <td
          className="balance-report-table__name"
          style={nameCellStyle}
          onClick={() => onToggleHighlight(pathKey)}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(pathKey);
            }}
            disabled={!hasChildren}
            className="balance-report__toggle-button"
            aria-label={
              hasChildren
                ? `${isCollapsed ? "Expand" : "Collapse"} ${account.name}`
                : undefined
            }
          >
            {hasChildren ? (isCollapsed ? "+" : "−") : "\u00a0"}
          </button>
          <span
            className="balance-report-table__name-text"
            onClick={() => onToggleHighlight(pathKey)}
          >
            {account.name}
          </span>
        </td>
        <td
          className={`balance-report-table__value ${
            (account.totalUSD ?? 0) < 0
              ? "balance-report-table__value--negative"
              : ""
          }`}
          style={highlightedCellStyle}
        >
          {formatCurrency(account.totalUSD)}
        </td>
        {comparisonValues.map((value, index) => (
          <td
            key={`${pathKey}-comparison-${index}`}
            className={`balance-report-table__value ${
              value < 0 ? "balance-report-table__value--negative" : ""
            }`}
            style={highlightedCellStyle}
          >
            {formatCurrency(value)}
          </td>
        ))}
      </tr>
    );

    const childrenRows =
      hasChildren && !isCollapsed
        ? renderAccountRows(
            account.children,
            level + 1,
            [...path, account.name],
            comparisonMaps,
            collapsedPaths,
            onToggle,
            highlightedPaths,
            onToggleHighlight
          )
        : [];

    return hasChildren ? [row, ...childrenRows] : [row];
  });
};

export default function BalanceReport({
  balanceReports,
  periodDates,
  periodCount,
  collapsedPaths = new Set(),
  onTogglePath = () => {},
}) {
  const activeReports = Array.isArray(balanceReports)
    ? balanceReports.slice(0, Math.min(periodCount ?? 1, 3))
    : [];
  const baseReport = activeReports[0];
  const hasReport = Array.isArray(baseReport) && baseReport.length > 0;
  const comparisonMaps = activeReports
    .slice(1)
    .map((report) => buildAccountValueMap(report));
  const periodLabels = activeReports.map(
    (_, index) => periodDates?.[index] ?? `Period ${index + 1}`
  );
  const [categoryColumnWidth, setCategoryColumnWidth] = useState(260);
  const [highlightedRows, setHighlightedRows] = useState(new Set());
  const tableRef = useRef(null);
  const dragCleanup = useRef(() => {});
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
    <section className="balance-content">
      {hasReport ? (
        <>
          <section className="budget-region realization-header">
            <p className="budget-region__label">Balance Sheet</p>
            <p className="budget-region__description">
              View account balances across multiple periods to track changes in financial position.
            </p>
          </section>
          <div className="balance-report">
            <div className="balance-report__table-wrapper">
            <table className="balance-report-table" ref={tableRef}>
              <caption className="balance-report-table__caption">
                <div className="balance-report-table__caption-row"></div>
              </caption>
              <colgroup>
                <col style={{ width: `${categoryColumnWidth}px` }} />
                <col />
                {periodLabels.slice(1).map((_, index) => (
                  <col key={`period-col-${index + 2}`} />
                ))}
              </colgroup>
              <thead className="balance-report-table__head">
                <tr>
                  <th className="balance-report-table__category">
                    <span>Account</span>
                    <span
                      className="balance-report-table__column-resizer"
                      role="presentation"
                      onMouseDown={startResizingCategory}
                    />
                  </th>
                  <th>{periodLabels[0] ?? "Period 1"}</th>
                  {periodLabels.slice(1).map((label, index) => (
                    <th key={`period-header-${index + 2}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {renderAccountRows(
                  baseReport,
                  0,
                  [],
                  comparisonMaps,
                  collapsedPaths,
                  onTogglePath,
                  highlightedRows,
                  toggleRowHighlight
                )}
              </tbody>
            </table>
          </div>
          </div>
        </>
      ) : (
        <div className="balance-report-empty-wrapper">
          <p className="balance-report-empty balance-report-empty--alert">
            Generating Report.........
          </p>
        </div>
      )}
    </section>
  );
}
