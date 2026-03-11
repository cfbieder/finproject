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
import { useScenarios } from "../features/Forecast/hooks/useScenarios.js";
import { useCashFlowAccounts } from "../features/Forecast/hooks/useCashFlowAccounts.js";
import { useBalanceSheetAccounts } from "../features/Forecast/hooks/useBalanceSheetAccounts.js";
import { useForecastData } from "../features/Forecast/hooks/useForecastData.js";
import { useBaseYearActuals } from "../features/Forecast/hooks/useBaseYearActuals.js";
import { useBaseYearBalanceSheet } from "../features/Forecast/hooks/useBaseYearBalanceSheet.js";
import FCReviewTable from "../features/Forecast/FCReviewTable.jsx";
import FCReviewBreakdownModal from "../features/Forecast/FCReviewBreakdownModal.jsx";
import FCCashTransferModal from "../features/Forecast/FCCashTransferModal.jsx";
import FCReviewTableGraphModal from "../features/Forecast/FCReviewTableGraphModal.jsx";
import { formatAmount } from "../features/Forecast/utils/fcReviewUtils.js";
import { KpiCard, KpiCardRow } from "../components/KpiCards.jsx";
import { TrendingUp, TrendingDown, DollarSign, Landmark } from "lucide-react";
import Rest from "../js/rest.js";
import "./PageLayout.css";

