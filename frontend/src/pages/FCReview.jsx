/**
 * Forecast Review Page
 *
 * This component displays a comprehensive financial forecast review, showing both
 * cash flow projections and balance sheet forecasts across multiple years.
 *
 * Features:
 * - Multi-year forecast display (cash flow + balance sheet)
 * - Scenario selection and comparison
 * - Base year actuals vs forecast comparison
 * - Hierarchical account structure (Level 1, 2, 3)
 * - Real-time data loading with error handling
 * - Responsive table layout
 *
 * Data Sources:
 * - Forecast scenarios and entries from API
 * - Chart of Accounts (Cash Flow and Balance Sheet)
 * - Base year actuals from P&L and Balance Sheet reports
 *
 * @module FCReview
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import FCReviewSelector from "../features/Forecast/FCReviewSelector.jsx";
import { formatAmount } from "../features/Forecast/utils/fcReviewUtils.js";
import { useScenarios } from "../features/Forecast/hooks/useScenarios.js";
import { useCashFlowAccounts } from "../features/Forecast/hooks/useCashFlowAccounts.js";
import { useBalanceSheetAccounts } from "../features/Forecast/hooks/useBalanceSheetAccounts.js";
import { useForecastData } from "../features/Forecast/hooks/useForecastData.js";
import { useBaseYearActuals } from "../features/Forecast/hooks/useBaseYearActuals.js";
import { useBaseYearBalanceSheet } from "../features/Forecast/hooks/useBaseYearBalanceSheet.js";
import Rest from "../js/rest.js";
import "./PageLayout.css";

/**
 * Main Forecast Review component
 *
 * Manages the loading and display of forecast data, including:
 * - Cash flow statements (Income, Expense, Transfers, Net Cash Flow)
 * - Balance sheet statements (Assets, Liabilities)
 * - Multi-year projections with base year actuals
 */
