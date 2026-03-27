import { AlertTriangle } from "lucide-react";
import "./FCModulesFilter.css";

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
 * @param {Function} props.onNewClick - Callback when New button is clicked
 * @param {React.RefObject} props.scenarioSelectRef - Ref for the scenario select element (used for dynamic width)
 * @param {string} props.selectedScenario - Currently selected scenario name
 * @param {Object|null} props.selectedScenarioDetails - Details of the selected scenario
 * @param {boolean} props.hasSelectedModule - Whether a module is currently selected
 * @param {Function} props.onEditClick - Callback when Edit button is clicked
 * @param {Function} props.onDeleteClick - Callback when Delete button is clicked
 * @param {Function} props.onUnmatchedClick - Callback when Unmatched button is clicked
 * @param {boolean} props.unmatchedDisabled - Whether the unmatched button should be disabled
 * @param {boolean} props.newDisabled - Whether the New button should be disabled
 * @returns {JSX.Element} The filter and action controls section
 */
export default function FCModulesFilter({
  assumptions,
  error,
  isLoading,
  onScenarioChange,
   onNewClick,
  scenarioSelectRef,
  selectedScenario,
  selectedScenarioDetails,
  hasSelectedModule,
  onEditClick,
  onDeleteClick,
  onUnmatchedClick,
  onSeedClick,
  unmatchedDisabled,
  seedDisabled,
   newDisabled,
}) {
  const scenarios = assumptions?.scenarios || [];
  const periodStart =
    selectedScenarioDetails?.PeriodStart ?? assumptions?.PeriodStart ?? null;
  const periodEnd =
    selectedScenarioDetails?.PeriodEnd ?? assumptions?.PeriodEnd ?? null;

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
            <span className="fc-modules-filter__error-icon"><AlertTriangle size={16} /></span>
            <p>{error}</p>
          </div>
        )}
        {!isLoading && !error && assumptions && (
          <div className="fc-modules-filter__content">
            <div className="fc-modules-filter__row">
              <div className="fc-modules-filter__field">
                <label
                  htmlFor="fc-scenario-select"
                  className="fc-modules-filter__label"
                >
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

              <div className="fc-modules-filter__actions">
                <div className="fc-modules-filter__actions-grid">
                  {[
                    {
                      label: "New",
                      icon: "+",
                      disabled: newDisabled,
                      onClick: onNewClick,
                      success: true,
                    },
                    {
                      label: "Edit",
                      icon: "✎",
                      disabled: !hasSelectedModule,
                      onClick: onEditClick,
                      primary: hasSelectedModule,
                    },
                    {
                      label: "Delete",
                      icon: "×",
                      disabled: !hasSelectedModule,
                      onClick: onDeleteClick,
                      danger: true,
                    },
                    {
                      label: "Unmatched",
                      icon: "⚡",
                      disabled: unmatchedDisabled,
                      onClick: onUnmatchedClick,
                    },
                    {
                      label: "Seed Actuals",
                      icon: "↓",
                      disabled: seedDisabled,
                      onClick: onSeedClick,
                      primary: !seedDisabled,
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
                    }) => {
                      return (
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
                      );
                    }
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
