export default function FCReviewSelector({
  scenarios,
  selectedScenario,
  setSelectedScenario,
  isLoading,
  loadError,
}) {
  return (
    <section className="section-filters">
      <div className="section-filters__content">
        <div className="fc-review-selector">
          <div className="fc-review-selector__header">
            <div className="fc-review-selector__pill">Forecast</div>
            <div className="fc-review-selector__title-block">
              <p className="fc-review-selector__label">Scenario</p>
              <h3 className="fc-review-selector__title">
                Choose a scenario to review
              </h3>
            </div>
          </div>
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
