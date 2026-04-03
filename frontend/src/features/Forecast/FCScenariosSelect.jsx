import { AlertTriangle } from "lucide-react";

/**
 * FCScenariosSelect Component
 *
 * Header section for forecast scenarios page with controls for:
 * - Selecting active scenario
 * - Setting period start/end years
 * - Setting tax rate for the scenario
 * - Committing changes to persist to server
 * - Setting default scenario for forecast pages
 * - Copying scenarios with all related data
 * - Reloading defaults from server
 * - Deleting scenarios
 *
 * Displays error banners when data fails to load
 */
export default function FCScenariosSelect({
  assumptions,
  loadError,
  scenarios,
  selectedScenario,
  setSelectedScenario,
  periodStart,
  setPeriodStart,
  periodEnd,
  setPeriodEnd,
  periodYears,
  confirmCommit,
  reloadDefaults,
  clearAuditTrail,
  openDeleteModal,
  isLoading,
  taxRate,
  setTaxRate,
  sweepLow,
  setSweepLow,
  sweepHigh,
  setSweepHigh,
  makeDefaultScenario,
  onCopyScenario,
  hasPendingChanges,
}) {
  // Disable controls when loading, no data, or errors
  const isDisabled = !assumptions || !!loadError || isLoading;

  // Can only delete existing scenarios (not "__new_scenario__")
  const canDeleteScenario =
    selectedScenario &&
    selectedScenario !== "__new_scenario__" &&
    scenarios.find((s) => s.Name === selectedScenario);

  return (
    <section className="section-filters fc-scenarios-header">
      <div className="section-table__content">
        <div className="fc-scenarios-header__top">
          <div className="fc-scenarios-header__title-group">
            <h2 className="fc-scenarios-header__title">Forecast Scenarios</h2>
            <p className="fc-scenarios-header__subtitle">
              Manage scenario assumptions for financial forecasting
            </p>
            {hasPendingChanges && (
              <p
                className="fc-scenarios-header__pending-warning"
                style={{ color: "#C0504D", fontWeight: 700, margin: "0.35rem 0 0" }}
              >
                You have uncommitted changes.
              </p>
            )}
          </div>
          {loadError && (
            <div className="fc-scenarios-error-banner">
              <span className="fc-scenarios-error-icon"><AlertTriangle size={16} /></span>
              <span>{loadError}</span>
            </div>
          )}
        </div>

        <div className="fc-scenarios-controls">
          <div className="fc-scenarios-row">
            <div className="fc-scenarios-row__field fc-scenarios-row__field--scenario">
              <label
                className="fc-scenarios-select__label"
                htmlFor="scenario-select"
              >
                Scenario
              </label>
              <select
                id="scenario-select"
                className="form-input"
                value={selectedScenario}
                onChange={(event) => {
                  const val = event.target.value;
                  if (val === "__new_scenario__") {
                    // Immediately prompt for name instead of going to placeholder state
                    confirmCommit("__new_scenario__");
                    return;
                  }
                  setSelectedScenario(val);
                }}
                disabled={isDisabled}
              >
                <option value="" disabled>
                  {isLoading ? "Loading..." : "Select scenario"}
                </option>
                {(scenarios || []).map((scenario) => (
                  <option key={scenario.Name} value={scenario.Name}>
                    {scenario.Name}
                  </option>
                ))}
                <option value="__new_scenario__">+ New Scenario</option>
              </select>
            </div>
            <div className="fc-scenarios-row__field">
              <label
                className="fc-scenarios-select__label"
                htmlFor="period-start-select"
              >
                Period Start
              </label>
              <select
                id="period-start-select"
                className="form-input"
                value={periodStart}
                onChange={(event) => setPeriodStart(event.target.value)}
                disabled={isDisabled}
              >
                {(periodYears || []).map((year) => (
                  <option key={year} value={String(year)}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="fc-scenarios-row__field">
              <label
                className="fc-scenarios-select__label"
                htmlFor="period-end-select"
              >
                Period End
              </label>
              <select
                id="period-end-select"
                className="form-input"
                value={periodEnd}
                onChange={(event) => setPeriodEnd(event.target.value)}
                disabled={isDisabled}
              >
                {periodYears.map((year) => (
                  <option key={year} value={String(year)}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="fc-scenarios-row__field">
              <label
                className="fc-scenarios-select__label"
                htmlFor="tax-rate-input"
              >
                Tax Rate (%)
              </label>
              <input
                id="tax-rate-input"
                type="number"
                className="form-input"
                value={taxRate}
                onChange={(event) => setTaxRate(event.target.value)}
                disabled={isDisabled}
                min="0"
                max="100"
                step="0.1"
              />
            </div>
            <div className="fc-scenarios-row__field">
              <label
                className="fc-scenarios-select__label"
                htmlFor="sweep-low-input"
              >
                Cash Sweep Low
              </label>
              <input
                id="sweep-low-input"
                type="number"
                className="form-input"
                value={sweepLow}
                onChange={(event) => setSweepLow(event.target.value)}
                disabled={isDisabled}
                min="0"
                step="1000"
                placeholder="Optional"
              />
            </div>
            <div className="fc-scenarios-row__field">
              <label
                className="fc-scenarios-select__label"
                htmlFor="sweep-high-input"
              >
                Cash Sweep High
              </label>
              <input
                id="sweep-high-input"
                type="number"
                className="form-input"
                value={sweepHigh}
                onChange={(event) => setSweepHigh(event.target.value)}
                disabled={isDisabled}
                min="0"
                step="1000"
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="fc-scenarios-actions">
            <button
              type="button"
              className="fc-scenarios-action-button fc-scenarios-action-button--primary"
              onClick={confirmCommit}
              disabled={isDisabled}
            >
              <span className="fc-scenarios-button-icon">💾</span>
              Commit Changes
            </button>
            <button
              type="button"
              className="fc-scenarios-action-button"
              onClick={clearAuditTrail}
              disabled={!canDeleteScenario || isLoading}
              title="Remove audit trail files for this scenario"
            >
              <span className="fc-scenarios-button-icon">🧹</span>
              Clear Audit
            </button>
            <button
              type="button"
              className="fc-scenarios-action-button fc-scenarios-action-button--success"
              onClick={makeDefaultScenario}
              disabled={!canDeleteScenario || isLoading}
              title="Set this scenario as default for forecast pages"
            >
              <span className="fc-scenarios-button-icon">⭐</span>
              Make Default
            </button>
            <button
              type="button"
              className="fc-scenarios-action-button"
              onClick={onCopyScenario}
              disabled={!canDeleteScenario || isLoading}
              title="Copy this scenario with all modules and income/expense entries"
            >
              <span className="fc-scenarios-button-icon">📋</span>
              Copy
            </button>
            <button
              type="button"
              className="fc-scenarios-action-button"
              onClick={reloadDefaults}
              disabled={isLoading}
            >
              <span className="fc-scenarios-button-icon">🔄</span>
              Reload Defaults
            </button>
            <button
              type="button"
              className="fc-scenarios-action-button fc-scenarios-action-button--danger"
              disabled={!canDeleteScenario || isLoading}
              onClick={() =>
                openDeleteModal("deleteScenario", { Name: selectedScenario })
              }
            >
              <span className="fc-scenarios-button-icon">🗑</span>
              Delete Scenario
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
