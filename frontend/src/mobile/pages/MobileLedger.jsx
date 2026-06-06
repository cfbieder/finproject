import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Inbox } from "lucide-react";
import Rest from "../../js/rest.js";

const fmtAmount = (n, ccy) => {
  const v = Number(n) || 0;
  const s = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(v));
  const body = ccy ? `${s} ${ccy}` : s;
  return v < 0 ? `(${body})` : body;
};

const fmtDate = (iso) => {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
};

export default function MobileLedger() {
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [txns, setTxns] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Load balance-sheet leaf accounts (assets + liabilities) for the picker.
  useEffect(() => {
    let cancelled = false;
    Rest.fetchAccountsV2({ leafOnly: true })
      .then((data) => {
        if (cancelled) return;
        const ledgerable = (data || [])
          .filter((a) => a.account_type === "asset" || a.account_type === "liability")
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        setAccounts(ledgerable);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Failed to load accounts");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load transactions when an account is chosen.
  useEffect(() => {
    if (!selectedId) {
      setTxns(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError("");
    Rest.fetchTransactionsV2({ accountId: selectedId, limit: 500 })
      .then((data) => {
        if (!cancelled) setTxns(data || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? "Failed to load ledger");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const account = useMemo(
    () => accounts.find((a) => String(a.id) === String(selectedId)) || null,
    [accounts, selectedId]
  );
  const ccy = account?.currency || "";

  // Chronological cumulative running balance (from 0), then show newest-first.
  const rows = useMemo(() => {
    if (!txns) return [];
    const chrono = [...txns].sort((a, b) => {
      const d = (a.transaction_date || "").localeCompare(b.transaction_date || "");
      return d !== 0 ? d : Number(a.id) - Number(b.id);
    });
    let running = 0;
    const balById = new Map();
    for (const t of chrono) {
      running += Number(t.amount) || 0;
      balById.set(t.id, running);
    }
    return chrono
      .slice()
      .reverse()
      .map((t) => ({ t, running: balById.get(t.id) ?? 0 }));
  }, [txns]);

  return (
    <div>
      <div className="m-page-meta">
        <select
          className="m-select"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="Select account"
        >
          <option value="">Select an account…</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.currency ? ` (${a.currency})` : ""}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="m-state m-state--error">
          <AlertTriangle size={28} />
          <span>{error}</span>
        </div>
      )}

      {!selectedId && !error && (
        <div className="m-state">
          <Inbox size={28} />
          <span>Select an account to view its ledger</span>
        </div>
      )}

      {selectedId && isLoading && !txns && (
        <div className="m-state">
          <Loader2 size={28} className="m-spin" />
          <span>Loading ledger…</span>
        </div>
      )}

      {selectedId && txns && rows.length === 0 && !isLoading && (
        <div className="m-state">
          <Inbox size={28} />
          <span>No transactions for this account</span>
        </div>
      )}

      {rows.length > 0 && (
        <div className="m-tx-list">
          {rows.map(({ t, running }) => {
            const amt = Number(t.amount) || 0;
            return (
              <div className="m-tx" key={t.id}>
                <span className="m-tx__desc">{t.description1 || "—"}</span>
                <span
                  className={
                    "m-tx__amt " + (amt < 0 ? "m-tx__amt--neg" : "m-tx__amt--pos")
                  }
                >
                  {fmtAmount(amt, ccy)}
                </span>
                <span className="m-tx__meta">
                  {fmtDate(t.transaction_date)} · Bal {fmtAmount(running, ccy)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
