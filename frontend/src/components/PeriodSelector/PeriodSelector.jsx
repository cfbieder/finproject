import { useCallback, useMemo, useState } from "react";
import { EARLIEST_ACTUAL_YEAR } from "../../utils/yearOptions";
import "./PeriodSelector.css";

// ============================================================================
// Constants
// ============================================================================

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = String(new Date().getMonth() + 1).padStart(2, "0");

const DEFAULT_MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const YEAR_OPTION_COUNT = 6;
// Actual-year options must reach back far enough to view historical imports
// (EARLIEST_ACTUAL_YEAR; the Quicken backfill goes back ~20 years). Callers can
// still override via the `yearOptions` prop for data-driven ranges.
const DEFAULT_YEAR_OPTIONS = Array.from(
  { length: CURRENT_YEAR - EARLIEST_ACTUAL_YEAR + 1 },
  (_, i) => CURRENT_YEAR - i
);
// Budget years are forward-looking — keep the short window.
const DEFAULT_BUDGET_YEAR_OPTIONS = Array.from(
  { length: YEAR_OPTION_COUNT },
  (_, i) => CURRENT_YEAR - 1 + i
);

function getPreviousMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return {
    month: String(d.getMonth() + 1).padStart(2, "0"),
    year: d.getFullYear(),
  };
}

/**
 * Standard period presets.
 * Each preset has an `id`, display `label`, and a `compute` function that
 * returns { fromMonth, toMonth, actualYear, budgetYear }.
 * "custom" has `compute: null` — manual entry mode.
 */
const PERIOD_PRESETS = [
  {
    id: "this-month",
    label: "This Month",
    compute: () => ({
      fromMonth: CURRENT_MONTH,
      toMonth: CURRENT_MONTH,
      actualYear: CURRENT_YEAR,
      budgetYear: CURRENT_YEAR,
    }),
  },
  {
    id: "this-month-prior-year",
    label: "This Month PY",
    compute: () => ({
      fromMonth: CURRENT_MONTH,
      toMonth: CURRENT_MONTH,
      actualYear: CURRENT_YEAR - 1,
      budgetYear: CURRENT_YEAR - 1,
    }),
  },
  {
    id: "last-month",
    label: "Last Month",
    compute: () => {
      const prev = getPreviousMonth();
      return {
        fromMonth: prev.month,
        toMonth: prev.month,
        actualYear: prev.year,
        budgetYear: prev.year,
      };
    },
  },
  {
    id: "last-month-prior-year",
    label: "Last Month PY",
    compute: () => {
      const prev = getPreviousMonth();
      return {
        fromMonth: prev.month,
        toMonth: prev.month,
        actualYear: prev.year - 1,
        budgetYear: prev.year - 1,
      };
    },
  },
  {
    id: "ytd",
    label: "YTD",
    compute: () => ({
      fromMonth: "01",
      toMonth: CURRENT_MONTH,
      actualYear: CURRENT_YEAR,
      budgetYear: CURRENT_YEAR,
    }),
  },
  {
    id: "ytd-prior-year",
    label: "YTD PY",
    compute: () => ({
      fromMonth: "01",
      toMonth: CURRENT_MONTH,
      actualYear: CURRENT_YEAR - 1,
      budgetYear: CURRENT_YEAR - 1,
    }),
  },
  {
    id: "this-year",
    label: "This Year",
    compute: () => ({
      fromMonth: "01",
      toMonth: "12",
      actualYear: CURRENT_YEAR,
      budgetYear: CURRENT_YEAR,
    }),
  },
  {
    id: "last-year",
    label: "Last Year",
    compute: () => ({
      fromMonth: "01",
      toMonth: "12",
      actualYear: CURRENT_YEAR - 1,
      budgetYear: CURRENT_YEAR - 1,
    }),
  },
  {
    id: "custom",
    label: "Custom",
    compute: null,
  },
];

// ============================================================================
// Helper: build summary text for non-custom presets
// ============================================================================

