import { useState } from "react";
import { X } from "lucide-react";
import Rest from "../../js/rest.js";
import CategorySelector from "../../components/CategorySelector/CategorySelector.jsx";
import { parseDisplayDate } from "../../utils/dateHelpers.js";

/**
 * Split one transaction into 2–5 pieces that sum to the original
 * (POST /transactions/:id/split). The server keeps the original row as the
 * first piece and inserts the rest in the same account, date and description.
 *
 * Styles live in TransactionExplorer.css (`txv2-drawer`, `txv2-split-*`); the
 * page must load it. `onDone()` runs after a successful save; the caller owns
 * the toast and the reload.
 */
const MIN_SPLITS = 2;
const MAX_SPLITS = 5; // server limit

const fmt = (value) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
};

const fmtDate = (value) => {
  const d = parseDisplayDate(value);
  return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-";
};

export default function SplitTransactionDrawer({ entry, plTree, onClose, onDone, onError }) {
  const original = Number(entry.Amount);
  const category = entry.Category ?? "";
  const [splits, setSplits] = useState([
    { amount: String(original), categoryName: category },
    { amount: "0", categoryName: category },
  ]);
  const [saving, setSaving] = useState(false);

  const allocated = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  const unallocated = original - allocated;
  const balanced = Math.abs(unallocated) <= 0.01;
  const allNonZero = splits.every((s) => Number.isFinite(Number(s.amount)) && Number(s.amount) !== 0);

  const setCount = (n) => {
    const count = Math.max(MIN_SPLITS, Math.min(MAX_SPLITS, n));
    setSplits((prev) =>
      Array.from({ length: count }, (_, i) => prev[i] ?? { amount: "0", categoryName: category })
    );
  };

  const patch = (index, change) =>
    setSplits((prev) => prev.map((s, i) => (i === index ? { ...s, ...change } : s)));

  const save = async () => {
    if (!balanced) return onError("Split amounts must equal the original amount");
    if (!allNonZero) return onError("All splits must have a non-zero amount");
    setSaving(true);
    try {
      const r = await fetch(Rest.buildUrl(`/api/v2/transactions/${entry.id}/split`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splits: splits.map((s) => ({
            amount: Number(s.amount),
            category_name: s.categoryName || undefined,
          })),
        }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error || "Failed to split transaction");
      await onDone(body?.data);
    } catch (err) {
      onError(err?.message ?? "Failed to split transaction");
    } finally {
      setSaving(false);
    }
  };

  const close = () => { if (!saving) onClose(); };

  return (
    <>
      <div className="txv2-drawer-overlay" onClick={close} />
      <div className="txv2-drawer" role="dialog" aria-modal="true" aria-label="Split transaction">
        <div className="txv2-drawer__header">
          <h3 className="txv2-drawer__title">Split Transaction</h3>
          <button type="button" className="txv2-drawer__close" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="txv2-drawer__body">
          <dl className="txv2-split-summary">
            <dt>Date</dt>
            <dd>{fmtDate(entry.Date)}</dd>
            <dt>Description</dt>
            <dd>{entry.Description1 ?? "-"}</dd>
            <dt>Amount</dt>
            <dd>{fmt(original)} {entry.Currency}</dd>
            <dt>Account</dt>
            <dd>{entry.Account ?? "-"}</dd>
          </dl>

          <div className="txv2-field">
            <label className="txv2-field__label">Number of Splits</label>
            <select
              className="txv2-field__input"
              value={splits.length}
              onChange={(e) => setCount(Number(e.target.value))}
              disabled={saving}
              style={{ width: "5rem" }}
            >
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>

          {splits.map((split, index) => (
            <div key={index} className="txv2-split-entry">
              <div className="txv2-field">
                <label className="txv2-field__label">Split {index + 1}</label>
                <input
                  className="txv2-field__input"
                  type="text"
                  inputMode="decimal"
                  value={split.amount}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (/^-?\d*\.?\d*$/.test(raw)) patch(index, { amount: raw });
                  }}
                  disabled={saving}
                />
              </div>
              <div className="txv2-field">
                <label className="txv2-field__label">Category</label>
                {plTree?.length > 0 ? (
                  <CategorySelector
                    plTree={plTree}
                    selectedCategories={split.categoryName ? [split.categoryName] : []}
                    onCategoriesChange={(selected) =>
                      patch(index, { categoryName: selected.length > 0 ? selected[selected.length - 1] : "" })
                    }
                    categoryGroupOptions={[]}
                  />
                ) : (
                  <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Loading...</span>
                )}
              </div>
            </div>
          ))}

          <p className={`txv2-unallocated${balanced ? "" : " txv2-unallocated--warning"}`}>
            Unallocated: {fmt(unallocated)} {entry.Currency}
          </p>
        </div>

        <div className="txv2-drawer__footer">
          <button type="button" className="btn btn--sm btn--outline" onClick={close} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={save}
            disabled={saving || !balanced || !allNonZero}
          >
            {saving ? "Saving..." : "Save Split"}
          </button>
        </div>
      </div>
    </>
  );
}
