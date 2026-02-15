/**
 * Shared delete confirmation modal for transactions.
 * Displays count and requires user confirmation before deletion.
 */
export default function TransactionDeleteModal({
  isOpen,
  selectedCount,
  isDeleting,
  error,
  onCancel,
  onConfirm,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="trans-budget-delete-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Delete selected transactions"
    >
      <div className="trans-budget-delete-modal">
        <h3>Confirm deletion</h3>
        <p>
          You are about to delete {selectedCount} transaction
          {selectedCount === 1 ? "" : "s"}. This cannot be undone.
        </p>
        {error && (
          <p className="trans-budget-delete-modal__error">{error}</p>
        )}
        <div className="trans-budget-delete-modal__actions">
          <button
            className="generate-report-button"
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            className="generate-report-button"
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
