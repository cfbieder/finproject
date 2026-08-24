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

// CR087 §4c — UNKNOWN and ZERO are different statements and this must not
// conflate them. `null` reaches here when a fetch failed, and rendering it as
// `$0.00` is what let a page of 100%-favourable variances look like real data.
// A genuine 0 still renders `$0.00`.
const formatCurrencyValue = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const amount = Number(value);
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
  // CR087 §4c. ⚠️ `null` on the two maps above is OVERLOADED — it is set both
  // when a fetch STARTS and when one FAILS. A banner keyed on null would flash
  // on every load, so failure needs its own state. Without this the page showed
  // a full table of 100%-favourable variances with no error anywhere.
  const [actualsError, setActualsError] = useState(false);
  const [budgetsError, setBudgetsError] = useState(false);
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
    setActualsError(false);

    const fetchActuals = async () => {
      try {
        const report = await Rest.fetchCashFlowReportV2({
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
        setActualsError(true);
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
    setBudgetsError(false);

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
        setBudgetsError(true);
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

    // CR087 §4c. ⚠️ Two DIFFERENT reasons a figure can be absent, and conflating
    // them is the defect: a category missing FROM A LOADED MAP genuinely has 0
    // (nothing budgeted, nothing spent), while a map that never loaded means the
    // figure is UNKNOWN. The old code coalesced both with `?? 0`, so a failed
    // actuals fetch rendered every category at $0.00 actual and reported the
    // full budget as a FAVOURABLE variance, with no error anywhere on the page.
    const budgetsUnknown = !leafBudgetTotals;
    const actualsUnknown = !leafActualTotals;

    const rows = [];
    for (const name of allNames) {
      const budget = budgetsUnknown ? null : (leafBudgetTotals.get(name) ?? 0);
      const actual = actualsUnknown ? null : (leafActualTotals.get(name) ?? 0);
      // A variance derived from a missing operand is not a number.
      const variance = budget == null || actual == null ? null : actual - budget;
      if (budget === 0 && actual === 0) continue;
      rows.push({
        name,
        budget,
        actual,
        variance,
        // Unknown sorts last rather than as zero, which would bury it among the
        // genuinely-unchanged rows.
        absVariance: variance == null ? -1 : Math.abs(variance),
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
    // CR087 §4c — a total over a column with an unknown operand is itself
    // unknown. Summing `null` as 0 would restate the same defect in the one row
    // most likely to be read.
    let budget = leafBudgetTotals ? 0 : null;
    let actual = leafActualTotals ? 0 : null;
    for (const row of varianceRows) {
      if (budget != null) budget += row.budget;
      if (actual != null) actual += row.actual;
    }
    return {
      budget,
      actual,
      variance: budget == null || actual == null ? null : actual - budget,
    };
  }, [varianceRows, leafBudgetTotals, leafActualTotals]);

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

        {/* CR087 §4c — say so when a side did not load. Without this the page
            renders a full table of 100%-favourable variances and looks like a
            good month. Keyed on an explicit error flag, NOT on the maps being
            null, because null is also the loading state and would flash. */}
        {(actualsError || budgetsError) && (
          <div
            role="alert"
            style={{
              margin: "0 0 1rem",
              padding: "0.75rem 1rem",
              border: "1px solid var(--danger)",
              borderLeft: "3px solid var(--danger)",
              borderRadius: "var(--radius-sm)",
              background: "var(--danger-subtle)",
              color: "var(--ink)",
              fontSize: "0.875rem",
            }}
          >
            <strong>
              {actualsError && budgetsError
                ? "Neither actuals nor budgets could be loaded."
                : actualsError
                  ? "Actuals could not be loaded."
                  : "Budgets could not be loaded."}
            </strong>{" "}
            Variances are shown as <code>—</code> rather than computed against a
            missing figure. Reload to try again.
          </div>
        )}

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
