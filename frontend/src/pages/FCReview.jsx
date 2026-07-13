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

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import FCReviewSelector from "../features/Forecast/FCReviewSelector.jsx";
import FCAIReviewDrawer from "../features/Forecast/FCAIReviewDrawer.jsx";
import { useScenarios } from "../features/Forecast/hooks/useScenarios.js";
import { useFCLineStructure } from "../features/Forecast/hooks/useFCLineStructure.js";
import { useBalanceSheetAccounts } from "../features/Forecast/hooks/useBalanceSheetAccounts.js";
import { useForecastData } from "../features/Forecast/hooks/useForecastData.js";
import { useBaseYearActuals } from "../features/Forecast/hooks/useBaseYearActuals.js";
import { useBaseYearBalanceSheet } from "../features/Forecast/hooks/useBaseYearBalanceSheet.js";
import FCReviewTable from "../features/Forecast/FCReviewTable.jsx";
import FCReviewBreakdownModal from "../features/Forecast/FCReviewBreakdownModal.jsx";
import FCCashTransferModal from "../features/Forecast/FCCashTransferModal.jsx";
import FCReviewTableGraphModal from "../features/Forecast/FCReviewTableGraphModal.jsx";
import FCCashSweepModal from "../features/Forecast/FCCashSweepModal.jsx";
import FCGraphAdjustModal from "../features/Forecast/FCGraphAdjustModal.jsx";
import FCGraphModuleAdjustModal from "../features/Forecast/FCGraphModuleAdjustModal.jsx";
import { formatAmount } from "../features/Forecast/utils/fcReviewUtils.js";
import { KpiCard, KpiCardRow } from "../components/KpiCards.jsx";
import FCReviewWarnings from "../features/Forecast/FCReviewWarnings.jsx";
import { computeForecastWarnings } from "../features/Forecast/utils/fcWarnings.js";
import { buildBreakdownSeries } from "../features/Forecast/utils/fcBreakdown.js";
import { TrendingUp, TrendingDown, DollarSign, Landmark } from "lucide-react";
import Rest from "../js/rest.js";
import FCStepNav from "../features/Forecast/FCStepNav.jsx";
import "./PageLayout.css";

const GRAPH_COLORS = [
  "#6B8E6B",
  "#5B9E9E",
  "#C4923A",
  "#C0504D",
  "#8B7BB5",
  "#5B7B9A",
];