function buildSummaryText(fromMonth, toMonth, actualYear, budgetYear, monthOptions) {
  const fromLabel =
    monthOptions.find((m) => m.value === fromMonth)?.label ?? fromMonth;
  const toLabel =
    monthOptions.find((m) => m.value === toMonth)?.label ?? toMonth;

  const range =
    fromMonth === toMonth
      ? `${fromLabel} ${actualYear}`
      : `${fromLabel}\u2013${toLabel} ${actualYear}`;

  if (actualYear !== budgetYear) {
    return `${range} (budget: ${budgetYear})`;
  }
  return range;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Preset-based period picker with optional Custom manual mode.
 *
 * Reusable shared component — auto-computes fromMonth, toMonth, actualYear,
 * budgetYear from standard presets (This Month, Last Year, etc.) or allows
 * full manual entry via the "Custom" preset.
 *
 * Supports controlled and uncontrolled modes (following BudgetBalancePanel
 * pattern: internal state for each field; prop wins when provided).
 *
 * @param {Object} props
 * @param {string}   [props.fromMonth]         – Controlled from-month ("01"-"12")
 * @param {string}   [props.toMonth]           – Controlled to-month ("01"-"12")
 * @param {number}   [props.actualYear]        – Controlled actual year
 * @param {number}   [props.budgetYear]        – Controlled budget year
 * @param {Function} props.onChange             – ({fromMonth, toMonth, actualYear, budgetYear, preset}) => void
 * @param {Array}    [props.monthOptions]      – [{value, label}]
 * @param {number[]} [props.yearOptions]       – Year values for Actual Year dropdown
 * @param {number[]} [props.budgetYearOptions] – Year values for Budget Year dropdown
 * @param {string}   [props.id]                – Root element ID
 * @param {string}   [props.className]         – Additional CSS class
 */
export default function PeriodSelector({
  fromMonth: fromMonthProp,
  toMonth: toMonthProp,
  actualYear: actualYearProp,
  budgetYear: budgetYearProp,
  toYear: toYearProp,
  onChange,
  monthOptions = DEFAULT_MONTH_OPTIONS,
  yearOptions = DEFAULT_YEAR_OPTIONS,
  budgetYearOptions = DEFAULT_BUDGET_YEAR_OPTIONS,
  id = "period-selector",
  className = "",
  defaultPreset = "custom",
  hideBudgetYear = false,
  enableYearRange = false,
}) {
  // ── Internal state (uncontrolled fallbacks) ──
  const [preset, setPreset] = useState(defaultPreset);
  const [fromMonthState, setFromMonthState] = useState(
    monthOptions[0]?.value ?? "01"
  );
  const [toMonthState, setToMonthState] = useState(
    monthOptions[11]?.value ?? "12"
  );
  const [actualYearState, setActualYearState] = useState(
    yearOptions[0] ?? CURRENT_YEAR
  );
  const [budgetYearState, setBudgetYearState] = useState(
    budgetYearOptions[2] ?? CURRENT_YEAR
  );
  const [toYearState, setToYearState] = useState(
    yearOptions[0] ?? CURRENT_YEAR
  );

  // ── Resolve controlled vs uncontrolled ──
  const fromMonth = fromMonthProp ?? fromMonthState;
  const toMonth = toMonthProp ?? toMonthState;
  const actualYear = actualYearProp ?? actualYearState;
  const budgetYear = budgetYearProp ?? budgetYearState;
  const toYear = toYearProp ?? toYearState;

  // ── Summary text (for non-custom presets) ──
  const summaryText = useMemo(
    () => buildSummaryText(fromMonth, toMonth, actualYear, budgetYear, monthOptions),
    [fromMonth, toMonth, actualYear, budgetYear, monthOptions]
  );

  // ── Preset selection ──
  const handlePresetChange = useCallback(
    (presetId) => {
      setPreset(presetId);
      const found = PERIOD_PRESETS.find((p) => p.id === presetId);
      if (!found?.compute) return; // "custom" – no auto-compute

      const values = found.compute();

      if (fromMonthProp === undefined) setFromMonthState(values.fromMonth);
      if (toMonthProp === undefined) setToMonthState(values.toMonth);
      if (actualYearProp === undefined) setActualYearState(values.actualYear);
      if (budgetYearProp === undefined) setBudgetYearState(values.budgetYear);
      if (enableYearRange && toYearProp === undefined) {
        setToYearState(values.actualYear);
      }

      const payload = { ...values, preset: presetId };
      if (enableYearRange) payload.toYear = values.actualYear;
      onChange?.(payload);
    },
    [
      fromMonthProp,
      toMonthProp,
      actualYearProp,
      budgetYearProp,
      toYearProp,
      enableYearRange,
      onChange,
    ]
  );

  // ── Manual field change (Custom mode) ──
  const handleManualChange = useCallback(
    (field, rawValue) => {
      const value =
        field === "actualYear" || field === "budgetYear" || field === "toYear"
          ? Number(rawValue)
          : rawValue;

      // Update internal state for uncontrolled fields
      const setters = {
        fromMonth: setFromMonthState,
        toMonth: setToMonthState,
        actualYear: setActualYearState,
        budgetYear: setBudgetYearState,
        toYear: setToYearState,
      };
      const props = {
        fromMonth: fromMonthProp,
        toMonth: toMonthProp,
        actualYear: actualYearProp,
        budgetYear: budgetYearProp,
        toYear: toYearProp,
      };
      if (props[field] === undefined) {
        setters[field](value);
      }

      const current = { fromMonth, toMonth, actualYear, budgetYear };
      if (enableYearRange) current.toYear = toYear;
      onChange?.({ ...current, [field]: value, preset: "custom" });
    },
    [
      fromMonth,
      toMonth,
      actualYear,
      budgetYear,
      toYear,
      fromMonthProp,
      toMonthProp,
      actualYearProp,
      budgetYearProp,
      toYearProp,
      enableYearRange,
      onChange,
    ]
  );

  return (
    <div
      className={`period-selector${className ? ` ${className}` : ""}`}
      id={id}
    >
      {/* Preset buttons */}
      <div className="period-selector__presets">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`period-selector__preset${preset === p.id ? " period-selector__preset--active" : ""}`}
            onClick={() => handlePresetChange(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary line for non-custom presets */}
      {preset !== "custom" && (
        <div className="period-selector__summary">{summaryText}</div>
      )}

      {/* Manual dropdowns for Custom mode */}
      {preset === "custom" && (
        <div className="period-selector__custom">
          <div className="period-selector__field">
            <label
              htmlFor={`${id}-from-month`}
              className="period-selector__label"
            >
              Month (from)
            </label>
            <select
              id={`${id}-from-month`}
              className="period-selector__select"
              value={fromMonth}
              onChange={(e) => handleManualChange("fromMonth", e.target.value)}
            >
              {monthOptions.map((m) => (
                <option key={`from-${m.value}`} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="period-selector__field">
            <label
              htmlFor={`${id}-to-month`}
              className="period-selector__label"
            >
              Month (to)
            </label>
            <select
              id={`${id}-to-month`}
              className="period-selector__select"
              value={toMonth}
              onChange={(e) => handleManualChange("toMonth", e.target.value)}
            >
              {monthOptions.map((m) => (
                <option key={`to-${m.value}`} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="period-selector__field">
            <label
              htmlFor={`${id}-actual-year`}
              className="period-selector__label"
            >
              {enableYearRange ? "Year (from)" : "Actual Year"}
            </label>
            <select
              id={`${id}-actual-year`}
              className="period-selector__select"
              value={actualYear}
              onChange={(e) => handleManualChange("actualYear", e.target.value)}
            >
              {yearOptions.map((y) => (
                <option key={`actual-${y}`} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {enableYearRange && (
            <div className="period-selector__field">
              <label
                htmlFor={`${id}-to-year`}
                className="period-selector__label"
              >
                Year (to)
              </label>
              <select
                id={`${id}-to-year`}
                className="period-selector__select"
                value={toYear}
                onChange={(e) => handleManualChange("toYear", e.target.value)}
              >
                {yearOptions.map((y) => (
                  <option key={`to-year-${y}`} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!hideBudgetYear && (
            <div className="period-selector__field">
              <label
                htmlFor={`${id}-budget-year`}
                className="period-selector__label"
              >
                Budget Year
              </label>
              <select
                id={`${id}-budget-year`}
                className="period-selector__select"
                value={budgetYear}
                onChange={(e) => handleManualChange("budgetYear", e.target.value)}
              >
                {budgetYearOptions.map((y) => (
                  <option key={`budget-${y}`} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { PERIOD_PRESETS, DEFAULT_MONTH_OPTIONS };
