import { formatAmount } from "./utils/fcReviewUtils.js";
import FCReviewTableControls from "./FCReviewTableControls.jsx";

export default function FCReviewTable({
  sortedYears,
  baseYear,
  baseYears,
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
  const zoomScale = zoomLevel || 1;
  const sectionBorder = "2px solid var(--border-strong)";

  const selectColumnWidth = 44;
  const selectColumnStickyStyle = {
    position: "sticky",
    left: 0,
    zIndex: 4,
    top: 0,
    background:
      "linear-gradient(180deg, var(--surface-muted) 0%, var(--surface) 100%)",
    textAlign: "center",
    width: `${selectColumnWidth}px`,
    minWidth: `${selectColumnWidth}px`,
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
    zIndex: 2,
    boxShadow: "inset -1px 0 0 var(--border)",
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

        {/* Forecast Table */}
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
                    return (
                      <tr key={`cash-${row.label}-${index}`}>
                        <td style={selectCellBaseStyle}>
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
                            backgroundColor:
                              row.isNet || isCashFlow
                                ? "var(--surface-muted)"
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
                          const value = getCellValue(row, year, true);
                          const isBaseYear = baseYears?.has(Number(year));
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
                                backgroundColor:
                                  row.isNet || isCashFlow
                                    ? "var(--surface-muted)"
                                    : isBaseYear
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
                    return (
                      <tr
                        key={`balance-${row.label}-${index}`}
                        style={{
                          ...(index === 0 && cashAccounts.length === 0
                            ? { borderTop: "2px solid var(--border)" }
                            : undefined),
                        }}
                      >
                        <td style={selectCellBaseStyle}>
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
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
