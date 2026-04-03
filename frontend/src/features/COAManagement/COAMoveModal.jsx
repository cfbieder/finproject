import { useState } from "react";
import COACategoryPicker from "./COACategoryPicker.jsx";

export default function COAMoveModal({
  open,
  row,
  coaSections,
  onClose,
  onConfirm,
  isSaving,
  error,
}) {
  const [targetPath, setTargetPath] = useState([]);

  if (!open || !row) return null;

  const currentParent = row.path?.length
    ? row.path[row.path.length - 1]
    : "Root";

  return (
    <div className="coa-modal-overlay" onClick={onClose}>
      <div
        className="coa-modal"
        style={{ width: "540px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="coa-modal__header">
          <h3 className="coa-modal__title">Move Account</h3>
          <button
            type="button"
            className="coa-modal__close"
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        <div className="coa-modal__body">
          <div className="coa-move-info">
            <span className="coa-move-info__label">Moving:</span>
            <span className="coa-move-info__value">{row.name}</span>
          </div>
          <div className="coa-move-info">
            <span className="coa-move-info__label">Current parent:</span>
            <span className="coa-move-info__value">{currentParent}</span>
          </div>

          <div style={{ marginTop: "0.75rem" }}>
            <span
              style={{
                fontWeight: 700,
                color: "#0f172a",
                fontSize: "0.9rem",
                display: "block",
                marginBottom: "0.35rem",
              }}
            >
              Move to:
            </span>
            <COACategoryPicker
              coaSections={coaSections}
              selectedPath={targetPath}
              onSelect={setTargetPath}
              includeAllNodes
              excludeName={row.name}
            />
            {targetPath.length > 0 && (
              <span
                style={{
                  fontSize: "0.8rem",
                  color: "#475569",
                  marginTop: "0.25rem",
                  display: "block",
                }}
              >
                Destination: {targetPath.join(" \u203A ")}
              </span>
            )}
          </div>

          {error && (
            <p style={{ margin: "0.5rem 0 0", color: "#b91c1c", fontWeight: 700, fontSize: "0.875rem" }}>
              {error}
            </p>
          )}
        </div>

        <div className="coa-modal__footer">
          <button
            type="button"
            className="coa-toolbar-btn"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="coa-toolbar-btn coa-toolbar-btn--edit"
            style={{ color: "#fff", background: "#6B8E6B", borderColor: "#6B8E6B" }}
            onClick={() => onConfirm(row, targetPath)}
            disabled={isSaving || targetPath.length === 0}
          >
            {isSaving ? "Moving..." : "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}
