import { useEffect, useMemo, useState } from "react";
import Rest from "../../js/rest.js";
import EmptyState from "../../components/EmptyState.jsx";

const formatDateParam = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * A budget or actual figure's entries, as a compact list in the Workbench side
 * inspector (CR105 S4). The overlay version went with the classic layout (S6c).
 */
const BudgetDetailModal = ({ detail }) => {
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

  if (!detail) {
    return null;
  }

  return (
    <div className="insp-drill">
      <dl className="insp-facts">
        <dt>{type === "actual" ? "Actual" : "Budget"}</dt>
        <dd>{categoryPath}</dd>
        <dt>Period</dt>
        <dd>{periodLabel}</dd>
      </dl>
      {loading && <p className="insp-muted">Loading transactions…</p>}
      {!loading && error && <p className="insp-error">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <EmptyState variant="wallet" message="No transactions found for this selection." />
      )}
      {!loading && !error && entries.length > 0 && (
        <>
          <div className="insp-summary">
            <span>
              {entries.length} entr{entries.length === 1 ? "y" : "ies"}
            </span>
          </div>
          <div className="insp-tools">
            <select
              value={`${sortState.key}:${sortState.direction}`}
              onChange={(e) => {
                const [key, direction] = e.target.value.split(":");
                setSortState({ key, direction });
              }}
              aria-label="Sort entries"
            >
              <option value="Date:desc">Newest first</option>
              <option value="Date:asc">Oldest first</option>
              <option value="Amount:asc">Largest outflow first</option>
              <option value="Amount:desc">Largest inflow first</option>
            </select>
          </div>
          <ul className="insp-list">
            {sortedEntries.map((entry, index) => {
              const amt = formatEntryAmount(entry.Amount, entry.Currency);
              return (
                <li key={entry._id ?? `${index}-${entry.Date ?? "row"}`} className="insp-item">
                  <div className="insp-item__top">
                    <span className="insp-item__desc">
                      {entry.Description1 || entry.Description2 || entry.Note || "—"}
                    </span>
                    <span className={`insp-amt${amt.negative ? " insp-amt--neg" : ""}`}>{amt.text}</span>
                  </div>
                  <div className="insp-item__meta">
                    {entry.Date ? entry.Date.split("T")[0] : "—"} · {entry.Account || "—"} · {entry.Category || "—"}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );

};

export default BudgetDetailModal;
