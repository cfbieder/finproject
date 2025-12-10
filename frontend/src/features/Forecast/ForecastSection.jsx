import ForecastTable from "./ForecastTable.jsx";

export default function ForecastSection({
  hasChanges,
  isSaving,
  saveError,
  saveSuccess,
  onSave,
  periodLabels,
  profitLossRows,
  netCashFlowValues,
  onPeriodDoubleClick,
  includeUnrealizedGL,
  onIncludeUnrealizedGLChange,
}) {
  return (
    <section className="section-table">
      <div className="section-table__content">
        <div>
          <h2>Forecast Expense Setup</h2>
          <p>Periods and Profit &amp; Loss accounts loaded from fc_setup.json.</p>
          <div
            className="trans-buget-panel"
            style={{ display: "flex", gap: "10px", marginTop: "10px" }}
          >
            <button
              type="button"
              disabled={!hasChanges || isSaving}
              onClick={onSave}
              style={{
                padding: "8px 12px",
                background: hasChanges && !isSaving ? "#0f766e" : "#d1d5db",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                cursor: hasChanges && !isSaving ? "pointer" : "not-allowed",
                transition: "background 0.2s ease",
              }}
            >
              {isSaving ? "Saving..." : "Save Period Changes"}
            </button>
            {saveError && <span style={{ color: "#b91c1c" }}>{saveError}</span>}
            {saveSuccess && (
              <span style={{ color: "#047857" }}>{saveSuccess}</span>
            )}
          </div>
          <label
            htmlFor="forecast-include-unrealized"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              marginTop: "8px",
              fontWeight: 600,
            }}
          >
            <input
              id="forecast-include-unrealized"
              type="checkbox"
              checked={includeUnrealizedGL}
              onChange={(event) =>
                onIncludeUnrealizedGLChange?.(event.target.checked)
              }
            />
            Include Unrealized G/L
          </label>
        </div>
        <ForecastTable
          periodLabels={periodLabels}
          profitLossRows={profitLossRows}
          netCashFlowValues={netCashFlowValues}
          onPeriodDoubleClick={onPeriodDoubleClick}
          includeUnrealizedGL={includeUnrealizedGL}
        />
      </div>
    </section>
  );
}
