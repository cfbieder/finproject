import PeriodCountSelector from "../../components/PeriodCountSelector";
import MonthYearPicker from "../../components/MonthYearPicker";
import "./BudgetRealizationDateSelectorMonthYear.css";
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
  activePeriodCount,
  fromDates,
  toDates,
  onFromDateChange,
  onToDateChange,
  onPeriodCountChange,
  includeUnrealizedGL,
  onIncludeUnrealizedChange,
  transfers,
  onTransfersChange,
  onGenerateReport,
  isLoading,
  collapsiblePaths,
  onToggleCollapseAll,
  isFullyCollapsed,
  error,
  showPeriodSelector = true,
  onExport,
  canExport = true,
}) {
  const clampedPeriodCount = Math.min(Math.max(activePeriodCount ?? 1, 1), 3);
  const normalizedFromDates = Array.isArray(fromDates) ? fromDates : [];
  const normalizedToDates = Array.isArray(toDates) ? toDates : [];
  const isCollapseToggleDisabled =
    isLoading || (collapsiblePaths?.size ?? 0) === 0;
  const isExportDisabled = isLoading || !canExport;

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const baseYears = Array.from(
    { length: 21 },
    (_, idx) => currentYear - 10 + idx
  );
  const existingYears = [...normalizedFromDates, ...normalizedToDates]
    .map((date) => parseDateParts(date).year)
    .filter(Boolean);
  const yearOptions = Array.from(new Set([...baseYears, ...existingYears]))
    .filter((year) => Boolean(year) && year <= currentYear)
    .sort((a, b) => a - b);

  const getFromParts = (index) => {
    const parsed = parseDateParts(normalizedFromDates[index]);
    return {
      month: parsed.month || currentMonth,
      year: parsed.year || currentYear,
    };
  };
  const getToParts = (index) => {
    const parsed = parseDateParts(normalizedToDates[index]);
    return {
      month: parsed.month || currentMonth,
      year: parsed.year || currentYear,
    };
  };

  const updateFromDate = (index, month, year) => {
    const current = getFromParts(index);
    const parsedMonth = toNumberOrEmpty(month);
    const parsedYear = toNumberOrEmpty(year);
    const nextMonth = parsedMonth || current.month;
    const nextYear = parsedYear || current.year;
    if (!nextMonth || !nextYear) {
      onFromDateChange?.(index, "");
      return;
    }
    const fromDate = firstDayOfMonthIso(nextYear, nextMonth);
    onFromDateChange?.(index, fromDate);
  };

  const updateToDate = (index, month, year) => {
    const current = getToParts(index);
    const parsedMonth = toNumberOrEmpty(month);
    const parsedYear = toNumberOrEmpty(year);
    const nextMonth = parsedMonth || current.month;
    const nextYear = parsedYear || current.year;
    if (!nextMonth || !nextYear) {
      onToDateChange?.(index, "");
      return;
    }
    const toDate = lastDayOfMonthIso(nextYear, nextMonth);
    onToDateChange?.(index, toDate);
  };

  return (
    <div className="balance-layout">
      <aside className="balance-panel">
        <div className="balance-date-picker">
          {showPeriodSelector && (
            <PeriodCountSelector
              id="cashflow-period-count"
              value={clampedPeriodCount}
              onChange={onPeriodCountChange}
            />
          )}
          {Array.from({ length: clampedPeriodCount }).map((_, index) => {
            const periodLabel = index + 1;
            const fromParts = getFromParts(index);
            const toParts = getToParts(index);
            return (
              <div
                key={`cashflow-period-${periodLabel}`}
                className="balance-period-group"
              >
                <div className="balance-period-title">
                  <span className="balance-period-pill">{periodLabel}</span>
                  <div className="balance-period-heading">
                    <div className="balance-period-heading__title">
                      {`Period ${periodLabel}`}
                    </div>
                    <div className="balance-period-heading__subtitle">
                      {`From ${normalizedFromDates[index] ?? ""} To ${
                        normalizedToDates[index] ?? ""
                      }`}
                    </div>
                  </div>
                </div>
                <label
                  htmlFor={`cashflow-from-month-${periodLabel}`}
                  className="balance-date-picker__label"
                >
                  From Month / Year
                </label>
                <MonthYearPicker
                  monthId={`cashflow-from-month-${periodLabel}`}
                  yearId={`cashflow-from-year-${periodLabel}`}
                  monthValue={fromParts.month || ""}
                  yearValue={fromParts.year || ""}
                  monthOptions={monthOptions}
                  yearOptions={yearOptions}
                  onMonthChange={(value) =>
                    updateFromDate(index, value, undefined)
                  }
                  onYearChange={(value) =>
                    updateFromDate(index, undefined, value)
                  }
                />
                <label
                  htmlFor={`cashflow-to-month-${periodLabel}`}
                  className="balance-date-picker__label"
                >
                  To Month / Year
                </label>
                <MonthYearPicker
                  monthId={`cashflow-to-month-${periodLabel}`}
                  yearId={`cashflow-to-year-${periodLabel}`}
                  monthValue={toParts.month || ""}
                  yearValue={toParts.year || ""}
                  monthOptions={monthOptions}
                  yearOptions={yearOptions}
                  onMonthChange={(value) =>
                    updateToDate(index, value, undefined)
                  }
                  onYearChange={(value) =>
                    updateToDate(index, undefined, value)
                  }
                />
                <div
                  className="balance-period-summary"
                  style={{ marginTop: 8 }}
                >
                  {`From ${normalizedFromDates[index] ?? ""} To ${
                    normalizedToDates[index] ?? ""
                  }`}
                </div>
              </div>
            );
          })}
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
          className="generate-report-button"
          type="button"
          onClick={onGenerateReport}
          disabled={isLoading}
        >
          {isLoading ? "Generating..." : "Generate Report"}
        </button>
        <button
          className="generate-report-button"
          type="button"
          onClick={onToggleCollapseAll}
          disabled={isCollapseToggleDisabled}
        >
          {isFullyCollapsed ? "Expand All" : "Collapse All"}
        </button>
        {typeof onExport === "function" && (
          <button
            className="generate-report-button"
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
