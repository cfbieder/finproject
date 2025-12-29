/**
 * FCScenariosModal Component
 *
 * Centralized modal component for all forecast scenario operations.
 * Handles editing, deleting, and committing changes for scenarios, inflation, and FX data.
 *
 * Modal Types:
 * - editInflation: Add or edit inflation rate for a year
 * - deleteInflation: Confirm deletion of inflation entry
 * - editFX: Add or edit FX rates for a year
 * - deleteFX: Confirm deletion of FX entry
 * - deleteScenario: Confirm deletion of entire scenario
 * - nameScenario: Prompt for new scenario name
 * - commit: Confirm committing all changes
 * - copyScenario: Prompt for name of copied scenario
 *
 * @param {Object} modalState - Current modal state { type, payload }
 * @param {Function} closeModal - Function to close the modal
 * @param {Function} saveInflation - Handler for saving inflation data
 * @param {Function} deleteInflation - Handler for deleting inflation entry
 * @param {Function} saveFx - Handler for saving FX data
 * @param {Function} deleteFx - Handler for deleting FX entry
 * @param {Function} deleteScenario - Handler for deleting scenario
 * @param {Function} commitNewScenario - Handler for committing new scenario
 * @param {Function} commitChanges - Handler for committing existing scenario changes
 * @param {Function} setModalState - Function to update modal state
 * @param {Array} fxKeys - List of FX rate keys (e.g., ["USDPLN", "USDEUR"])
 * @param {Function} copyScenario - Handler for copying a scenario
 */

import "./FCScenariosModal.css";

