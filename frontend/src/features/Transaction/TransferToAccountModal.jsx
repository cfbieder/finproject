import { useEffect, useState } from "react";
import Rest from "../../js/rest.js";
import Modal from "../../components/Modal/Modal.jsx";
import { AccountPicker, buildHierarchyOptions } from "../../components/AccountPicker/AccountPicker.jsx";
// `.trans-budget-edit-modal__field` lives there; Ledger does not otherwise load it.
import "../../pages/PageLayout.css";

/**
 * CR022 — offset a transaction against another tracked account
 * (POST /transactions/:id/transfer). Shared by Refresh Feeds and Ledger.
 *
 * `onDone(result)` receives `{ original, offset }`; the caller owns the toast,
 * so each page can offer its own Undo.
 */
export default function TransferToAccountModal({ entry, onClose, onDone, onError }) {
  const [options, setOptions] = useState([]);
  const [loadState, setLoadState] = useState("loading"); // loading | ready | failed
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Rest.fetchAccountsV2()
      .then((rows) => { if (active) { setOptions(buildHierarchyOptions(rows)); setLoadState("ready"); } })
      .catch(() => { if (active) setLoadState("failed"); });
    return () => { active = false; };
  }, []);

  const confirm = async () => {
    if (!targetId) return;
    setSaving(true);
    try {
      const r = await fetch(Rest.buildUrl(`/api/v2/transactions/${entry.id}/transfer`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetAccountId: Number(targetId) }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error || "Failed to create transfer");
      await onDone(body?.data);
    } catch (err) {
      onError(err?.message ?? "Failed to create transfer");
    } finally {
      setSaving(false);
    }
  };

  // Say what is moving, because the modal covers the row it was opened from; and
  // say when the offset will NOT be the negated amount — across currencies the
  // server books the USD value at the target currency's rate on that date.
  const target = options.find((o) => String(o.id) === String(targetId));
  const amount = Number(entry.Amount ?? entry.amount);
  const currency = entry.Currency ?? entry.currency;
  const date = String(entry.Date ?? entry.transaction_date ?? "").slice(0, 10);
  const crossCurrency = target?.currency && currency && target.currency !== currency;

  return (
    <Modal
      open
      onClose={onClose}
      title="Transfer to account"
      description="Creates an offsetting entry in the chosen account, making this a net-worth-neutral transfer. Both legs are accepted."
      dismissable={!saving}
      footer={
        <>
          <button className="btn btn--outline" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" onClick={confirm} disabled={saving || !targetId}>
            {saving ? "Saving…" : "Create transfer"}
          </button>
        </>
      }
    >
      <p className="transfer-modal__source">
        <strong>{date}</strong> · {Number.isFinite(amount) ? amount.toFixed(2) : "—"} {currency} ·{" "}
        {entry.Description1 ?? entry.description1}
      </p>
      <label className="trans-budget-edit-modal__field trans-budget-edit-modal__field--full-row">
        <span>Destination account</span>
        <AccountPicker
          value={targetId}
          options={options.filter(
            // Balance-sheet leaves only: a net-worth-neutral transfer
            // must offset to a real asset/liability, not a P&L account.
            (o) => o.isLeaf && o.section === "balance_sheet" && o.id !== entry.account_id
          )}
          onChange={setTargetId}
          placeholder="Search accounts…"
          autoFocus
        />
      </label>
      {loadState === "loading" && <p className="transfer-modal__note">Loading accounts…</p>}
      {loadState === "failed" && <p className="transfer-modal__note" role="alert">Could not load accounts — close and try again.</p>}
      {crossCurrency && (
        <p className="transfer-modal__note">
          {target.name} is in {target.currency}: the offset is booked in {target.currency}, converted from
          this row&apos;s USD value at the {date} rate — not as the negated {currency} amount.
        </p>
      )}
    </Modal>
  );
}
