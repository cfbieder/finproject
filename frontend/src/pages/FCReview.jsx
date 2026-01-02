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
import NavigationMenu from "../components/NavigationMenu.jsx";
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
import { formatAmount } from "../features/Forecast/utils/fcReviewUtils.js";
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

  const tableWrapperRef = useRef(null);
  const tableRef = useRef(null);
  const [zoomLevel, setZoomLevel] = useState(1);

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

        if (row.isNet) {
          return yearData.net;
        }
        if (row.level === 1) {
          return yearData.level1.get(row.label) ?? null;
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
    </div>
  );
}
