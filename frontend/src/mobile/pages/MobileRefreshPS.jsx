import { useCallback, useEffect, useState } from "react";
import { RefreshCw, AlertTriangle, Loader2, CheckCheck } from "lucide-react";
import Rest from "../../js/rest.js";
import { useCoa } from "../../hooks/useCoa.js";
import MobileCategoryPicker, {
  pushRecentCategory,
} from "../MobileCategoryPicker.jsx";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatAmount = (amount, currency) => {
  const n = Number(amount) || 0;
  if (currency && currency !== "USD") {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${currency} ${n.toFixed(2)}`;
    }
  }
  return currencyFormatter.format(n);
};

const formatDate = (raw) => {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return raw;
  }
};

export default function MobileRefreshPS() {
  const { plTree } = useCoa();
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [acceptingId, setAcceptingId] = useState(null);
  const [isAcceptingAll, setIsAcceptingAll] = useState(false);
  const [toast, setToast] = useState("");
  // Picker state — when set, the picker is open and we know which row to update.
  const [pickerRow, setPickerRow] = useState(null);
  const [savingCategoryId, setSavingCategoryId] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }, []);

  const loadReview = useCallback(async () => {
    setError("");
    setIsLoading(true);
    try {
      const response = await Rest.fetchJson(
        "/api/v2/ingest-ps/review-new-transactions",
        { method: "POST" }
      );
      const data = response?.data ?? [];
      const parsed = data.map((txn) => {
        const id = txn.id != null ? Number(txn.id) : null;
        return {
          id: Number.isFinite(id) ? id : null,
          ps_id: txn.ps_id,
          date: txn.transaction_date,
          description: txn.description1 || txn.description2 || "(no description)",
          amount: parseFloat(txn.amount),
          currency: txn.currency,
          baseAmount: parseFloat(txn.base_amount),
          account: txn.account_name,
          category: txn.category_name,
        };
      });
      setTransactions(parsed);
    } catch (err) {
      setError(err?.message ?? "Failed to load transactions");
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReview();
  }, [loadReview]);

  const handleRefreshFromPS = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await Rest.fetchJson("/api/v2/ingest-ps/refresh-ps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysHistory: 7 }),
      });
      const inserted = Number(result?.importReport) || 0;
      const updated = Number(result?.updateReport) || 0;
      showToast(`Pulled ${inserted} new, ${updated} updated`);
      await loadReview();
    } catch (err) {
      showToast(err?.message ?? "Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  }, [loadReview, showToast]);

  const acceptOne = useCallback(
    async (id) => {
      if (!id) return;
      setAcceptingId(id);
      try {
        const response = await fetch(
          Rest.buildUrl(`/api/v2/transactions/${id}`),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accepted: true }),
          }
        );
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Failed to accept");
        }
        // Optimistic remove
        setTransactions((prev) => prev.filter((t) => t.id !== id));
        showToast("Accepted");
      } catch (err) {
        showToast(err?.message ?? "Failed to accept");
      } finally {
        setAcceptingId(null);
      }
    },
    [showToast]
  );

  const handleCategoryPick = useCallback(
    async (newCategory) => {
      const row = pickerRow;
      if (!row || !newCategory) {
        setPickerRow(null);
        return;
      }
      if (row.id == null) {
        showToast("Cannot edit: not yet synced");
        setPickerRow(null);
        return;
      }
      // Close the picker immediately so the user sees the row update
      setPickerRow(null);
      setSavingCategoryId(row.id);
      try {
        const response = await fetch(
          Rest.buildUrl(`/api/v2/transactions/${row.id}`),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ Category: newCategory }),
          }
        );
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Failed to update category");
        }
        // Optimistic local update + remember the choice
        setTransactions((prev) =>
          prev.map((t) =>
            t.id === row.id ? { ...t, category: newCategory } : t
          )
        );
        pushRecentCategory(newCategory);
        showToast(`Category set to ${newCategory}`);
      } catch (err) {
        showToast(err?.message ?? "Failed to update category");
      } finally {
        setSavingCategoryId(null);
      }
    },
    [pickerRow, showToast]
  );

  const acceptAll = useCallback(async () => {
    const ids = transactions.map((t) => t.id).filter((id) => typeof id === "number");
    if (ids.length === 0) {
      showToast("Nothing to accept");
      return;
    }
    setIsAcceptingAll(true);
    try {
      // Sequential (small batches) to keep things simple and reliable on mobile
      let failures = 0;
      for (let i = 0; i < ids.length; i += 5) {
        const batch = ids.slice(i, i + 5);
        const results = await Promise.all(
          batch.map((id) =>
            fetch(Rest.buildUrl(`/api/v2/transactions/${id}`), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accepted: true }),
            })
          )
        );
        failures += results.filter((r) => !r.ok).length;
      }
      if (failures > 0) {
        showToast(`${ids.length - failures} accepted, ${failures} failed`);
      } else {
        showToast(`${ids.length} accepted`);
      }
      await loadReview();
    } catch (err) {
      showToast(err?.message ?? "Accept all failed");
    } finally {
      setIsAcceptingAll(false);
    }
  }, [transactions, loadReview, showToast]);

  return (
    <div>
      <div className="m-refresh-bar">
        <button
          type="button"
          className="m-btn m-btn--primary"
          onClick={handleRefreshFromPS}
          disabled={isRefreshing || isAcceptingAll}
        >
          {isRefreshing ? (
            <Loader2 size={16} className="m-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {isRefreshing ? "Refreshing…" : "Refresh from PS"}
        </button>
        <button
          type="button"
          className="m-btn"
          onClick={acceptAll}
          disabled={
            transactions.length === 0 || isAcceptingAll || isRefreshing
          }
        >
          {isAcceptingAll ? (
            <Loader2 size={16} className="m-spin" />
          ) : (
            <CheckCheck size={16} />
          )}
          Accept all
        </button>
      </div>

      {error && (
        <div className="m-state m-state--error">
          <AlertTriangle size={20} />
          <span>{error}</span>
        </div>
      )}

      <h2 className="m-tx-section-h">
        New transactions
        <span className="m-tx-section-h__count">{transactions.length}</span>
      </h2>

      {isLoading ? (
        <div className="m-state">
          <Loader2 size={28} className="m-spin" />
          <span>Loading…</span>
        </div>
      ) : transactions.length === 0 ? (
        <div className="m-state">
          <span>No new transactions</span>
          <span style={{ fontSize: 13 }}>
            Tap "Refresh from PS" to pull the latest
          </span>
        </div>
      ) : (
        <div className="m-tx-list">
          {transactions.map((tx) => {
            const acceptable = typeof tx.id === "number";
            const isAccepting = acceptingId === tx.id;
            const isSavingCat = savingCategoryId === tx.id;
            const hasCategory = !!tx.category;
            return (
              <div
                className={
                  "m-tx" + (isAccepting ? " m-tx--accepted" : "")
                }
                key={tx.id ?? `ps-${tx.ps_id}`}
              >
                <span className="m-tx__desc">{tx.description}</span>
                <span
                  className={
                    "m-tx__amt " +
                    (tx.amount < 0 ? "m-tx__amt--neg" : "m-tx__amt--pos")
                  }
                >
                  {formatAmount(tx.amount, tx.currency)}
                </span>
                <span className="m-tx__meta">
                  {formatDate(tx.date)}
                  {tx.account ? ` · ${tx.account}` : ""}
                </span>
                <div className="m-tx__cat-row">
                  <button
                    type="button"
                    className={
                      "m-tx__cat" +
                      (hasCategory ? "" : " m-tx__cat--missing")
                    }
                    disabled={!acceptable || isSavingCat}
                    onClick={() => acceptable && setPickerRow(tx)}
                  >
                    {isSavingCat
                      ? "Saving…"
                      : hasCategory
                      ? tx.category
                      : "Uncategorized — tap to set"}
                  </button>
                </div>
                <button
                  type="button"
                  className="m-tx__action"
                  disabled={!acceptable || isAccepting || isAcceptingAll}
                  onClick={() => acceptOne(tx.id)}
                >
                  {isAccepting ? "…" : "Accept"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className="m-toast">{toast}</div>}

      <MobileCategoryPicker
        open={pickerRow !== null}
        plTree={plTree}
        currentCategory={pickerRow?.category || ""}
        onSelect={handleCategoryPick}
        onClose={() => setPickerRow(null)}
        title="Choose category"
      />
    </div>
  );
}
