import { useMemo, useState, useEffect } from "react";
import {
  MONTH_OPTIONS,
  YEAR_OPTIONS,
} from "../features/Budgets/BudgetBalancePanel.jsx";
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

const computePeriodRange = (selectedMonth, selectedYear) => {
  const yearNumber = Number.parseInt(selectedYear, 10);
  if (!Number.isFinite(yearNumber)) {
    return null;
  }
  const monthNumber = Number.parseInt(selectedMonth, 10);
  if (!Number.isFinite(monthNumber)) {
    return null;
  }
  const start = new Date(yearNumber, monthNumber - 1, 1);
  const end = new Date(yearNumber, monthNumber, 0);
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

export default function BudgetVariances() {
  // ========== State ==========
  const [selectedMonth, setSelectedMonth] = useState(
    MONTH_OPTIONS[new Date().getMonth()].value
  );
  const [selectedYear, setSelectedYear] = useState(YEAR_OPTIONS[3]);
  const [leafActualTotals, setLeafActualTotals] = useState(null);
  const [leafBudgetTotals, setLeafBudgetTotals] = useState(null);

  // ========== Computed: Period Range ==========
  const periodRange = useMemo(
    () => computePeriodRange(selectedMonth, selectedYear),
    [selectedMonth, selectedYear]
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
              selected month.
            </p>
          </div>
        </div>

        {/* Toolbar */}
        <section className="realization-toolbar" aria-label="Report filters">
          <div className="realization-toolbar__group realization-toolbar__group--selectors">
            <div className="realization-toolbar__field">
              <label
                htmlFor="variance-year"
                className="realization-toolbar__label"
              >
                Year
              </label>
              <select
                id="variance-year"
                className="realization-toolbar__select"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
              >
                {YEAR_OPTIONS.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="realization-toolbar__field">
              <label
                htmlFor="variance-month"
                className="realization-toolbar__label"
              >
                Month
              </label>
              <select
                id="variance-month"
                className="realization-toolbar__select"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              >
                {MONTH_OPTIONS.map(({ label, value }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
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
                        >
                          {formatCurrencyValue(row.budget)}
                        </td>
                        <td
                          className={getValueCellClassName(row.actual, true)}
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
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
