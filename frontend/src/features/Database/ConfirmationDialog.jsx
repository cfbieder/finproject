export default function ConfirmationDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
}) {
  return (
    <div className="clear-confirmation">
      <p>{message}</p>
      <div className="clear-confirmation__actions">
        <button
          type="button"
          className="upload-submit upload-submit_clear"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          className="upload-submit upload-submit_cancel"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
