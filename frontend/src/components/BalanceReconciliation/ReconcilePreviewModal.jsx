import { useEffect, useState } from "react";
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
  balanceDate = "",
  onBalanceDateChange,
  onForce,
}) {
  // CR089 P1 — which feed OBSERVATION this row marks against. It used to be a page-level box
  // that applied to every row reconciled while it was set; it is now this row's own question,
  // PRE-FILLED (never auto-applied) from the candidates the engine returns when its own pick was
  // synced before the day ended. "Confirm" must also mean "change": the field stays editable.
  const candidates = preview?.later_observations || [];
  const suggested = balanceDate || candidates[0]?.balance_date || "";
  const [draftDate, setDraftDate] = useState(suggested);
  useEffect(() => { setDraftDate(suggested); }, [suggested]);
  // "Book anyway" is armed by an explicit acknowledgement, and disarmed whenever
  // the figures change (a new observation is a new number to check).
  const [forceAck, setForceAck] = useState(false);
  useEffect(() => { setForceAck(false); }, [preview]);

  if (!open || !account) return null;

  const ccy = account.currency ? ` ${account.currency}` : "";
  const mode = preview?.mode || account.reconcile_mode || "calibrate";

  // A refused run (accrue's yield guard, mtm's stale/implausible guards, the
  // Quicken-anchor block) returns applied:false with a reason. There is nothing
  // to apply, so the primary action must not be offered — the refusal IS the
  // outcome.
  //
  // ⚠️ This gate was DEAD for every feed reconcile: `refused`/`blocked` were set
  // only by reconcileManual, so an accrue preview arrived with both undefined,
  // rendered its figures as a proposal and lit Apply — which posted, was refused
  // server-side, and changed nothing but a toast. reconcileToFeed now sets
  // `refused` on all three modes. It is NOT re-derived here from `implausible` /
  // `stale_feed` / `note`: which of those actually blocks a write is the engine's
  // rule, and a copy of it in the UI is the restatement that goes stale.
  const refused = preview ? preview.refused === true || preview.blocked === true : false;

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
      rows.push([refused ? "Gap (not booked)" : "MTM entry", `${fmtNum(preview.mtm_amount)}${ccy}`]);
      rows.push([refused ? "Would have been dated" : "Dated", `${preview.month_end ?? "—"}`]);
    } else if (mode === "accrue") {
      // Nothing is written on a refusal, so nothing here may be phrased as a
      // thing that will happen: "Accrual … Books to Interest Income … Dated"
      // describes a transaction that will not exist. The figure stays — it is
      // the evidence the refusal reasons about — but named for what it is, and
      // the income category goes, because no row books to it.
      rows.push([refused ? "Gap (not booked)" : "Accrual", `${fmtNum(preview.accrual_amount)}${ccy}`]);
      if (!refused) {
        rows.push(["Books to", preview.category_name || account.accrual_category_name || "—"]);
      }
      rows.push([refused ? "Would have been dated" : "Dated", `${preview.book_date ?? "—"}`]);
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

  const footer = (
    <div className="rpm__footer">
      <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
        {refused ? "Close" : "Cancel"}
      </button>
      {/* Not merely DISABLED when refused — absent. A greyed-out Apply still
          reads as "this is the action, one condition away"; there is no such
          condition. Cancel becomes Close, and the dialog is an explanation.
          On a stale preview the figures shown are the server's CURRENT ones
          (from the 409), so the action is to approve THOSE — not to re-preview,
          which would recompute from the un-synced cache and stale again. */}
      {!refused && (
        <button
          type="button"
          className={`btn ${isReAnchor ? "btn--danger" : "btn--primary"}`}
          onClick={onApply}
          disabled={!preview || busy}
        >
          {busy
            ? "Working…"
            : stale
              ? "Apply updated figures"
              : isReAnchor
                ? "Re-anchor"
                : "Apply"}
        </button>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onCancel}
      dismissable={!busy}
      title={
        refused
          ? "Not booked"
          : isReAnchor
            ? "Re-anchor opening balance"
            : "Reconcile to feed"
      }
      description={
        refused
          ? "This account will not reconcile in its current state. Nothing will be written — the figures below are what was computed, and why it was rejected."
          : isReAnchor
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

        {/* ABOVE the figures: the reason is the headline of a refusal, and a
            reader who meets the numbers first has already read them as a
            proposal by the time the reason arrives. */}
        {refused && (
          <p className="rpm__refused" role="status">
            <strong>Refused — nothing was written.</strong>{" "}
            {preview.note || "This account will not reconcile in its current state."}
          </p>
        )}

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

        {(mode === "mtm" || mode === "accrue") && onBalanceDateChange && preview && (
          <div className="rpm__observation">
            <label className="rpm__observation-label">
              Mark against balance dated
              <input
                type="date"
                value={draftDate}
                onChange={(e) => setDraftDate(e.target.value)}
                disabled={busy}
              />
            </label>
            <span className="rpm__observation-actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => onBalanceDateChange(draftDate)}
                disabled={busy || !draftDate || draftDate === balanceDate}
              >
                Preview against this date
              </button>
              {balanceDate && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => onBalanceDateChange("")}
                  disabled={busy}
                >
                  Engine&apos;s pick
                </button>
              )}
            </span>
            {candidates.length > 0 && (
              <ul className="rpm__candidates">
                {candidates.map((c) => (
                  <li key={c.balance_date}>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => onBalanceDateChange(c.balance_date)}
                      disabled={busy || c.balance_date === balanceDate}
                    >
                      {c.balance_date}
                    </button>{" "}
                    <span className="rpm__num">{fmtNum(c.balance)}{ccy}</span>
                    <span className="rpm__muted"> · synced {c.synced_on}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="rpm__muted">
              {balanceDate
                ? `Figures above are measured against the balance dated ${balanceDate}.`
                : "Figures above use the engine's own pick. The feed syncs once a day, mid-session in New York, and dates each sync with the next day's date — see the month-end runbook §3 for choosing between candidates."}
            </p>
          </div>
        )}

        {/* A refused MTM can still be booked, deliberately. The guards refuse what
            they cannot prove right, and some months nothing provable exists — at
            2026-09-30 a bank-feed stall left no observation holding that day's
            close, and the only way to book was a script. Offered for mtm only:
            calibrate and accrue refusals are not judgement calls about a market
            value, and the engine's `force` means something different there. */}
        {refused && mode === "mtm" && onForce && preview && (
          <div className="rpm__override">
            <label className="rpm__override-ack">
              <input
                type="checkbox"
                checked={forceAck}
                onChange={(e) => setForceAck(e.target.checked)}
                disabled={busy}
              />
              I have checked this figure and want it booked despite the refusal.
            </label>
            <button
              type="button"
              className="btn btn--danger"
              onClick={onForce}
              disabled={busy || !forceAck}
            >
              Book anyway: {fmtNum(preview.mtm_amount)}{ccy} on {preview.month_end ?? "—"}
            </button>
          </div>
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
