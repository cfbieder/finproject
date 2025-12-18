/**
 * FCModulesFilter component provides filtering and action controls for forecast modules.
 *
 * Features:
 * - Scenario selection dropdown with dynamic width adjustment
 * - Period display showing start and end dates from selected scenario
 * - Action buttons for module management (New, Edit, Delete, Unmatched)
 * - Loading and error state handling
 *
 * @component
 * @param {Object} props - Component props
 * @param {Object|null} props.assumptions - Forecast assumptions containing scenarios
 * @param {string} props.error - Error message to display
 * @param {boolean} props.isLoading - Loading state for assumptions
 * @param {Function} props.onScenarioChange - Callback when scenario selection changes
 * @param {React.RefObject} props.scenarioSelectRef - Ref for the scenario select element (used for dynamic width)
 * @param {string} props.selectedScenario - Currently selected scenario name
 * @param {Object|null} props.selectedScenarioDetails - Details of the selected scenario
 * @param {boolean} props.hasSelectedModule - Whether a module is currently selected
 * @param {Function} props.onEditClick - Callback when Edit button is clicked
 * @returns {JSX.Element} The filter and action controls section
 */
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
    <section className="section-filters fc-modules-filter">
      <div className="section-table__content">
        {isLoading && (
          <div className="fc-modules-filter__loading">
            <div className="fc-modules-filter__spinner" />
            <p>Loading scenarios...</p>
          </div>
        )}
        {error && !isLoading && (
          <div className="fc-modules-filter__error">
            <span className="fc-modules-filter__error-icon">⚠</span>
            <p>{error}</p>
          </div>
        )}
        {!isLoading && !error && assumptions && (
          <div className="fc-modules-filter__content">
            <div className="fc-modules-filter__row">
              <div className="fc-modules-filter__field">
                <label htmlFor="fc-scenario-select" className="fc-modules-filter__label">
                  Scenario
                </label>
                <select
                  id="fc-scenario-select"
                  className="form-input fc-modules-filter__select"
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

              <div className="fc-modules-filter__period">
                <div className="fc-modules-filter__period-item">
                  <span className="fc-modules-filter__period-label">Period Start</span>
                  <span className="fc-modules-filter__period-value">
                    {selectedScenarioDetails?.PeriodStart ?? "-"}
                  </span>
                </div>
                <div className="fc-modules-filter__period-item">
                  <span className="fc-modules-filter__period-label">Period End</span>
                  <span className="fc-modules-filter__period-value">
                    {selectedScenarioDetails?.PeriodEnd ?? "-"}
                  </span>
                </div>
              </div>

              <div className="fc-modules-filter__actions">
                <div className="fc-modules-filter__actions-grid">
                  {["New", "Edit", "Delete", "Unmatched"].map((label) => {
                    const isEdit = label === "Edit";
                    const disabled = label !== "Edit" || !hasSelectedModule;
                    return (
                      <button
                        key={label}
                        type="button"
                        className={`fc-modules-filter__action-btn ${
                          isEdit && hasSelectedModule
                            ? "fc-modules-filter__action-btn--primary"
                            : ""
                        }`}
                        disabled={disabled}
                        onClick={isEdit ? onEditClick : undefined}
                      >
                        <span className="fc-modules-filter__action-icon">
                          {label === "New" && "+"}
                          {label === "Edit" && "✎"}
                          {label === "Delete" && "×"}
                          {label === "Unmatched" && "⚡"}
                        </span>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
