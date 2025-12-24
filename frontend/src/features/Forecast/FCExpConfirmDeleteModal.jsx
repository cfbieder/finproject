import "./FCModulesEdit.css";
import "./FCExpModal.css";

export default function FCExpConfirmDeleteModal({
  isOpen,
  selectedEntry,
  error,
  isSaving,
  onClose,
  onConfirm,
}) {
  if (!isOpen) return null;

  const entryLabel =
    selectedEntry?.Name || selectedEntry?.Account || "this entry";

  return (
    <div className="fc-scenarios-modal-overlay" onClick={onClose}>
      <div
        className="fc-scenarios-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="fc-scenarios-modal__title">Delete Entry</h3>
        <p className="fc-scenarios-modal__description">
          {`Delete ${entryLabel}? This action cannot be undone.`}
        </p>
        {error && (
          <div className="trans-budget-edit-modal__error">{error}</div>
        )}
        <div className="fc-scenarios-modal__actions">
          <button
            type="button"
            className="fc-scenarios-action-button"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fc-scenarios-action-button fc-scenarios-action-button--danger"
            onClick={onConfirm}
            disabled={isSaving}
          >
            {isSaving ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
