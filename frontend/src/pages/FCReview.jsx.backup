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
  // STATE - Scenarios & Selection
  // =============================================================================

  const [scenarios, setScenarios] = useState([]);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateResult, setGenerateResult] = useState(null);

  // =============================================================================
  // STATE - Years & Entries
  // =============================================================================

  const [years, setYears] = useState([]);
  const [yearsLoading, setYearsLoading] = useState(false);
  const [yearsError, setYearsError] = useState("");

  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState("");

  // =============================================================================
  // STATE - Chart of Accounts
  // =============================================================================

  // Cash flow accounts (Income, Expense, Transfers)
  const [cashAccounts, setCashAccounts] = useState([]);
  const [cashAccountMap, setCashAccountMap] = useState(new Map());
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState("");

  // Balance sheet accounts (Assets, Liabilities)
  const [balanceAccounts, setBalanceAccounts] = useState([]);
  const [balanceAccountMap, setBalanceAccountMap] = useState(new Map());
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");

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

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

  /**
   * Parses hierarchical account data from Chart of Accounts.
   *
   * Converts nested COA structure into a flat array with level indicators,
   * and optionally creates a mapping from leaf accounts to their parent categories.
   *
   * @param {Array} data - Raw COA data from API
   * @param {boolean} includeMapping - Whether to build account-to-parent mapping
   * @returns {Object} { rows: Array, mapping: Map }
   *   - rows: Flat array of { label, level } objects
   *   - mapping: Map of account name -> { level1, level2 }
   */
  const parseLevelAccounts = useCallback((data, includeMapping = false) => {
    if (!Array.isArray(data)) {
      return { rows: [], mapping: new Map() };
    }

    const mapping = new Map();
    const rows = data.flatMap((group) => {
      if (!group || typeof group !== "object") {
        return [];
      }

      return Object.entries(group).flatMap(([level1, children]) => {
        const rows = [{ label: level1, level: 1 }];

        if (Array.isArray(children)) {
          for (const child of children) {
            if (!child || typeof child !== "object") {
              continue;
            }

            const [level2] = Object.keys(child);
            if (level2) {
              rows.push({ label: level2, level: 2 });

              // Build mapping for leaf accounts if requested
              if (includeMapping) {
                mapping.set(level2, { level2, level1 });

                // Recursively add all leaf account mappings
                const addLeaf = (node) => {
                  if (typeof node === "string") {
                    mapping.set(node, { level2, level1 });
                    return;
                  }
                  if (Array.isArray(node)) {
                    node.forEach((item) => addLeaf(item));
                    return;
                  }
                  if (node && typeof node === "object") {
                    for (const [k, v] of Object.entries(node)) {
                      addLeaf(k);
                      addLeaf(v);
                    }
                  }
                };

                addLeaf(child[level2]);
              }
            }
          }
        }

        return rows;
      });
    });

    return { rows, mapping };
  }, []);

  /**
   * Formats a numeric amount for display.
   *
   * - Formats with thousands separators
   * - Displays negative numbers in parentheses
   * - Shows "-" for null/undefined/NaN values
   *
   * @param {number|null|undefined} value - Numeric value to format
   * @returns {string} Formatted string representation
   */
  const formatAmount = useCallback((value) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "-";
    }
    const num = Number(value);
    const formatted = Math.abs(num).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return num < 0 ? `(${formatted})` : formatted;
  }, []);

  // =============================================================================
  // EFFECTS - Load Scenarios
  // =============================================================================

  /**
   * Loads available forecast scenarios on component mount.
   * Auto-selects the first scenario if none is currently selected.
   */
  useEffect(() => {
    const loadScenarios = async () => {
      setIsLoading(true);
      try {
        const data = await Rest.fetchJson("/api/forecast/assumptions");
        const list = data?.scenarios || [];
        setScenarios(list);
        setSelectedScenario((current) => current || list[0]?.Name || "");
        setLoadError("");
      } catch (error) {
        setLoadError(error.message || "Failed to load scenarios");
      } finally {
        setIsLoading(false);
      }
    };

    loadScenarios();
  }, []);

  useEffect(() => {
    setGenerateError("");
    setGenerateResult(null);
  }, [selectedScenario]);

  // =============================================================================
  // EFFECTS - Load Chart of Accounts
  // =============================================================================

  /**
   * Loads Cash Flow Chart of Accounts (Income, Expense, Transfers).
   * Creates mapping from leaf accounts to parent categories for aggregation.
   */
  useEffect(() => {
    let isMounted = true;

    const loadCashAccounts = async () => {
      setAccountsLoading(true);
      setAccountsError("");
      try {
        const data = await Rest.fetchJson("/api/coa/CashFlow");
        if (!isMounted) return;

        const parsed = parseLevelAccounts(data, true);
        setCashAccounts(parsed.rows);
        setCashAccountMap(parsed.mapping);
      } catch (error) {
        if (isMounted) {
          setAccountsError(error.message || "Failed to load cash accounts");
        }
      } finally {
        if (isMounted) {
          setAccountsLoading(false);
        }
      }
    };

    loadCashAccounts();
    return () => {
      isMounted = false;
    };
  }, [parseLevelAccounts]);

  /**
   * Loads Balance Sheet Chart of Accounts (Assets, Liabilities).
   * Creates mapping from leaf accounts to parent categories for aggregation.
   */
  useEffect(() => {
    let isMounted = true;

    const loadBalanceAccounts = async () => {
      setBalanceLoading(true);
      setBalanceError("");
      try {
        const data = await Rest.fetchJson("/api/coa/BalanceSheet");
        if (!isMounted) return;

        const parsed = parseLevelAccounts(data, true);
        setBalanceAccounts(parsed.rows);
        setBalanceAccountMap(parsed.mapping);
      } catch (error) {
        if (isMounted) {
          setBalanceError(error.message || "Failed to load balance accounts");
        }
      } finally {
        if (isMounted) {
          setBalanceLoading(false);
        }
      }
    };

    loadBalanceAccounts();
    return () => {
      isMounted = false;
    };
  }, [parseLevelAccounts]);

  // =============================================================================
  // EFFECTS - Load Scenario-Specific Data
  // =============================================================================

  /**
   * Loads forecast years for the selected scenario.
   * Years are sorted chronologically for display.
   */
  useEffect(() => {
    if (!selectedScenario) {
      setYears([]);
      return;
    }

    let isMounted = true;

    const loadYears = async () => {
      setYearsLoading(true);
      setYearsError("");
      try {
        const encodedScenario = encodeURIComponent(selectedScenario);
        const data = await Rest.fetchJson(
          `/api/forecast/scenarios/years/${encodedScenario}`
        );
        if (!isMounted) return;

        const list = Array.isArray(data?.years) ? data.years : [];
        const sorted = [...list].sort((a, b) => Number(a) - Number(b));
        setYears(sorted);
      } catch (error) {
        if (isMounted) {
          setYearsError(error.message || "Failed to load forecast years");
        }
      } finally {
        if (isMounted) {
          setYearsLoading(false);
        }
      }
    };

    loadYears();
    return () => {
      isMounted = false;
    };
  }, [selectedScenario]);

  /**
   * Loads forecast entries for the selected scenario.
   * Entries contain Year, Account, and Amount for each forecast line item.
   */
  useEffect(() => {
    if (!selectedScenario) {
      setEntries([]);
      return;
    }

    let isMounted = true;

    const loadEntries = async () => {
      setEntriesLoading(true);
      setEntriesError("");
      try {
        const encoded = encodeURIComponent(selectedScenario);
        const data = await Rest.fetchJson(
          `/api/forecast/entries?scenario=${encoded}`
        );
        if (!isMounted) return;

        const list = Array.isArray(data?.entries) ? data.entries : [];
        setEntries(list);
      } catch (error) {
        if (isMounted) {
          setEntriesError(error.message || "Failed to load forecast entries");
        }
      } finally {
        if (isMounted) {
          setEntriesLoading(false);
        }
      }
    };

    loadEntries();
    return () => {
      isMounted = false;
    };
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

      setYearsLoading(true);
      setEntriesLoading(true);
      setYearsError("");
      setEntriesError("");

      const [yearsResponse, entriesResponse] = await Promise.all([
        Rest.fetchJson(`/api/forecast/scenarios/years/${encodedScenario}`),
        Rest.fetchJson(`/api/forecast/entries?scenario=${encodedScenario}`),
      ]);

      const yearList = Array.isArray(yearsResponse?.years)
        ? yearsResponse.years
        : [];
      setYears([...yearList].sort((a, b) => Number(a) - Number(b)));

      const entryList = Array.isArray(entriesResponse?.entries)
        ? entriesResponse.entries
        : [];
      setEntries(entryList);
    } catch (error) {
      setGenerateError(error.message || "Failed to generate forecast");
    } finally {
      setGenerateLoading(false);
      setYearsLoading(false);
      setEntriesLoading(false);
    }
  }, [selectedScenario, generateLoading]);

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
          isLoading={isLoading}
          loadError={loadError}
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
