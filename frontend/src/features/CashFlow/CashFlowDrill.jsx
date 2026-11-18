/**
 * CR105 S4 — a cash-flow figure's transactions, in the Workbench inspector.
 * The classic layout keeps TransactionModal; both read the same endpoint
 * (GET /reports/cash-flow/transactions) and format rows the same way.
 * Fetches itself, so the panel shows its own loading / error state.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import Rest from "../../js/rest.js";
import EmptyState from "../../components/EmptyState.jsx";
import TransactionSummaryModal from "./TransactionSummaryModal.jsx";
import { formatDateOnly } from "../../utils/dateHelpers.js";
import { formatRowAmount, getTransactionSortValue, rowAmount, rowDescription } from "./transactionDrillFormat.js";

// The endpoint defaults to 100 rows — the classic modal's silent cap. Ask for
// more, and say so when even this is reached.
const LIMIT = 2000;

const SORTS = {
  "date-desc": ["date", -1, "Newest first"],
  "date-asc": ["date", 1, "Oldest first"],
  "amount-asc": ["amount", 1, "Largest outflow first"],
  "amount-desc": ["amount", -1, "Largest inflow first"],
};

export default function CashFlowDrill({ query, title, formatCurrency, currencyMode = "usd" }) {
  const preferNative = currencyMode === "original";
  const [sort, setSort] = useState("date-desc");
  const [summary, setSummary] = useState(false);

  const q = useQuery({
    queryKey: ["cashFlowDrill", query],
    queryFn: () => Rest.fetchCashFlowTransactions({ ...query, limit: LIMIT }),
  });
  const transactions = useMemo(() => {
    const d = q.data;
    return Array.isArray(d?.transactions) ? d.transactions : Array.isArray(d) ? d : [];
  }, [q.data]);

  const sorted = useMemo(() => {
    const [column, dir] = SORTS[sort];
    return [...transactions].sort((a, b) => {
      const va = getTransactionSortValue(a, column, preferNative);
      const vb = getTransactionSortValue(b, column, preferNative);
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
    });
  }, [transactions, sort, preferNative]);

  const fmt = (txn) =>
    preferNative ? formatRowAmount(txn?.Currency, rowAmount(txn, true)) : formatCurrency(rowAmount(txn, false));

  if (q.isPending) return <p className="insp-muted">Loading transactions…</p>;
  if (q.isError) return <p className="insp-error">{q.error?.message || "Failed to load transactions"}</p>;
  if (transactions.length === 0) return <EmptyState variant="wallet" message="No transactions found for this period." />;

  return (
    <div className="insp-drill">
      <div className="insp-summary">
        {/* No total here: the report can exclude transfers / unrealized G/L that
            these rows include, so a sum could disagree with the figure clicked. */}
        <span>
          {transactions.length >= LIMIT
            ? `The first ${LIMIT} transactions`
            : `${transactions.length} transaction${transactions.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="insp-tools">
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort transactions">
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v[2]}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setSummary(true)}>
          Summarize
        </button>
      </div>
      <ul className="insp-list">
        {sorted.map((txn, i) => {
          const amount = rowAmount(txn, preferNative);
          return (
            <li key={txn?._id || txn?.ID || i} className="insp-item">
              <div className="insp-item__top">
                <span className="insp-item__desc">{rowDescription(txn) || "(No description)"}</span>
                <span className={`insp-amt${amount < 0 ? " insp-amt--neg" : ""}`}>{fmt(txn)}</span>
              </div>
              <div className="insp-item__meta">
                {formatDateOnly(txn?.Date)} · {txn?.Account || "—"} · {txn?.Category || "—"}
              </div>
            </li>
          );
        })}
      </ul>
      {/* To the body: inside the sticky panel its overlay would sit under the rail. */}
      {summary &&
        createPortal(
          <TransactionSummaryModal
            transactions={transactions}
            title={title}
            formatCurrency={formatCurrency}
            currencyMode={currencyMode}
            onClose={() => setSummary(false)}
          />,
          document.body
        )}
    </div>
  );
}
