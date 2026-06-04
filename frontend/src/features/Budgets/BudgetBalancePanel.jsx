import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTION_COUNT = 8;
const YEAR_OPTIONS = Array.from({ length: YEAR_OPTION_COUNT }, (_, index) =>
  (CURRENT_YEAR + 3 - index).toString()
);
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTH_OPTIONS = MONTH_NAMES.map((label, index) => ({
  label,
  value: String(index + 1),
}));

export default function BudgetBalancePanel({
  includeUnrealized: includeUnrealizedProp,
  onIncludeUnrealizedChange,
  includeTransfers: includeTransfersProp,
  onIncludeTransfersChange,
  reportType: reportTypeProp,
  onReportTypeChange,
  year: selectedYearProp,
  actualYear: actualYearProp,
  onYearChange,
  onActualYearChange,
  month: selectedMonthProp,
  onMonthChange,
  isFullyCollapsed,
  isFullyExpanded,
  onExpandOneLayer,
  onCollapseOneLayer,
  hasCollapsiblePaths,
  layout,
}) {
  const [reportTypeState, setReportTypeState] = useState("month");
  const [selectedYearState, setSelectedYearState] = useState(YEAR_OPTIONS[3]);
  const [actualYearState, setActualYearState] = useState(YEAR_OPTIONS[3]);
  const [selectedMonthState, setSelectedMonthState] = useState(
    MONTH_OPTIONS[new Date().getMonth()].value
  );
  const reportType = reportTypeProp ?? reportTypeState;
  const selectedYear = selectedYearProp ?? selectedYearState;
  const actualYear = actualYearProp ?? actualYearState;
  const selectedMonth = selectedMonthProp ?? selectedMonthState;
  const [includeUnrealizedState, setIncludeUnrealizedState] = useState(false);
  const [includeTransfersState, setIncludeTransfersState] = useState(false);

  const includeUnrealized = includeUnrealizedProp ?? includeUnrealizedState;
  const includeTransfers = includeTransfersProp ?? includeTransfersState;
  const handleIncludeUnrealizedChange = (checked) => {
    if (includeUnrealizedProp === undefined) {
      setIncludeUnrealizedState(checked);
    }
    onIncludeUnrealizedChange?.(checked);
  };
  const handleIncludeTransfersChange = (checked) => {
    if (includeTransfersProp === undefined) {
      setIncludeTransfersState(checked);
    }
    onIncludeTransfersChange?.(checked);
  };
  const handleReportSelectionChange = (value) => {
    if (reportTypeProp === undefined) {
      setReportTypeState(value);
    }
    onReportTypeChange?.(value);
  };
  const handleYearSelectionChange = (value) => {
    if (selectedYearProp === undefined) {
      setSelectedYearState(value);
    }
    onYearChange?.(value);
  };
  const handleActualYearSelectionChange = (value) => {
    if (actualYearProp === undefined) {
      setActualYearState(value);
    }
    onActualYearChange?.(value);
  };
  const handleMonthSelectionChange = (value) => {
    if (selectedMonthProp === undefined) {
      setSelectedMonthState(value);
    }
    onMonthChange?.(value);
  };

  if (layout === "toolbar") {
    return (
      <section className="realization-toolbar" aria-label="Report filters">
        <div className="realization-toolbar__group realization-toolbar__group--selectors">
          <div className="realization-toolbar__field">
            <label htmlFor="budget-period-window" className="realization-toolbar__label">
              Report Type
            </label>
            <select
              id="budget-period-window"
              className="realization-toolbar__select"
              value={reportType}
              onChange={(event) => handleReportSelectionChange(event.target.value)}
            >
              <option value="month">Month</option>
              <option value="ytd">YTD</option>
              <option value="full-year">Full Year</option>
            </select>
          </div>
          <div className="realization-toolbar__field">
            <label htmlFor="budget-period-year" className="realization-toolbar__label">
              Budget Year
            </label>
            <select
              id="budget-period-year"
              className="realization-toolbar__select"
              value={selectedYear}
              onChange={(event) => handleYearSelectionChange(event.target.value)}
            >
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="realization-toolbar__field">
            <label htmlFor="budget-period-actual-year" className="realization-toolbar__label">
              Actual Year
            </label>
            <select
              id="budget-period-actual-year"
              className="realization-toolbar__select"
              value={actualYear}
              onChange={(event) => handleActualYearSelectionChange(event.target.value)}
            >
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          {["month", "ytd"].includes(reportType) && (
            <div className="realization-toolbar__field">
              <label htmlFor="budget-period-month" className="realization-toolbar__label">
                Month
              </label>
              <select
                id="budget-period-month"
                className="realization-toolbar__select"
                value={selectedMonth}
                onChange={(event) => handleMonthSelectionChange(event.target.value)}
              >
                {MONTH_OPTIONS.map(({ label, value }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="realization-toolbar__group realization-toolbar__group--toggles">
          <label className="realization-toolbar__toggle" htmlFor="budget-include-unrealized">
            <input
              id="budget-include-unrealized"
              type="checkbox"
              className="realization-toolbar__checkbox"
              checked={includeUnrealized}
              onChange={(event) => handleIncludeUnrealizedChange(event.target.checked)}
            />
            <span className="realization-toolbar__toggle-text">Unrealized</span>
          </label>
          <label className="realization-toolbar__toggle" htmlFor="budget-include-transfers">
            <input
              id="budget-include-transfers"
              type="checkbox"
              className="realization-toolbar__checkbox"
              checked={includeTransfers}
              onChange={(event) => handleIncludeTransfersChange(event.target.checked)}
            />
            <span className="realization-toolbar__toggle-text">Transfers</span>
          </label>
          {!isFullyExpanded && (
            <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onExpandOneLayer} disabled={!hasCollapsiblePaths} title="Expand one level"><ChevronDown size={16} /></button>
          )}
          {!isFullyCollapsed && (
            <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onCollapseOneLayer} disabled={!hasCollapsiblePaths} title="Collapse one level"><ChevronUp size={16} /></button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="balance-panel">
      <div className="balance-panel__selector">
        <label htmlFor="budget-period-window" className="balance-panel__label">
          Report Type
        </label>
        <select
          id="budget-period-window"
          className="balance-panel__select"
          value={reportType}
          onChange={(event) => handleReportSelectionChange(event.target.value)}
        >
          <option value="month">Month</option>
          <option value="ytd">YTD</option>
          <option value="full-year">Full Year</option>
        </select>
      </div>
      <div className="balance-panel__selector">
        <label htmlFor="budget-period-year" className="balance-panel__label">
          Budget Year
        </label>
        <select
          id="budget-period-year"
          className="balance-panel__select"
          value={selectedYear}
          onChange={(event) => handleYearSelectionChange(event.target.value)}
        >
          {YEAR_OPTIONS.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
      <div className="balance-panel__selector">
        <label htmlFor="budget-period-actual-year" className="balance-panel__label">
          Actual Year
        </label>
        <select
          id="budget-period-actual-year"
          className="balance-panel__select"
          value={actualYear}
          onChange={(event) =>
            handleActualYearSelectionChange(event.target.value)
          }
        >
          {YEAR_OPTIONS.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
      {["month", "ytd"].includes(reportType) && (
        <div className="balance-panel__selector">
          <label htmlFor="budget-period-month" className="balance-panel__label">
            Month
          </label>
          <select
            id="budget-period-month"
            className="balance-panel__select"
            value={selectedMonth}
            onChange={(event) => handleMonthSelectionChange(event.target.value)}
          >
            {MONTH_OPTIONS.map(({ label, value }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="balance-panel__selector">
        <label
          htmlFor="budget-include-unrealized"
          className="balance-panel__label"
        >
          Include Unrealized?
        </label>
        <input
          id="budget-include-unrealized"
          type="checkbox"
          className="balance-panel__checkbox"
          checked={includeUnrealized}
          onChange={(event) =>
            handleIncludeUnrealizedChange(event.target.checked)
          }
        />
      </div>
      <div className="balance-panel__selector">
        <label
          htmlFor="budget-include-transfers"
          className="balance-panel__label"
        >
          Include Transfers?
        </label>
        <input
          id="budget-include-transfers"
          type="checkbox"
          className="balance-panel__checkbox"
          checked={includeTransfers}
          onChange={(event) =>
            handleIncludeTransfersChange(event.target.checked)
          }
        />
      </div>
      <div className="balance-panel__actions">
        {!isFullyExpanded && (
          <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onExpandOneLayer} disabled={!hasCollapsiblePaths} title="Expand one level"><ChevronDown size={16} /></button>
        )}
        {!isFullyCollapsed && (
          <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onCollapseOneLayer} disabled={!hasCollapsiblePaths} title="Collapse one level"><ChevronUp size={16} /></button>
        )}
      </div>
    </section>
  );
}

export { YEAR_OPTIONS, MONTH_OPTIONS };
