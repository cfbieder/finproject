/**
 * Delete confirmation modal for actual transactions.
 * Displays count and requires user confirmation before deletion.
 *
 * @component
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {number} props.selectedCount - Number of selected transactions
 * @param {boolean} props.isDeleting - Whether deletion is in progress
 * @param {string} props.deleteError - Error message if deletion failed
 * @param {Function} props.onCancel - Cancel callback
 * @param {Function} props.onConfirm - Confirm deletion callback
 * @returns {JSX.Element|null} Delete modal or null if not open
 */
export default function TransActualDeleteModal({
  isOpen,
  selectedCount,
  isDeleting,
  deleteError,
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
        {deleteError && (
          <p className="trans-budget-delete-modal__error">{deleteError}</p>
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
