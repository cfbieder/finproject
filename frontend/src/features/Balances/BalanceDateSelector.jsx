import "./BalanceDateSelector.css";
import PeriodCountSelector from "../../components/PeriodCountSelector";

export default function BalanceDateSelector({
  periodDates,
  onPeriodDateChange,
  onGenerateReport,
  isLoading,
  periodCount,
  onPeriodCountChange,
  onToggleCollapseAll,
  collapseToggleLabel,
  collapseToggleDisabled,
  showCollapseToggle = false,
}) {
  const normalizedDates = Array.isArray(periodDates) ? periodDates : [];
  const clampedPeriodCount = Math.min(Math.max(periodCount ?? 1, 1), 3);

  return (
    <div className="balance-layout">
      <aside className="balance-panel">
        <div className="balance-date-picker">
          <PeriodCountSelector
            id="balance-date-period-count"
            value={clampedPeriodCount}
            onChange={onPeriodCountChange}
          />
          {Array.from({ length: clampedPeriodCount }).map((_, index) => {
            const periodLabel = index + 1;
            const inputId = `balance-date-period-${periodLabel}`;
            return (
              <div key={inputId} className="balance-period-group">
                <div className="balance-period-title">
                  <span className="balance-period-pill">{periodLabel}</span>
                  <div className="balance-period-heading">
                    <div className="balance-period-heading__title">
                      {`Period ${periodLabel}`}
                    </div>
                  </div>
                </div>
                <label htmlFor={inputId} className="balance-date-picker__label">
                  Balance Date
                </label>
                <input
                  id={inputId}
                  type="date"
                  className="balance-date-picker__input"
                  value={normalizedDates[index] ?? ""}
                  onChange={(event) =>
                    onPeriodDateChange?.(index, event.target.value)
                  }
                />
              </div>
            );
          })}
        </div>
        <button
          className="generate-report-button"
          type="button"
          onClick={onGenerateReport}
          disabled={isLoading}
        >
          {isLoading ? "Generating..." : "Generate Report"}
        </button>
        {showCollapseToggle && (
          <button
            className="generate-report-button"
            type="button"
            onClick={onToggleCollapseAll}
            disabled={collapseToggleDisabled}
          >
            {collapseToggleLabel}
          </button>
        )}
      </aside>
    </div>
  );
}