const GRAPH_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#0ea5e9",
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

  // Get the selected scenario object to access PeriodStart
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

  const tableWrapperRef = useRef(null);
  const tableRef = useRef(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Clear generation state when scenario changes
  useEffect(() => {
    setGenerateError("");
    setGenerateResult(null);
    setSelectedSeries([]);
    setGraphModalOpen(false);
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

  // Calculate base years (PeriodStart - 2 and PeriodStart - 1)
  const baseYears = useMemo(() => {
    const yearsSet = new Set();
    if (periodStart) {
      yearsSet.add(Number(periodStart) - 2);
      yearsSet.add(Number(periodStart) - 1);
    }
    return yearsSet;
  }, [periodStart]);

  // Combine base years with forecast years for display
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

      // ========== Cash Flow - Base Year Actuals ==========
    if (isCashSection && isBaseYear) {
      const yearData = baseActualTotalsByYear.get(numericYear);
      if (!yearData) return null;

      if (row.isCashFlow) {
        const income = yearData.level1.get("Income");
        const expense = yearData.level1.get("Expense");
        const transfers =
          yearData.level1.get("Transfers") ||
          yearData.level2.get("Transfers") ||
          0;
        if (income == null && expense == null) {
          return null;
        }
        const expenseAdjusted =
          (expense == null ? 0 : expense) - transfers;
        return (income == null ? 0 : income) + expenseAdjusted;
      }

      if (row.isNet) {
        return yearData.net;
      }
      if (row.level === 1) {
        const baseValue = yearData.level1.get(row.label);
        if (row.label === "Expense") {
          const transfersBase =
            yearData.level1.get("Transfers") ||
            yearData.level2.get("Transfers") ||
            0;
          return baseValue == null ? null : baseValue - transfersBase;
        }
        return baseValue ?? null;
      }
      return yearData.level2.get(row.label) ?? null;
      }

      // ========== Balance Sheet - Base Year Actuals ==========
      if (!isCashSection && isBaseYear) {
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
    [baseYears, baseActualTotalsByYear, baseBalanceTotalsByYear, entryMaps]
  );

  /**
   * Computes display values for balance sheet rows with special handling for bank accounts.
   *
   * Bank accounts use cumulative totals (running sum across years) to reflect
   * year-end balances, while other accounts show their direct forecast values.
   *
   * @returns {Map<string, Array<number>>} Map of account label to array of values per year
   */
  const balanceDisplayValues = useMemo(() => {
    const valuesByRow = new Map();
    for (const row of balanceAccounts) {
      let runningBankTotal;
      const perYear = sortedYears.map((year, index) => {
        const baseValue = getCellValue(row, year, false);
        if (row.label === "Bank Accounts" || bankAccountLabels.has(row.label)) {
          const numericValue = Number.isFinite(Number(baseValue))
            ? Number(baseValue)
            : 0;
          if (index === 0) {
            runningBankTotal = numericValue;
          } else {
            runningBankTotal = (runningBankTotal ?? 0) + numericValue;
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
  }, [balanceAccounts, sortedYears, getCellValue, bankAccountLabels]);

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
      "padding:8px 10px;border:1px solid #d9e2ec;background:#f8fafc;font-weight:700;text-align:left;";
    const tdStyleBase = "padding:6px 10px;border:1px solid #e2e8f0;";
    const sectionBorder = "2px solid #334155";

    const headerRow = sortedYears
      .map((year) => {
        const isBase = baseYears.has(Number(year));
        const baseStyle = isBase
          ? "background:linear-gradient(180deg,#f8f9fa 0%,#e9ecef 100%);font-weight:700;border-left:1px solid #cbd5e0;border-right:1px solid #cbd5e0;"
          : "";
        const actualLabel = isBase
          ? '<div style="font-size:11px;color:#6b7280;">(Actual)</div>'
          : "";
        return `<th style="${thStyleBase}${baseStyle};min-width:120px;text-align:center;">${year}${actualLabel}</th>`;
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
          ? "background:#f8fafc;font-weight:700;color:#0f172a;"
          : isCashFlow
          ? "background:#f8fafc;"
          : "";

        const cashSectionBorders = `border-left:${sectionBorder};border-right:${sectionBorder};${
          isFirstCashRow ? `border-top:${sectionBorder};` : ""
        }${isLastCashRow ? `border-bottom:${sectionBorder};` : ""}`;

        const cells = sortedYears
          .map((year) => {
            const value = getCellValue(row, year, true);
            const isBase = baseYears.has(Number(year));
            const numStyle = Number(value) < 0 ? "color:#dc2626;" : "";
            const baseStyle = isBase
              ? "background:#fafafa;border-left:1px solid #cbd5e0;border-right:1px solid #cbd5e0;"
              : "";
            const transferStyle =
              isTransfers && !isBase
                ? "border-top:2px solid #3b82f6;border-bottom:2px solid #3b82f6;"
                : "";
            const netStyle = row.isNet ? "background:#f8fafc;font-weight:600;" : "";
            const cashFlowStyle = isCashFlow ? "background:#f8fafc;font-weight:600;" : "";
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
                ? "background:#fff5f5;border-top:2px solid #ef4444;border-bottom:2px solid #ef4444;"
                : isBank
                ? "background:#fff5f5;"
                : "";
            const dangerStyle = Number(displayValue) < 0 ? "color:#dc2626;" : "";
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
        ? `<tr><td style="padding:0;border-top:2px solid #e2e8f0;height:12px;"></td>${sortedYears
            .map((year) => {
              const isBase = baseYears.has(Number(year));
              const baseStyle = isBase
                ? "background:#fafafa;border-left:1px solid #cbd5e0;border-right:1px solid #cbd5e0;"
                : "";
              return `<td style="padding:0;border-top:2px solid #e2e8f0;height:12px;${baseStyle}"></td>`;
            })
            .join("")}</tr>`
        : "";

    const tableHtml = `<table style="border-collapse:collapse;font-family:Inter,Helvetica,Arial,sans-serif;font-size:12px;color:#0f172a;width:100%;">
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
      h2 { margin: 0 0 12px; font-size: 18px; color: #0f172a; }
      p { margin: 4px 0 12px; color: #475569; font-size: 12px; }
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
      .replace(/[^a-z0-9\-\._\s]/gi, "_")
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

  const handleCloseGraph = useCallback(() => setGraphModalOpen(false), []);

  const selectedSeriesIds = useMemo(
    () => new Set(selectedSeries.map((series) => series.id)),
    [selectedSeries]
  );

  const graphDisabled =
    !selectedScenario ||
    selectedSeries.length === 0 ||
    yearsLoading ||
    entriesLoading ||
    accountsLoading ||
    balanceLoading ||
    baseActualLoading ||
    baseBalanceLoading;

  const graphSeries = useMemo(
    () =>
      selectedSeries.map((series, index) => ({
        ...series,
        color: GRAPH_COLORS[index % GRAPH_COLORS.length],
      })),
    [selectedSeries]
  );

  return (
    <>
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
              chartColor="#1e40af"
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
              chartColor="#047857"
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
              chartColor="#dc2626"
            />
          </KpiCardRow>
        )}
        <FCReviewTable
          sortedYears={sortedYears}
          baseYear={baseYear}
          baseYears={baseYears}
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
          getCellValue={getCellValue}
          balanceDisplayValues={balanceDisplayValues}
          totalAssetsByYear={totalAssetsByYear}
          onCellDoubleClick={handleCellDoubleClick}
          onCashTransferClick={handleCashTransferClick}
          selectedSeriesIds={selectedSeriesIds}
          onToggleSeries={handleToggleSeries}
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
      />
    </>
  );
}