export default function FCReview() {
  // =============================================================================
  // CUSTOM HOOKS - Data Loading
  // =============================================================================

  // Load forecast scenarios
  const {
    scenarios,
    selectedScenario,
    setSelectedScenario,
    isLoading: scenariosLoading,
    loadError: scenariosError,
  } = useScenarios();

  // Load forecast years and entries for selected scenario
  const {
    years,
    entries,
    yearsLoading,
    entriesLoading,
    yearsError,
    entriesError,
    reload: reloadForecastData,
  } = useForecastData(selectedScenario);

  // Load cash flow chart of accounts (Income, Expense, Transfers)
  const {
    cashAccounts,
    cashAccountMap,
    loading: accountsLoading,
    error: accountsError,
  } = useCashFlowAccounts();

  // Load balance sheet chart of accounts (Assets, Liabilities)
  const {
    balanceAccounts,
    balanceAccountMap,
    loading: balanceLoading,
    error: balanceError,
  } = useBalanceSheetAccounts();

  // Load base year actuals for cash flow (P&L)
  const {
    baseActualTotals,
    loading: baseActualLoading,
    error: baseActualError,
  } = useBaseYearActuals(years);

  // Load base year actuals for balance sheet
  const {
    baseBalanceTotals,
    loading: baseBalanceLoading,
    error: baseBalanceError,
  } = useBaseYearBalanceSheet(years, balanceAccountMap);

  // =============================================================================
  // STATE - Forecast Generation
  // =============================================================================

  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateResult, setGenerateResult] = useState(null);

  // Clear generation state when scenario changes
  useEffect(() => {
    setGenerateError("");
    setGenerateResult(null);
  }, [selectedScenario]);

  // =============================================================================
  // ACTIONS - Generate Forecast
  // =============================================================================

  const handleGenerateForecast = useCallback(async () => {
    const scenario = selectedScenario?.trim();
    if (!scenario || generateLoading) {
      return;
    }

    setGenerateError("");
    setGenerateResult(null);
    setGenerateLoading(true);

    try {
      const encodedScenario = encodeURIComponent(scenario);
      const result = await Rest.fetchJson(
        `/api/forecast/generate/${encodedScenario}`,
        {
          method: "POST",
        }
      );
      setGenerateResult(result);

      // Reload forecast data to reflect the newly generated forecast
      reloadForecastData();
    } catch (error) {
      setGenerateError(error.message || "Failed to generate forecast");
    } finally {
      setGenerateLoading(false);
    }
  }, [selectedScenario, generateLoading, reloadForecastData]);

  // =============================================================================
  // COMPUTED VALUES - Memoized for Performance
  // =============================================================================

  const sortedYears = useMemo(
    () => [...years].sort((a, b) => Number(a) - Number(b)),
    [years]
  );

  const baseYear = sortedYears[0];

  const balanceLevel1Labels = useMemo(
    () =>
      new Set(
        balanceAccounts.filter((row) => row.level === 1).map((row) => row.label)
      ),
    [balanceAccounts]
  );

  const balanceLevel2Labels = useMemo(
    () =>
      new Set(
        balanceAccounts.filter((row) => row.level === 2).map((row) => row.label)
      ),
    [balanceAccounts]
  );

  const tableColSpan = Math.max(sortedYears.length + 1, 2);

  const tableError =
    accountsError ||
    balanceError ||
    yearsError ||
    entriesError ||
    baseActualError ||
    baseBalanceError;

  /**
   * Enhanced cash flow rows with "Net Cash Flow" calculation row.
   * Inserts a special row after "Transfers" to show Income + Expense.
   */
  const cashRowsWithNet = useMemo(() => {
    const rows = [];
    for (const row of cashAccounts) {
      rows.push(row);
      if (row.label === "Transfers") {
        rows.push({
          label: "Net Cash Flow",
          level: 1,
          isNet: true,
        });
      }
    }
    return rows;
  }, [cashAccounts]);

  /**
   * Aggregates forecast entries by account and year for both cash flow and balance sheet.
   *
   * Creates efficient lookup maps for:
   * - Cash flow: by label (level 2/account) and level 1 totals
   * - Balance sheet: by label (level 2/account) and level 1 totals
   *
   * @returns {Object} { cash: { byLabel, level1Totals }, balance: { byLabel, level1Totals } }
   */
  const entryMaps = useMemo(() => {
    const cashByLabel = new Map();
    const cashLevel1Totals = new Map();
    const balanceByLabel = new Map();
    const balanceLevel1Totals = new Map();

    for (const entry of entries) {
      const account = entry?.Account;
      const year = Number(entry?.Year);
      const amount = Number(entry?.Amount ?? 0);

      if (!account || Number.isNaN(year) || Number.isNaN(amount)) {
        continue;
      }

      // ========== Cash Flow Mapping ==========
      const cashMapping = cashAccountMap.get(account);
      const cashTarget = cashMapping?.level2 || account;
      const cashYearMap = cashByLabel.get(cashTarget) || new Map();
      cashYearMap.set(year, (cashYearMap.get(year) || 0) + amount);
      cashByLabel.set(cashTarget, cashYearMap);

      if (cashMapping?.level1) {
        const l1YearMap = cashLevel1Totals.get(cashMapping.level1) || new Map();
        l1YearMap.set(year, (l1YearMap.get(year) || 0) + amount);
        cashLevel1Totals.set(cashMapping.level1, l1YearMap);
      }

      // ========== Balance Sheet Mapping ==========
      const balMapping = balanceAccountMap.get(account);
      const balL1 =
        balMapping?.level1 ||
        (balanceLevel1Labels.has(account) ? account : undefined);
      const balL2 =
        balMapping?.level2 ||
        (balanceLevel2Labels.has(account) ? account : undefined);
      const balTarget = balL2 || account;
      const balYearMap = balanceByLabel.get(balTarget) || new Map();
      balYearMap.set(year, (balYearMap.get(year) || 0) + amount);
      balanceByLabel.set(balTarget, balYearMap);

      if (balL1) {
        const l1YearMap = balanceLevel1Totals.get(balL1) || new Map();
        l1YearMap.set(year, (l1YearMap.get(year) || 0) + amount);
        balanceLevel1Totals.set(balL1, l1YearMap);
      }
    }

    return {
      cash: { byLabel: cashByLabel, level1Totals: cashLevel1Totals },
      balance: { byLabel: balanceByLabel, level1Totals: balanceLevel1Totals },
    };
  }, [
    entries,
    cashAccountMap,
    balanceAccountMap,
    balanceLevel1Labels,
    balanceLevel2Labels,
  ]);

  /**
   * Gets the cell value for a specific row and year.
   *
   * Logic:
   * - For base year: Returns actuals from P&L or balance sheet reports
   * - For forecast years: Returns aggregated forecast entry amounts
   * - For Net Cash Flow row: Calculates Income + Expense
   *
   * @param {Object} row - Row object with { label, level, isNet }
   * @param {number} year - Year to retrieve value for
   * @param {boolean} isCashSection - True for cash flow, false for balance sheet
   * @returns {number|null} Cell value or null if no data
   */
  const getCellValue = useCallback(
    (row, year, isCashSection) => {
      // ========== Cash Flow - Base Year Actuals ==========
      if (isCashSection && year === baseYear) {
        if (row.isNet) {
          return baseActualTotals.net;
        }
        if (row.level === 1) {
          return baseActualTotals.level1.get(row.label) ?? null;
        }
        return baseActualTotals.level2.get(row.label) ?? null;
      }

      // ========== Balance Sheet - Base Year Actuals ==========
      if (!isCashSection && year === baseYear) {
        if (row.level === 1) {
          return baseBalanceTotals.level1.get(row.label) ?? null;
        }
        if (row.level === 2) {
          return baseBalanceTotals.level2.get(row.label) ?? null;
        }
        return baseBalanceTotals.level3?.get(row.label) ?? null;
      }

      // ========== Balance Sheet - Forecast Years ==========
      if (!isCashSection) {
        if (row.level === 1) {
          return (
            entryMaps.balance.level1Totals.get(row.label)?.get(year) ?? null
          );
        }
        return entryMaps.balance.byLabel.get(row.label)?.get(year) ?? null;
      }

      // ========== Cash Flow - Net Row Calculation ==========
      if (row.isNet) {
        const incomeMap = entryMaps.cash.level1Totals.get("Income");
        const expenseMap = entryMaps.cash.level1Totals.get("Expense");
        const hasIncome = incomeMap?.has(year);
        const hasExpense = expenseMap?.has(year);
        if (!hasIncome && !hasExpense) {
          return null;
        }
        const income = incomeMap?.get(year) || 0;
        const expense = expenseMap?.get(year) || 0;
        return income + expense;
      }

      // ========== Cash Flow - Forecast Years ==========
      if (row.level === 1) {
        return entryMaps.cash.level1Totals.get(row.label)?.get(year) ?? null;
      }
      return entryMaps.cash.byLabel.get(row.label)?.get(year) ?? null;
    },
    [baseYear, baseActualTotals, baseBalanceTotals, entryMaps]
  );

  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        {/* Scenario Selector */}
        <FCReviewSelector
          scenarios={scenarios}
          selectedScenario={selectedScenario}
          setSelectedScenario={setSelectedScenario}
          isLoading={scenariosLoading}
          loadError={scenariosError}
          onGenerateForecast={handleGenerateForecast}
          generateLoading={generateLoading}
          generateDisabled={
            generateLoading ||
            yearsLoading ||
            entriesLoading ||
            accountsLoading ||
            balanceLoading ||
            baseActualLoading ||
            baseBalanceLoading
          }
          generateError={generateError}
          generateResult={generateResult}
        />

        {/* Forecast Review Table */}
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
              )}
            </div>

            {/* Forecast Table */}
            <div className="trans-budget-table-wrapper">
              <table className="trans-budget-table fc-review-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: "240px", textAlign: "left" }}>
                      Account
                    </th>
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
                      {cashRowsWithNet.map((row, index) => (
                        <tr key={`cash-${row.label}-${index}`}>
                          <td
                            style={{
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
                                    Number(value) < 0
                                      ? "var(--danger)"
                                      : undefined,
                                  backgroundColor: row.isNet
                                    ? "var(--surface-muted)"
                                    : undefined,
                                  fontWeight: row.isNet ? 600 : undefined,
                                }}
                              >
                                {formatAmount(value)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}

                      {/* ========== SECTION DIVIDER ========== */}
                      {balanceAccounts.length > 0 &&
                        cashAccounts.length > 0 && (
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
                      {balanceAccounts.map((row, index) => (
                        <tr
                          key={`balance-${row.label}-${index}`}
                          style={
                            index === 0 && cashAccounts.length === 0
                              ? { borderTop: "2px solid var(--border)" }
                              : undefined
                          }
                        >
                          <td
                            style={{
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
                            }}
                          >
                            {row.label}
                          </td>
                          {sortedYears.map((year) => {
                            const value = getCellValue(row, year, false);
                            return (
                              <td
                                key={`${row.label}-${year}`}
                                className="trans-budget-table__value--numeric"
                                style={{
                                  color:
                                    Number(value) < 0
                                      ? "var(--danger)"
                                      : undefined,
                                }}
                              >
                                {formatAmount(value)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
