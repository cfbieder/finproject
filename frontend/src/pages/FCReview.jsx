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

  // =============================================================================
  // STATE - Forecast Generation
  // =============================================================================

  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateResult, setGenerateResult] = useState(null);

  // =============================================================================
  // STATE - Base Year Actuals
  // =============================================================================

  // Base year actuals for cash flow (P&L)
  const [baseActualTotals, setBaseActualTotals] = useState({
    level1: new Map(), // Level 1 totals (Income, Expense)
    level2: new Map(), // Level 2 totals (sub-categories)
    net: null, // Net cash flow (Income + Expense)
  });
  const [baseActualLoading, setBaseActualLoading] = useState(false);
  const [baseActualError, setBaseActualError] = useState("");

  // Base year actuals for balance sheet
  const [baseBalanceTotals, setBaseBalanceTotals] = useState({
    level1: new Map(), // Level 1 totals (Assets, Liabilities)
    level2: new Map(), // Level 2 totals (sub-categories)
    level3: new Map(), // Level 3 totals (leaf accounts)
  });
  const [baseBalanceLoading, setBaseBalanceLoading] = useState(false);
  const [baseBalanceError, setBaseBalanceError] = useState("");

  // Clear generation state when scenario changes
  useEffect(() => {
    setGenerateError("");
    setGenerateResult(null);
  }, [selectedScenario]);

  // =============================================================================
  // EFFECTS - Load Base Year Actuals
  // =============================================================================

  /**
   * Loads actual P&L data for the base year (first forecast year).
   * This provides comparison data for the forecast starting point.
   *
   * Features:
   * - Fetches cash flow report for base year
   * - Aggregates by level 1 (Income, Expense) and level 2 categories
   * - Excludes unrealized G/L from expense totals
   * - Calculates net cash flow (Income + Expense)
   */
  useEffect(() => {
    const sortedYears = [...years].sort((a, b) => Number(a) - Number(b));
    const baseYear = sortedYears[0];

    if (!baseYear) {
      setBaseActualTotals({ level1: new Map(), level2: new Map(), net: null });
      return;
    }

    let isMounted = true;

    const loadActuals = async () => {
      setBaseActualLoading(true);
      setBaseActualError("");
      try {
        const fromDate = `${baseYear}-01-01`;
        const toDate = `${baseYear}-12-31`;
        const report = await Rest.fetchCashFlowReport({
          fromDate,
          toDate,
          transfers: "exclude",
          includeUnrealizedGL: false,
        });
        if (!isMounted) return;

        const level1 = new Map();
        const level2 = new Map();
        let unrealizedAdjustment = 0;
        let unrealizedLevel2 = "";

        /**
         * Recursively traverses cash flow report tree to aggregate totals.
         *
         * @param {Array} nodes - Report nodes to traverse
         * @param {number} level - Current depth in tree (1, 2, 3, ...)
         * @param {string} parentLevel1 - Parent level 1 category name
         * @param {string} parentLevel2 - Parent level 2 category name
         */
        const traverse = (
          nodes,
          level = 1,
          parentLevel1 = "",
          parentLevel2 = ""
        ) => {
          if (!Array.isArray(nodes)) return;

          for (const node of nodes) {
            if (!node || typeof node !== "object") continue;

            const name = node.name;
            const total = Number(
              node.totalUSD !== undefined && node.totalUSD !== null
                ? node.totalUSD
                : node.total ?? 0
            );
            const nextLevel1 = level === 1 && name ? name : parentLevel1;
            const nextLevel2 =
              level === 2 && name ? name : level === 1 ? "" : parentLevel2;

            // Track unrealized G/L separately to exclude from expense
            if (name === "Unrealized G/L") {
              unrealizedAdjustment += total;
              unrealizedLevel2 = nextLevel2 || unrealizedLevel2;
              continue;
            }

            // Aggregate level 1 and level 2 totals
            if (level === 1 && name) {
              level1.set(name, total);
            } else if (level === 2 && name) {
              level2.set(name, total);
            }

            // Recurse into children
            if (Array.isArray(node.children) && node.children.length > 0) {
              traverse(node.children, level + 1, nextLevel1, nextLevel2);
            }
          }
        };

        traverse(report, 1, "", "");

        // Adjust expense totals to exclude unrealized G/L
        if (unrealizedAdjustment) {
          const expenseTotal = level1.get("Expense") ?? 0;
          level1.set("Expense", expenseTotal - unrealizedAdjustment);
          if (unrealizedLevel2) {
            const l2Total = level2.get(unrealizedLevel2) ?? 0;
            level2.set(unrealizedLevel2, l2Total - unrealizedAdjustment);
          }
        }

        const income = level1.get("Income") ?? 0;
        const expense = level1.get("Expense") ?? 0;
        setBaseActualTotals({ level1, level2, net: income + expense });
      } catch (error) {
        if (isMounted) {
          setBaseActualError(
            error.message || "Failed to load base year actuals"
          );
        }
      } finally {
        if (isMounted) {
          setBaseActualLoading(false);
        }
      }
    };

    loadActuals();
    return () => {
      isMounted = false;
    };
  }, [years]);

  /**
   * Loads actual balance sheet data for the base year.
   * Provides comparison data for the balance sheet forecast starting point.
   *
   * Features:
   * - Fetches balance sheet as of end of base year
   * - Aggregates by level 1 (Assets, Liabilities), level 2, and level 3
   * - Uses account mapping to categorize leaf accounts
   * - Calculates total assets and liabilities
   */
  useEffect(() => {
    const sortedYears = [...years].sort((a, b) => Number(a) - Number(b));
    const baseYear = sortedYears[0];

    if (!baseYear) {
      setBaseBalanceTotals({
        level1: new Map(),
        level2: new Map(),
        level3: new Map(),
      });
      return;
    }

    let isMounted = true;

    const loadBalance = async () => {
      setBaseBalanceLoading(true);
      setBaseBalanceError("");
      try {
        const asOfDate = `${baseYear}-12-31`;
        const report = await Rest.fetchBalanceReport(asOfDate);
        if (!isMounted) return;

        const level1 = new Map();
        const level2 = new Map();
        const level3Map = new Map();
        let assetTotal = 0;
        let liabilityTotal = 0;

        /**
         * Recursively aggregates balance sheet values.
         *
         * @param {Array} nodes - Balance sheet nodes to process
         * @param {Array} path - Current path in tree (for mapping)
         */
        const aggregateValues = (nodes, path = []) => {
          if (!Array.isArray(nodes)) return;

          for (const node of nodes) {
            if (!node || typeof node !== "object") continue;

            const name = node.name;
            const children = Array.isArray(node.children) ? node.children : [];
            const hasChildren = children.length > 0;
            const newPath = [...path, name].filter(Boolean);

            // Recurse into children first
            if (hasChildren) {
              aggregateValues(children, newPath);
              continue;
            }

            // Process leaf nodes
            const total = Number(node.totalUSD ?? 0);
            const mapping = balanceAccountMap.get(name);
            const l1 = mapping?.level1 || newPath[0];
            const l2 = mapping?.level2 || newPath[1];

            // Aggregate at all three levels
            if (name) {
              level3Map.set(name, (level3Map.get(name) ?? 0) + total);
            }
            if (l1) {
              level1.set(l1, (level1.get(l1) ?? 0) + total);
              if (l1 === "Assets") {
                assetTotal += total;
              } else if (l1 === "Liabilities") {
                liabilityTotal += total;
              }
            }
            if (l2) {
              level2.set(l2, (level2.get(l2) ?? 0) + total);
            }
          }
        };

        const nodes = Array.isArray(report)
          ? report
          : Array.isArray(report?.["Balance Sheet Accounts"])
          ? report["Balance Sheet Accounts"]
          : [];

        aggregateValues(nodes, []);

        // Set final asset and liability totals
        if (assetTotal) {
          level1.set("Assets", assetTotal);
        }
        if (liabilityTotal) {
          level1.set("Liabilities", liabilityTotal);
        }

        setBaseBalanceTotals({ level1, level2, level3: level3Map });
      } catch (error) {
        if (isMounted) {
          setBaseBalanceError(error.message || "Failed to load balance sheet");
        }
      } finally {
        if (isMounted) {
          setBaseBalanceLoading(false);
        }
      }
    };

    loadBalance();
    return () => {
      isMounted = false;
    };
  }, [years, balanceAccountMap]);

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
