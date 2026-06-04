import "../Balances/BalanceDateSelector.css";
import { ChevronDown, ChevronUp } from "lucide-react";
import MonthYearPicker from "../../components/MonthYearPicker";
import { EARLIEST_ACTUAL_YEAR } from "../../utils/yearOptions";
const monthOptions = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

const parseDateParts = (dateStr) => {
  if (typeof dateStr !== "string") return { year: "", month: "" };
  const [yearStr, monthStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  return {
    year: Number.isFinite(year) && year > 0 ? year : "",
    month: Number.isFinite(month) && month > 0 ? month : "",
  };
};

const toIsoDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(date.getTime())) return "";
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const firstDayOfMonthIso = (year, month) => toIsoDate(year, month, 1);
const lastDayOfMonthIso = (year, month) => {
  const date = new Date(Date.UTC(year, month, 0));
  if (!Number.isFinite(date.getTime())) return "";
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const toNumberOrEmpty = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : "";
};

export default function CashFlowDateSelectorMonthYear({
  fromDates,
  toDates,
  onFromDateChange,
  onToDateChange,
  includeUnrealizedGL,
  onIncludeUnrealizedChange,
  transfers,
  onTransfersChange,
  frequency,
  onFrequencyChange,
  onGenerateReport,
  isLoading,
  collapsiblePaths,
  onExpandOneLayer,
  onCollapseOneLayer,
  isFullyCollapsed,
  isFullyExpanded,
  error,
  onExport,
  canExport = true,
  layout,
}) {
  const normalizedFromDates = Array.isArray(fromDates) ? fromDates : [];
  const normalizedToDates = Array.isArray(toDates) ? toDates : [];
  const isCollapseToggleDisabled =
    isLoading || (collapsiblePaths?.size ?? 0) === 0;
  const isExportDisabled = isLoading || !canExport;

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  // Floor at EARLIEST_ACTUAL_YEAR so historical imports are selectable.
  const baseYears = Array.from(
    { length: currentYear + 10 - EARLIEST_ACTUAL_YEAR + 1 },
    (_, idx) => EARLIEST_ACTUAL_YEAR + idx
  );
  const existingYears = [...normalizedFromDates, ...normalizedToDates]
    .map((date) => parseDateParts(date).year)
    .filter(Boolean);
  const yearOptions = Array.from(new Set([...baseYears, ...existingYears]))
    .filter((year) => Boolean(year) && year <= currentYear)
    .sort((a, b) => a - b);

  const getFromParts = () => {
    const parsed = parseDateParts(normalizedFromDates[0]);
    return {
      month: parsed.month || currentMonth,
      year: parsed.year || currentYear,
    };
  };
  const getToParts = () => {
    const parsed = parseDateParts(normalizedToDates[0]);
    return {
      month: parsed.month || currentMonth,
      year: parsed.year || currentYear,
    };
  };

  const updateFromDate = (month, year) => {
    const current = getFromParts();
    const parsedMonth = toNumberOrEmpty(month);
    const parsedYear = toNumberOrEmpty(year);
    const nextMonth = parsedMonth || current.month;
    const nextYear = parsedYear || current.year;
    if (!nextMonth || !nextYear) {
      onFromDateChange?.(0, "");
      return;
    }
    const fromDate = firstDayOfMonthIso(nextYear, nextMonth);
    onFromDateChange?.(0, fromDate);
  };

  const updateToDate = (month, year) => {
    const current = getToParts();
    const parsedMonth = toNumberOrEmpty(month);
    const parsedYear = toNumberOrEmpty(year);
    const nextMonth = parsedMonth || current.month;
    const nextYear = parsedYear || current.year;
    if (!nextMonth || !nextYear) {
      onToDateChange?.(0, "");
      return;
    }
    const toDate = lastDayOfMonthIso(nextYear, nextMonth);
    onToDateChange?.(0, toDate);
  };

  const fromParts = getFromParts();
  const toParts = getToParts();

  if (layout === "toolbar") {
    return (
      <section className="report-toolbar report-toolbar--stacked" aria-label="Report filters">
        <div className="report-toolbar__control-row">
          <label
            className="report-toolbar__toggle"
            htmlFor="cashflow-include-unrealized"
          >
            <input
              id="cashflow-include-unrealized"
              type="checkbox"
              className="report-toolbar__checkbox"
              checked={includeUnrealizedGL}
              onChange={(event) =>
                onIncludeUnrealizedChange?.(event.target.checked)
              }
            />
            <span className="report-toolbar__toggle-text">Unrealized</span>
          </label>
          {typeof onFrequencyChange === "function" && (
            <div className="report-toolbar__field">
              <label
                htmlFor="cashflow-frequency"
                className="report-toolbar__label"
              >
                Period
              </label>
              <select
                id="cashflow-frequency"
                className="report-toolbar__select"
                value={frequency}
                onChange={(event) => onFrequencyChange?.(event.target.value)}
              >
                <option value="month">Month</option>
                <option value="quarter">Quarter</option>
                <option value="year">Year</option>
              </select>
            </div>
          )}
          <div className="report-toolbar__field">
            <label
              htmlFor="cashflow-transfers"
              className="report-toolbar__label"
            >
              Transfers
            </label>
            <select
              id="cashflow-transfers"
              className="report-toolbar__select"
              value={transfers}
              onChange={(event) => onTransfersChange?.(event.target.value)}
            >
              <option value="include">Include</option>
              <option value="exclude">Exclude</option>
              <option value="only">Only</option>
            </select>
          </div>
        </div>
        <div className="report-toolbar__periods-column">
          <div className="report-toolbar__period-group">
            <div className="report-toolbar__field">
              <label
                htmlFor="cashflow-from-month-1"
                className="report-toolbar__label"
              >
                From
              </label>
              <MonthYearPicker
                monthId="cashflow-from-month-1"
                yearId="cashflow-from-year-1"
                monthValue={fromParts.month || ""}
                yearValue={fromParts.year || ""}
                monthOptions={monthOptions}
                yearOptions={yearOptions}
                onMonthChange={(value) => updateFromDate(value, undefined)}
                onYearChange={(value) => updateFromDate(undefined, value)}
                rowClassName="report-toolbar__month-year-row"
                inputClassName="report-toolbar__select"
              />
            </div>
            <div className="report-toolbar__field">
              <label
                htmlFor="cashflow-to-month-1"
                className="report-toolbar__label"
              >
                To
              </label>
              <MonthYearPicker
                monthId="cashflow-to-month-1"
                yearId="cashflow-to-year-1"
                monthValue={toParts.month || ""}
                yearValue={toParts.year || ""}
                monthOptions={monthOptions}
                yearOptions={yearOptions}
                onMonthChange={(value) => updateToDate(value, undefined)}
                onYearChange={(value) => updateToDate(undefined, value)}
                rowClassName="report-toolbar__month-year-row"
                inputClassName="report-toolbar__select"
              />
            </div>
          </div>
          <div className="report-toolbar__period-actions">
            <button
              className="report-toolbar__button report-toolbar__button--primary"
              type="button"
              onClick={onGenerateReport}
              disabled={isLoading}
            >
              {isLoading ? "Generating..." : "Generate"}
            </button>
            {!isFullyExpanded && (
              <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onExpandOneLayer} disabled={isCollapseToggleDisabled} title="Expand one level"><ChevronDown size={16} /></button>
            )}
            {!isFullyCollapsed && (
              <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onCollapseOneLayer} disabled={isCollapseToggleDisabled} title="Collapse one level"><ChevronUp size={16} /></button>
            )}
            {typeof onExport === "function" && (
              <button
                className="report-toolbar__button"
                type="button"
                onClick={onExport}
                disabled={isExportDisabled}
              >
                Export
              </button>
            )}
          </div>
          {error && <p className="report-toolbar__error">{error}</p>}
        </div>
      </section>
    );
  }

  return (
    <div className="balance-layout">
      <aside className="balance-panel">
        <div className="balance-date-picker">
          <div className="balance-period-group">
            <div className="balance-period-title"></div>
            <label
              htmlFor="cashflow-from-month-1"
              className="balance-date-picker__label"
            >
              From Month / Year
            </label>
            <MonthYearPicker
              monthId="cashflow-from-month-1"
              yearId="cashflow-from-year-1"
              monthValue={fromParts.month || ""}
              yearValue={fromParts.year || ""}
              monthOptions={monthOptions}
              yearOptions={yearOptions}
              onMonthChange={(value) => updateFromDate(value, undefined)}
              onYearChange={(value) => updateFromDate(undefined, value)}
            />
            <label
              htmlFor="cashflow-to-month-1"
              className="balance-date-picker__label"
            >
              To Month / Year
            </label>
            <MonthYearPicker
              monthId="cashflow-to-month-1"
              yearId="cashflow-to-year-1"
              monthValue={toParts.month || ""}
              yearValue={toParts.year || ""}
              monthOptions={monthOptions}
              yearOptions={yearOptions}
              onMonthChange={(value) => updateToDate(value, undefined)}
              onYearChange={(value) => updateToDate(undefined, value)}
            />
            <div className="balance-period-summary" style={{ marginTop: 8 }}>
              {`From ${normalizedFromDates[0] ?? ""} To ${
                normalizedToDates[0] ?? ""
              }`}
            </div>
          </div>
          <label
            htmlFor="cashflow-include-unrealized"
            className="balance-date-picker__label"
          >
            Include Unrealized?
          </label>
          <input
            id="cashflow-include-unrealized"
            type="checkbox"
            className="balance-date-picker__input"
            checked={includeUnrealizedGL}
            onChange={(event) =>
              onIncludeUnrealizedChange?.(event.target.checked)
            }
          />
          <label
            htmlFor="cashflow-transfers"
            className="balance-date-picker__label"
          >
            Transfers
          </label>
          <select
            id="cashflow-transfers"
            className="balance-date-picker__input"
            value={transfers}
            onChange={(event) => onTransfersChange?.(event.target.value)}
          >
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
            <option value="only">Only</option>
          </select>
        </div>
        <button
          className="btn btn--lg btn--primary btn--block"
          type="button"
          onClick={onGenerateReport}
          disabled={isLoading}
        >
          {isLoading ? "Generating..." : "Generate Report"}
        </button>
        {!isFullyExpanded && (
          <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onExpandOneLayer} disabled={isCollapseToggleDisabled} title="Expand one level"><ChevronDown size={16} /></button>
        )}
        {!isFullyCollapsed && (
          <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onCollapseOneLayer} disabled={isCollapseToggleDisabled} title="Collapse one level"><ChevronUp size={16} /></button>
        )}
        {typeof onExport === "function" && (
          <button
            className="btn btn--lg btn--primary btn--block"
            type="button"
            onClick={onExport}
            disabled={isExportDisabled}
          >
            Export
          </button>
        )}
        {error && (
          <p
            className="balance-report-empty"
            style={{
              margin: 0,
              color: "#fecdd3",
              fontWeight: 600,
            }}
          >
            {error}
          </p>
        )}
      </aside>
    </div>
  );
}
