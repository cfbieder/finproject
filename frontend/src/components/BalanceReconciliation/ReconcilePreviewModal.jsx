import Modal from "../Modal/Modal.jsx";
import "./ReconcilePreviewModal.css";

/**
 * CR087 P0c — show what Reconcile is about to do, before it does it.
 *
 * `calibrate()` re-anchors `opening_balance`, which shifts EVERY historical date
 * on that account by one constant. Until now the owner confirmed a sentence with
 * no figures in it and learned the numbers from a toast AFTER the write.
 *
 * ⚠️ Built on `<Modal>` (Radix), deliberately NOT on `ConfirmModal`. CR086 §5
 * measured that component as having no Esc, no focus trap, 17 naked hex literals
 * and a white card on a dark page — and `frontend/e2e/nested-modal.spec.js`
 * records that with a Radix layer open it is DEAD TO CLICKS and absent from the
 * a11y tree, because Radix sets `pointer-events: none` on `<body>`. That is the
 * wrong place for the most consequential number in the reconcile loop. Owner
 * decision, 2026-08-24.
 */
export default function ReconcilePreviewModal({
  open,
  preview,
  account,
  busy,
  error,
  stale,
  onCancel,
  onApply,
  fmtNum,
}) {
  if (!open || !account) return null;

  const ccy = account.currency ? ` ${account.currency}` : "";
  const mode = preview?.mode || account.reconcile_mode || "calibrate";

  // Each mode writes a different thing, so each shows its own figures rather
  // than a lowest-common-denominator summary that would omit the number that
  // matters. `delta` is stated explicitly: "how much does this move" is the
  // question, and making the reader subtract two long figures is how a wrong
  // one gets approved.
  const rows = [];
  if (preview) {
    rows.push(["Feed observation", `${preview.feed_date ?? "—"}`]);
    if (mode === "calibrate") {
      rows.push(["Bank reports", `${fmtNum(preview.feed_balance)}${ccy}`]);
      rows.push(["Expected in fin", `${fmtNum(preview.expected)}${ccy}`]);
      rows.push(["Σ transactions", `${fmtNum(preview.sum_tx)}${ccy}`]);
    } else if (mode === "mtm") {
      rows.push(["MTM entry", `${fmtNum(preview.mtm_amount)}${ccy}`]);
      rows.push(["Dated", `${preview.month_end ?? "—"}`]);
    } else if (mode === "accrue") {
      rows.push(["Accrual", `${fmtNum(preview.accrual_amount)}${ccy}`]);
      rows.push(["Books to", preview.category_name || account.accrual_category_name || "—"]);
      rows.push(["Dated", `${preview.book_date ?? "—"}`]);
      if (preview.implied_apy != null) {
        rows.push(["Implied yield", `${(preview.implied_apy * 100).toFixed(2)}%/yr over ${preview.period_days}d`]);
      }
    }
  }

  const isReAnchor = mode === "calibrate";
  const delta =
    isReAnchor && preview && preview.new_opening != null && preview.old_opening != null
      ? Number(preview.new_opening) - Number(preview.old_opening)
      : null;

  // A refused run (accrue's yield guard, the Quicken-anchor block) returns
  // applied:false with a reason. There is nothing to apply, so the primary
  // action must not be offered — the refusal IS the outcome.
  const refused = preview ? preview.blocked === true || preview.refused === true : false;
  const canApply = Boolean(preview) && !refused && !busy;

  const footer = (
    <div className="rpm__footer">
      <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      {/* On a stale preview the figures shown are the server's CURRENT ones
          (from the 409), so the action is to approve THOSE — not to re-preview,
          which would recompute from the un-synced cache and stale again. */}
      <button
        type="button"
        className={`btn ${isReAnchor ? "btn--danger" : "btn--primary"}`}
        onClick={onApply}
        disabled={!canApply}
      >
        {busy
          ? "Working…"
          : stale
            ? "Apply updated figures"
            : isReAnchor
              ? "Re-anchor"
              : "Apply"}
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onCancel}
      dismissable={!busy}
      title={isReAnchor ? "Re-anchor opening balance" : "Reconcile to feed"}
      description={
        isReAnchor
          ? "Re-anchoring shifts every historical date on this account by one constant. Nothing is written until you confirm."
          : "Nothing is written until you confirm."
      }
      footer={footer}
    >
      <div className="rpm">
        <div className="rpm__account">
          <span className="rpm__account-name">{account.name}</span>
          <span className="rpm__mode">{mode}</span>
        </div>

        {!preview && !error && <p className="rpm__loading">Computing the preview…</p>}

        {rows.length > 0 && (
          <dl className="rpm__facts">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className="rpm__num">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {isReAnchor && preview && (
          <div className="rpm__move">
            <div className="rpm__move-row">
              <span className="rpm__move-label">Opening balance</span>
              <span className="rpm__num">
                {fmtNum(preview.old_opening)}
                <span className="rpm__arrow" aria-label="becomes"> → </span>
                <strong>{fmtNum(preview.new_opening)}</strong>
                {ccy}
              </span>
            </div>
            <div className="rpm__move-row rpm__move-row--delta">
              <span className="rpm__move-label">Moves by</span>
              {/* A zero delta is NEUTRAL, not a gain. Colouring 0.00 green would
                  assert something untrue about a re-anchor that moves nothing. */}
              <span
                className={`rpm__num ${
                  delta === 0 ? "" : delta < 0 ? "rpm__num--neg" : "rpm__num--pos"
                }`}
              >
                {delta > 0 ? "+" : ""}
                {fmtNum(delta)}
                {ccy}
              </span>
            </div>
          </div>
        )}

        {refused && (
          <p className="rpm__refused" role="status">
            <strong>Refused.</strong> {preview.note || "This account will not reconcile in its current state."}
          </p>
        )}

        {stale && (
          <p className="rpm__stale" role="alert">
            <strong>The figures moved and nothing was written.</strong> The numbers
            above are now the server&apos;s current ones. {error}
          </p>
        )}

        {error && !stale && (
          <p className="rpm__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
