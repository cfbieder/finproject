import "./BalanceChartDateSelectorMonthYear.css";
import MonthYearPicker from "../../components/MonthYearPicker";
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
  onGenerateReport,
  isLoading,
  error,
  onExport,
  canExport = true,
}) {
  const normalizedFromDates = Array.isArray(fromDates) ? fromDates : [];
  const normalizedToDates = Array.isArray(toDates) ? toDates : [];
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
          </div>
        </div>
        <button
          className="generate-report-button"
          type="button"
          onClick={onGenerateReport}
          disabled={isLoading}
        >
          {isLoading ? "Generating..." : "Generate Report"}
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
        {error && <p className="balance-report-empty">{error}</p>}
      </aside>
    </div>
  );
}
