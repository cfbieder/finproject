import "./BalanceDateSelector.css";
import { ChevronDown, ChevronUp } from "lucide-react";
import PeriodCountSelector from "../../components/PeriodCountSelector";

export default function BalanceDateSelector({
  periodDates,
  onPeriodDateChange,
  onGenerateReport,
  isLoading,
  periodCount,
  onPeriodCountChange,
  onExpandOneLayer,
  onCollapseOneLayer,
  isFullyCollapsed,
  isFullyExpanded,
  collapseToggleDisabled,
  showCollapseToggle = false,
  onExport,
  canExport = false,
  layout,
}) {
  const normalizedDates = Array.isArray(periodDates) ? periodDates : [];
  const clampedPeriodCount = Math.min(Math.max(periodCount ?? 1, 1), 3);
  const currentYear = new Date().getFullYear();
  const maxBalanceDate = `${currentYear}-12-31`;

  if (layout === "toolbar") {
    return (
      <section className="report-toolbar report-toolbar--inline" aria-label="Report filters">
        <div className="report-toolbar__group report-toolbar__group--controls">
          <div className="report-toolbar__field">
            <PeriodCountSelector
              id="balance-date-period-count"
              value={clampedPeriodCount}
              onChange={onPeriodCountChange}
              labelClassName="report-toolbar__label"
              inputClassName="report-toolbar__select"
            />
          </div>
          {Array.from({ length: clampedPeriodCount }).map((_, index) => {
            const periodLabel = index + 1;
            const inputId = `balance-date-period-${periodLabel}`;
            return (
              <div key={inputId} className="report-toolbar__period-group">
                <span className="report-toolbar__period-label">
                  {`P${periodLabel}`}
                </span>
                <input
                  id={inputId}
                  type="date"
                  className="report-toolbar__date-input"
                  value={normalizedDates[index] ?? ""}
                  max={maxBalanceDate}
                  onChange={(event) =>
                    onPeriodDateChange?.(index, event.target.value)
                  }
                />
              </div>
            );
          })}
        </div>
        <div className="report-toolbar__group report-toolbar__group--actions">
          <button
            className="report-toolbar__button report-toolbar__button--primary"
            type="button"
            onClick={onGenerateReport}
            disabled={isLoading}
          >
            {isLoading ? "Generating..." : "Generate"}
          </button>
          {showCollapseToggle && !isFullyExpanded && (
            <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onExpandOneLayer} disabled={collapseToggleDisabled} title="Expand one level"><ChevronDown size={16} /></button>
          )}
          {showCollapseToggle && !isFullyCollapsed && (
            <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onCollapseOneLayer} disabled={collapseToggleDisabled} title="Collapse one level"><ChevronUp size={16} /></button>
          )}
          {canExport && onExport && (
            <button
              className="report-toolbar__button"
              type="button"
              onClick={onExport}
            >
              Export
            </button>
          )}
        </div>
      </section>
    );
  }

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
                  max={maxBalanceDate}
                  onChange={(event) =>
                    onPeriodDateChange?.(index, event.target.value)
                  }
                />
              </div>
            );
          })}
        </div>
        <button
          className="btn btn--lg btn--primary btn--block"
          type="button"
          onClick={onGenerateReport}
          disabled={isLoading}
        >
          {isLoading ? "Generating..." : "Generate Report"}
        </button>
        {showCollapseToggle && !isFullyExpanded && (
          <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onExpandOneLayer} disabled={collapseToggleDisabled} title="Expand one level"><ChevronDown size={16} /></button>
        )}
        {showCollapseToggle && !isFullyCollapsed && (
          <button type="button" className="btn btn--sm btn--outline btn--icon" onClick={onCollapseOneLayer} disabled={collapseToggleDisabled} title="Collapse one level"><ChevronUp size={16} /></button>
        )}
      </aside>
    </div>
  );
}
