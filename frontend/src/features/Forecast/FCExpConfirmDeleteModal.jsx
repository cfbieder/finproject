import "./FCModulesEdit.css";
import "./FCExpModal.css";
import "./FCExpDeleteModal.css";

/**
 * FCExpConfirmDeleteModal - Confirmation dialog for deleting income/expense entries
 *
 * Displays a modal dialog asking the user to confirm deletion of a forecast entry.
 * Shows the entry name/account being deleted and handles the deletion process.
 *
 * @component
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether the modal is visible
 * @param {Object} props.selectedEntry - The entry to be deleted
 * @param {string} props.error - Error message to display
 * @param {boolean} props.isSaving - Whether deletion is in progress
 * @param {Function} props.onClose - Callback to close the modal
 * @param {Function} props.onConfirm - Callback to confirm deletion
 * @returns {JSX.Element|null} The delete confirmation modal or null if not open
 */
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
    <div className="fc-delete-modal-overlay" onClick={onClose}>
      <div
        className="fc-delete-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="fc-delete-modal__icon-container">
          <div className="fc-delete-modal__icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </div>
        <h3 className="fc-delete-modal__title">Delete Entry</h3>
        <p className="fc-delete-modal__description">
          Are you sure you want to delete <strong>{entryLabel}</strong>?
        </p>
        <p className="fc-delete-modal__warning">
          This action cannot be undone.
        </p>
        {error && (
          <div className="fc-delete-modal__error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {error}
          </div>
        )}
        <div className="fc-delete-modal__actions">
          <button
            type="button"
            className="fc-delete-modal__button fc-delete-modal__button--cancel"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fc-delete-modal__button fc-delete-modal__button--delete"
            onClick={onConfirm}
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <span className="fc-delete-modal__spinner"></span>
                Deleting...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 7L18.1327 19.1425C18.0579 20.1891 17.187 21 16.1378 21H7.86224C6.81296 21 5.94208 20.1891 5.86732 19.1425L5 7M10 11V17M14 11V17M15 7V4C15 3.44772 14.5523 3 14 3H10C9.44772 3 9 3.44772 9 4V7M4 7H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Delete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