export default function FCScenariosModal({
  modalState,
  closeModal,
  saveInflation,
  deleteInflation,
  saveFx,
  deleteFx,
  deleteScenario,
  commitNewScenario,
  commitChanges,
  setModalState,
  fxKeys,
  copyScenario,
}) {
  // Don't render anything if no modal is open
  if (!modalState.type) return null;

  /**
   * Updates a specific field in the modal payload
   * @param {string} field - Field name to update
   * @param {*} value - New value for the field
   */
  const handleFieldChange = (field, value) => {
    setModalState((prev) => ({
      ...prev,
      payload: { ...prev.payload, [field]: value },
    }));
  };

  /**
   * Updates a specific FX rate in the modal payload
   * @param {string} key - FX rate key (e.g., "USDPLN")
   * @param {*} value - New rate value
   */
  const handleRateChange = (key, value) => {
    setModalState((prev) => ({
      ...prev,
      payload: {
        ...prev.payload,
        Rates: { ...(prev.payload?.Rates || {}), [key]: value },
      },
    }));
  };

  return (
    <div className="fc-scenarios-modal-overlay" onClick={closeModal}>
      <div className="fc-scenarios-modal" onClick={(e) => e.stopPropagation()}>
        {modalState.type === "editInflation" && (
          <>
            <div className="fc-scenarios-modal__header">
              <h3 className="fc-scenarios-modal__title">
                <span className="fc-scenarios-modal__title-icon">📊</span>
                {modalState.payload?.isNew ? "Add" : "Edit"} Inflation Rate
              </h3>
              <p className="fc-scenarios-modal__description">
                Set the inflation rate assumption for a specific year
              </p>
            </div>
            <div className="fc-scenarios-modal__body">
              <label className="fc-scenarios-modal__field">
                <span>Year</span>
                <input
                  type="number"
                  value={modalState.payload?.Year ?? ""}
                  onChange={(e) => handleFieldChange("Year", e.target.value)}
                />
              </label>
              <label className="fc-scenarios-modal__field">
                <span>Rate (%)</span>
                <input
                  type="number"
                  step="0.01"
                  value={modalState.payload?.Rate ?? ""}
                  onChange={(e) => handleFieldChange("Rate", e.target.value)}
                  placeholder="e.g., 2.5"
                />
              </label>
            </div>
            <div className="fc-scenarios-modal__actions">
              <button
                type="button"
                className="fc-scenarios-action-button"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fc-scenarios-action-button fc-scenarios-action-button--primary"
                onClick={saveInflation}
              >
                Save
              </button>
            </div>
          </>
        )}

        {modalState.type === "deleteInflation" && (
          <>
            <div className="fc-scenarios-modal__header">
              <h3 className="fc-scenarios-modal__title">
                <span className="fc-scenarios-modal__title-icon">🗑️</span>
                Delete Inflation Entry
              </h3>
              <p className="fc-scenarios-modal__description">
                Delete inflation rate for year <strong>{modalState.payload?.Year}</strong>?
              </p>
            </div>
            <div className="fc-scenarios-modal__body">
              <div className="fc-scenarios-modal__warning">
                <span className="fc-scenarios-modal__warning-icon">⚠️</span>
                This action cannot be undone.
              </div>
            </div>
            <div className="fc-scenarios-modal__actions">
              <button
                type="button"
                className="fc-scenarios-action-button"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fc-scenarios-action-button fc-scenarios-action-button--danger"
                onClick={deleteInflation}
              >
                Delete
              </button>
            </div>
          </>
        )}

        {modalState.type === "editFX" && (
          <>
            <div className="fc-scenarios-modal__header">
              <h3 className="fc-scenarios-modal__title">
                <span className="fc-scenarios-modal__title-icon">💱</span>
                {modalState.payload?.isNew ? "Add" : "Edit"} FX Rates
              </h3>
              <p className="fc-scenarios-modal__description">
                Set foreign exchange rate assumptions for a specific year
              </p>
            </div>
            <div className="fc-scenarios-modal__body">
              <label className="fc-scenarios-modal__field">
                <span>Year</span>
                <input
                  type="number"
                  value={modalState.payload?.Year ?? ""}
                  onChange={(e) => handleFieldChange("Year", e.target.value)}
                />
              </label>
              <div className="fc-scenarios-modal__fx-grid">
                {Array.from(
                  new Set([
                    ...fxKeys,
                    ...Object.keys(modalState.payload?.Rates || {}),
                  ])
                ).map((key) => (
                  <label key={key} className="fc-scenarios-modal__field">
                    <span>{key}</span>
                    <input
                      type="number"
                      step="0.0001"
                      value={modalState.payload?.Rates?.[key] ?? ""}
                      onChange={(e) => handleRateChange(key, e.target.value)}
                      placeholder="e.g., 4.1234"
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="fc-scenarios-modal__actions">
              <button
                type="button"
                className="fc-scenarios-action-button"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fc-scenarios-action-button fc-scenarios-action-button--primary"
                onClick={saveFx}
              >
                Save
              </button>
            </div>
          </>
        )}

        {modalState.type === "deleteFX" && (
          <>
            <div className="fc-scenarios-modal__header">
              <h3 className="fc-scenarios-modal__title">
                <span className="fc-scenarios-modal__title-icon">🗑️</span>
                Delete FX Entry
              </h3>
              <p className="fc-scenarios-modal__description">
                Delete FX rates for year <strong>{modalState.payload?.Year}</strong>?
              </p>
            </div>
            <div className="fc-scenarios-modal__body">
              <div className="fc-scenarios-modal__warning">
                <span className="fc-scenarios-modal__warning-icon">⚠️</span>
                This action cannot be undone.
              </div>
            </div>
            <div className="fc-scenarios-modal__actions">
              <button
                type="button"
                className="fc-scenarios-action-button"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fc-scenarios-action-button fc-scenarios-action-button--danger"
                onClick={deleteFx}
              >
                Delete
              </button>
            </div>
          </>
        )}

        {modalState.type === "deleteScenario" && (
          <>
            <div className="fc-scenarios-modal__header">
              <h3 className="fc-scenarios-modal__title">
                <span className="fc-scenarios-modal__title-icon">🗑️</span>
                Delete Scenario
              </h3>
              <p className="fc-scenarios-modal__description">
                Delete scenario <strong>"{modalState.payload?.Name}"</strong>?
              </p>
            </div>
            <div className="fc-scenarios-modal__body">
              <div className="fc-scenarios-modal__warning">
                <span className="fc-scenarios-modal__warning-icon">⚠️</span>
                This will remove all related inflation and FX data. This action cannot be undone.
              </div>
            </div>
            <div className="fc-scenarios-modal__actions">
              <button
                type="button"
                className="fc-scenarios-action-button"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fc-scenarios-action-button fc-scenarios-action-button--danger"
                onClick={deleteScenario}
              >
                Delete
              </button>
            </div>
          </>
        )}

        {modalState.type === "nameScenario" && (
          <>
            <div className="fc-scenarios-modal__header">
              <h3 className="fc-scenarios-modal__title">
                <span className="fc-scenarios-modal__title-icon">✨</span>
                Name New Scenario
              </h3>
              <p className="fc-scenarios-modal__description">
                Provide a name for your new forecast scenario
              </p>
            </div>
            <div className="fc-scenarios-modal__body">
              <label className="fc-scenarios-modal__field">
                <span>Scenario Name</span>
                <input
                  type="text"
                  value={modalState.payload?.Name ?? ""}
                  onChange={(e) => handleFieldChange("Name", e.target.value)}
                  placeholder="e.g., Q1 2025 Baseline"
                />
              </label>
            </div>
            <div className="fc-scenarios-modal__actions">
              <button
                type="button"
                className="fc-scenarios-action-button"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fc-scenarios-action-button fc-scenarios-action-button--primary"
                disabled={!modalState.payload?.Name?.trim()}
                onClick={commitNewScenario}
              >
                Save & Commit
              </button>
            </div>
          </>
        )}

        {modalState.type === "commit" && (
          <>
            <div className="fc-scenarios-modal__header">
              <h3 className="fc-scenarios-modal__title">
                <span className="fc-scenarios-modal__title-icon">💾</span>
                Commit Changes
              </h3>
              <p className="fc-scenarios-modal__description">
                Save all changes to scenarios, inflation, and FX data?
              </p>
            </div>
            <div className="fc-scenarios-modal__body">
              <div className="fc-scenarios-modal__info">
                <span className="fc-scenarios-modal__info-icon">ℹ️</span>
                Your changes will be permanently saved to the server.
              </div>
            </div>
            <div className="fc-scenarios-modal__actions">
              <button
                type="button"
                className="fc-scenarios-action-button"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fc-scenarios-action-button fc-scenarios-action-button--primary"
                onClick={commitChanges}
              >
                Confirm
              </button>
            </div>
          </>
        )}

        {modalState.type === "copyScenario" && (
          <>
            <div className="fc-scenarios-modal__header">
              <h3 className="fc-scenarios-modal__title">
                <span className="fc-scenarios-modal__title-icon">📋</span>
                Copy Scenario
              </h3>
              <p className="fc-scenarios-modal__description">
                Copy <strong>"{modalState.payload?.sourceScenario}"</strong> to a new scenario.
                This will copy all assumptions, modules, and income/expense entries.
              </p>
            </div>
            <div className="fc-scenarios-modal__body">
              <label className="fc-scenarios-modal__field">
                <span>New Scenario Name</span>
                <input
                  type="text"
                  value={modalState.payload?.newScenarioName ?? ""}
                  onChange={(e) =>
                    handleFieldChange("newScenarioName", e.target.value)
                  }
                  placeholder="e.g., Q2 2025 Conservative"
                />
              </label>
              <div className="fc-scenarios-modal__info">
                <span className="fc-scenarios-modal__info-icon">ℹ️</span>
                The new scenario will include all data from the source scenario.
              </div>
            </div>
            <div className="fc-scenarios-modal__actions">
              <button
                type="button"
                className="fc-scenarios-action-button"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="fc-scenarios-action-button fc-scenarios-action-button--primary"
                disabled={!modalState.payload?.newScenarioName?.trim()}
                onClick={copyScenario}
              >
                Copy Scenario
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
