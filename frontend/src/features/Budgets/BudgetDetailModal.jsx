import { useEffect, useMemo, useState } from "react";
import Rest from "../../js/rest.js";

const formatDateParam = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString().split("T")[0];
};

const BudgetDetailModal = ({ detail, onClose }) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sortState, setSortState] = useState({
    key: "Date",
    direction: "desc",
  });

  const {
    name,
    path,
    pathLabel,
    categories,
    period,
    type = "budget",
  } = detail || {};

  const categoryPath = pathLabel
    ? pathLabel
    : Array.isArray(path) && path.length
    ? path.join(" › ")
    : name ?? "Category";
  const fromDate = formatDateParam(period?.start);
  const toDate = formatDateParam(period?.end);
  const periodLabel =
    fromDate && toDate ? `${fromDate} → ${toDate}` : "Date range unavailable";

  useEffect(() => {
    let isActive = true;
    if (!detail) {
      setEntries([]);
      setError("");
      setLoading(false);
      return () => {
        isActive = false;
      };
    }
    const selectedCategories =
      Array.isArray(categories) && categories.length
        ? categories
        : name
        ? [name]
        : [];

    const hasValidDates = Boolean(fromDate && toDate);

    if (!hasValidDates || selectedCategories.length === 0) {
      setEntries([]);
      setError(
        hasValidDates
          ? "No categories to load transactions for."
          : "Date range unavailable for this selection."
      );
      return undefined;
    }

    const fetchEntries = async () => {
      setLoading(true);
      setError("");
      setEntries([]);
      try {
        let payload;
        if (type === "actual") {
          payload = await Rest.fetchCashFlowTransactions({
            categories: selectedCategories,
            fromDate,
            toDate,
            limit: 500,
          });
        } else {
          const params = new URLSearchParams();
          params.set("fromDate", fromDate);
          params.set("toDate", toDate);
          for (const category of selectedCategories) {
            params.append("category", category);
          }
          params.set("limit", "500");
          // Using v2 API (PostgreSQL)
          payload = await Rest.fetchJson(`/api/v2/budget?${params.toString()}`);
        }

        if (!isActive) {
          return;
        }

        const fetchedEntries = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.entries)
          ? payload.entries
          : Array.isArray(payload?.transactions)
          ? payload.transactions
          : [];
        setEntries(fetchedEntries);
      } catch (err) {
        if (!isActive) {
          return;
        }
        setError(err?.message || "Unable to load transactions.");
        setEntries([]);
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    fetchEntries();

    return () => {
      isActive = false;
    };
  }, [categories, detail, fromDate, name, toDate, type]);

  const formatEntryAmount = (amount, currency) => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed)) {
      return { text: "—", negative: false };
    }
    const formatted = Math.abs(parsed).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const suffix = currency ? ` ${currency}` : "";
    return parsed < 0
      ? { text: `(${formatted}${suffix})`, negative: true }
      : { text: `${formatted}${suffix}`, negative: false };
  };

  const sortedEntries = useMemo(() => {
    const copy = [...entries];
    copy.sort((a, b) => {
      const { key, direction } = sortState;
      let valueA;
      let valueB;
      switch (key) {
        case "Date": {
          valueA = a?.Date
            ? new Date(a.Date).getTime()
            : Number.NEGATIVE_INFINITY;
          valueB = b?.Date
            ? new Date(b.Date).getTime()
            : Number.NEGATIVE_INFINITY;
          break;
        }
        case "Description":
          valueA = (
            a?.Description1 ??
            a?.Description2 ??
            a?.Note ??
            ""
          ).toLowerCase();
          valueB = (
            b?.Description1 ??
            b?.Description2 ??
            b?.Note ??
            ""
          ).toLowerCase();
          break;
        case "Account":
          valueA = (a?.Account ?? "").toLowerCase();
          valueB = (b?.Account ?? "").toLowerCase();
          break;
        case "Category":
          valueA = (a?.Category ?? "").toLowerCase();
          valueB = (b?.Category ?? "").toLowerCase();
          break;
        case "Amount":
          valueA = Number(a?.Amount) || 0;
          valueB = Number(b?.Amount) || 0;
          break;
        default:
          valueA = "";
          valueB = "";
      }
      const comparison =
        typeof valueA === "number" && typeof valueB === "number"
          ? valueA - valueB
          : String(valueA).localeCompare(String(valueB));
      return direction === "asc" ? comparison : -comparison;
    });
    return copy;
  }, [entries, sortState]);

  const handleSort = (key) => {
    setSortState((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget && typeof onClose === "function") {
      onClose();
    }
  };

  const handleCloseClick = () => {
    if (typeof onClose === "function") {
      onClose();
    }
  };

  if (!detail) {
    return null;
  }

  return (
    <div className="fc-scenarios-modal-overlay" onClick={handleOverlayClick}>
      <div
        className="fc-scenarios-modal budget-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Balance details for ${name || categoryPath}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="fc-scenarios-modal__header">
          <h3 className="fc-scenarios-modal__title">
            {type === "actual" ? "Actual Details" : "Budget Details"}
          </h3>
          <p className="fc-scenarios-modal__description">
            Underlying transactions that make up this balance.
          </p>
        </div>
        <div className="fc-scenarios-modal__body">
          <div className="fc-scenarios-modal__field">
            <span>Category</span>
            <strong>{categoryPath}</strong>
          </div>
          <div className="fc-scenarios-modal__field">
            <span>Period</span>
            <strong>{periodLabel}</strong>
          </div>
          {loading && (
            <p className="fc-scenarios-modal__description">
              Loading transactions…
            </p>
          )}
          {!loading && error && (
            <p className="fc-scenarios-modal__description">{error}</p>
          )}
          {!loading && !error && entries.length === 0 && (
            <p className="fc-scenarios-modal__description">
              No transactions found for this selection.
            </p>
          )}
          {!loading && !error && entries.length > 0 && (
            <div className="balance-report__table-wrapper">
              <table className="balance-report-table">
                <thead>
                  <tr>
                    <th scope="col" onClick={() => handleSort("Date")}>
                      Date
                    </th>
                    <th scope="col" onClick={() => handleSort("Description")}>
                      Description
                    </th>
                    <th scope="col" onClick={() => handleSort("Account")}>
                      Account
                    </th>
                    <th scope="col" onClick={() => handleSort("Category")}>
                      Category
                    </th>
                    <th scope="col" onClick={() => handleSort("Amount")}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEntries.map((entry, index) => (
                    <tr key={entry._id ?? `${index}-${entry.Date ?? "row"}`}>
                      <td>{entry.Date ? entry.Date.split("T")[0] : "—"}</td>
                      <td>
                        {entry.Description1 ||
                          entry.Description2 ||
                          entry.Note ||
                          "—"}
                      </td>
                      <td>{entry.Account || "—"}</td>
                      <td>{entry.Category || "—"}</td>
                      {(() => {
                        const formattedAmount = formatEntryAmount(
                          entry.Amount,
                          entry.Currency
                        );
                        const amountClass = formattedAmount.negative
                          ? "balance-report-table__value balance-report-table__value--negative"
                          : "balance-report-table__value";
                        return (
                          <td className={amountClass}>
                            {formattedAmount.text}
                          </td>
                        );
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="fc-scenarios-modal__actions">
          <button
            type="button"
            className="generate-report-button"
            onClick={handleCloseClick}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default BudgetDetailModal;
