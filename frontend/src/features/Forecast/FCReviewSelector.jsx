import { BarChart3, TrendingUp, BrainCircuit, ArrowRightLeft } from "lucide-react";

export default function FCReviewSelector({
  scenarios,
  selectedScenario,
  setSelectedScenario,
  isLoading,
  loadError,
  onGenerateForecast,
  generateLoading,
  generateDisabled,
  generateError,
  generateResult,
  onExcelExport,
  excelDisabled,
  onGraphClick,
  graphDisabled,
  onAIReviewClick,
  aiReviewDisabled,
  aiReviewHasUnread,
  onCashSweepClick,
  cashSweepDisabled,
}) {
  const disableGenerate =
    generateDisabled || !selectedScenario || isLoading || !!loadError;
  const disableExcel = excelDisabled ?? disableGenerate;

  return (
    <section className="section-filters" style={{ height: "auto" }}>
      <div className="section-filters__content">
        <div className="fc-review-selector">
          <div className="fc-review-selector__header">
            <div className="fc-review-selector__title-row">
              <div className="fc-review-selector__pill">Forecast</div>
              <div className="fc-review-selector__title-block">
                <p className="fc-review-selector__label">Scenario</p>
                <h3 className="fc-review-selector__title">
                  Choose a scenario to review
                </h3>
              </div>
            </div>
            <div className="fc-review-selector__actions">
              <div className="fc-review-selector__control">
                <select
                  id="fc-review-scenario"
                  className="fc-review-selector__select"
                  value={selectedScenario}
                  onChange={(event) => setSelectedScenario(event.target.value)}
                  disabled={isLoading || !!loadError}
                >
                  <option value="" disabled>
                    {isLoading ? "Loading..." : "Select scenario"}
                  </option>
                  {scenarios.map((scenario) => (
                    <option key={scenario.Name} value={scenario.Name}>
                      {scenario.Name}
                    </option>
                  ))}
                </select>
                <span className="fc-review-selector__chevron">⌄</span>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                onClick={onGenerateForecast}
                disabled={disableGenerate}
              >
                <span aria-hidden="true" className="fc-review-selector__action-icon">
                  ⚡
                </span>
                {generateLoading ? "Generating..." : "Generate"}
              </button>
              {/* Everything past this divider opens a view or exports a file — nothing here
                  changes the forecast, so nothing here competes with Generate. */}
              <div className="fc-review-selector__utilities">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={cashSweepDisabled ?? disableGenerate}
                  onClick={onCashSweepClick}
                >
                  <span aria-hidden="true" className="fc-review-selector__action-icon">
                    <ArrowRightLeft size={16} />
                  </span>
                  Cash Sweep
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={graphDisabled}
                  onClick={onGraphClick}
                >
                  <span aria-hidden="true" className="fc-review-selector__action-icon">
                    <TrendingUp size={16} />
                  </span>
                  Graph
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={onExcelExport}
                  disabled={disableExcel}
                >
                  <span aria-hidden="true" className="fc-review-selector__action-icon">
                    <BarChart3 size={16} />
                  </span>
                  Excel Export
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={aiReviewDisabled ?? disableGenerate}
                  onClick={onAIReviewClick}
                  title={aiReviewHasUnread ? "New AI review ready" : undefined}
                >
                  <span
                    aria-hidden="true"
                    className="fc-review-selector__action-icon fc-review-selector__ai-icon"
                  >
                    <BrainCircuit size={16} />
                  </span>
                  AI Review
                  {aiReviewHasUnread && (
                    <span
                      aria-label="new review ready"
                      className="fc-review-selector__ai-dot"
                    />
                  )}
                </button>
              </div>
            </div>
          </div>
          {generateResult && (
            <p className="fc-review-selector__meta">
              {generateResult.message || "Forecast generated"} · Scenario:{" "}
              {generateResult.scenario || selectedScenario} · Entries:{" "}
              {generateResult.entriesCreated ?? "n/a"} · Modules:{" "}
              {generateResult.modulesProcessed ?? "n/a"} · Deleted:{" "}
              {generateResult.deletedCount ?? "n/a"} · Time:{" "}
              {generateResult.durationMs
                ? `${generateResult.durationMs}ms`
                : "n/a"}
            </p>
          )}
          {generateError && (
            <p className="fc-review-selector__error">{generateError}</p>
          )}
          {loadError && (
            <p className="fc-review-selector__error">
              Failed to load: {loadError}
            </p>
          )}
        </div>
      </div>
      <style>{`
        @keyframes fcAiPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.25); opacity: 0.7; }
        }
      `}</style>
    </section>
  );
}
