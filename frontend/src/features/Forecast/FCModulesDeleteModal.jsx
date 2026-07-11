import Modal from "../../components/Modal/Modal.jsx";
import "./FCExpDeleteModal.css";

/**
 * Delete confirmation modal for forecast modules.
 * Displays module details and requires user confirmation before deletion.
 *
 * @component
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {Object|null} props.selectedModule - Module to delete
 * @param {boolean} props.deleteSaving - Whether deletion is in progress
 * @param {string} props.deleteError - Error message if deletion failed
 * @param {Function} props.onClose - Close modal callback
 * @param {Function} props.onDelete - Delete confirmation callback
 * @returns {JSX.Element|null} Delete modal or null if not open
 */
export default function FCModulesDeleteModal({
  isOpen,
  selectedModule,
  deleteSaving,
  deleteError,
  onClose,
  onDelete,
}) {
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      bare
      dismissable={!deleteSaving}
      ariaLabel="Delete Module"
    >
      <div className="fc-delete-modal">
        <div className="fc-delete-modal__icon-container">
          <div className="fc-delete-modal__icon">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        <h3 className="fc-delete-modal__title">Delete Module</h3>
        <p className="fc-delete-modal__description">
          Are you sure you want to delete{" "}
          <strong>
            {selectedModule?.Name || selectedModule?.Account || "this module"}
          </strong>
          ?
        </p>
        <p className="fc-delete-modal__warning">
          This action cannot be undone.
        </p>

        {deleteError && (
          <div className="fc-delete-modal__error">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {deleteError}
          </div>
        )}

        <div className="fc-delete-modal__actions">
          <button
            type="button"
            className="fc-delete-modal__button fc-delete-modal__button--cancel"
            onClick={onClose}
            disabled={deleteSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fc-delete-modal__button fc-delete-modal__button--delete"
            onClick={onDelete}
            disabled={deleteSaving}
          >
            {deleteSaving ? (
              <>
                <span className="fc-delete-modal__spinner"></span>
                Deleting...
              </>
            ) : (
              <>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M19 7L18.1327 19.1425C18.0579 20.1891 17.187 21 16.1378 21H7.86224C6.81296 21 5.94208 20.1891 5.86732 19.1425L5 7M10 11V17M14 11V17M15 7V4C15 3.44772 14.5523 3 14 3H10C9.44772 3 9 3.44772 9 4V7M4 7H20"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Delete
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
