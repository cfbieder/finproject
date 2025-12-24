import "./FCModulesFilter.css";

export default function FCExpFilter({
  assumptions,
  error,
  isLoading,
  onScenarioChange,
  scenarioSelectRef,
  selectedScenario,
  periodStart,
  periodEnd,
  onAddClick,
  onEditClick,
  onDeleteClick,
  addDisabled,
  editDisabled,
  deleteDisabled,
}) {
  const scenarios = assumptions?.scenarios || [];

  return (
    <section className="exp-setup-filter section-filters fc-modules-filter">
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
                <label
                  htmlFor="fc-exp-scenario-select"
                  className="fc-modules-filter__label"
                >
                  Scenario
                </label>
                <select
                  id="fc-exp-scenario-select"
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
              <div className="fc-modules-filter__actions">
                <div className="fc-modules-filter__actions-grid">
                  {[
                    {
                      label: "Add",
                      icon: "+",
                      disabled: addDisabled,
                      onClick: onAddClick,
                      success: true,
                    },
                    {
                      label: "Edit",
                      icon: "✎",
                      disabled: editDisabled,
                      onClick: onEditClick,
                      primary: !editDisabled,
                    },
                    {
                      label: "Delete",
                      icon: "×",
                      disabled: deleteDisabled,
                      onClick: onDeleteClick,
                      danger: true,
                    },
                  ].map(
                    ({
                      label,
                      icon,
                      disabled,
                      onClick,
                      primary,
                      danger,
                      success,
                    }) => (
                      <button
                        key={label}
                        type="button"
                        className={`fc-modules-filter__action-btn ${
                          primary
                            ? "fc-modules-filter__action-btn--primary"
                            : ""
                        } ${
                          danger
                            ? "fc-modules-filter__action-btn--danger"
                            : ""
                        } ${
                          success
                            ? "fc-modules-filter__action-btn--success"
                            : ""
                        }`}
                        disabled={disabled}
                        onClick={onClick}
                      >
                        <span className="fc-modules-filter__action-icon">
                          {icon}
                        </span>
                        {label}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>

            {(periodStart || periodEnd) && (
              <div className="fc-modules-filter__period">
                <div className="fc-modules-filter__period-item">
                  <span className="fc-modules-filter__period-label">
                    Period Start
                  </span>
                  <span className="fc-modules-filter__period-value">
                    {periodStart ?? "—"}
                  </span>
                </div>
                <div className="fc-modules-filter__period-item">
                  <span className="fc-modules-filter__period-label">
                    Period End
                  </span>
                  <span className="fc-modules-filter__period-value">
                    {periodEnd ?? "—"}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
