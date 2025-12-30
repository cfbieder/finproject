import PropTypes from "prop-types";

export default function FCReviewAuditTrailModal({ auditModal, onClose }) {
  if (!auditModal?.isOpen) {
    return null;
  }

  const { title, headers = [], rows = [], loading, error } = auditModal;
  const hasData = headers.length > 0 && rows.length > 0;

  return (
    <div
      className="trans-budget-edit-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Audit trail details"
    >
      <div
        className="trans-budget-edit-modal"
        style={{
          width: "min(920px, 96vw)",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
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
              Audit Trail
            </p>
            <h3 style={{ margin: "0.25rem 0 0", color: "var(--ink)" }}>
              {title || "Module entries"}
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

        {loading ? (
          <p style={{ margin: "1rem 0", color: "var(--muted)", fontWeight: 600 }}>
            Loading audit trail...
          </p>
        ) : error ? (
          <p style={{ margin: "1rem 0", color: "var(--danger)", fontWeight: 600 }}>
            {error}
          </p>
        ) : hasData ? (
          <div style={{ overflowX: "auto", marginTop: "1rem" }}>
            <table className="trans-budget-table">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th
                      key={header}
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${rowIndex}-${title || "audit"}`}>
                    {headers.map((header) => (
                      <td key={`${rowIndex}-${header}`}>
                        {row[header] ?? "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ margin: "1rem 0", color: "var(--muted)", fontWeight: 600 }}>
            No audit trail data found for this module.
          </p>
        )}
      </div>
    </div>
  );
}

FCReviewAuditTrailModal.propTypes = {
  auditModal: PropTypes.shape({
    isOpen: PropTypes.bool,
    title: PropTypes.string,
    headers: PropTypes.arrayOf(PropTypes.string),
    rows: PropTypes.arrayOf(PropTypes.object),
    loading: PropTypes.bool,
    error: PropTypes.string,
  }),
  onClose: PropTypes.func,
};
