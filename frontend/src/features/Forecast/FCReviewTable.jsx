import { formatAmount } from "./utils/fcReviewUtils.js";
import FCReviewTableControls from "./FCReviewTableControls.jsx";

export default function FCReviewTable({
  sortedYears,
  baseYear,
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
  tableWrapperRef,
  tableRef,
  scrollTableByYears,
  zoomLevel,
  onZoomIn,
  onZoomOut,
}) {
  const accountColumnStickyStyle = {
    position: "sticky",
    left: 0,
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
        <div className="trans-budget-table-wrapper" ref={tableWrapperRef}>
          <table
            className="trans-budget-table fc-review-table"
            ref={tableRef}
            style={{
              transform: `scale(${zoomLevel || 1})`,
              transformOrigin: "top left",
            }}
          >
            <thead>
              <tr>
                <th style={accountHeaderStyle}>Account</th>
                {sortedYears.length ? (
                  sortedYears.map((year) => (
                    <th
                      key={year}
                      className="trans-budget-table__value"
                      style={{ minWidth: "120px" }}
                    >
                      {year}
                      {year === baseYear && (
                        <span
                          style={{
                            display: "block",
                            fontSize: "0.75rem",
                            fontWeight: 500,
                            color: "var(--muted)",
                            marginTop: "0.25rem",
                          }}
                        >
                          (Actual)
                        </span>
                      )}
                    </th>
                  ))
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
                    colSpan={tableColSpan}
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
                    colSpan={tableColSpan}
                    style={{ color: "var(--danger)", padding: "2rem" }}
                  >
                    {tableError}
                  </td>
                </tr>
              ) : /* No Scenario Selected */ !selectedScenario ? (
                <tr>
                  <td
                    colSpan={tableColSpan}
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
                    colSpan={tableColSpan}
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
                    colSpan={tableColSpan}
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
                    return (
                      <tr
                        key={`cash-${row.label}-${index}`}
                        style={
                          isTransfers
                            ? { outline: "2px solid var(--primary)" }
                            : undefined
                        }
                      >
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
                            color: row.isNet ? "var(--ink)" : undefined,
                            backgroundColor: row.isNet
                              ? "var(--surface-muted)"
                              : undefined,
                          }}
                        >
                          {row.isNet
                            ? "Net Cash Flow (Income + Expense)"
                            : row.label}
                        </td>
                      {sortedYears.map((year) => {
                        const value = getCellValue(row, year, true);
                        return (
                          <td
                            key={`${row.label}-${year}`}
                            className="trans-budget-table__value--numeric"
                            style={{
                              color:
                                Number(value) < 0 ? "var(--danger)" : undefined,
                              backgroundColor: row.isNet
                                ? "var(--surface-muted)"
                                : undefined,
                              fontWeight: row.isNet ? 600 : undefined,
                            }}
                            onDoubleClick={() =>
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
                        colSpan={tableColSpan}
                        style={{
                          borderTop: "2px solid var(--border)",
                          padding: 0,
                          height: "1rem",
                        }}
                      />
                    </tr>
                  )}

                  {/* ========== BALANCE SHEET SECTION ========== */}
                  {balanceAccounts.map((row, index) => {
                    const isBankAccounts = row.label === "Bank Accounts";
                    return (
                      <tr
                        key={`balance-${row.label}-${index}`}
                        style={{
                          ...(index === 0 && cashAccounts.length === 0
                            ? { borderTop: "2px solid var(--border)" }
                            : undefined),
                          ...(isBankAccounts
                            ? { outline: "2px solid var(--danger)" }
                            : undefined),
                        }}
                      >
                        <td
                          style={{
                            ...accountCellBaseStyle,
                            fontWeight:
                              row.level === 1 ? 700 : row.level === 2 ? 600 : 500,
                            paddingLeft:
                              row.level === 3
                                ? "2.5rem"
                                : row.level === 2
                                ? "1.75rem"
                                : "0.75rem",
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
                            values?.[yearIndex] ?? getCellValue(row, year, false);
                          return (
                            <td
                              key={`${row.label}-${year}`}
                              className="trans-budget-table__value--numeric"
                              style={{
                                color:
                                  Number(displayValue) < 0
                                    ? "var(--danger)"
                                    : undefined,
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
