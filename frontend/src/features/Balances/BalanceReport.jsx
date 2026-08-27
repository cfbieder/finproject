import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import "./BalanceReport.css";
import "../../components/ReportTable.css";
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

// Computes Net Worth (Assets + Liabilities) from a report's top-level accounts
const computeNetWorth = (accounts) => {
  if (!Array.isArray(accounts)) return 0;
  let total = 0;
  for (const account of accounts) {
    const name = (account.name ?? "").toLowerCase();
    if (name === "assets" || name === "liabilities") {
      total += account.totalUSD ?? 0;
    }
  }
  return total;
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
    // CR088 P3: the highlight fill used to be an INLINE `rgba(87, 188, 103, 1)`
    // spread onto every cell of the row. Inline beats CSS, so the stylesheet
    // could only reach it with `!important` — which BalanceReport.css did, for
    // the frozen first cell only, in two hand-maintained literal hexes (one for
    // light, one for dark). The result was a row whose first cell was pale and
    // whose remaining cells were a saturated opaque green, by accident rather
    // than design, with three colour literals keeping it that way.
    //
    // The class alone now carries it, painted from `--primary-subtle` in
    // `ReportTable.css` — one rule, one token, defined in both themes, shared
    // with the Cash Flow report which only ever set the class anyway.
    const nameCellStyle = { "--report-indent-level": level };

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
          {/* ⚠️ `stopPropagation` is load-bearing, and its absence was a live
              defect until CR088 P3. The enclosing <td> ALSO calls
              `onToggleHighlight(pathKey)`, so a click on the label fired both
              handlers and toggled the same key twice — on, then off — and
              clicking an account name did visibly nothing. Only the cell's
              empty padding worked, which nobody would find on purpose.
              `.balance-report-table__name-text` even carries `cursor: pointer`,
              so it advertised an affordance it did not have: CR085's named
              defect class, state that renders and produces no visible effect.
              The Cash Flow report's identical span has always stopped
              propagation here; this one had drifted. */}
          <span
            className="balance-report-table__name-text"
            onClick={(event) => {
              event.stopPropagation();
              onToggleHighlight(pathKey);
            }}
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
        >
          {formatCurrency(account.totalUSD)}
        </td>
        {comparisonValues.map((value, index) => (
          <td
            key={`${pathKey}-comparison-${index}`}
            className={`balance-report-table__value ${
              value < 0 ? "balance-report-table__value--negative" : ""
            }`}
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
  maxPeriods = 3,
  collapsedPaths = new Set(),
  onTogglePath = () => {},
}) {
  const activeReports = Array.isArray(balanceReports)
    ? balanceReports.slice(0, Math.min(periodCount ?? 1, maxPeriods))
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
          <div className="balance-report report-table">
            <div className="balance-report__table-wrapper">
              <table className="balance-report-table" ref={tableRef}>
                {/* CR088 P4 — see the note in CashFlowReport.jsx. Here the banner
                    was the worse of the two: it read "BALANCE SHEET" directly under
                    an <h1> reading "Balance Sheet", the same words twice, in a card
                    taller than the three rows beneath it. */}
                <caption className="report-table__caption">
                  Balance Sheet
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
                <tfoot>
                  <tr className="balance-report-table__net-worth">
                    <td className="balance-report-table__name">
                      <span className="balance-report-table__name-text">
                        Net Worth
                      </span>
                    </td>
                    <td className={`balance-report-table__value ${computeNetWorth(baseReport) < 0 ? "balance-report-table__value--negative" : ""}`}>
                      {formatCurrency(computeNetWorth(baseReport))}
                    </td>
                    {activeReports.slice(1).map((report, index) => {
                      const nw = computeNetWorth(report);
                      return (
                        <td
                          key={`net-worth-${index}`}
                          className={`balance-report-table__value ${nw < 0 ? "balance-report-table__value--negative" : ""}`}
                        >
                          {formatCurrency(nw)}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
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

BalanceReport.propTypes = {
  balanceReports: PropTypes.arrayOf(PropTypes.array),
  periodDates: PropTypes.arrayOf(PropTypes.string),
  periodCount: PropTypes.number,
  maxPeriods: PropTypes.number,
  collapsedPaths: PropTypes.instanceOf(Set),
  onTogglePath: PropTypes.func,
};
