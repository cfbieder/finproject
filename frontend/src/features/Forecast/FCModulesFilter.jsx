export default function FCModulesFilter({
  assumptions,
  error,
  isLoading,
  onScenarioChange,
  scenarioSelectRef,
  selectedScenario,
  selectedScenarioDetails,
}) {
  const scenarios = assumptions?.scenarios || [];

  return (
    <section className="section-filters fx-modules-edit-select">
      <div className="section-table__content">
        {isLoading && <p>Loading assumptions…</p>}
        {error && !isLoading && <p className="error-text">{error}</p>}
        {!isLoading && !error && assumptions && (
          <>
            <div className="fc-setup-select__row">
              <div className="fc-setup-select__field">
                <label htmlFor="fc-scenario-select">Scenario</label>
                <select
                  id="fc-scenario-select"
                  className="form-input"
                  ref={scenarioSelectRef}
                  value={selectedScenario}
                  onChange={(event) => onScenarioChange(event.target.value)}
                  disabled={!scenarios.length}
                >
                  <option value="" disabled>
                    Select scenario
                  </option>
                  {scenarios.map((scenario) => (
                    <option key={scenario.Name} value={scenario.Name}>
                      {scenario.Name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="fc-setup-period">
                <div className="fc-setup-period__item">
                  <span className="fc-setup-period__label">Period Start</span>
                  <span className="fc-setup-period__value">
                    {selectedScenarioDetails?.PeriodStart ?? "-"}
                  </span>
                </div>
                <div className="fc-setup-period__item">
                  <span className="fc-setup-period__label">Period End</span>
                  <span className="fc-setup-period__value">
                    {selectedScenarioDetails?.PeriodEnd ?? "-"}
                  </span>
                </div>
              </div>
              <div className="fc-setup-table-placeholder">Table placeholder</div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
