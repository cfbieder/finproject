import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatAmount } from "./utils/fcReviewUtils.js";
import FCReviewTableControls from "./FCReviewTableControls.jsx";

function EquityBridgeRows({ sortedYears, cashRowsWithNet, getCellValue, totalAssetsByYear, selectCellBaseStyle, accountCellBaseStyle }) {
  const [collapsed, setCollapsed] = useState(false);

  const bridge = useMemo(() => {
    const cashFlow = []; // Net Cash Flow values
    const tax = [];
    const operating = []; // Cash Flow excl tax
    const netWorthChange = [];

    for (let yi = 0; yi < sortedYears.length; yi++) {
      let cashFlowVal = 0;
      let taxTotal = 0;

      // Find Cash Flow and Tax from P&L rows
      for (const row of (cashRowsWithNet || [])) {
        const label = row.label || "";
        const val = Number(getCellValue(row, sortedYears[yi], true)) || 0;
        if (row.isNet || label === "Net Cash Flow") {
          cashFlowVal = val;
        } else if (label.toLowerCase().includes("tax")) {
          taxTotal += val;
        }
      }
      cashFlow.push(cashFlowVal);
      tax.push(taxTotal);
      operating.push(cashFlowVal - taxTotal); // Operating = Cash Flow - Tax

      const nw = totalAssetsByYear?.[yi] || 0;
      const prevNw = yi > 0 ? (totalAssetsByYear?.[yi - 1] || 0) : nw;
      netWorthChange.push(yi > 0 ? nw - prevNw : 0);
    }

    const capitalGains = sortedYears.map((_, yi) =>
      netWorthChange[yi] - cashFlow[yi]
    );

    return { operating, tax, capitalGains, netWorthChange };
  }, [sortedYears, cashRowsWithNet, getCellValue, totalAssetsByYear]);

  const rows = [
    { label: "Operating (excl Tax)", values: bridge.operating },
    { label: "Tax", values: bridge.tax },
    { label: "Capital & Unrealized", values: bridge.capitalGains },
    { label: "Total Change in Net Worth", values: bridge.netWorthChange, bold: true },
  ];

  return (
    <>
      {/* Bridge header row */}
      <tr>
        <td style={{ ...selectCellBaseStyle, top: undefined, borderTop: "2px solid var(--primary, #1e40af)" }} />
        <td
          style={{ ...accountCellBaseStyle, borderTop: "2px solid var(--primary, #1e40af)", padding: "0.4rem 0.75rem", cursor: "pointer" }}
          onClick={() => setCollapsed((p) => !p)}
        >
          <span style={{ color: "var(--primary, #1e40af)", fontWeight: 600, fontSize: "0.85rem" }}>
            {collapsed ? "+" : "-"} Change in Net Worth
          </span>
        </td>
        {sortedYears.map((y) => (
          <td key={`bridge-hdr-${y}`} style={{ borderTop: "2px solid var(--primary, #1e40af)" }} />
        ))}
      </tr>
      {/* Bridge data rows */}
      {!collapsed && rows.map((row) => (
        <tr key={`bridge-${row.label}`}>
          <td style={{ ...selectCellBaseStyle, top: undefined }} />
          <td style={{
            ...accountCellBaseStyle, padding: "0.3rem 0.75rem 0.3rem 1.5rem",
            fontWeight: row.bold ? 700 : 400,
            borderTop: row.bold ? "2px solid #e2e8f0" : undefined,
          }}>
            {row.label}
          </td>
          {sortedYears.map((year, yi) => {
            const val = row.values[yi] || 0;
            return (
              <td
                key={`bridge-${row.label}-${year}`}
                className="trans-budget-table__value--numeric"
                style={{
                  color: val < -0.5 ? "var(--danger)" : val > 0.5 ? "var(--success, #16a34a)" : undefined,
                  fontWeight: row.bold ? 700 : 400,
                  borderTop: row.bold ? "2px solid #e2e8f0" : undefined,
                }}
              >
                {Math.abs(val) > 0.5 ? formatAmount(val) : "—"}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

export default function FCReviewTable({
  sortedYears,
  baseYear,
  baseYears,
  birthYear,
  baseYearBudget,
  cashAccountMap,
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
  getCellValue,
  balanceDisplayValues,
  totalAssetsByYear,
  onCellDoubleClick,
  onCashTransferClick,
  selectedSeriesIds,
  onToggleSeries,
  tableWrapperRef,
  tableRef,
  scrollTableByYears,
  zoomLevel,
  onZoomIn,
  onZoomOut,
}) {
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

        {/* Top Scrollbar */}
        <div
          className="trans-budget-table-wrapper"
          ref={topScrollRef}
          style={{
            flex: "0 0 auto",
            height: "17px",
            overflowX: "auto",
            overflowY: "hidden",
            marginBottom: "0.5rem",
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
                    return (
                      <th
                        key={year}
                        className="trans-budget-table__value"
                        style={{
                          minWidth: "120px",
                          ...(isBaseYear && {
                            background:
                              "linear-gradient(180deg, #f8f9fa 0%, #e9ecef 100%)",
                            fontWeight: 600,
                            borderLeft: "1px solid #cbd5e0",
                            borderRight: "1px solid #cbd5e0",
                          }),
                        }}
                      >
                        {year}
                        {isBaseYear && (
                          <span
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              fontWeight: 500,
                              color: "#718096",
                              marginTop: "0.25rem",
                            }}
                          >
                            (Actual)
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
                  <td style={{ ...accountHeaderStyle, fontSize: "0.7rem", color: "#94a3b8", fontWeight: 500, padding: "0.15rem 0.5rem" }}>Age</td>
                  {sortedYears.map((year) => (
                    <td key={`age-${year}`} className="trans-budget-table__value" style={{ fontSize: "0.7rem", color: "#94a3b8", fontWeight: 500, padding: "0.15rem 0.5rem" }}>
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
                      getCellValue(row, year, true)
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
                            ...cashSectionBorders,
                          }}
                        >
                          {row.isNet
                            ? "Net Cash Flow"
                            : isCashFlow
                            ? "Cash Flow"
                            : row.label}
                        </td>
                        {sortedYears.map((year) => {
                          let value = getCellValue(row, year, true);
                          const isBaseYear = baseYears?.has(Number(year));
                          // For base year P&L only (first year in table), show base values
                          const isBaseColumn = Number(year) === Number(sortedYears[0]);
                          const isBaseForBudget = isBaseColumn && baseYearBudget && Object.keys(baseYearBudget).length > 0;
                          if (isBaseForBudget) {
                            if (row.level === 2 && !row.isCashFlow && !row.isNet && baseYearBudget[row.label] != null) {
                              value = baseYearBudget[row.label];
                            } else if (row.level === 1 && cashAccountMap?.size > 0) {
                              let total = 0; let found = false;
                              for (const [ln, mp] of cashAccountMap.entries()) {
                                if (mp.level1 === row.label && baseYearBudget[ln] != null) { total += baseYearBudget[ln]; found = true; }
                              }
                              if (found) value = total;
                            } else if (row.isNet || row.isCashFlow) {
                              let total = 0;
                              for (const amt of Object.values(baseYearBudget)) total += amt;
                              if (total !== 0) value = total;
                            }
                          }
                          const canDoubleClick = isTransfers && !isBaseYear;
                          return (
                            <td
                              key={`${row.label}-${year}`}
                              className="trans-budget-table__value--numeric"
                              style={{
                                color:
                                  Number(value) < 0
                                    ? "var(--danger)"
                                    : undefined,
                                backgroundColor: isBaseYear
                                  ? "#fafafa"
                                  : undefined,
                                fontWeight:
                                  row.isNet || isCashFlow ? 600 : undefined,
                                cursor: isBaseYear
                                  ? "default"
                                  : canDoubleClick
                                  ? "pointer"
                                  : undefined,
                                textDecoration: canDoubleClick
                                  ? "underline dotted"
                                  : undefined,
                                boxShadow: isBaseYear
                                  ? "inset 1px 0 0 #cbd5e0, inset -1px 0 0 #cbd5e0"
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
                        const isBaseYear = baseYears?.has(Number(year));
                        return (
                          <td
                            key={`divider-${year}`}
                            style={{
                              borderTop: "2px solid var(--border)",
                              padding: 0,
                              height: "1rem",
                              backgroundColor: isBaseYear
                                ? "#fafafa"
                                : undefined,
                              borderLeft: isBaseYear
                                ? "1px solid #cbd5e0"
                                : undefined,
                              borderRight: isBaseYear
                                ? "1px solid #cbd5e0"
                                : undefined,
                            }}
                          />
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
                    const rowValues = sortedYears.map((year, yearIndex) => {
                      const values =
                        row.label === "Assets"
                          ? totalAssetsByYear
                          : balanceDisplayValues.get(row.label);
                      const displayValue =
                        values?.[yearIndex] ??
                        getCellValue(row, year, false);
                      return displayValue;
                    });
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
                            ...balanceSectionBorders,
                          }}
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
                          const canDoubleClick = isBankAccounts && !isBaseYear;
                          return (
                            <td
                              key={`${row.label}-${year}`}
                              className="trans-budget-table__value--numeric"
                              style={{
                                color:
                                  Number(displayValue) < 0
                                    ? "var(--danger)"
                                    : undefined,
                                backgroundColor: isBaseYear
                                  ? "#fafafa"
                                  : undefined,
                                cursor: isBaseYear
                                  ? "default"
                                  : canDoubleClick
                                  ? "pointer"
                                  : undefined,
                                textDecoration: canDoubleClick
                                  ? "underline dotted"
                                  : undefined,
                                boxShadow: isBaseYear
                                  ? "inset 1px 0 0 #cbd5e0, inset -1px 0 0 #cbd5e0"
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
              {/* Equity Bridge rows inside the same table */}
              {!tableError && sortedYears.length > 0 && cashRowsWithNet?.length > 0 && (
                <EquityBridgeRows
                  sortedYears={sortedYears}
                  cashRowsWithNet={cashRowsWithNet}
                  getCellValue={getCellValue}
                  totalAssetsByYear={totalAssetsByYear}
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
