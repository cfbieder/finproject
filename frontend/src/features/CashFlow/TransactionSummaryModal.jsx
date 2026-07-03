import { useMemo, useState } from "react";
import EmptyState from "../../components/EmptyState.jsx";
import "./TransactionSummaryModal.css";

const GROUP_MODES = [
  { key: "month", label: "By month" },
  { key: "account", label: "By account" },
];

const getAmount = (txn) => {
  if (typeof txn?.BaseAmount === "number") {
    return txn.BaseAmount;
  }
  if (typeof txn?.Amount === "number") {
    return txn.Amount;
  }
  return 0;
};

const getMonthKey = (value) => {
  if (!value) {
    return "(No date)";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "(No date)";
  }
  return date.toISOString().slice(0, 7); // YYYY-MM
};

const getAccountKey = (txn) => txn?.Account || "(No account)";

export default function TransactionSummaryModal({
  onClose,
  transactions,
  title,
  formatCurrency,
}) {
  const [mode, setMode] = useState("month");
  const [sortDirection, setSortDirection] = useState("desc");

  const rows = Array.isArray(transactions) ? transactions : [];

  const summary = useMemo(() => {
    const buckets = new Map();
    let grandTotal = 0;
    for (const txn of rows) {
      const key =
        mode === "month" ? getMonthKey(txn?.Date) : getAccountKey(txn);
      const amount = getAmount(txn);
      grandTotal += amount;
      const existing = buckets.get(key);
      if (existing) {
        existing.total += amount;
        existing.count += 1;
      } else {
        buckets.set(key, { key, total: amount, count: 1 });
      }
    }

    const items = Array.from(buckets.values());
    const direction = sortDirection === "asc" ? 1 : -1;
    items.sort((a, b) => {
      // Month sorts chronologically by key; account sorts alphabetically.
      const compare = a.key.localeCompare(b.key, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      return compare * direction;
    });

    return { items, grandTotal, count: rows.length };
  }, [rows, mode, sortDirection]);

  const groupLabel = mode === "month" ? "Month" : "Account";

  return (
    <div
      className="transaction-summary-modal__overlay"
      onClick={onClose}
    >
      <div
        className="transaction-summary-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="transaction-summary-modal__header">
          <div>
            <h3 className="transaction-summary-modal__title">Summary</h3>
            {title ? (
              <p className="transaction-summary-modal__subtitle">{title}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="transaction-summary-modal__close-button"
          >
            Close
          </button>
        </div>

        <div className="transaction-summary-modal__toolbar">
          <div
            className="transaction-summary-modal__toggle"
            role="tablist"
            aria-label="Summarize by"
          >
            {GROUP_MODES.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={mode === option.key}
                onClick={() => setMode(option.key)}
                className={`transaction-summary-modal__toggle-button ${
                  mode === option.key
                    ? "transaction-summary-modal__toggle-button--active"
                    : ""
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="transaction-summary-modal__table-wrapper">
          {rows.length === 0 ? (
            <EmptyState
              variant="wallet"
              message="No transactions to summarize."
            />
          ) : (
            <table className="balance-report-table transaction-summary-modal__table">
              <thead>
                <tr>
                  <th className="transaction-summary-modal__header-cell">
                    <button
                      type="button"
                      onClick={() =>
                        setSortDirection((prev) =>
                          prev === "asc" ? "desc" : "asc"
                        )
                      }
                      className="transaction-summary-modal__header-button"
                    >
                      <span>{groupLabel}</span>
                      <span aria-hidden="true">
                        {sortDirection === "asc" ? "↑" : "↓"}
                      </span>
                    </button>
                  </th>
                  <th className="transaction-summary-modal__header-cell transaction-summary-modal__header-cell--right">
                    Count
                  </th>
                  <th className="transaction-summary-modal__header-cell transaction-summary-modal__header-cell--right">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.items.map((item) => (
                  <tr key={item.key}>
                    <td>{item.key}</td>
                    <td className="transaction-summary-modal__value">
                      {item.count}
                    </td>
                    <td
                      className={`balance-report-table__value ${
                        item.total < 0
                          ? "balance-report-table__value--negative"
                          : ""
                      }`}
                    >
                      {formatCurrency(item.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="transaction-summary-modal__total-row">
                  <td>Total</td>
                  <td className="transaction-summary-modal__value">
                    {summary.count}
                  </td>
                  <td
                    className={`balance-report-table__value ${
                      summary.grandTotal < 0
                        ? "balance-report-table__value--negative"
                        : ""
                    }`}
                  >
                    {formatCurrency(summary.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
