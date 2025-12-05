import { useCallback, useEffect, useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import TransactionBudgetFilter from "../features/TransactionBudget/TransactionBudgetFilter.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

const numberFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatDateValue = (value) => {
  if (!value) {
    return "-";
  }
  const next = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(next.getTime())) {
    return "-";
  }
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${monthNames[next.getUTCMonth()]} ${next.getUTCFullYear()}`;
};

const formatTextValue = (value) => {
  if (value === undefined || value === null) {
    return "-";
  }
  const text = String(value).trim();
  return text.length ? text : "-";
};

const formatNumberValue = (value) => {
  if (value === undefined || value === null) {
    return "-";
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? numberFormatter.format(parsed) : "-";
};

const SELECTION_COLUMN = { key: "selected", label: "Selected" };

const TRANSACTION_COLUMNS = [
  { key: "Date", label: "Date", render: formatDateValue },
  { key: "Description1", label: "Description", render: formatTextValue },
  {
    key: "Amount",
    label: "LC Amount",
    render: formatNumberValue,
    alignRight: true,
  },
  { key: "Currency", label: "Currency", render: formatTextValue },
  {
    key: "BaseAmount",
    label: "USD Amount",
    render: formatNumberValue,
    alignRight: true,
  },
  { key: "Account", label: "Account", render: formatTextValue },
  { key: "Category", label: "Category", render: formatTextValue },
];
const DEFAULT_SORT = { key: "Date", direction: "desc" };

const getSortValue = (entry, key, meta = {}) => {
  if (!entry) {
    return null;
  }

  if (key === SELECTION_COLUMN.key) {
    return meta.isSelected ? 1 : 0;
  }

  if (key === "Date") {
    const date = parseEntryDate(entry);
    return date ? date.getTime() : null;
  }

  const value = entry[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (value === undefined || value === null) {
    return null;
  }
  return String(value).toLowerCase();
};

const parseEntryDate = (entry) => {
  const rawDate = entry?.Date ?? entry?.date;
  if (!rawDate) {
    return null;
  }
  const parsed = rawDate instanceof Date ? rawDate : new Date(rawDate);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const filtersAreEqual = (a, b) => {
  if (!a || !b) {
    return false;
  }
  return (
    a.yearEnabled === b.yearEnabled &&
    a.monthEnabled === b.monthEnabled &&
    a.accountEnabled === b.accountEnabled &&
    a.categoryEnabled === b.categoryEnabled &&
    a.year === b.year &&
    a.month === b.month &&
    a.account === b.account &&
    a.category === b.category &&
    a.valueFromEnabled === b.valueFromEnabled &&
    a.valueToEnabled === b.valueToEnabled &&
    a.valueFrom === b.valueFrom &&
    a.valueTo === b.valueTo
  );
};

const DEFAULT_FILTERS = {
  yearEnabled: false,
  monthEnabled: false,
  accountEnabled: false,
  categoryEnabled: false,
  year: "",
  month: "",
  account: "",
  category: "",
  valueFromEnabled: false,
  valueToEnabled: false,
  valueFrom: null,
  valueTo: null,
};

export default function TransBudget() {
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS }));
  const [sortConfig, setSortConfig] = useState(DEFAULT_SORT);
  const [selectedRows, setSelectedRows] = useState(() => new Map());
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const loadTransactions = useCallback(
    async (signal) => {
      setIsLoading(true);
      try {
        const payload = await Rest.fetchJson("/api/budget", { signal });
        const data = Array.isArray(payload) ? payload : [];
        setTransactions(data);
        setError("");
        setSelectedRows(new Map());
      } catch (err) {
        if (err?.name === "AbortError") {
          return;
        }
        console.error("[TransBudget] Failed to load transactions:", err);
        setError(err?.message ?? "Failed to load budget transactions");
        setTransactions([]);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    loadTransactions(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadTransactions]);

  const handleFilterChange = useCallback((nextFilters) => {
    if (!nextFilters) {
      return;
    }
    setFilters((previous) => {
      if (filtersAreEqual(previous, nextFilters)) {
        return previous;
      }
      return { ...nextFilters };
    });
  }, []);

  const normalizedTransactions = useMemo(() => {
    if (!transactions.length) {
      return [];
    }

    const {
      yearEnabled,
      monthEnabled,
      accountEnabled,
      categoryEnabled,
      valueFromEnabled,
      valueToEnabled,
      year,
      month,
      account,
      category,
      valueFrom,
      valueTo,
    } = filters;

    const yearValue =
      yearEnabled && year ? Number.parseInt(year, 10) : undefined;
    const hasYearFilter = Number.isFinite(yearValue);
    const monthValue =
      monthEnabled && month !== null && month !== undefined
        ? Number(month)
        : null;
    const hasMonthFilter = monthEnabled && Number.isFinite(monthValue);
    const normalizedAccount = accountEnabled
      ? (account ?? "").trim().toLowerCase()
      : "";
    const normalizedCategory = categoryEnabled
      ? (category ?? "").trim().toLowerCase()
      : "";
    const hasAccountFilter = !!(
      accountEnabled && normalizedAccount.length > 0
    );
    const hasCategoryFilter = !!(
      categoryEnabled && normalizedCategory.length > 0
    );
    const hasBaseFromFilter =
      valueFromEnabled && typeof valueFrom === "number" && Number.isFinite(valueFrom);
    const hasBaseToFilter =
      valueToEnabled && typeof valueTo === "number" && Number.isFinite(valueTo);
    const normalizedFromValue = hasBaseFromFilter ? valueFrom : 0;
    const normalizedToValue = hasBaseToFilter ? valueTo : 0;

    return transactions.filter((entry) => {
      const entryDate = parseEntryDate(entry);
      if (hasYearFilter) {
        const entryYear = entryDate ? entryDate.getUTCFullYear() : null;
        if (!entryDate || entryYear !== yearValue) {
          return false;
        }
      }
      if (hasMonthFilter) {
        const entryMonth = entryDate ? entryDate.getUTCMonth() : null;
        if (!entryDate || entryMonth !== monthValue) {
          return false;
        }
      }
      if (hasAccountFilter) {
        const entryAccount = (entry?.Account ?? "")
          .toString()
          .trim()
          .toLowerCase();
        if (entryAccount !== normalizedAccount) {
          return false;
        }
      }
      if (hasCategoryFilter) {
        const entryCategory = (entry?.Category ?? "")
          .toString()
          .trim()
          .toLowerCase();
        if (entryCategory !== normalizedCategory) {
          return false;
        }
      }
      if (hasBaseFromFilter || hasBaseToFilter) {
        const entryBase = entry?.BaseAmount ?? entry?.baseAmount;
        const baseValue = typeof entryBase === "number" ? entryBase : Number(entryBase);
        const hasValidBase = Number.isFinite(baseValue);

        if (hasBaseFromFilter) {
          if (!hasValidBase || baseValue < normalizedFromValue) {
            return false;
          }
        }
        if (hasBaseToFilter) {
          if (!hasValidBase || baseValue > normalizedToValue) {
            return false;
          }
        }
      }
      return true;
    });
  }, [transactions, filters]);

  const sortedTransactions = useMemo(() => {
    const entries = normalizedTransactions.map((entry, index) => {
      const rowId = entry._id ?? `${entry.Date ?? ""}-${index}`;
      return {
        entry,
        rowId,
        isSelected: selectedRows.has(rowId),
      };
    });

    if (!sortConfig?.key) {
      return entries;
    }

    const direction = sortConfig.direction === "desc" ? -1 : 1;
    entries.sort((left, right) => {
      const leftValue = getSortValue(left.entry, sortConfig.key, left);
      const rightValue = getSortValue(right.entry, sortConfig.key, right);
      if (leftValue === rightValue) {
        return 0;
      }
      if (leftValue === null || leftValue === undefined) {
        return 1 * direction;
      }
      if (rightValue === null || rightValue === undefined) {
        return -1 * direction;
      }
      if (leftValue < rightValue) {
        return -1 * direction;
      }
      if (leftValue > rightValue) {
        return 1 * direction;
      }
      return 0;
    });

    return entries;
  }, [normalizedTransactions, selectedRows, sortConfig]);

  const isAllSelected =
    sortedTransactions.length > 0 &&
    selectedRows.size === sortedTransactions.length;

  const handleSelectAllToggle = useCallback(() => {
    if (isAllSelected) {
      setSelectedRows(new Map());
      return;
    }
    const nextSelection = new Map();
    sortedTransactions.forEach(({ rowId, entry }) => {
      nextSelection.set(rowId, entry);
    });
    setSelectedRows(nextSelection);
  }, [sortedTransactions, isAllSelected]);

  const handleDeleteRequest = () => {
    if (!selectedRows.size) {
      return;
    }
    setDeleteError("");
    setShowDeleteConfirmation(true);
  };

  const handleDeleteCancel = () => {
    if (isDeleting) {
      return;
    }
    setDeleteError("");
    setShowDeleteConfirmation(false);
  };

  const handleConfirmDelete = async () => {
    const ids = Array.from(selectedRows.values())
      .map((entry) => entry?._id)
      .filter(Boolean);

    if (!ids.length) {
      setDeleteError("No deleteable transactions selected.");
      return;
    }

    setIsDeleting(true);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(Rest.buildUrl(`/api/budget/${id}`), {
            method: "DELETE",
          }).then(async (response) => {
            if (!response.ok) {
              const payload = await response.json().catch(() => null);
              throw new Error(payload?.error || "Failed to delete entry");
            }
            return response.json().catch(() => null);
          })
        )
      );
      setShowDeleteConfirmation(false);
      setSelectedRows(new Map());
      await loadTransactions();
    } catch (err) {
      console.error("[TransBudget] Failed to delete entries:", err);
      setDeleteError(err?.message ?? "Failed to delete selected entries");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSort = (key) => {
    setSortConfig((previous) => {
      if (previous.key === key) {
        const direction = previous.direction === "desc" ? "asc" : "desc";
        return { key, direction };
      }
      return { key, direction: "desc" };
    });
  };

  const renderMessage = (message, isError = false) => (
    <p
      className={`trans-budget-table__message${
        isError ? " trans-budget-table__message--error" : ""
      }`}
    >
      {message}
    </p>
  );

  const toggleRowSelection = useCallback((rowId, entry) => {
    setSelectedRows((previous) => {
      const next = new Map(previous);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else if (entry) {
        next.set(rowId, entry);
      }
      return next;
    });
  }, []);

  const renderTableBody = () =>
    sortedTransactions.map(({ entry, rowId, isSelected }) => (
      <tr
        key={rowId}
        className="trans-budget-table__row"
        onClick={() => toggleRowSelection(rowId, entry)}
      >
        <td className="trans-budget-table__checkbox-cell">
          <input
            type="checkbox"
            checked={isSelected}
            readOnly
            aria-label={`Select transaction ${rowId}`}
          />
        </td>
        {TRANSACTION_COLUMNS.map((column) => (
          <td
            key={column.key}
            className={`trans-budget-table__value${
              column.alignRight ? " trans-budget-table__value--numeric" : ""
            }`}
          >
            {column.render(entry[column.key])}
          </td>
        ))}
      </tr>
    ));

  const hasTransactions = transactions.length > 0;
  const hasFilteredTransactions = normalizedTransactions.length > 0;

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        <TransactionBudgetFilter
          onFiltersChange={handleFilterChange}
          onDeleteClick={handleDeleteRequest}
          onSelectAllToggle={handleSelectAllToggle}
          canDelete={selectedRows.size > 0}
          isAllSelected={isAllSelected}
        />
        <section className="section-table" aria-label="Budget table">
          <div className="section-table__content">
            <div className="trans-budget-table-wrapper">
              {isLoading &&
                renderMessage("Loading budget transactions...", false)}
              {!isLoading && error && renderMessage(error, true)}
              {!isLoading &&
                !error &&
                !hasTransactions &&
                renderMessage("No budget transactions available.")}
              {!isLoading &&
                !error &&
                hasTransactions &&
                !hasFilteredTransactions &&
                renderMessage("No budget transactions match the filters.")}
              {!isLoading &&
                !error &&
                hasFilteredTransactions && (
                  <table className="trans-budget-table">
                    <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className="trans-budget-table__sort-button"
                          onClick={() => handleSort(SELECTION_COLUMN.key)}
                        >
                          <span>{SELECTION_COLUMN.label}</span>
                          <span className="trans-budget-table__sort-indicator">
                            {sortConfig.key === SELECTION_COLUMN.key
                              ? sortConfig.direction === "desc"
                                ? "▼"
                                : "▲"
                              : "↕"}
                          </span>
                        </button>
                      </th>
                      {TRANSACTION_COLUMNS.map((column) => (
                        <th key={column.key}>
                          <button
                            type="button"
                            className="trans-budget-table__sort-button"
                            onClick={() => handleSort(column.key)}
                          >
                            <span>{column.label}</span>
                            <span className="trans-budget-table__sort-indicator">
                              {sortConfig.key === column.key
                                ? sortConfig.direction === "desc"
                                  ? "▼"
                                  : "▲"
                                : "↕"}
                            </span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{renderTableBody()}</tbody>
                </table>
              )}
            </div>
          </div>
        </section>
        {showDeleteConfirmation && (
          <div
            className="trans-budget-delete-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Delete selected transactions"
          >
            <div className="trans-budget-delete-modal">
              <h3>Confirm deletion</h3>
              <p>
                You are about to delete {selectedRows.size} transaction
                {selectedRows.size === 1 ? "" : "s"}. This cannot be undone.
              </p>
              {deleteError && (
                <p className="trans-budget-delete-modal__error">
                  {deleteError}
                </p>
              )}
              <div className="trans-budget-delete-modal__actions">
                <button
                  className="generate-report-button"
                  type="button"
                  onClick={handleDeleteCancel}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  className="generate-report-button"
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
