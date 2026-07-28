import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../../components/Modal/Modal.jsx";
import AccountPicker, { buildHierarchyOptions } from "../../components/AccountPicker/AccountPicker.jsx";
import Rest from "../../js/rest.js";
import "./BookAtSourceModal.css";

/**
 * BookAtSourceModal — CR057 "Book income at source".
 *
 * An income row sitting on the account where the CASH LANDED (PKO) is restated
 * onto the holding that EARNED it, as a three-leg booking. The modal never
 * writes on open: picking a holding runs the endpoint's `dryRun`, which returns
 * the exact rows that would be written plus the holding's book value before and
 * after — the same code path as the write, so the preview cannot drift from it.
 *
 * A row that is already booked shows the Undo view instead. Undo refuses if a
 * created leg has been edited since it was written, because deleting it then
 * would move the holding's book value and silently invalidate every later mark.
 */

const money = (v, ccy) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${ccy ? ` ${ccy}` : ""}`;
};

export default function BookAtSourceModal({ open, transaction, restatement, onClose, onDone }) {
  const [options, setOptions] = useState([]);
  const [holdingId, setHoldingId] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isBooked = !!restatement;
  const txId = transaction?.id;

  useEffect(() => {
    if (!open || isBooked) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await Rest.fetchAccountsV2({ activeOnly: true, leafOnly: true });
        // Only balance-sheet accounts can earn income, and only same-currency
        // ones will pass the server's guard — filter here so the picker doesn't
        // offer choices the endpoint will refuse.
        const eligible = rows.filter(
          (a) => a.section === "balance_sheet"
            && a.id !== transaction?.account_id
            && (!transaction?.currency || (a.currency || "").trim() === (transaction.currency || "").trim())
        );
        if (!cancelled) setOptions(buildHierarchyOptions(eligible));
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [open, isBooked, transaction?.account_id, transaction?.currency]);

  // Reset when the modal is opened for a different row.
  useEffect(() => {
    if (!open) return;
    setHoldingId("");
    setPreview(null);
    setError("");
  }, [open, txId]);

  const runPreview = useCallback(async (id) => {
    setHoldingId(id);
    setPreview(null);
    setError("");
    if (!id) return;
    setBusy(true);
    try {
      const res = await fetch(Rest.buildUrl(`/api/v2/transactions/${txId}/book-at-source`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holding_account_id: Number(id), dryRun: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Preview failed");
      setPreview(body.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [txId]);

  const commit = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(Rest.buildUrl(`/api/v2/transactions/${txId}/book-at-source`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holding_account_id: Number(holdingId) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Booking failed");
      onDone?.(`Booked at ${preview?.holding?.name ?? "the holding"} — book value unchanged`);
      onClose?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [txId, holdingId, preview, onDone, onClose]);

  const undo = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(Rest.buildUrl(`/api/v2/transactions/${txId}/book-at-source/undo`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Undo failed");
      onDone?.("Restatement undone — the original category is restored");
      onClose?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [txId, onDone, onClose]);

  const bookUnchanged = useMemo(() => {
    if (!preview) return false;
    return preview.holding_book_before?.amount === preview.holding_book_after?.amount
      && preview.holding_book_before?.base_amount === preview.holding_book_after?.base_amount;
  }, [preview]);

  if (!open) return null;

  const footer = isBooked ? (
    <>
      <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Close</button>
      <button type="button" className="btn btn--danger" onClick={undo} disabled={busy}>
        {busy ? "Undoing…" : "Undo book at source"}
      </button>
    </>
  ) : (
    <>
      <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="btn btn--primary" onClick={commit} disabled={busy || !preview}>
        {busy ? "Working…" : "Book at source"}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="wide"
      dismissable={!busy}
      title={isBooked ? "Undo book at source" : "Book income at source"}
      description={
        isBooked
          ? "Removes the two legs on the holding and restores this row's original category."
          : "Records the income on the holding that earned it, then transfers the cash here. Nothing is written until you confirm."
      }
      footer={footer}
    >
      <div className="bas">
        <dl className="bas__source">
          <div><dt>Date</dt><dd>{String(transaction?.transaction_date ?? "").slice(0, 10)}</dd></div>
          <div><dt>Amount</dt><dd className="bas__num">{money(transaction?.amount, transaction?.currency)}</dd></div>
          <div><dt>Account</dt><dd>{transaction?.account_name}</dd></div>
          <div><dt>Category</dt><dd>{transaction?.category_name}</dd></div>
        </dl>
        <p className="bas__desc">{transaction?.description1}</p>

        {isBooked ? (
          <p className="bas__note">
            Booked at <strong>{restatement.holding_name}</strong>. Undo will refuse if either created
            leg has been edited since — deleting an edited leg would change the holding&apos;s book value.
          </p>
        ) : (
          <div className="bas__field">
            <label className="bas__label" htmlFor="bas-holding">Holding that earned this income</label>
            <AccountPicker
              value={holdingId ? Number(holdingId) : ""}
              options={options}
              placeholder="Search holdings…"
              onChange={runPreview}
            />
            <p className="bas__hint">
              Only balance-sheet accounts in {transaction?.currency} are listed — a cross-currency
              leg needs a rate policy this action does not take.
            </p>
          </div>
        )}

        {error && <p className="bas__error">{error}</p>}

        {preview && (
          <div className="bas__preview">
            <h4 className="bas__h">Will create</h4>
            <table className="bas__table">
              <thead>
                <tr><th>Account</th><th>Category</th><th className="bas__r">Amount</th><th className="bas__r">USD</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>{preview.holding.name}</td>
                  <td>{transaction?.category_name}</td>
                  <td className="bas__r bas__num">{money(preview.create[0].amount)}</td>
                  <td className="bas__r bas__num">{money(preview.create[0].base_amount)}</td>
                </tr>
                <tr>
                  <td>{preview.holding.name}</td>
                  <td>{preview.update.to_category_name}</td>
                  <td className="bas__r bas__num">{money(preview.create[1].amount)}</td>
                  <td className="bas__r bas__num">{money(preview.create[1].base_amount)}</td>
                </tr>
              </tbody>
            </table>

            <h4 className="bas__h">Will change</h4>
            <p className="bas__change">
              {transaction?.account_name} · this row&apos;s category{" "}
              <span className="bas__was">{preview.update.from_category_name}</span>
              {" → "}
              <strong>{preview.update.to_category_name}</strong>
              <br />
              <span className="bas__hint">The amount is never touched, so this account&apos;s balance does not move.</span>
            </p>

            <p className={bookUnchanged ? "bas__ok" : "bas__error"}>
              {preview.holding.name} book value{" "}
              {bookUnchanged ? "unchanged" : "WOULD CHANGE — do not proceed"}:{" "}
              <strong>{money(preview.holding_book_before.amount, preview.holding.currency)}</strong>
              {" → "}
              <strong>{money(preview.holding_book_after.amount, preview.holding.currency)}</strong>
              {" · "}
              <strong>{money(preview.holding_book_before.base_amount, "USD")}</strong>
              {" → "}
              <strong>{money(preview.holding_book_after.base_amount, "USD")}</strong>
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