const BAR_CHART_COLORS = [
  "#6B8E6B", "#5B9E9E", "#C4923A", "#C0504D", "#8B7BB5",
  "#5B7B9A", "#9B7B9B", "#D4A74E", "#5B8C5B", "#B5637B",
  "#6B7BB5", "#8BAF5B", "#5BA5B5", "#9B7BB5", "#C07B8B",
  "#7FA37F", "#C06363", "#7B9EB5", "#B5A03A", "#6BBFBF",
];

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

  // Get the selected scenario object to access PeriodStart/PeriodEnd
  const selectedScenarioObj = useMemo(
    () => scenarios.find((s) => s.Name === selectedScenario),
    [scenarios, selectedScenario]
  );
  const periodStart = selectedScenarioObj?.PeriodStart;

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

  // Load FC Line structure for P&L section (replaces COA-based cash flow accounts)
  const {
    cashAccounts,
    cashAccountMap,
    categoryToLineMap,
    loading: accountsLoading,
    error: accountsError,
  } = useFCLineStructure();

  // Load balance sheet chart of accounts (Assets, Liabilities)
  const {
    balanceAccounts,
    balanceAccountMap,
    loading: balanceLoading,
    error: balanceError,
  } = useBalanceSheetAccounts();

  // Load base year actuals for cash flow (P&L)
  const {
    baseActualTotalsByYear,
    loading: baseActualLoading,
    error: baseActualError,
  } = useBaseYearActuals(periodStart);

  // Load base year actuals for balance sheet
  const {
    baseBalanceTotalsByYear,
    loading: baseBalanceLoading,
    error: baseBalanceError,
  } = useBaseYearBalanceSheet(periodStart, balanceAccountMap);

  // =============================================================================
  // STATE - App Settings
  // =============================================================================

  const [birthYear, setBirthYear] = useState(null);
  useEffect(() => {
    Rest.fetchAppDataV2().then((data) => {
      const doc = Array.isArray(data) && data.length > 0 ? data[0] : data;
      if (doc?.birthYear) setBirthYear(Number(doc.birthYear));
    }).catch(() => {});
  }, []);

  // =============================================================================
  // STATE - FC Exp Entries (for graph point adjustments)
  // =============================================================================

  const [fcExpEntries, setFcExpEntries] = useState([]);
  useEffect(() => {
    if (!selectedScenario) { setFcExpEntries([]); return; }
    Rest.fetchJson(`/api/v2/forecast/incomeexpense?scenario=${encodeURIComponent(selectedScenario)}`)
      .then((res) => setFcExpEntries(res?.entries || []))
      .catch(() => setFcExpEntries([]));
  }, [selectedScenario]);

  // Map: series label (FC Line name) → array of FC Exp entries under that line
  const fcExpByLabel = useMemo(() => {
    const map = new Map();
    for (const entry of fcExpEntries) {
      // Use FcLineName (the FC Line name that appears as level 2 label in the review table)
      // Fall back to Name if FcLineName is not set
      const label = entry.FcLineName || entry.Name || "";
      if (!label) continue;
      const arr = map.get(label) || [];
      arr.push(entry);
      map.set(label, arr);
    }
    return map;
  }, [fcExpEntries]);

  // Graph point adjustment modal state (FC Exp)
  const [graphAdjustModal, setGraphAdjustModal] = useState({
    isOpen: false,
    entry: null,
    year: null,
    currentValue: null,
    seriesLabel: "",
  });

  // =============================================================================
  // STATE - FC Modules (for graph point adjustments on balance sheet)
  // =============================================================================

  const [fcModules, setFcModules] = useState([]);
  useEffect(() => {
    if (!selectedScenario) { setFcModules([]); return; }
    Rest.fetchJson(`/api/v2/forecast/modules?scenario=${encodeURIComponent(selectedScenario)}`)
      .then((res) => setFcModules(Array.isArray(res) ? res : []))
      .catch(() => setFcModules([]));
  }, [selectedScenario]);

  // Sweep band for the cash warnings (CR045). useScenarios reads the assumptions
  // doc, which carries PeriodStart/End but not the bands — those live on the
  // scenarios table, so fetch them separately.
  const [cashSweepLow, setCashSweepLow] = useState(null);
  useEffect(() => {
    if (!selectedScenario) { setCashSweepLow(null); return; }
    Rest.fetchJson("/api/v2/forecast/scenarios")
      .then((res) => {
        const row = (res?.data || []).find((s) => s.name === selectedScenario);
        setCashSweepLow(row?.cash_sweep_low != null ? Number(row.cash_sweep_low) : null);
      })
      .catch(() => setCashSweepLow(null));
  }, [selectedScenario]);

  // Map: balance sheet level 2 label → array of FC Modules under that account
  const fcModulesByLabel = useMemo(() => {
    const map = new Map();
    for (const mod of fcModules) {
      const account = mod.Account || "";
      if (!account) continue;
      // The module's Account may be a leaf (level 3) account.
      // Use balanceAccountMap to find the level 2 label that the graph shows.
      const mapping = balanceAccountMap.get(account);
      const level2Label = mapping?.level2 || account;
      const arr = map.get(level2Label) || [];
      arr.push(mod);
      map.set(level2Label, arr);
    }
    return map;
  }, [fcModules, balanceAccountMap]);

  // Graph module adjustment modal state (FC Module)
  const [graphModuleAdjustModal, setGraphModuleAdjustModal] = useState({
    isOpen: false,
    moduleId: null,
    year: null,
    currentValue: null,
    seriesLabel: "",
  });

  // =============================================================================
  // STATE - Base Year Budget (P&L base year column)
  // =============================================================================

  // Base year values from completed modules/expenses (grouped by FC Line name)
  const [baseYearValues, setBaseYearValues] = useState({});
  useEffect(() => {
    if (!selectedScenario) return;
    Rest.get(`/forecast/base-year-values?scenario=${encodeURIComponent(selectedScenario)}`)
      .then((res) => setBaseYearValues(res.data || {}))
      .catch(() => {});
  }, [selectedScenario]);

  // =============================================================================
  // STATE - Forecast Generation
  // =============================================================================

  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateResult, setGenerateResult] = useState(null);
  const [breakdownModal, setBreakdownModal] = useState({
    isOpen: false,
    title: "",
    amount: null,
    entryTotal: 0,
    entries: [],
  });
  const [cashTransferModal, setCashTransferModal] = useState({
    isOpen: false,
    title: "",
    year: null,
  });
  const [selectedSeries, setSelectedSeries] = useState([]);
  const [graphModalOpen, setGraphModalOpen] = useState(false);
  const [graphMode, setGraphMode] = useState("line"); // "line" or "bar"
  const [breakdownLabel, setBreakdownLabel] = useState("Net Assets"); // names the stack (CR046)

  const tableWrapperRef = useRef(null);
  const tableRef = useRef(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Clear generation state when scenario changes
  useEffect(() => {
    setGenerateError("");
    setGenerateResult(null);
    setSelectedSeries([]);
    setGraphModalOpen(false);
    setGraphMode("line");
  }, [selectedScenario]);

  const handleGenerateForecast = useCallback(async () => {
    const scenario = selectedScenario?.trim();
    if (!scenario || generateLoading) {
      return;
    }

    setGenerateError("");
    setGenerateResult(null);
    setGenerateLoading(true);

    try {
      // Using v2 API (wraps v1 generator)
      const encodedScenario = encodeURIComponent(scenario);
      const result = await Rest.fetchJson(
        `/api/v2/forecast/generate/${encodedScenario}`,
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

  // BaseYear = PeriodStart - 1 (budget year), LastActualYear = PeriodStart - 2 (actuals)
  const lastActualYear = periodStart ? Number(periodStart) - 2 : undefined;
  const baseYears = useMemo(() => {
    const yearsSet = new Set();
    if (periodStart) {
      yearsSet.add(Number(periodStart) - 1);
    }
    return yearsSet;
  }, [periodStart]);

  const lastActualYears = useMemo(() => {
    const yearsSet = new Set();
    if (lastActualYear) {
      yearsSet.add(lastActualYear);
    }
    return yearsSet;
  }, [lastActualYear]);

  // Combine LastActualYear + BaseYear + forecast years for display
  const sortedYears = useMemo(() => {
    const allYears = [...years];
    if (periodStart) {
      allYears.unshift(Number(periodStart) - 1);
      allYears.unshift(Number(periodStart) - 2);
    }
    return [...new Set(allYears)].sort((a, b) => Number(a) - Number(b));
  }, [years, periodStart]);

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

  const bankAccountLabels = useMemo(() => {
    const labels = new Set(
      Array.from(balanceAccountMap.entries())
        .filter(([, mapping]) => mapping?.level2 === "Bank Accounts")
        .map(([label]) => label)
    );
    labels.add("Bank Accounts");
    return labels;
  }, [balanceAccountMap]);

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
      if (row.label === "Transfers") {
        rows.push({
          label: "Cash Flow",
          level: 1,
          isCashFlow: true,
        });
        rows.push(row);
        rows.push({
          label: "Net Cash Flow",
          level: 1,
          isNet: true,
        });
      } else {
        rows.push(row);
      }
    }
    return rows;
  }, [cashAccounts]);

  /**
   * Per-source detail rows for the Transfers line in the Cash Flow Summary.
   *
   * Groups every transfer entry (cash accounts mapped to level2 "Transfers")
   * by its Module (source), summing amounts per year. Each row's per-year
   * values therefore sum to the Transfers line for that year, and the rows
   * collectively reconcile Income + Expense + Transfers = Net Cash Flow.
   *
   * @returns {Array<{module: string, values: Array<number|null>, total: number}>}
   *   Rows sorted by absolute lifetime total (largest first).
   */
  const transferDetailRows = useMemo(() => {
    // Synthetic engine modules (e.g. _cash_sweep) don't name the real counterparty
    // account in the Module field — the cash-sweep engine puts it in the comment as
    // "Cash sweep to/from <account>". Surface that account name instead of "_cash_sweep".
    const transferLabel = (entry) => {
      const module = entry?.Module || "";
      if (module.startsWith("_")) {
        const m = String(entry?.Comment || "").match(/cash sweep (?:to|from)\s+(.+)$/i);
        if (m && m[1]) return m[1].trim();
      }
      return module || entry?.Comment || "(unspecified)";
    };

    const byModule = new Map(); // label -> Map<year, amount>
    for (const entry of entries) {
      const account = entry?.Account;
      const mapping = cashAccountMap.get(account);
      if (mapping?.level2 !== "Transfers") continue;
      const year = Number(entry?.Year);
      const amount = Number(entry?.Amount ?? 0);
      if (Number.isNaN(year) || Number.isNaN(amount)) continue;
      const module = transferLabel(entry);
      const yearMap = byModule.get(module) || new Map();
      yearMap.set(year, (yearMap.get(year) || 0) + amount);
      byModule.set(module, yearMap);
    }

    const rows = [];
    for (const [module, yearMap] of byModule.entries()) {
      let total = 0;
      const values = sortedYears.map((year) => {
        const v = yearMap.get(Number(year));
        if (v == null) return null;
        total += v;
        return v;
      });
      rows.push({ module, values, total });
    }
    rows.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    return rows;
  }, [entries, cashAccountMap, sortedYears]);

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
   * - For base years (first two years): Returns actuals from P&L or balance sheet reports
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
      const numericYear = Number(year);
      const isBaseYear = baseYears.has(numericYear);
      const isLastActualYear = lastActualYears.has(numericYear);

      // ========== LastActualYear - P&L from actuals ==========
      if (isCashSection && isLastActualYear) {
        return null; // Handled by FCReviewTable via baseYearBudget for LastActualYear actuals
      }

      // ========== LastActualYear - BS from actuals ==========
      if (!isCashSection && isLastActualYear) {
        const yearData = baseBalanceTotalsByYear.get(numericYear);
        if (!yearData) return null;

        if (row.level === 1) {
          return yearData.level1.get(row.label) ?? null;
        }
        if (row.level === 2) {
          return yearData.level2.get(row.label) ?? null;
        }
        return yearData.level3?.get(row.label) ?? null;
      }

      // ========== BaseYear - P&L from budget, Transfers from engine ==========
      if (isCashSection && isBaseYear && row.label !== "Transfers") {
        return null; // P&L, Cash Flow, Net handled by FCReviewTable via baseYearBudget prop
      }

      // ========== BaseYear - BS from engine (same as forecast years) ==========
      // ========== Balance Sheet - Forecast Years ==========
      if (!isCashSection) {
        if (row.level === 1) {
          return (
            entryMaps.balance.level1Totals.get(row.label)?.get(year) ?? null
          );
        }
        return entryMaps.balance.byLabel.get(row.label)?.get(year) ?? null;
      }

      // ========== Cash Flow - Cash Flow / Net Row Calculation ==========
      if (row.isCashFlow) {
        const incomeMap = entryMaps.cash.level1Totals.get("Income");
        const expenseMap = entryMaps.cash.level1Totals.get("Expense");
        const transferMap =
          entryMaps.cash.byLabel.get("Transfers") ||
          entryMaps.cash.level1Totals.get("Transfers");
        const hasIncome = incomeMap?.has(year);
        const hasExpense = expenseMap?.has(year);
        const hasTransfer = transferMap?.has(year);
        if (!hasIncome && !hasExpense && !hasTransfer) {
          return null;
        }
        const income = incomeMap?.get(year) || 0;
        const transfers = transferMap?.get(year) || 0;
        const expense = expenseMap?.get(year) || 0;
        const expenseAdjusted = expense - transfers;
        return income + expenseAdjusted;
      }

      if (row.isNet) {
        const incomeMap = entryMaps.cash.level1Totals.get("Income");
        const expenseMap = entryMaps.cash.level1Totals.get("Expense");
        const transferMap = entryMaps.cash.level1Totals.get("Transfers");
        const hasIncome = incomeMap?.has(year);
        const hasExpense = expenseMap?.has(year);
        const hasTransfer = transferMap?.has(year);
        if (!hasIncome && !hasExpense && !hasTransfer) {
          return null;
        }
        const income = incomeMap?.get(year) || 0;
        const expense = expenseMap?.get(year) || 0;
        const transfers = transferMap?.get(year) || 0;
        return income + expense + transfers;
      }

      // ========== Cash Flow - Forecast Years ==========
      if (row.level === 1) {
        const baseValue =
          entryMaps.cash.level1Totals.get(row.label)?.get(year) ?? null;
        if (row.label === "Expense") {
          const transfersVal =
            entryMaps.cash.byLabel.get("Transfers")?.get(year) ||
            entryMaps.cash.level1Totals.get("Transfers")?.get(year) ||
            0;
          return baseValue == null ? null : baseValue - transfersVal;
        }
        return baseValue;
      }
      return entryMaps.cash.byLabel.get(row.label)?.get(year) ?? null;
    },
    [baseYears, lastActualYears, baseActualTotalsByYear, baseBalanceTotalsByYear, entryMaps, baseYearValues, cashAccountMap]
  );

  /**
   * Computes display values for balance sheet rows with special handling for bank accounts.
   *
   * Bank accounts use cumulative totals (running sum across years) to reflect
   * year-end balances, while other accounts show their direct forecast values.
   *
   * @returns {Map<string, Array<number>>} Map of account label to array of values per year
   */
  // Compute Net Cash Flow per year for Bank Accounts running balance
  // Net Cash Flow = Income + Expense + Transfers (for forecast years and BaseYear)
  const netCashFlowByYear = useMemo(() => {
    return sortedYears.map((year) => {
      const isBase = baseYears.has(Number(year));
      if (isBase) {
        // BaseYear: budget P&L + engine transfers
        let plTotal = 0;
        if (baseYearValues && Object.keys(baseYearValues).length > 0) {
          for (const amt of Object.values(baseYearValues)) plTotal += amt;
        }
        const transfers = entryMaps.cash.byLabel.get("Transfers")?.get(year) ||
          entryMaps.cash.level1Totals.get("Transfers")?.get(year) || 0;
        return plTotal + transfers;
      }
      // Forecast years: from engine entries
      const incomeMap = entryMaps.cash.level1Totals.get("Income");
      const expenseMap = entryMaps.cash.level1Totals.get("Expense");
      const transferMap = entryMaps.cash.level1Totals.get("Transfers");
      const income = incomeMap?.get(year) || 0;
      const expense = expenseMap?.get(year) || 0;
      const transfers = transferMap?.get(year) || 0;
      return income + expense + transfers;
    });
  }, [sortedYears, baseYears, baseYearValues, entryMaps]);

  const balanceDisplayValues = useMemo(() => {
    const valuesByRow = new Map();
    for (const row of balanceAccounts) {
      let runningBankTotal;
      const perYear = sortedYears.map((year, index) => {
        const baseValue = getCellValue(row, year, false);
        if (row.label === "Bank Accounts" || bankAccountLabels.has(row.label)) {
          if (index === 0) {
            // LastActualYear: actual cash balance from ledger
            runningBankTotal = Number.isFinite(Number(baseValue))
              ? Number(baseValue)
              : 0;
          } else {
            // BaseYear+: prior cash + Net Cash Flow
            runningBankTotal = (runningBankTotal ?? 0) + (netCashFlowByYear[index] ?? 0);
          }
          return runningBankTotal;
        }
        return Number.isFinite(Number(baseValue))
          ? Number(baseValue)
          : baseValue;
      });
      valuesByRow.set(row.label, perYear);
    }
    return valuesByRow;
  }, [balanceAccounts, sortedYears, getCellValue, bankAccountLabels, netCashFlowByYear]);

  /**
   * Calculates total Assets by summing all level 2 asset categories.
   *
   * Sums all level 2 accounts under the Assets section (Bank Accounts, Fidelity Stock,
   * Fidelity Fixed Income, CVC Investments, Properties, etc.) to provide the total
   * Assets value displayed in the Assets header row.
   *
   * @returns {Array<number>} Array of total asset values, one per year
   */
  const totalAssetsByYear = useMemo(() => {
    const totals = sortedYears.map(() => 0);
    for (const row of balanceAccounts) {
      // Skip the Assets header row itself
      if (row.label === "Assets") {
        continue;
      }
      const mapping = balanceAccountMap.get(row.label);
      // Only sum level 2 rows that are under Assets (excludes Liabilities)
      const isAssetLevel2 = mapping?.level1 === "Assets" && row.level === 2;
      if (!isAssetLevel2) {
        continue;
      }
      const values = balanceDisplayValues.get(row.label);
      if (!values) {
        continue;
      }
      values.forEach((value, index) => {
        if (Number.isFinite(Number(value))) {
          totals[index] += Number(value);
        }
      });
    }
    return totals;
  }, [balanceAccounts, balanceAccountMap, balanceDisplayValues, sortedYears]);

  /**
   * Calculates total Liabilities by summing all level 2 liability categories.
   */
  const totalLiabilitiesByYear = useMemo(() => {
    const totals = sortedYears.map(() => 0);
    for (const row of balanceAccounts) {
      if (row.label === "Liabilities") continue;
      const mapping = balanceAccountMap.get(row.label);
      const isLiabilityLevel2 = mapping?.level1 === "Liabilities" && row.level === 2;
      if (!isLiabilityLevel2) continue;
      const values = balanceDisplayValues.get(row.label);
      if (!values) continue;
      values.forEach((value, index) => {
        if (Number.isFinite(Number(value))) {
          totals[index] += Number(value);
        }
      });
    }
    return totals;
  }, [balanceAccounts, balanceAccountMap, balanceDisplayValues, sortedYears]);

  /**
   * Net Assets = Total Assets - Total Liabilities
   */
  const netAssetsByYear = useMemo(() => {
    return sortedYears.map((_, index) => {
      return (totalAssetsByYear[index] || 0) - (totalLiabilitiesByYear[index] || 0);
    });
  }, [sortedYears, totalAssetsByYear, totalLiabilitiesByYear]);

  /**
   * Builds per-account breakdown data for Net Assets bar chart.
   * Returns all level 2 accounts (e.g. Bank Accounts, Fidelity Stock, Mortgage)
   * excluding the level 1 subtotals (Assets, Liabilities).
   * Liability values are negated so the chart shows net contribution.
   */
  // CR046: raw engine entries keyed by the account they were actually written against,
  // NOT rolled up to level 2 like entryMaps. That roll-up is what makes entryMaps useless
  // for expanding a level-2 row into its leaves.
  const leafValuesByAccount = useMemo(() => {
    const map = new Map();
    for (const entry of entries) {
      const account = entry.Account;
      if (!account) continue;
      if (!map.has(account)) map.set(account, new Map());
      const byYear = map.get(account);
      const year = Number(entry.Year);
      byYear.set(year, (byYear.get(year) || 0) + (Number(entry.Amount) || 0));
    }
    return map;
  }, [entries]);

  const netAssetsAccountBreakdown = useMemo(() => {
    const accounts = [];
    for (const row of balanceAccounts) {
      if (row.level !== 2) continue;
      const values = balanceDisplayValues.get(row.label);
      if (!values) continue;
      const mapping = balanceAccountMap.get(row.label);
      const sign = mapping?.level1 === "Liabilities" ? -1 : 1;
      accounts.push({
        label: row.label,
        level1: mapping?.level1,
        values: values.map((v) => (Number.isFinite(Number(v)) ? Number(v) * sign : 0)),
      });
    }
    return accounts;
  }, [balanceAccounts, balanceDisplayValues, balanceAccountMap]);

  // =============================================================================
  // COMPUTED VALUES - KPI Summary Data
  // =============================================================================

  const kpiValues = useMemo(() => {
    if (!sortedYears.length || (!entries.length && !baseActualTotalsByYear.size)) {
      return null;
    }

    // Helper: get income/expense/net for each year
    const incomeByYear = sortedYears.map((year) => {
      const row = { label: "Income", level: 1 };
      return { value: getCellValue(row, year, true) ?? 0 };
    });

    const expenseByYear = sortedYears.map((year) => {
      const row = { label: "Expense", level: 1 };
      return { value: getCellValue(row, year, true) ?? 0 };
    });

    const netCashFlowByYear = sortedYears.map((year) => {
      const row = { isNet: true };
      return { value: getCellValue(row, year, true) ?? 0 };
    });

    const totalAssetsByYearChart = totalAssetsByYear.map((v) => ({
      value: Number.isFinite(v) ? v : 0,
    }));

    const lastYear = sortedYears.length - 1;
    const prevYear = Math.max(0, lastYear - 1);

    return {
      incomeLatest: incomeByYear[lastYear]?.value ?? 0,
      incomeChange: (incomeByYear[lastYear]?.value ?? 0) - (incomeByYear[prevYear]?.value ?? 0),
      incomeChart: incomeByYear,
      expenseLatest: expenseByYear[lastYear]?.value ?? 0,
      expenseChange: (expenseByYear[lastYear]?.value ?? 0) - (expenseByYear[prevYear]?.value ?? 0),
      expenseChart: expenseByYear,
      netLatest: netCashFlowByYear[lastYear]?.value ?? 0,
      netChange: (netCashFlowByYear[lastYear]?.value ?? 0) - (netCashFlowByYear[prevYear]?.value ?? 0),
      netChart: netCashFlowByYear,
      assetsLatest: totalAssetsByYearChart[lastYear]?.value ?? 0,
      assetsChange: (totalAssetsByYearChart[lastYear]?.value ?? 0) - (totalAssetsByYearChart[prevYear]?.value ?? 0),
      assetsChart: totalAssetsByYearChart,
      lastYearLabel: sortedYears[lastYear],
      prevYearLabel: sortedYears[prevYear],
    };
  }, [sortedYears, entries, baseActualTotalsByYear, getCellValue, totalAssetsByYear]);

  // =============================================================================
  // COMPUTED VALUES - Cash health warnings (CR045)
  // =============================================================================

  const forecastWarnings = useMemo(() => {
    if (!sortedYears.length || !entries.length) return [];
    return computeForecastWarnings({
      years: sortedYears,
      bankBalanceByYear: balanceDisplayValues.get("Bank Accounts") || [],
      entries,
      modules: fcModules,
      cashSweepLow,
    });
  }, [sortedYears, entries, balanceDisplayValues, fcModules, cashSweepLow]);

  // =============================================================================
  // ACTIONS - Export Excel
  // =============================================================================

  const handleExcelExport = useCallback(() => {
    if (
      !selectedScenario ||
      generateLoading ||
      yearsLoading ||
      entriesLoading ||
      accountsLoading ||
      balanceLoading ||
      baseActualLoading ||
      baseBalanceLoading ||
      !sortedYears.length
    ) {
      return;
    }

    const thStyleBase =
      "padding:8px 10px;border:1px solid #E8E6DF;background:#FAF9F5;font-weight:700;text-align:left;";
    const tdStyleBase = "padding:6px 10px;border:1px solid #E8E6DF;";
    const sectionBorder = "2px solid #4A5568";

    const headerRow = sortedYears
      .map((year) => {
        const isBase = baseYears.has(Number(year));
        const isLastActual = lastActualYears.has(Number(year));
        const isPreForecast = isBase || isLastActual;
        const preStyle = isPreForecast
          ? "background:linear-gradient(180deg,#FAF9F5 0%,#F0EFE9 100%);font-weight:700;border-left:1px solid #D5D2C9;border-right:1px solid #D5D2C9;"
          : "";
        const columnLabel = isBase
          ? '<div style="font-size:11px;color:#808E9B;">(Budget)</div>'
          : isLastActual
          ? '<div style="font-size:11px;color:#808E9B;">(Actual)</div>'
          : "";
        return `<th style="${thStyleBase}${preStyle};min-width:120px;text-align:center;">${year}${columnLabel}</th>`;
      })
      .join("");

    const formatLabelCell = (label, level, extraStyle = "", sectionBorders = "") => {
      const weight = level === 1 ? 700 : level === 2 ? 600 : 500;
      const padding =
        level === 3 ? "padding-left:40px;" : level === 2 ? "padding-left:28px;" : "padding-left:12px;";
      return `<td style="${tdStyleBase}${padding}font-weight:${weight};${extraStyle}${sectionBorders}">${label}</td>`;
    };

    const cashRowsHtml = cashRowsWithNet
      .map((row, index) => {
        const isTransfers = row.label === "Transfers";
        const isCashFlow = row.isCashFlow;
        const isFirstCashRow = index === 0;
        const isLastCashRow = index === cashRowsWithNet.length - 1;
        const label = row.isNet ? "Net Cash Flow" : isCashFlow ? "Cash Flow" : row.label;
        const labelBg = row.isNet
          ? "background:#FAF9F5;font-weight:700;color:#2D3436;"
          : isCashFlow
          ? "background:#FAF9F5;"
          : "";

        const cashSectionBorders = `border-left:${sectionBorder};border-right:${sectionBorder};${
          isFirstCashRow ? `border-top:${sectionBorder};` : ""
        }${isLastCashRow ? `border-bottom:${sectionBorder};` : ""}`;

        const cells = sortedYears
          .map((year) => {
            const value = getCellValue(row, year, true);
            const isBase = baseYears.has(Number(year));
            const numStyle = Number(value) < 0 ? "color:#C0504D;" : "";
            const baseStyle = isBase
              ? "background:#FAF9F5;border-left:1px solid #D5D2C9;border-right:1px solid #D5D2C9;"
              : "";
            const transferStyle =
              isTransfers && !isBase
                ? "border-top:2px solid #7FA37F;border-bottom:2px solid #7FA37F;"
                : "";
            const netStyle = row.isNet ? "background:#FAF9F5;font-weight:600;" : "";
            const cashFlowStyle = isCashFlow ? "background:#FAF9F5;font-weight:600;" : "";
            return `<td style="${tdStyleBase}${numStyle}${baseStyle}${transferStyle}${netStyle}${cashFlowStyle}text-align:right;${cashSectionBorders}">${formatAmount(
              value
            )}</td>`;
          })
          .join("");
        return `<tr>${formatLabelCell(label, row.level || 1, labelBg, cashSectionBorders)}${cells}</tr>`;
      })
      .join("");

    const balanceRowsHtml = balanceAccounts
      .map((row, index) => {
        const isBank = row.label === "Bank Accounts";
        const isFirstBalanceRow = index === 0;
        const isLastBalanceRow = index === balanceAccounts.length - 1;
        const labelBg = isBank ? "background:#fff5f5;" : "";

        const balanceSectionBorders = `border-left:${sectionBorder};border-right:${sectionBorder};${
          isFirstBalanceRow ? `border-top:${sectionBorder};` : ""
        }${isLastBalanceRow ? `border-bottom:${sectionBorder};` : ""}`;

        const cells = sortedYears
          .map((year, yearIndex) => {
            const values =
              row.label === "Assets"
                ? totalAssetsByYear
                : balanceDisplayValues.get(row.label);
            const displayValue =
              values?.[yearIndex] ?? getCellValue(row, year, false);
            const isBase = baseYears.has(Number(year));
            const baseStyle = isBase
              ? "background:#fafafa;border-left:1px solid #cbd5e0;border-right:1px solid #cbd5e0;"
              : "";
            const bankStyle =
              isBank && !isBase
                ? "background:#fff5f5;border-top:2px solid #C0504D;border-bottom:2px solid #C0504D;"
                : isBank
                ? "background:#fff5f5;"
                : "";
            const dangerStyle = Number(displayValue) < 0 ? "color:#C0504D;" : "";
            return `<td style="${tdStyleBase}${baseStyle}${bankStyle}${dangerStyle}text-align:right;${balanceSectionBorders}">${formatAmount(
              displayValue
            )}</td>`;
          })
          .join("");
        return `<tr>${formatLabelCell(row.label, row.level, labelBg, balanceSectionBorders)}${cells}</tr>`;
      })
      .join("");

    const dividerRow =
      balanceAccounts.length > 0 && cashAccounts.length > 0
        ? `<tr><td style="padding:0;border-top:2px solid #E8E6DF;height:12px;"></td>${sortedYears
            .map((year) => {
              const isBase = baseYears.has(Number(year));
              const baseStyle = isBase
                ? "background:#fafafa;border-left:1px solid #cbd5e0;border-right:1px solid #cbd5e0;"
                : "";
              return `<td style="padding:0;border-top:2px solid #E8E6DF;height:12px;${baseStyle}"></td>`;
            })
            .join("")}</tr>`
        : "";

    const tableHtml = `<table style="border-collapse:collapse;font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;color:#2D3436;width:100%;">
      <thead>
        <tr>
          <th style="${thStyleBase}min-width:240px;">Account</th>
          ${headerRow}
        </tr>
      </thead>
      <tbody>
        ${cashRowsHtml}
        ${dividerRow}
        ${balanceRowsHtml}
      </tbody>
    </table>`;

    const documentStyles = `
      body { margin: 16px; background: #ffffff; }
      h2 { margin: 0 0 12px; font-size: 18px; color: #2D3436; }
      p { margin: 4px 0 12px; color: #4A5568; font-size: 12px; }
    `;

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <style>${documentStyles}</style>
        </head>
        <body>
          <h2>Forecast Review - ${selectedScenario}</h2>
          <p>Years: ${sortedYears[0]} - ${sortedYears[sortedYears.length - 1]}</p>
          ${tableHtml}
        </body>
      </html>
    `;

    const blob = new Blob([html], {
      type: "application/vnd.ms-excel;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const safeScenario = String(selectedScenario || "export")
      .replace(/[^a-z0-9\-._\s]/gi, "_")
      .replace(/\s+/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "")
      .trim();
    const filename =
      safeScenario.length > 0
        ? `ForecastReview-${safeScenario}.xls`
        : "ForecastReview-export.xls";
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [
    selectedScenario,
    generateLoading,
    yearsLoading,
    entriesLoading,
    accountsLoading,
    balanceLoading,
    baseActualLoading,
    baseBalanceLoading,
    sortedYears,
    baseYears,
    cashRowsWithNet,
    getCellValue,
    balanceAccounts,
    cashAccounts,
    totalAssetsByYear,
    balanceDisplayValues,
  ]);

  // =============================================================================
  // RENDER
  // =============================================================================

  const collectBreakdownEntries = useCallback(
    (row, year, isCashSection) => {
      const targetYear = Number(year);
      if (!Number.isFinite(targetYear)) {
        return [];
      }

      return entries.filter((entry) => {
        const entryYear = Number(entry?.Year);
        const account = entry?.Account;
        if (!Number.isFinite(entryYear) || !account) {
          return false;
        }

        if (isCashSection) {
          const mapping = cashAccountMap.get(account);
          const level1 = mapping?.level1;
          const level2 = mapping?.level2 || account;

          if (row.isNet) {
            const isIncomeOrExpense =
              level1 === "Income" || level1 === "Expense";
            return isIncomeOrExpense && entryYear === targetYear;
          }

          if (row.level === 1) {
            return level1 === row.label && entryYear === targetYear;
          }

          return level2 === row.label && entryYear === targetYear;
        }

        const mapping = balanceAccountMap.get(account);
        const balL1 =
          mapping?.level1 ||
          (balanceLevel1Labels.has(account) ? account : undefined);
        const balL2 =
          mapping?.level2 ||
          (balanceLevel2Labels.has(account) ? account : undefined);
        const balTarget = balL2 || account;
        const matchesRow =
          (row.level === 1 ? balL1 === row.label : balTarget === row.label) ||
          row.label === balL1;

        if (!matchesRow) {
          return false;
        }

        const entryIsBank =
          balL2 === "Bank Accounts" || bankAccountLabels.has(balTarget);
        return entryIsBank ? entryYear <= targetYear : entryYear === targetYear;
      });
    },
    [
      entries,
      cashAccountMap,
      balanceAccountMap,
      balanceLevel1Labels,
      balanceLevel2Labels,
      bankAccountLabels,
    ]
  );

  const handleCellDoubleClick = useCallback(
    (row, year, isCashSection) => {
      const entryList = collectBreakdownEntries(row, year, isCashSection);
      const sortedList = [...entryList].sort(
        (a, b) => Number(b?.Amount ?? 0) - Number(a?.Amount ?? 0)
      );
      const entryTotal = sortedList.reduce(
        (sum, entry) => sum + Number(entry?.Amount ?? 0),
        0
      );

      const yearIndex = sortedYears.findIndex(
        (y) => Number(y) === Number(year)
      );
      let displayValue = null;
      if (isCashSection) {
        displayValue = getCellValue(row, year, true);
      } else if (yearIndex >= 0) {
        displayValue =
          row.label === "Assets"
            ? totalAssetsByYear[yearIndex]
            : balanceDisplayValues.get(row.label)?.[yearIndex] ??
              getCellValue(row, year, false);
      }

      setBreakdownModal({
        isOpen: true,
        title: `${row.label} • ${year}`,
        amount: displayValue,
        entryTotal,
        entries: sortedList,
      });
    },
    [
      collectBreakdownEntries,
      sortedYears,
      getCellValue,
      totalAssetsByYear,
      balanceDisplayValues,
    ]
  );

  const closeBreakdownModal = useCallback(() => {
    setBreakdownModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleCashTransferClick = useCallback((row, year) => {
    setCashTransferModal({
      isOpen: true,
      title: `${row.label} • ${year}`,
      year,
    });
  }, []);

  const closeCashTransferModal = useCallback(() => {
    setCashTransferModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleTransferComplete = useCallback(() => {
    // Close all modals
    setBreakdownModal((prev) => ({ ...prev, isOpen: false }));
    setCashTransferModal((prev) => ({ ...prev, isOpen: false }));
    // Reload forecast data after transfer
    reloadForecastData();
  }, [reloadForecastData]);

  const scrollTableByYears = useCallback((direction) => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) return;

    const firstYearHeader = tableRef.current?.querySelector(
      "thead th:nth-child(2)"
    );
    const yearWidth = firstYearHeader?.getBoundingClientRect().width || 120;
    const scrollDistance = yearWidth * 10;

    wrapper.scrollBy({
      left: direction === "right" ? scrollDistance : -scrollDistance,
      behavior: "smooth",
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoomLevel((prev) => Math.min(prev + 0.1, 2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((prev) => Math.max(prev - 0.1, 0.5));
  }, []);

  const handleToggleSeries = useCallback(
    (series) => {
      if (!series || !series.id) return;
      const numericValues = sortedYears.map((_, index) => {
        const value = series.values?.[index];
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
      });

      setSelectedSeries((prev) => {
        const exists = prev.find((item) => item.id === series.id);
        if (exists) {
          return prev.filter((item) => item.id !== series.id);
        }
        return [...prev, { ...series, values: numericValues }];
      });
    },
    [sortedYears]
  );

  const handleGraphClick = useCallback(() => {
    if (selectedSeries.length === 0) return;
    setGraphModalOpen(true);
  }, [selectedSeries.length]);

  const handleAccountDoubleClick = useCallback(
    (series) => {
      if (!series || !series.id) return;

      // CR046: expand the row into the accounts beneath it and stack them, the way
      // Net Assets already did. A row with nothing under it falls through to the
      // single-line chart below — the old behavior.
      const isCash = series.side === "cash";
      const accountMap = isCash ? cashAccountMap : balanceAccountMap;
      const breakdown = buildBreakdownSeries({
        label: series.label,
        level: series.level,
        sortedYears,
        accountMap,
        valuesForLevel2: (label) =>
          isCash
            ? sortedYears.map((year) => getCellValue({ label, level: 2 }, year, true) ?? 0)
            : balanceDisplayValues.get(label) || [],
        leafValues: leafValuesByAccount,
        palette: BAR_CHART_COLORS,
        // The Expense row is displayed net of Transfers (getCellValue subtracts them, and
        // Transfers gets its own row), so its breakdown must drop them too — otherwise the
        // stack totals to a number the row above it doesn't show.
        excludeChildren: isCash && series.label === "Expense" ? ["Transfers"] : [],
      });

      if (breakdown.length > 0) {
        setSelectedSeries(breakdown);
        setBreakdownLabel(series.label);
        setGraphMode("bar");
        setGraphModalOpen(true);
        return;
      }

      const numericValues = sortedYears.map((_, index) => {
        const value = series.values?.[index];
        const num = Number(value);
        return Number.isFinite(num) ? num : 0;
      });
      setSelectedSeries([{ id: series.id, label: series.label, values: numericValues }]);
      setGraphMode("line");
      setGraphModalOpen(true);
    },
    [
      sortedYears,
      cashAccountMap,
      balanceAccountMap,
      balanceDisplayValues,
      leafValuesByAccount,
      getCellValue,
    ]
  );

  const handleNetAssetsDoubleClick = useCallback(() => {
    const barSeries = netAssetsAccountBreakdown.map((acct, idx) => ({
      id: `net-assets-${acct.label}`,
      label: acct.label,
      values: acct.values,
      color: BAR_CHART_COLORS[idx % BAR_CHART_COLORS.length],
    }));
    setSelectedSeries(barSeries);
    setBreakdownLabel("Net Assets");
    setGraphMode("bar");
    setGraphModalOpen(true);
  }, [netAssetsAccountBreakdown]);

  const handleCloseGraph = useCallback(() => {
    setGraphModalOpen(false);
    setGraphMode("line");
  }, []);

  // Graph point double-click → open adjustment modal (FC Exp or FC Module)
  const handleGraphPointDoubleClick = useCallback(
    (seriesId, seriesLabel, yearIndex, year, currentValue) => {
      // Check FC Exp entries first (cash flow / P&L series)
      const expEntries = fcExpByLabel.get(seriesLabel);
      if (expEntries && expEntries.length > 0) {
        const entry = expEntries[0];
        setGraphAdjustModal({
          isOpen: true,
          entry,
          year: Number(year),
          currentValue,
          seriesLabel,
        });
        return;
      }

      // Check FC Modules (balance sheet series)
      const modules = fcModulesByLabel.get(seriesLabel);
      if (modules && modules.length > 0) {
        // If multiple modules under this label, pick the first for now
        const mod = modules[0];
        setGraphModuleAdjustModal({
          isOpen: true,
          moduleId: mod.id,
          year: Number(year),
          currentValue,
          seriesLabel,
        });
        return;
      }
    },
    [fcExpByLabel, fcModulesByLabel]
  );

  const handleCloseGraphAdjust = useCallback(() => {
    setGraphAdjustModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleGraphAdjustSave = useCallback(
    async (entryId, change) => {
      // 1. Find the entry from our cached fcExpEntries (avoid re-fetch race conditions)
      const entry = fcExpEntries.find((e) => String(e.id) === String(entryId));
      if (!entry) throw new Error("Income/Expense item not found");

      // 2. Merge changes: replace existing change for this year/flag or add new
      const existingChanges = Array.isArray(entry.Changes) ? [...entry.Changes] : [];
      const changeYear = change.Date.slice(0, 4);
      const existingIdx = existingChanges.findIndex(
        (c) => c.Date && c.Date.slice(0, 4) === changeYear && c.Flag === change.Flag
      );
      if (existingIdx >= 0) {
        existingChanges[existingIdx] = change;
      } else {
        existingChanges.push(change);
      }

      // 3. Save via PUT
      await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense/${encodeURIComponent(entryId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Changes: existingChanges }),
        }
      );

      // 4. Regenerate forecast
      await Rest.fetchJson(
        `/api/v2/forecast/generate/${encodeURIComponent(selectedScenario)}`,
        { method: "POST" }
      );

      // 5. Reload data
      reloadForecastData();

      // 6. Refresh FC Exp entries cache
      const refreshed = await Rest.fetchJson(
        `/api/v2/forecast/incomeexpense?scenario=${encodeURIComponent(selectedScenario)}`
      );
      setFcExpEntries(refreshed?.entries || []);

      // 7. Close adjust modal (graph stays open — it will re-render with new data)
      setGraphAdjustModal((prev) => ({ ...prev, isOpen: false }));
    },
    [selectedScenario, reloadForecastData, fcExpEntries]
  );

  // FC Module adjust modal handlers
  const handleCloseGraphModuleAdjust = useCallback(() => {
    setGraphModuleAdjustModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleGraphModuleAdjustSave = useCallback(
    async (moduleId, invest, dispose) => {
      // 1. Save via PUT (sends full Invest/Dispose arrays)
      await Rest.fetchJson(
        `/api/v2/forecast/modules/${encodeURIComponent(moduleId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Invest: invest, Dispose: dispose }),
        }
      );

      // 2. Regenerate forecast
      await Rest.fetchJson(
        `/api/v2/forecast/generate/${encodeURIComponent(selectedScenario)}`,
        { method: "POST" }
      );

      // 3. Reload data
      reloadForecastData();

      // 4. Refresh FC Modules cache
      const refreshed = await Rest.fetchJson(
        `/api/v2/forecast/modules?scenario=${encodeURIComponent(selectedScenario)}`
      );
      setFcModules(Array.isArray(refreshed) ? refreshed : []);

      // 5. Close modal (graph stays open)
      setGraphModuleAdjustModal((prev) => ({ ...prev, isOpen: false }));
    },
    [selectedScenario, reloadForecastData]
  );

  // AI Review drawer
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [aiReviewHasUnread, setAiReviewHasUnread] = useState(false);
  const handleAIReviewClick = useCallback(() => setAiDrawerOpen(true), []);
  const handleCloseAIDrawer = useCallback(() => setAiDrawerOpen(false), []);

  // Cash Sweep modal
  const [cashSweepOpen, setCashSweepOpen] = useState(false);
  const handleCashSweepClick = useCallback(() => setCashSweepOpen(true), []);
  const handleCloseCashSweep = useCallback(() => setCashSweepOpen(false), []);

  const selectedSeriesIds = useMemo(
    () => new Set(selectedSeries.map((series) => series.id)),
    [selectedSeries]
  );

  // Refresh selected series values when forecast data changes (e.g., after regeneration)
  useEffect(() => {
    if (selectedSeries.length === 0 || !sortedYears.length) return;
    setSelectedSeries((prev) =>
      prev.map((series) => {
        const isCash = series.id.startsWith("cash-");
        const isBalance = series.id.startsWith("balance-");
        if (!isCash && !isBalance) return series;

        const label = series.label;
        const newValues = sortedYears.map((year) => {
          if (isCash) {
            // Rebuild cash row to match getCellValue
            const isNet = label === "Net Cash Flow";
            const isCashFlow = label === "Cash Flow";
            const row = isNet
              ? { label, isNet: true }
              : isCashFlow
              ? { label, isCashFlow: true }
              : { label, level: cashAccountMap.get(label) ? 2 : 1 };
            const val = getCellValue(row, year, true);
            const num = Number(val);
            return Number.isFinite(num) ? num : 0;
          }
          // Balance
          const row = { label, level: balanceAccountMap.get(label) ? 2 : 1 };
          const yearIndex = sortedYears.indexOf(year);
          const values =
            label === "Assets"
              ? totalAssetsByYear
              : balanceDisplayValues.get(label);
          const val = values?.[yearIndex] ?? getCellValue(row, year, false);
          const num = Number(val);
          return Number.isFinite(num) ? num : 0;
        });

        return { ...series, values: newValues };
      })
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryMaps]);

  const graphDisabled =
    !selectedScenario ||
    selectedSeries.length === 0;

  const graphSeries = useMemo(
    () =>
      selectedSeries.map((series, index) => ({
        ...series,
        // Keep a series' own color when it has one (stacked breakdowns pick from
        // BAR_CHART_COLORS); only line series fall back to the 6-color line palette.
        color: series.color ?? GRAPH_COLORS[index % GRAPH_COLORS.length],
        hasModule: fcExpByLabel.has(series.label) || fcModulesByLabel.has(series.label),
      })),
    [selectedSeries, fcExpByLabel, fcModulesByLabel]
  );

  return (
    <>
      <main className="page-main trans-budget-main">
        <FCStepNav />
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
          onExcelExport={handleExcelExport}
          excelDisabled={
            !selectedScenario ||
            generateLoading ||
            yearsLoading ||
            entriesLoading ||
            accountsLoading ||
            balanceLoading ||
            baseActualLoading ||
            baseBalanceLoading
          }
          onGraphClick={handleGraphClick}
          graphDisabled={graphDisabled}
          onAIReviewClick={handleAIReviewClick}
          aiReviewDisabled={!selectedScenario}
          aiReviewHasUnread={aiReviewHasUnread}
          onCashSweepClick={handleCashSweepClick}
          cashSweepDisabled={!selectedScenario}
        />
        {kpiValues && (
          <KpiCardRow>
            <KpiCard
              title="Total Assets"
              value={kpiValues.assetsLatest}
              icon={<Landmark size={16} />}
              changeValue={kpiValues.assetsChange}
              changeLabel={`vs ${kpiValues.prevYearLabel}`}
              positiveIsGood={true}
              chartData={kpiValues.assetsChart}
              chartType="area"
              chartColor="#567856"
            />
            <KpiCard
              title="Net Cash Flow"
              value={kpiValues.netLatest}
              icon={<DollarSign size={16} />}
              changeValue={kpiValues.netChange}
              changeLabel={`vs ${kpiValues.prevYearLabel}`}
              positiveIsGood={true}
              chartData={kpiValues.netChart}
              chartType="area"
              chartColor="#5B8C5B"
            />
            <KpiCard
              title="Income"
              value={kpiValues.incomeLatest}
              icon={<TrendingUp size={16} />}
              changeValue={kpiValues.incomeChange}
              changeLabel={`vs ${kpiValues.prevYearLabel}`}
              positiveIsGood={true}
              chartData={kpiValues.incomeChart}
              chartType="area"
              chartColor="#059669"
            />
            <KpiCard
              title="Expenses"
              value={kpiValues.expenseLatest}
              icon={<TrendingDown size={16} />}
              changeValue={kpiValues.expenseChange}
              changeLabel={`vs ${kpiValues.prevYearLabel}`}
              positiveIsGood={false}
              chartData={kpiValues.expenseChart}
              chartType="area"
              chartColor="#C0504D"
            />
          </KpiCardRow>
        )}
        {sortedYears.length > 0 && entries.length > 0 && (
          <FCReviewWarnings warnings={forecastWarnings} />
        )}
        <FCReviewTable
          sortedYears={sortedYears}
          baseYear={baseYear}
          baseYears={baseYears}
          lastActualYears={lastActualYears}
          birthYear={birthYear}
          baseYearBudget={baseYearValues}
          baseActualTotalsByYear={baseActualTotalsByYear}
          categoryToLineMap={categoryToLineMap}
          cashAccountMap={cashAccountMap}
          periodStart={periodStart}
          tableColSpan={tableColSpan}
          yearsLoading={yearsLoading}
          accountsLoading={accountsLoading}
          balanceLoading={balanceLoading}
          entriesLoading={entriesLoading}
          baseActualLoading={baseActualLoading}
          baseBalanceLoading={baseBalanceLoading}
          tableError={tableError}
          selectedScenario={selectedScenario}
          cashAccounts={cashAccounts}
          balanceAccounts={balanceAccounts}
          cashRowsWithNet={cashRowsWithNet}
          transferDetailRows={transferDetailRows}
          getCellValue={getCellValue}
          balanceDisplayValues={balanceDisplayValues}
          balanceAccountMap={balanceAccountMap}
          bankAccountLabels={bankAccountLabels}
          totalAssetsByYear={totalAssetsByYear}
          totalLiabilitiesByYear={totalLiabilitiesByYear}
          netAssetsByYear={netAssetsByYear}
          onNetAssetsDoubleClick={handleNetAssetsDoubleClick}
          onCellDoubleClick={handleCellDoubleClick}
          onCashTransferClick={handleCashTransferClick}
          selectedSeriesIds={selectedSeriesIds}
          onToggleSeries={handleToggleSeries}
          onAccountDoubleClick={handleAccountDoubleClick}
          tableWrapperRef={tableWrapperRef}
          tableRef={tableRef}
          scrollTableByYears={scrollTableByYears}
          zoomLevel={zoomLevel}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />
      </main>
      <FCReviewBreakdownModal
        breakdownModal={breakdownModal}
        onClose={closeBreakdownModal}
        scenarioName={selectedScenario}
        onTransferComplete={handleTransferComplete}
      />
      <FCCashTransferModal
        isOpen={cashTransferModal.isOpen}
        onClose={closeCashTransferModal}
        title={cashTransferModal.title}
        year={cashTransferModal.year}
        scenarioName={selectedScenario}
        onTransferComplete={handleTransferComplete}
      />
      <FCReviewTableGraphModal
        isOpen={graphModalOpen}
        onClose={handleCloseGraph}
        graphSeries={graphSeries}
        sortedYears={sortedYears}
        birthYear={birthYear}
        chartMode={graphMode}
        breakdownLabel={breakdownLabel}
        onPointDoubleClick={handleGraphPointDoubleClick}
      />
      <FCGraphAdjustModal
        isOpen={graphAdjustModal.isOpen}
        onClose={handleCloseGraphAdjust}
        onSave={handleGraphAdjustSave}
        entry={graphAdjustModal.entry}
        year={graphAdjustModal.year}
        currentValue={graphAdjustModal.currentValue}
        seriesLabel={graphAdjustModal.seriesLabel}
      />
      <FCGraphModuleAdjustModal
        isOpen={graphModuleAdjustModal.isOpen}
        onClose={handleCloseGraphModuleAdjust}
        onSave={handleGraphModuleAdjustSave}
        moduleId={graphModuleAdjustModal.moduleId}
        year={graphModuleAdjustModal.year}
        currentValue={graphModuleAdjustModal.currentValue}
        seriesLabel={graphModuleAdjustModal.seriesLabel}
        selectedScenario={selectedScenario}
      />
      <FCAIReviewDrawer
        isOpen={aiDrawerOpen}
        onClose={handleCloseAIDrawer}
        scenarioName={selectedScenario}
        onUnreadChange={setAiReviewHasUnread}
      />
      <FCCashSweepModal
        isOpen={cashSweepOpen}
        onClose={handleCloseCashSweep}
        scenario={selectedScenario}
      />
    </>
  );
}
