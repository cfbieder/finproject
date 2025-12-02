import "../Balances/BalanceDateSelector.css";
import PeriodCountSelector from "../../components/PeriodCountSelector";

export default function CashFlowDateSelector({
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
}) {
  const clampedPeriodCount = Math.min(Math.max(activePeriodCount ?? 1, 1), 3);
  const normalizedFromDates = Array.isArray(fromDates) ? fromDates : [];
  const normalizedToDates = Array.isArray(toDates) ? toDates : [];
  const isCollapseToggleDisabled =
    isLoading || (collapsiblePaths?.size ?? 0) === 0;

  return (
    <div className="balance-layout">
      <aside className="balance-panel">
        <div className="balance-date-picker">
          <PeriodCountSelector
            id="cashflow-period-count"
            value={clampedPeriodCount}
            onChange={onPeriodCountChange}
          />

          {Array.from({ length: clampedPeriodCount }).map((_, index) => {
            const periodLabel = index + 1;
            return (
              <div key={`cashflow-period-${periodLabel}`}>
                <label
                  htmlFor={`cashflow-from-date-${periodLabel}`}
                  className="balance-date-picker__label"
                >
                  {`From Date Period ${periodLabel}`}
                </label>
                <input
                  id={`cashflow-from-date-${periodLabel}`}
                  type="date"
                  className="balance-date-picker__input"
                  value={normalizedFromDates[index] ?? ""}
                  onChange={(event) =>
                    onFromDateChange?.(index, event.target.value)
                  }
                />
                <label
                  htmlFor={`cashflow-to-date-${periodLabel}`}
                  className="balance-date-picker__label"
                >
                  {`To Date Period ${periodLabel}`}
                </label>
                <input
                  id={`cashflow-to-date-${periodLabel}`}
                  type="date"
                  className="balance-date-picker__input"
                  value={normalizedToDates[index] ?? ""}
                  onChange={(event) =>
                    onToDateChange?.(index, event.target.value)
                  }
                />
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
