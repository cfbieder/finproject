import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatAmount } from "./utils/fcReviewUtils.js";
import FCReviewTableControls from "./FCReviewTableControls.jsx";

/**
 * Change in Net Assets bridge.
 *
 * Decomposes the year-over-year change in Net Assets (Assets − Liabilities) into
 * its two drivers, which reconcile exactly:
 *
 *   ΔNet Assets = Operating Cash Flow + Σ Unrealized G/L (per balance-sheet line)
 *
 * - **Operating Cash Flow** = Income + Expense (incl. tax). Transfers are excluded
 *   because they are internal moves between the bank and tracked BS lines — their
 *   bank leg would otherwise double-count against the line leg neutralised below.
 * - **Unrealized G/L** per line = Δ(signed balance) + line transfers, where signed
 *   balance is +balance for assets / −balance for liabilities, and "line transfers"
 *   is that line's value from the Transfers section above (bank-impact sign:
 *   negative = cash invested into the line). This strips invested/withdrawn cash out
 *   of the balance change, leaving pure non-cash appreciation (incl. FX revaluation
 *   on foreign-currency assets and liabilities).
 *
 * The headline rows always tie by construction (Unrealized total is derived as
 * ΔNet Assets − Operating). The per-line detail is the explanation; any unattributed
 * remainder is surfaced as an explicit "Other (unattributed)" line rather than hidden.
 */
