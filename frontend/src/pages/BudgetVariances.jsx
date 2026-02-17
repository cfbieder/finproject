import { useCallback, useMemo, useState, useEffect } from "react";
import PeriodSelector from "../components/PeriodSelector/PeriodSelector.jsx";
import BudgetDetailModal from "../features/Budgets/BudgetDetailModal.jsx";
import Rest from "../js/rest.js";
import "../features/CashFlow/CashFlowReport.css";
import "./PageLayout.css";

// ============================================================================
// CURRENCY FORMATTING
// ============================================================================

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrencyValue = (value) => {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const formatted = currencyFormatter.format(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
};

const getValueCellClassName = (value, hasValue, extraClass = "") => {
  const classes = ["balance-report-table__value"];
  if (hasValue && Number(value) < 0) {
    classes.push("balance-report-table__value--negative");
  }
  if (extraClass) {
    classes.push(extraClass);
  }
  return classes.join(" ");
};

// ============================================================================
// DATA PROCESSING
// ============================================================================

const buildLeafActualTotalsMap = (nodes, map = new Map()) => {
  if (!Array.isArray(nodes)) {
    return map;
  }

  for (const node of nodes) {
    if (!node || typeof node !== "object" || !node.name) {
      continue;
    }
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    if (!hasChildren) {
      const numericValue = Number.isFinite(Number(node.total))
        ? Number(node.total)
        : 0;
      map.set(node.name, numericValue);
      continue;
    }
    buildLeafActualTotalsMap(node.children, map);
  }

  return map;
};

const computePeriodRange = (fromMonth, toMonth, year) => {
  const yearNumber = Number.isFinite(Number(year)) ? Number(year) : NaN;
  if (!Number.isFinite(yearNumber)) return null;
  const from = Number.parseInt(fromMonth, 10);
  const to = Number.parseInt(toMonth, 10);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const start = new Date(yearNumber, from - 1, 1);
  const end = new Date(yearNumber, to, 0);
  return { start, end };
};

const formatDateParam = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const CURRENT_MONTH = String(new Date().getMonth() + 1).padStart(2, "0");
const CURRENT_YEAR = new Date().getFullYear();

export default function BudgetVariances() {
  // ========== State ==========
  const [periodValues, setPeriodValues] = useState({
    fromMonth: CURRENT_MONTH,
    toMonth: CURRENT_MONTH,
    actualYear: CURRENT_YEAR,
    budgetYear: CURRENT_YEAR,
  });
  const [leafActualTotals, setLeafActualTotals] = useState(null);
  const [leafBudgetTotals, setLeafBudgetTotals] = useState(null);
  const [entryDetail, setEntryDetail] = useState(null);

  const handlePeriodChange = useCallback((values) => {
    setPeriodValues(values);
  }, []);

  // ========== Computed: Period Range ==========
  const periodRange = useMemo(
    () =>
      computePeriodRange(
        periodValues.fromMonth,
        periodValues.toMonth,
        periodValues.actualYear
      ),
    [periodValues.fromMonth, periodValues.toMonth, periodValues.actualYear]
  );

  // ========== Effects: Fetch Actuals ==========
  useEffect(() => {
    if (!periodRange) {
      setLeafActualTotals(null);
      return;
    }

    const fromDateParam = formatDateParam(periodRange.start);
    const toDateParam = formatDateParam(periodRange.end);
    if (!fromDateParam || !toDateParam) {
      setLeafActualTotals(null);
      return;
    }

    let isActive = true;
    setLeafActualTotals(null);

    const fetchActuals = async () => {
      try {
        const report = await Rest.fetchCashFlowReport({
          fromDate: fromDateParam,
          toDate: toDateParam,
          transfers: "exclude",
          includeUnrealizedGL: false,
        });
        const nodes = Array.isArray(report) ? report : [];
        const totalsMap = buildLeafActualTotalsMap(nodes);
        if (!isActive) return;
        setLeafActualTotals(totalsMap);
      } catch (error) {
        if (!isActive) return;
        console.error("[BudgetVariances] Failed to load actuals:", error);
        setLeafActualTotals(null);
      }
    };

    fetchActuals();

    return () => {
      isActive = false;
    };
  }, [periodRange]);

  // ========== Effects: Fetch Budgets ==========
  useEffect(() => {
    if (!periodRange) {
      setLeafBudgetTotals(null);
      return;
    }

    const fromDateParam = formatDateParam(periodRange.start);
    const toDateParam = formatDateParam(periodRange.end);
    if (!fromDateParam || !toDateParam) {
      setLeafBudgetTotals(null);
      return;
    }

    let isActive = true;
    setLeafBudgetTotals(null);

    const fetchBudgets = async () => {
      try {
        const report = await Rest.fetchBudgetCashFlowReport({
          fromDate: fromDateParam,
          toDate: toDateParam,
          transfers: "exclude",
          includeUnrealizedGL: false,
        });
        const nodes = Array.isArray(report) ? report : [];
        const totalsMap = buildLeafActualTotalsMap(nodes);
        if (!isActive) return;
        setLeafBudgetTotals(totalsMap);
      } catch (error) {
        if (!isActive) return;
        console.error(
          "[BudgetVariances] Failed to load budget totals:",
          error
        );
        setLeafBudgetTotals(null);
      }
    };

    fetchBudgets();

    return () => {
      isActive = false;
    };
  }, [periodRange]);

  // ========== Computed: Variance Rows ==========
  const varianceRows = useMemo(() => {
    if (!leafBudgetTotals && !leafActualTotals) return [];

    const allNames = new Set();
    if (leafBudgetTotals) {
      for (const name of leafBudgetTotals.keys()) allNames.add(name);
    }
    if (leafActualTotals) {
      for (const name of leafActualTotals.keys()) allNames.add(name);
    }

    const rows = [];
    for (const name of allNames) {
      const budget = leafBudgetTotals?.get(name) ?? 0;
      const actual = leafActualTotals?.get(name) ?? 0;
      const variance = actual - budget;
      if (budget === 0 && actual === 0) continue;
      rows.push({
        name,
        budget,
        actual,
        variance,
        absVariance: Math.abs(variance),
      });
    }

    rows.sort((a, b) => b.absVariance - a.absVariance);

    return rows;
  }, [leafBudgetTotals, leafActualTotals]);

  // ========== Handlers: Double-Click ==========
  const handleValueDoubleClick = useCallback(
    (name, type) => {
      if (!periodRange) return;
      setEntryDetail({
        name,
        categories: [name],
        period: periodRange,
        type,
      });
    },
    [periodRange]
  );

  // ========== Computed: Totals ==========
  const totals = useMemo(() => {
    let budget = 0;
    let actual = 0;
    for (const row of varianceRows) {
      budget += row.budget;
      actual += row.actual;
    }
    return { budget, actual, variance: actual - budget };
  }, [varianceRows]);

  // ========== Render ==========
  return (
    <main className="budget-realization-main budget-realization-main--single">
      <div className="budget-realization-content">
        {/* Header */}
        <div className="realization-toolbar-header">
          <div className="realization-toolbar-header__text">
            <h1 className="realization-toolbar-header__title">
              Budget Variances
            </h1>
            <p className="realization-toolbar-header__description">
              Line items ranked by largest budget-to-actual variance for the
              selected period.
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <section className="realization-toolbar" aria-label="Report filters">
          <PeriodSelector
            onChange={handlePeriodChange}
            defaultPreset="this-month"
            hideBudgetYear
            id="variance-period"
          />
        </section>

        {/* Table */}
        <div className="budget-realization-scroll">
          <section className="realization-table-section">
            <div className="budget-realization-table__wrapper">
              <div className="cash-flow-report">
                <table className="balance-report-table">
                  <thead className="balance-report-table__head">
                    <tr>
                      <th
                        className="balance-report-table__category"
                        scope="col"
                      >
                        Category
                      </th>
                      <th scope="col">Budgeted</th>
                      <th scope="col">Actual</th>
                      <th scope="col">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {varianceRows.map((row) => (
                      <tr key={row.name}>
                        <td className="balance-report-table__name">
                          <span className="balance-report-table__name-text">
                            {row.name}
                          </span>
                        </td>
                        <td
                          className={getValueCellClassName(row.budget, true)}
                          onDoubleClick={() => handleValueDoubleClick(row.name, "budget")}
                          style={{ cursor: "pointer" }}
                        >
                          {formatCurrencyValue(row.budget)}
                        </td>
                        <td
                          className={getValueCellClassName(row.actual, true)}
                          onDoubleClick={() => handleValueDoubleClick(row.name, "actual")}
                          style={{ cursor: "pointer" }}
                        >
                          {formatCurrencyValue(row.actual)}
                        </td>
                        <td
                          className={getValueCellClassName(row.variance, true)}
                        >
                          {formatCurrencyValue(row.variance)}
                        </td>
                      </tr>
                    ))}
                    {varianceRows.length === 0 &&
                      (leafBudgetTotals || leafActualTotals) && (
                        <tr>
                          <td
                            colSpan={4}
                            style={{
                              textAlign: "center",
                              padding: "2rem",
                              color: "var(--muted)",
                            }}
                          >
                            No variance data for the selected period.
                          </td>
                        </tr>
                      )}
                  </tbody>
                  {varianceRows.length > 0 && (
                    <tfoot>
                      <tr className="balance-report-table__net-cash-flow">
                        <td className="balance-report-table__name">
                          <span className="balance-report-table__name-text">
                            Total
                          </span>
                        </td>
                        <td className={getValueCellClassName(totals.budget, true)}>
                          {formatCurrencyValue(totals.budget)}
                        </td>
                        <td className={getValueCellClassName(totals.actual, true)}>
                          {formatCurrencyValue(totals.actual)}
                        </td>
                        <td className={getValueCellClassName(totals.variance, true)}>
                          {formatCurrencyValue(totals.variance)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
      <BudgetDetailModal
        detail={entryDetail}
        onClose={() => setEntryDetail(null)}
      />
    </main>
  );
}
