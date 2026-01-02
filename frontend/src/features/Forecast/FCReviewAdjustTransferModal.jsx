export default function FCReviewAdjustTransferModal({
  isOpen,
  onClose,
  entry,
  scenarioName,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="trans-budget-edit-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Modify Transfer"
    >
      <div
        className="trans-budget-edit-modal"
        style={{
          width: "min(600px, 95vw)",
          maxHeight: "75vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "var(--muted)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Modify Transfer
            </p>
            <h3 style={{ margin: "0.25rem 0 0", color: "var(--ink)" }}>
              Transfer • {entry?.Module || "Unknown Module"}
            </h3>
          </div>
          <button
            type="button"
            className="generate-report-button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div
          style={{
            color: "var(--muted)",
            padding: "2rem",
            textAlign: "center",
            fontWeight: 600,
          }}
        >
          Modify Transfer functionality will be implemented in the next steps.
        </div>
      </div>
    </div>
  );
}