function EquityBridgeRows({
  sortedYears,
  resolveCashValue,
  transferDetailRows,
  netAssetsByYear,
  balanceDisplayValues,
  balanceAccountMap,
  bankAccountLabels,
  balanceAccounts,
  baseYears,
  lastActualYears,
  selectCellBaseStyle,
  accountCellBaseStyle,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [unrealOpen, setUnrealOpen] = useState(true);

  const bridge = useMemo(() => {
    const zeros = () => sortedYears.map(() => 0);

    // (2) Operating Cash Flow = Income + Expense (excludes Transfers). Computed via
    // resolveCashValue so it matches the Income / Expense rows shown in the section above.
    const operating = sortedYears.map((y, yi) => {
      if (yi === 0) return null; // LastActualYear has no prior year to bridge from
      const inc = Number(resolveCashValue({ label: "Income", level: 1 }, y)) || 0;
      const exp = Number(resolveCashValue({ label: "Expense", level: 1 }, y)) || 0;
      return inc + exp;
    });

    // (1) Total Change in Net Assets = NA(year) − NA(year-1)
    const totalChange = sortedYears.map((_, yi) =>
      yi === 0 ? null : (netAssetsByYear?.[yi] || 0) - (netAssetsByYear?.[yi - 1] || 0)
    );

    // Roll the per-module transfer rows up to their level-2 balance-sheet line.
    const transfersByLine = new Map();
    for (const detail of (transferDetailRows || [])) {
      const line = balanceAccountMap?.get(detail.module)?.level2 || detail.module;
      if (bankAccountLabels?.has(line)) continue; // bank side is captured by Operating CF
      const arr = transfersByLine.get(line) || zeros();
      (detail.values || []).forEach((v, yi) => { arr[yi] += Number(v) || 0; });
      transfersByLine.set(line, arr);
    }

    // (3) Per-line Unrealized G/L = Δ(signed balance) + line transfers, over every
    // non-bank level-2 line (assets and liabilities).
    const lineRows = [];
    for (const row of (balanceAccounts || [])) {
      if (row.level !== 2) continue;
      const label = row.label;
      if (bankAccountLabels?.has(label)) continue;
      const mapping = balanceAccountMap?.get(label);
      const sign = mapping?.level1 === "Liabilities" ? -1 : 1;
      const balances = balanceDisplayValues?.get(label);
      if (!balances) continue;
      const lineTransfers = transfersByLine.get(label) || zeros();
      const values = sortedYears.map((_, yi) => {
        if (yi === 0) return null;
        const cur = Number(balances[yi]) || 0;
        const prev = Number(balances[yi - 1]) || 0;
        return sign * (cur - prev) + (lineTransfers[yi] || 0);
      });
      if (values.some((v) => v != null && Math.abs(v) > 0.5)) {
        lineRows.push({ label, values });
      }
    }

    // Unrealized total is authoritative (derived from the net-asset change) so the
    // headline always reconciles. The per-line rows explain it; "Other" absorbs any gap.
    const unrealTotal = sortedYears.map((_, yi) =>
      yi === 0 ? null : (totalChange[yi] || 0) - (operating[yi] || 0)
    );
    const residual = sortedYears.map((_, yi) => {
      if (yi === 0) return null;
      const lineSum = lineRows.reduce((s, r) => s + (r.values[yi] || 0), 0);
      return (unrealTotal[yi] || 0) - lineSum;
    });

    return { operating, totalChange, unrealTotal, lineRows, residual };
  }, [sortedYears, resolveCashValue, transferDetailRows, netAssetsByYear, balanceDisplayValues, balanceAccountMap, bankAccountLabels, balanceAccounts]);

  // Renders one data row (label cell + per-year value cells).
  const dataRow = (key, label, values, opts = {}) => {
    const { bold = false, indent = "1.5rem", color, onClick, prefix, topBorder = false, muted = false } = opts;
    return (
      <tr key={key}>
        <td style={{ ...selectCellBaseStyle, top: undefined, borderTop: topBorder ? "2px solid var(--border)" : undefined }} />
        <td
          style={{
            ...accountCellBaseStyle,
            padding: `0.3rem 0.75rem 0.3rem ${indent}`,
            fontWeight: bold ? 700 : muted ? 400 : 500,
            color: color || (muted ? "var(--muted)" : undefined),
            borderTop: topBorder ? "2px solid var(--border)" : undefined,
            cursor: onClick ? "pointer" : undefined,
          }}
          onClick={onClick}
        >
          {prefix ? `${prefix} ` : ""}{label}
        </td>
        {sortedYears.map((year, yi) => {
          const val = values[yi];
          const num = Number(val);
          const show = val != null && Math.abs(num) > 0.5;
          return (
            <td
              key={`${key}-${year}`}
              className="trans-budget-table__value--numeric"
              style={{
                color: show ? (num < -0.5 ? "var(--danger)" : num > 0.5 ? "var(--success, #5B9E9E)" : undefined) : undefined,
                fontWeight: bold ? 700 : undefined,
                borderTop: topBorder ? "2px solid var(--border)" : undefined,
              }}
            >
              {show ? formatAmount(num) : "—"}
            </td>
          );
        })}
      </tr>
    );
  };

  const hasResidual = bridge.residual.some((v) => v != null && Math.abs(v) > 0.5);

  return (
    <>
      {/* Section header row */}
      <tr>
        <td style={{ ...selectCellBaseStyle, top: undefined, borderTop: "2px solid var(--primary, #567856)" }} />
        <td
          style={{ ...accountCellBaseStyle, borderTop: "2px solid var(--primary, #567856)", padding: "0.4rem 0.75rem", cursor: "pointer" }}
          onClick={() => setCollapsed((p) => !p)}
        >
          <span style={{ color: "var(--primary, #567856)", fontWeight: 600, fontSize: "0.85rem" }}>
            {collapsed ? "+" : "-"} Change in Net Assets
          </span>
        </td>
        {sortedYears.map((y) => (
          <td key={`bridge-hdr-${y}`} style={{ borderTop: "2px solid var(--primary, #567856)" }} />
        ))}
      </tr>
      {!collapsed && (
        <>
          {/* Year header row — mirrors the table's top header so years stay visible. */}
          <tr>
            <SelectSpacer style={selectCellBaseStyle} />
            <td style={{ ...accountCellBaseStyle, fontWeight: 600 }}>Account</td>
            {sortedYears.map((year) => {
              const isBaseYear = baseYears?.has(Number(year));
              const isLastActualYear = lastActualYears?.has(Number(year));
              const isPreForecast = isBaseYear || isLastActualYear;
              const columnLabel = isBaseYear ? "(Budget)" : isLastActualYear ? "(Actual)" : null;
              return (
                <td
                  key={`bridge-yr-${year}`}
                  className="trans-budget-table__value"
                  style={{
                    minWidth: "120px",
                    fontWeight: 600,
                    ...(isPreForecast && {
                      background: "linear-gradient(180deg, var(--surface-muted) 0%, var(--bg-tertiary) 100%)",
                      borderLeft: "1px solid var(--border-strong)",
                      borderRight: "1px solid var(--border-strong)",
                    }),
                  }}
                >
                  {year}
                  {columnLabel && (
                    <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 500, color: "var(--muted)", marginTop: "0.25rem" }}>
                      {columnLabel}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
          {dataRow("bridge-operating", "Operating Cash Flow", bridge.operating)}
          {dataRow("bridge-unreal", "Unrealized Gains / (Losses)", bridge.unrealTotal, {
            prefix: unrealOpen ? "−" : "+",
            onClick: () => setUnrealOpen((p) => !p),
          })}
          {unrealOpen && bridge.lineRows.map((row) =>
            dataRow(`bridge-unreal-${row.label}`, row.label, row.values, { indent: "2.75rem", muted: true })
          )}
          {unrealOpen && hasResidual &&
            dataRow("bridge-unreal-other", "Other (unattributed)", bridge.residual, { indent: "2.75rem", muted: true })}
          {dataRow("bridge-total", "Total Change in Net Assets", bridge.totalChange, { bold: true, topBorder: true })}
        </>
      )}
    </>
  );
}

/**
 * Cash Flow Summary section: Income + Expense + Transfers (broken out by source) = Net Cash Flow.
 *
 * The four headline rows reuse resolveCashValue so they match the main cash-flow
 * section exactly (including base-year budget / last-actual overlays). The Transfers
 * line is followed by one indented sub-row per source module; those sub-rows sum to
 * the Transfers line, and Income + Expense + Transfers reconciles to Net Cash Flow.
 */
function CashFlowSummaryRows({
  sortedYears,
  resolveCashValue,
  transferDetailRows,
  baseYears,
  lastActualYears,
  selectCellBaseStyle,
  accountCellBaseStyle,
}) {
  const [collapsed, setCollapsed] = useState(false);

  const incomeVals = sortedYears.map((y) => resolveCashValue({ label: "Income", level: 1 }, y));
  const expenseVals = sortedYears.map((y) => resolveCashValue({ label: "Expense", level: 1 }, y));
  const transferVals = sortedYears.map((y) => resolveCashValue({ label: "Transfers", level: 2 }, y));
  const netVals = sortedYears.map((y) => resolveCashValue({ isNet: true }, y));

  const shadeFor = (year) =>
    baseYears?.has(Number(year)) || lastActualYears?.has(Number(year)) ? "var(--surface-muted)" : undefined;

  const valueCells = (values, { bold } = {}) =>
    sortedYears.map((year, yi) => {
      const v = values[yi];
      const num = Number(v);
      return (
        <td
          key={`cfs-${year}`}
          className="trans-budget-table__value--numeric"
          style={{
            color: Number.isFinite(num) && num < 0 ? "var(--danger)" : undefined,
            backgroundColor: shadeFor(year),
            fontWeight: bold ? 700 : undefined,
          }}
        >
          {formatAmount(v)}
        </td>
      );
    });

  const labelCell = (label, { level = 1, bold = false, color } = {}) => (
    <td
      style={{
        ...accountCellBaseStyle,
        padding: "0.3rem 0.75rem",
        paddingLeft: level === 3 ? "2.5rem" : level === 2 ? "1.75rem" : "0.75rem",
        fontWeight: bold ? 700 : level === 1 ? 700 : level === 2 ? 600 : 500,
        color,
      }}
    >
      {label}
    </td>
  );

  return (
    <>
      {/* Cash Flow Summary header row */}
      <tr>
        <td style={{ ...selectCellBaseStyle, top: undefined, borderTop: "2px solid var(--primary, #567856)" }} />
        <td
          style={{ ...accountCellBaseStyle, borderTop: "2px solid var(--primary, #567856)", padding: "0.4rem 0.75rem", cursor: "pointer" }}
          onClick={() => setCollapsed((p) => !p)}
        >
          <span style={{ color: "var(--primary, #567856)", fontWeight: 600, fontSize: "0.85rem" }}>
            {collapsed ? "+" : "-"} Cash Flow Summary
          </span>
        </td>
        {sortedYears.map((y) => (
          <td key={`cfs-hdr-${y}`} style={{ borderTop: "2px solid var(--primary, #567856)" }} />
        ))}
      </tr>

      {!collapsed && (
        <>
          {/* Year header row — mirrors the table's top header so years stay
              visible without scrolling back up. */}
          <tr>
            <SelectSpacer style={selectCellBaseStyle} />
            <td style={{ ...accountCellBaseStyle, fontWeight: 600 }}>Account</td>
            {sortedYears.map((year) => {
              const isBaseYear = baseYears?.has(Number(year));
              const isLastActualYear = lastActualYears?.has(Number(year));
              const isPreForecast = isBaseYear || isLastActualYear;
              const columnLabel = isBaseYear ? "(Budget)" : isLastActualYear ? "(Actual)" : null;
              return (
                <td
                  key={`cfs-yr-${year}`}
                  className="trans-budget-table__value"
                  style={{
                    minWidth: "120px",
                    fontWeight: 600,
                    ...(isPreForecast && {
                      background: "linear-gradient(180deg, var(--surface-muted) 0%, var(--bg-tertiary) 100%)",
                      borderLeft: "1px solid var(--border-strong)",
                      borderRight: "1px solid var(--border-strong)",
                    }),
                  }}
                >
                  {year}
                  {columnLabel && (
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.75rem",
                        fontWeight: 500,
                        color: "var(--muted)",
                        marginTop: "0.25rem",
                      }}
                    >
                      {columnLabel}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
          <tr><SelectSpacer style={selectCellBaseStyle} />{labelCell("Income")}{valueCells(incomeVals)}</tr>
          <tr><SelectSpacer style={selectCellBaseStyle} />{labelCell("Expense")}{valueCells(expenseVals)}</tr>
          <tr><SelectSpacer style={selectCellBaseStyle} />{labelCell("Transfers", { level: 2 })}{valueCells(transferVals)}</tr>
          {transferDetailRows?.map((detail, di) => (
            <tr key={`cfs-tr-${detail.module}-${di}`}>
              <SelectSpacer style={selectCellBaseStyle} />
              {labelCell(detail.module, { level: 3, color: "var(--muted)" })}
              {valueCells(detail.values)}
            </tr>
          ))}
          <tr>
            <SelectSpacer style={selectCellBaseStyle} />
            {labelCell("Net Cash Flow", { bold: true })}
            {valueCells(netVals, { bold: true })}
          </tr>
        </>
      )}
    </>
  );
}

// Sticky leading cell (matches the checkbox column) so summary rows align with the grid.
function SelectSpacer({ style }) {
  return <td style={{ ...style, top: undefined }} />;
}

export default function FCReviewTable({
  sortedYears,
  baseYear,
  baseYears,
  lastActualYears,
  birthYear,
  baseYearBudget,
  baseActualTotalsByYear,
  categoryToLineMap,
  cashAccountMap,
  periodStart,
  tableColSpan,
  yearsLoading,
  accountsLoading,
  balanceLoading,
  entriesLoading,
  baseActualLoading,
  baseBalanceLoading,
  tableError,
  selectedScenario,
  cashAccounts,
  balanceAccounts,
  cashRowsWithNet,
  transferDetailRows,
  getCellValue,
  balanceDisplayValues,
  balanceAccountMap,
  bankAccountLabels,
  totalAssetsByYear,
  totalLiabilitiesByYear,
  netAssetsByYear,
  onNetAssetsDoubleClick,
  onCellDoubleClick,
  onCashTransferClick,
  selectedSeriesIds,
  onToggleSeries,
  onAccountDoubleClick,
  tableWrapperRef,
  tableRef,
  scrollTableByYears,
  zoomLevel,
  onZoomIn,
  onZoomOut,
}) {
  // Resolves the display value for a cash P&L row, including base/actual year overlays
  const resolveCashValue = (row, year) => {
    let value = getCellValue(row, year, true);
    const isBaseYear = baseYears?.has(Number(year));
    const isLastActualYear = lastActualYears?.has(Number(year));

    // LastActualYear P&L from actuals
    if (isLastActualYear && value == null && baseActualTotalsByYear?.size > 0) {
      const yearData = baseActualTotalsByYear.get(Number(year));
      if (yearData) {
        if (row.isNet || row.isCashFlow) {
          value = yearData.net ?? null;
        } else if (row.level === 1) {
          value = yearData.level1.get(row.label) ?? null;
        } else if (row.level === 2 && yearData.leafTotals && categoryToLineMap?.size > 0) {
          let total = 0; let found = false;
          for (const [catName, amt] of yearData.leafTotals.entries()) {
            if (categoryToLineMap.get(catName) === row.label) { total += amt; found = true; }
          }
          if (found) value = total;
        } else if (row.level === 2) {
          value = yearData.level2.get(row.label) ?? null;
        }
      }
    }

    // BaseYear P&L from budget
    const isBaseForBudget = isBaseYear && value == null && baseYearBudget && Object.keys(baseYearBudget).length > 0;
    if (isBaseForBudget) {
      if (row.isCashFlow) {
        let total = 0;
        for (const amt of Object.values(baseYearBudget)) total += amt;
        if (total !== 0) value = total;
      } else if (row.isNet) {
        let plTotal = 0;
        for (const amt of Object.values(baseYearBudget)) plTotal += amt;
        const transfers = getCellValue({ label: "Transfers", level: 2 }, year, true) || 0;
        const netTotal = plTotal + transfers;
        if (netTotal !== 0) value = netTotal;
      } else if (row.level === 2 && baseYearBudget[row.label] != null) {
        value = baseYearBudget[row.label];
      } else if (row.level === 1 && cashAccountMap?.size > 0) {
        let total = 0; let found = false;
        for (const [ln, mp] of cashAccountMap.entries()) {
          if (mp.level1 === row.label && baseYearBudget[ln] != null) { total += baseYearBudget[ln]; found = true; }
        }
        if (found) value = total;
      }
    }
    return value;
  };

  // Resolves the display value for a balance sheet row
  const resolveBalanceValue = (row, year, yearIndex) => {
    const values = row.label === "Assets" ? totalAssetsByYear : balanceDisplayValues.get(row.label);
    return values?.[yearIndex] ?? getCellValue(row, year, false);
  };

  const topScrollRef = useRef(null);
  const [topScrollWidth, setTopScrollWidth] = useState(0);
  const zoomScale = zoomLevel || 1;
  const sectionBorder = "2px solid var(--border-strong)";
  const tableWidth = topScrollWidth || tableRef?.current?.scrollWidth || 0;

  useEffect(() => {
    const topScroller = topScrollRef.current;
    const mainScroller = tableWrapperRef?.current;
    if (!topScroller || !mainScroller) return;

    const syncFromTop = () => {
      if (mainScroller.scrollLeft !== topScroller.scrollLeft) {
        mainScroller.scrollLeft = topScroller.scrollLeft;
      }
    };
    const syncFromMain = () => {
      if (topScroller.scrollLeft !== mainScroller.scrollLeft) {
        topScroller.scrollLeft = mainScroller.scrollLeft;
      }
    };

    topScroller.addEventListener("scroll", syncFromTop);
    mainScroller.addEventListener("scroll", syncFromMain);

    topScroller.scrollLeft = mainScroller.scrollLeft;

    return () => {
      topScroller.removeEventListener("scroll", syncFromTop);
      mainScroller.removeEventListener("scroll", syncFromMain);
    };
  }, [tableWrapperRef, tableRef, sortedYears.length, zoomScale]);

  useLayoutEffect(() => {
    const updateWidth = () => {
      const scrollWidth = tableRef?.current?.scrollWidth || 0;
      // Account for zoom scale in the width calculation
      const width = scrollWidth * zoomScale;
      if (width && width !== topScrollWidth) {
        setTopScrollWidth(width);
      }
    };

    updateWidth();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateWidth)
        : null;
    if (resizeObserver && tableRef?.current) {
      resizeObserver.observe(tableRef.current);
    }

    const handleWindowResize = () => updateWidth();
    window.addEventListener("resize", handleWindowResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [tableRef, sortedYears.length, zoomScale, topScrollWidth]);

  const selectColumnWidth = 44;
  const selectColumnStickyStyle = {
    position: "sticky",
    left: 0,
    zIndex: 11,
    top: 0,
    background:
      "linear-gradient(180deg, var(--surface-muted) 0%, var(--surface) 100%)",
    textAlign: "center",
    width: `${selectColumnWidth}px`,
    minWidth: `${selectColumnWidth}px`,
    boxShadow: "5px 0 0 0 var(--surface)",
    borderRight: `1px solid var(--border)`,
  };

  const accountColumnStickyStyle = {
    position: "sticky",
    left: selectColumnWidth,
    boxShadow: "inset -1px 0 0 var(--border)",
  };

  const accountHeaderStyle = {
    ...accountColumnStickyStyle,
    minWidth: "240px",
    textAlign: "left",
    top: 0,
    zIndex: 3,
    background:
      "linear-gradient(180deg, var(--surface-muted) 0%, var(--surface) 100%)",
  };

  const accountCellBaseStyle = {
    ...accountColumnStickyStyle,
    zIndex: 2,
    background: "var(--surface)",
  };

  const selectCellBaseStyle = {
    ...selectColumnStickyStyle,
    top: undefined,
    background: "var(--surface)",
    zIndex: 10,
    boxShadow: "5px 0 0 0 var(--surface), inset -1px 0 0 var(--border)",
    borderRight: `1px solid var(--border)`,
  };

  const totalColSpan = tableColSpan + 1;

  return (
    <section className="section-table">
      <div className="section-table__content">
        {/* Header Section */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "var(--muted)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Forecast Review
            </p>
            <h3
              style={{
                margin: "0.25rem 0 0",
                color: "var(--ink)",
                fontSize: "1.5rem",
              }}
            >
              {selectedScenario || "Select a scenario"}
            </h3>
          </div>
          {sortedYears.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
              }}
            >
              <div
                style={{
                  padding: "0.5rem 1rem",
                  borderRadius: "8px",
                  background: "var(--surface-muted)",
                  border: "1px solid var(--border)",
                  color: "var(--muted)",
                  fontWeight: 600,
                  fontSize: "0.95rem",
                }}
              >
                {sortedYears[0]} - {sortedYears[sortedYears.length - 1]}
              </div>
              {scrollTableByYears && (
                <FCReviewTableControls
                  scrollTableByYears={scrollTableByYears}
                  zoomLevel={zoomLevel}
                  onZoomIn={onZoomIn}
                  onZoomOut={onZoomOut}
                />
              )}
            </div>
          )}
        </div>

        {/* Top Scrollbar — sticky so it stays visible when scrolling vertically */}
        <div
          className="trans-budget-table-wrapper"
          ref={topScrollRef}
          style={{
            flex: "0 0 auto",
            height: "17px",
            overflowX: "auto",
            overflowY: "hidden",
            position: "sticky",
            top: 0,
            zIndex: 20,
            background: "var(--surface, white)",
            marginBottom: "0.25rem",
          }}
          aria-hidden="true"
        >
          <div
            style={{
              width: tableWidth ? `${tableWidth}px` : "100%",
              height: "100%",
            }}
          />
        </div>
        <div
          className="trans-budget-table-wrapper"
          ref={tableWrapperRef}
          style={{ zoom: zoomScale }}
        >
          <table className="trans-budget-table fc-review-table" ref={tableRef}>
            <thead>
              <tr>
                <th style={selectColumnStickyStyle} aria-label="Selection" />
                <th style={accountHeaderStyle}>Account</th>
                {sortedYears.length ? (
                  sortedYears.map((year) => {
                    const isBaseYear = baseYears?.has(Number(year));
                    const isLastActualYear = lastActualYears?.has(Number(year));
                    const isPreForecast = isBaseYear || isLastActualYear;
                    const columnLabel = isBaseYear ? "(Budget)" : isLastActualYear ? "(Actual)" : null;
                    return (
                      <th
                        key={year}
                        className="trans-budget-table__value"
                        style={{
                          minWidth: "120px",
                          ...(isPreForecast && {
                            background:
                              "linear-gradient(180deg, var(--surface-muted) 0%, var(--bg-tertiary) 100%)",
                            fontWeight: 600,
                            borderLeft: "1px solid var(--border-strong)",
                            borderRight: "1px solid var(--border-strong)",
                          }),
                        }}
                      >
                        {year}
                        {columnLabel && (
                          <span
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              fontWeight: 500,
                              color: "var(--muted)",
                              marginTop: "0.25rem",
                            }}
                          >
                            {columnLabel}
                          </span>
                        )}
                      </th>
                    );
                  })
                ) : (
                  <th>Year</th>
                )}
              </tr>
              {birthYear && (
                <tr>
                  <td style={selectColumnStickyStyle} />
                  <td style={{ ...accountHeaderStyle, fontSize: "0.7rem", color: "var(--muted-light)", fontWeight: 500, padding: "0.15rem 0.5rem" }}>Age</td>
                  {sortedYears.map((year) => (
                    <td key={`age-${year}`} className="trans-budget-table__value" style={{ fontSize: "0.7rem", color: "var(--muted-light)", fontWeight: 500, padding: "0.15rem 0.5rem" }}>
                      {Number(year) - birthYear}
                    </td>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {/* Loading State */}
              {yearsLoading ||
              accountsLoading ||
              balanceLoading ||
              entriesLoading ||
              baseActualLoading ||
              baseBalanceLoading ? (
                <tr>
                  <td
                    colSpan={totalColSpan}
                    style={{ textAlign: "center", padding: "2rem" }}
                  >
                    <div style={{ color: "var(--muted)" }}>
                      Loading forecast data...
                    </div>
                  </td>
                </tr>
              ) : /* Error State */ tableError ? (
                <tr>
                  <td
                    colSpan={totalColSpan}
                    style={{ color: "var(--danger)", padding: "2rem" }}
                  >
                    {tableError}
                  </td>
                </tr>
              ) : /* No Scenario Selected */ !selectedScenario ? (
                <tr>
                  <td
                    colSpan={totalColSpan}
                    style={{ textAlign: "center", padding: "2rem" }}
                  >
                    <div style={{ color: "var(--muted)" }}>
                      Select a scenario to view the forecast
                    </div>
                  </td>
                </tr>
              ) : /* No Years Available */ !sortedYears.length ? (
                <tr>
                  <td
                    colSpan={totalColSpan}
                    style={{ textAlign: "center", padding: "2rem" }}
                  >
                    <div style={{ color: "var(--muted)" }}>
                      No forecast years available for this scenario
                    </div>
                  </td>
                </tr>
              ) : /* No COA Data */ !cashAccounts.length &&
                !balanceAccounts.length ? (
                <tr>
                  <td
                    colSpan={totalColSpan}
                    style={{ textAlign: "center", padding: "2rem" }}
                  >
                    <div style={{ color: "var(--muted)" }}>
                      Chart of accounts not available
                    </div>
                  </td>
                </tr>
              ) : (
                /* Forecast Data */
                <>
                  {/* ========== CASH FLOW SECTION ========== */}
                  {cashRowsWithNet.map((row, index) => {
                    const isTransfers = row.label === "Transfers";
                    const isCashFlow = row.isCashFlow;
                    const isFirstCashRow = index === 0;
                    const isLastCashRow =
                      index === cashRowsWithNet.length - 1;
                    const rowId = `cash-${row.label}-${index}`;
                    const rowValues = sortedYears.map((year) =>
                      resolveCashValue(row, year)
                    );
                    const cashSectionBorders = {
                      borderLeft: sectionBorder,
                      borderRight: sectionBorder,
                      ...(isFirstCashRow ? { borderTop: sectionBorder } : {}),
                      ...(isLastCashRow ? { borderBottom: sectionBorder } : {}),
                    };
                    const selectCellCashBorders = {
                      ...(isFirstCashRow ? { borderTop: sectionBorder } : {}),
                      ...(isLastCashRow ? { borderBottom: sectionBorder } : {}),
                    };
                    return (
                      <tr key={`cash-${row.label}-${index}`}>
                        <td style={{...selectCellBaseStyle, ...selectCellCashBorders}}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.label}`}
                            checked={selectedSeriesIds?.has(rowId) || false}
                            onChange={() =>
                              onToggleSeries?.({
                                id: rowId,
                                label: row.label,
                                values: rowValues,
                              })
                            }
                          />
                        </td>
                        <td
                          style={{
                            ...accountCellBaseStyle,
                            fontWeight: row.isNet
                              ? 700
                              : row.level === 1
                              ? 700
                              : row.level === 2
                              ? 600
                              : 500,
                            paddingLeft:
                              row.level === 3
                                ? "2.5rem"
                                : row.level === 2
                                ? "1.75rem"
                                : "0.75rem",
                            color:
                              row.isNet || isCashFlow
                                ? "var(--ink)"
                                : undefined,
                            cursor: "pointer",
                            ...cashSectionBorders,
                          }}
                          onDoubleClick={() =>
                            onAccountDoubleClick?.({
                              id: rowId,
                              label: row.isNet ? "Net Cash Flow" : isCashFlow ? "Cash Flow" : row.label,
                              values: rowValues,
                            })
                          }
                        >
                          {row.isNet
                            ? "Net Cash Flow"
                            : isCashFlow
                            ? "Cash Flow"
                            : row.label}
                        </td>
                        {sortedYears.map((year) => {
                          const value = resolveCashValue(row, year);
                          const isBaseYear = baseYears?.has(Number(year));
                          const isLastActualYear = lastActualYears?.has(Number(year));
                          const canDoubleClick = isTransfers && !isBaseYear && !isLastActualYear;
                          return (
                            <td
                              key={`${row.label}-${year}`}
                              className="trans-budget-table__value--numeric"
                              style={{
                                color:
                                  Number(value) < 0
                                    ? "var(--danger)"
                                    : undefined,
                                backgroundColor: (isBaseYear || isLastActualYear)
                                  ? "var(--surface-muted)"
                                  : undefined,
                                fontWeight:
                                  row.isNet || isCashFlow ? 600 : undefined,
                                cursor: (isBaseYear || isLastActualYear)
                                  ? "default"
                                  : canDoubleClick
                                  ? "pointer"
                                  : undefined,
                                textDecoration: canDoubleClick
                                  ? "underline dotted"
                                  : undefined,
                                boxShadow: isBaseYear
                                  ? "inset 1px 0 0 var(--border-strong), inset -1px 0 0 var(--border-strong)"
                                  : undefined,
                                ...cashSectionBorders,
                              }}
                              onDoubleClick={() =>
                                !isBaseYear &&
                                onCellDoubleClick?.(row, year, true)
                              }
                            >
                              {formatAmount(value)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}

                  {/* ========== SECTION DIVIDER ========== */}
                  {balanceAccounts.length > 0 && cashAccounts.length > 0 && (
                    <tr>
                      <td
                        style={{
                          borderTop: "2px solid var(--border)",
                          padding: 0,
                          height: "1rem",
                          backgroundColor: "var(--surface)",
                        }}
                      />
                      <td
                        style={{
                          borderTop: "2px solid var(--border)",
                          padding: 0,
                          height: "1rem",
                        }}
                      />
                      {sortedYears.map((year) => {
                        const isPreForecast = baseYears?.has(Number(year)) || lastActualYears?.has(Number(year));
                        return (
                          <td
                            key={`divider-${year}`}
                            style={{
                              borderTop: "2px solid var(--border)",
                              padding: 0,
                              height: "1rem",
                              backgroundColor: isPreForecast
                                ? "var(--surface-muted)"
                                : undefined,
                              borderLeft: isPreForecast
                                ? "1px solid var(--border-strong)"
                                : undefined,
                              borderRight: isPreForecast
                                ? "1px solid var(--border-strong)"
                                : undefined,
                            }}
                          />
                        );
                      })}
                    </tr>
                  )}

                  {/* ========== NET ASSETS ROW ========== */}
                  {balanceAccounts.length > 0 && netAssetsByYear && (
                    <tr>
                      <td style={{ ...selectCellBaseStyle, borderTop: "2px solid var(--border)" }}>
                        <input
                          type="checkbox"
                          aria-label="Select Net Assets"
                          checked={selectedSeriesIds?.has("net-assets") || false}
                          onChange={() =>
                            onToggleSeries?.({
                              id: "net-assets",
                              label: "Net Assets",
                              values: netAssetsByYear,
                            })
                          }
                        />
                      </td>
                      <td
                        style={{
                          ...accountCellBaseStyle,
                          fontWeight: 700,
                          padding: "0.5rem 0.75rem",
                          borderTop: "2px solid var(--border)",
                          borderBottom: "2px solid var(--border)",
                          cursor: "pointer",
                        }}
                        onDoubleClick={() => onNetAssetsDoubleClick?.()}
                      >
                        Net Assets
                      </td>
                      {sortedYears.map((year) => {
                        const yearIndex = sortedYears.indexOf(year);
                        const displayValue = netAssetsByYear[yearIndex] ?? 0;
                        const isPreForecast = baseYears?.has(Number(year)) || lastActualYears?.has(Number(year));
                        return (
                          <td
                            key={`net-assets-${year}`}
                            className="trans-budget-table__value--numeric"
                            style={{
                              fontWeight: 700,
                              color: Number(displayValue) < 0 ? "var(--danger)" : undefined,
                              backgroundColor: isPreForecast ? "var(--surface-muted)" : undefined,
                              borderTop: "2px solid var(--border)",
                              borderBottom: "2px solid var(--border)",
                              cursor: "pointer",
                              boxShadow: isPreForecast ? "inset 1px 0 0 var(--border-strong), inset -1px 0 0 var(--border-strong)" : undefined,
                            }}
                            onDoubleClick={() => onNetAssetsDoubleClick?.()}
                          >
                            {formatAmount(displayValue)}
                          </td>
                        );
                      })}
                    </tr>
                  )}

                  {/* ========== BALANCE SHEET — Year header row ========== */}
                  {balanceAccounts.length > 0 && (
                    <tr>
                      <td style={{ ...selectCellBaseStyle, background: "var(--surface-muted)", borderBottom: "2px solid var(--border)" }} />
                      <td style={{ ...accountCellBaseStyle, background: "var(--surface-muted)", fontWeight: 700, fontSize: "0.72rem", color: "var(--muted)", letterSpacing: "0.04em", textTransform: "uppercase", padding: "0.35rem 0.5rem", borderBottom: "2px solid var(--border)" }}>Balance Sheet</td>
                      {sortedYears.map((year) => {
                        const isPreForecast = baseYears?.has(Number(year)) || lastActualYears?.has(Number(year));
                        return (
                          <td key={`bs-yr-${year}`} style={{
                            textAlign: "right", fontWeight: 700, fontSize: "0.78rem", padding: "0.35rem 0.5rem",
                            color: "var(--muted)", background: "var(--surface-muted)", borderBottom: "2px solid var(--border)",
                            ...(isPreForecast && { background: "var(--surface-muted)", borderLeft: "1px solid var(--border-strong)", borderRight: "1px solid var(--border-strong)" }),
                          }}>
                            {year}
                          </td>
                        );
                      })}
                    </tr>
                  )}

                  {/* ========== BALANCE SHEET SECTION ========== */}
                  {balanceAccounts.map((row, index) => {
                    const isBankAccounts = row.label === "Bank Accounts";
                    const isFirstBalanceRow = index === 0;
                    const isLastBalanceRow =
                      index === balanceAccounts.length - 1;
                    const rowId = `balance-${row.label}-${index}`;
                    const rowValues = sortedYears.map((year, yearIndex) =>
                      resolveBalanceValue(row, year, yearIndex)
                    );
                    const balanceSectionBorders = {
                      borderLeft: sectionBorder,
                      borderRight: sectionBorder,
                      ...(isFirstBalanceRow ? { borderTop: sectionBorder } : {}),
                      ...(isLastBalanceRow
                        ? { borderBottom: sectionBorder }
                        : {}),
                    };
                    const selectCellBalanceBorders = {
                      ...(isFirstBalanceRow ? { borderTop: sectionBorder } : {}),
                      ...(isLastBalanceRow
                        ? { borderBottom: sectionBorder }
                        : {}),
                    };
                    return (
                      <tr
                        key={`balance-${row.label}-${index}`}
                        style={{
                          ...(index === 0 && cashAccounts.length === 0
                            ? { borderTop: "2px solid var(--border)" }
                            : undefined),
                        }}
                      >
                        <td style={{...selectCellBaseStyle, ...selectCellBalanceBorders}}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.label}`}
                            checked={selectedSeriesIds?.has(rowId) || false}
                            onChange={() =>
                              onToggleSeries?.({
                                id: rowId,
                                label: row.label,
                                values: rowValues,
                              })
                            }
                          />
                        </td>
                        <td
                          style={{
                            ...accountCellBaseStyle,
                            fontWeight:
                              row.level === 1
                                ? 700
                                : row.level === 2
                                ? 600
                                : 500,
                            paddingLeft:
                              row.level === 3
                                ? "2.5rem"
                                : row.level === 2
                                ? "1.75rem"
                                : "0.75rem",
                            cursor: "pointer",
                            ...balanceSectionBorders,
                          }}
                          onDoubleClick={() =>
                            onAccountDoubleClick?.({
                              id: rowId,
                              label: row.label,
                              values: rowValues,
                            })
                          }
                        >
                          {row.label}
                        </td>
                        {sortedYears.map((year, yearIndex) => {
                          const values =
                            row.label === "Assets"
                              ? totalAssetsByYear
                              : balanceDisplayValues.get(row.label);
                          const displayValue =
                            values?.[yearIndex] ??
                            getCellValue(row, year, false);
                          const isBaseYear = baseYears?.has(Number(year));
                          const isLastActualYr = lastActualYears?.has(Number(year));
                          const isPreForecast = isBaseYear || isLastActualYr;
                          const canDoubleClick = isBankAccounts && !isPreForecast;
                          return (
                            <td
                              key={`${row.label}-${year}`}
                              className="trans-budget-table__value--numeric"
                              style={{
                                color:
                                  Number(displayValue) < 0
                                    ? "var(--danger)"
                                    : undefined,
                                backgroundColor: isPreForecast
                                  ? "var(--surface-muted)"
                                  : undefined,
                                cursor: isPreForecast
                                  ? "default"
                                  : canDoubleClick
                                  ? "pointer"
                                  : undefined,
                                textDecoration: canDoubleClick
                                  ? "underline dotted"
                                  : undefined,
                                boxShadow: isPreForecast
                                  ? "inset 1px 0 0 var(--border-strong), inset -1px 0 0 var(--border-strong)"
                                  : undefined,
                                ...balanceSectionBorders,
                              }}
                              onDoubleClick={() => {
                                if (isBankAccounts) {
                                  onCashTransferClick?.(row, year);
                                } else {
                                  onCellDoubleClick?.(row, year, false);
                                }
                              }}
                            >
                              {formatAmount(displayValue)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </>
              )}
              {/* Cash Flow Summary section (above the equity bridge) */}
              {!tableError && sortedYears.length > 0 && cashRowsWithNet?.length > 0 && (
                <CashFlowSummaryRows
                  sortedYears={sortedYears}
                  resolveCashValue={resolveCashValue}
                  transferDetailRows={transferDetailRows}
                  baseYears={baseYears}
                  lastActualYears={lastActualYears}
                  selectCellBaseStyle={selectCellBaseStyle}
                  accountCellBaseStyle={accountCellBaseStyle}
                />
              )}
              {/* Equity Bridge rows inside the same table */}
              {!tableError && sortedYears.length > 0 && cashRowsWithNet?.length > 0 && (
                <EquityBridgeRows
                  sortedYears={sortedYears}
                  resolveCashValue={resolveCashValue}
                  transferDetailRows={transferDetailRows}
                  netAssetsByYear={netAssetsByYear}
                  balanceDisplayValues={balanceDisplayValues}
                  balanceAccountMap={balanceAccountMap}
                  bankAccountLabels={bankAccountLabels}
                  balanceAccounts={balanceAccounts}
                  baseYears={baseYears}
                  lastActualYears={lastActualYears}
                  selectCellBaseStyle={selectCellBaseStyle}
                  accountCellBaseStyle={accountCellBaseStyle}
                />
              )}
            </tbody>
          </table>

        </div>
      </div>
    </section>
  );
}
