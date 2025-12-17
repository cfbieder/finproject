export default function FCModulesFilter({
  assumptions,
  error,
  isLoading,
  onScenarioChange,
  scenarioSelectRef,
  selectedScenario,
  selectedScenarioDetails,
  hasSelectedModule,
  onEditClick,
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
              <div className="fc-setup-table-placeholder">
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.65rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                    }}
                  >
                    {["New", "Edit", "Delete", "Unmatched"].map((label) => {
                      const isEdit = label === "Edit";
                      const disabled = label !== "Edit" || !hasSelectedModule;
                      return (
                        <button
                          key={label}
                          type="button"
                          className="fc-scenarios-action-button"
                          disabled={disabled}
                          onClick={isEdit ? onEditClick : undefined}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
