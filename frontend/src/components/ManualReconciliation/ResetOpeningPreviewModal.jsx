import Modal from "../Modal/Modal.jsx";
import Money from "../Money/Money.jsx";
import "./ResetOpeningPreviewModal.css";

/**
 * CR087 P1 — show what "Reset opening" is about to do, computed by the SERVER.
 *
 * 🔴 The defect this replaces was not a missing confirmation — there was one,
 * with figures in it. It was that the figures were computed in the BROWSER
 * (`opening_balance`, `computed_balance − opening_balance`) while the write is
 * computed on the server, and the apply carried no expectation. Approving one
 * arithmetic and writing another is the shape P0c fixed for the feed page; this
 * is the same page family's last instance of it.
 *
 * Built on the Radix `<Modal>`, deliberately NOT `ConfirmModal`: CR086 §5
 * measured that component as having no Esc, no focus trap and a white card on a
 * dark page, and `nested-modal.spec.js` records it as dead to clicks under a
 * Radix layer. It is the wrong home for a destructive write.
 *
 * Zeroing `opening_balance` moves EVERY balance on the account, today's
 * included — so the modal states the shift explicitly rather than making the
 * reader subtract two long figures, which is how a wrong one gets approved.
 */
export default function ResetOpeningPreviewModal({
  open,
  preview,
  account,
  busy,
  error,
  stale,
  onCancel,
  onApply,
}) {
  if (!open || !account) return null;

  const ccy = account.currency || "USD";
  // A Quicken-calibrated account is refused server-side: there `opening_balance`
  // is a computed anchor, not a plug. There is nothing to apply, so the primary
  // action is an explicit override rather than a normal Apply.
  const blocked = preview?.blocked === true;
  // Nothing to do: the plug is already zero. Also not an apply.
  const noop = !blocked && preview != null && preview.applied !== true && preview.old_opening === 0;

  const footer = (
    <div className="rop__footer">
      <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
        {noop ? "Close" : "Cancel"}
      </button>
      {!noop && (
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => onApply(blocked)}
          disabled={!preview || busy}
        >
          {busy
            ? "Working…"
            : stale
              ? "Apply updated figures"
              : blocked
                ? "Reset anyway (override)"
                : "Reset opening balance"}
        </button>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onCancel}
      dismissable={!busy}
      title={blocked ? "Safety guard — override?" : "Reset opening balance"}
      description={
        blocked
          ? "This account's opening balance is a computed anchor rather than a plug. Nothing is written unless you override."
          : "Zeroing the opening balance shifts every balance on this account, today's included. Nothing is written until you confirm."
      }
      footer={footer}
    >
      <div className="rop">
        <div className="rop__account">
          <span className="rop__account-name">{account.name}</span>
          <span className="rop__ccy">{ccy}</span>
        </div>

        {!preview && !error && <p className="rop__loading">Computing the preview…</p>}
        {error && <p className="rop__error" role="alert">{error}</p>}

        {/* The reason comes ABOVE the figures: a reader who meets the numbers
            first has already read them as a proposal. */}
        {blocked && (
          <p className="rop__refused" role="status">
            <strong>Blocked — nothing has been written.</strong> {preview.note}
          </p>
        )}
        {noop && (
          <p className="rop__refused" role="status">
            {preview.note || "The opening balance is already 0 — nothing to reset."}
          </p>
        )}

        {stale && (
          <p className="rop__stale" role="status">
            <strong>The figures moved since you previewed them.</strong> Nothing was written. These
            are the server's current figures — approving applies THESE.
          </p>
        )}

        {preview && !noop && (
          <>
            <div className="rop__move">
              <div className="rop__move-row">
                <span className="rop__move-label">Opening balance</span>
                <span className="rop__num">
                  <Money value={preview.old_opening} currency={ccy} />
                  <span className="rop__arrow" aria-label="becomes"> → </span>
                  <Money value={0} currency={ccy} bold />
                </span>
              </div>
              <div className="rop__move-row rop__move-row--delta">
                <span className="rop__move-label">Every balance moves by</span>
                {/* Signed: this IS a delta, and its direction is the point. */}
                <span className="rop__num">
                  <Money value={preview.shift} currency={ccy} signed />
                </span>
              </div>
            </div>

            <dl className="rop__facts">
              <div>
                <dt>Computed balance</dt>
                <dd className="rop__num">
                  <Money value={preview.computed_before} currency={ccy} />
                  <span className="rop__arrow" aria-label="becomes"> → </span>
                  <Money value={preview.computed_after} currency={ccy} />
                </dd>
              </div>
              <div>
                <dt>Σ transactions</dt>
                <dd className="rop__num"><Money value={preview.sum_tx} currency={ccy} /></dd>
              </div>
            </dl>

            <p className="rop__note">
              The entered balance is not touched, so this account will show a gap of{" "}
              <Money value={preview.old_opening} currency={ccy} /> until you Reconcile it — which
              books the amount as a dated entry instead of a hidden plug.
              {account.reconcile_mode !== "mtm" && (
                <>
                  {" "}
                  <strong>This account is in bank (calibrate) mode</strong>, where Reconcile
                  re-anchors the opening balance — clicking it after this would restore{" "}
                  <Money value={preview.old_opening} currency={ccy} />. Switch the row to brokerage
                  (mtm) first if you want the gap booked as a dated entry.
                </>
              )}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
