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
                className="fc-review-selector__generate"
                onClick={onGenerateForecast}
                disabled={disableGenerate}
              >
                {generateLoading ? "Generating..." : "Generate Forecast"}
              </button>
              <button
                type="button"
                className="fc-review-selector__excel"
                onClick={onExcelExport}
                disabled={disableExcel}
              >
                <span aria-hidden="true" className="fc-review-selector__excel-icon">
                  📊
                </span>
                Excel Export
              </button>
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
    </section>
  );
}
