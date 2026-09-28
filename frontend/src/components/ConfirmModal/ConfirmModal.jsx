import Modal from "../Modal/Modal.jsx";

/**
 * ConfirmModal — styled in-app replacement for window.confirm().
 *
 * Controlled: pass `state` (a config object) to open, or `null` to close.
 *   state: { title?, message, confirmLabel?, cancelLabel?, danger? }
 * `busy` disables the buttons (and every dismiss path) while an async
 * confirm action runs. onConfirm / onCancel are invoked by the buttons.
 *
 * Built on the Radix `<Modal>` (CR086 §5). The hand-rolled overlay it replaces
 * had no Esc, no focus trap, a white card in dark mode, and was dead to clicks
 * under a Radix layer — on the confirms that gate delete and promote.
 */
export default function ConfirmModal({ state, busy = false, onConfirm, onCancel }) {
  if (!state) return null;
  const footer = (
    <>
      <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>
        {state.cancelLabel || "Cancel"}
      </button>
      <button
        type="button"
        className={`btn ${state.danger ? "btn--danger" : "btn--primary"}`}
        onClick={onConfirm}
        disabled={busy}
      >
        {busy ? "Working…" : state.confirmLabel || "Confirm"}
      </button>
    </>
  );
  return (
    <Modal
      open
      onClose={busy ? undefined : onCancel}
      dismissable={!busy}
      title={state.title || "Confirm"}
      hideTitle={!state.title}
      footer={footer}
    >
      <p style={{ margin: 0, whiteSpace: "pre-line" }}>{state.message}</p>
    </Modal>
  );
}
