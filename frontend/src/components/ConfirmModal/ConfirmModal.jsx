import "./ConfirmModal.css";

/**
 * ConfirmModal — styled in-app replacement for window.confirm().
 *
 * Controlled: pass `state` (a config object) to open, or `null` to close.
 *   state: { title?, message, confirmLabel?, cancelLabel?, danger? }
 * `busy` disables the buttons (and the overlay-click cancel) while an async
 * confirm action runs. onConfirm / onCancel are invoked by the buttons.
 */
export default function ConfirmModal({ state, busy = false, onConfirm, onCancel }) {
  if (!state) return null;
  return (
    <div className="confirm-modal__overlay" onClick={busy ? undefined : onCancel}>
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {state.title && <div className="confirm-modal__header">{state.title}</div>}
        <div className="confirm-modal__body">
          <p className="confirm-modal__message">{state.message}</p>
        </div>
        <div className="confirm-modal__footer">
          <button
            type="button"
            className="confirm-modal__btn"
            onClick={onCancel}
            disabled={busy}
          >
            {state.cancelLabel || "Cancel"}
          </button>
          <button
            type="button"
            className={`confirm-modal__btn ${state.danger ? "confirm-modal__btn--danger" : "confirm-modal__btn--primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : state.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
