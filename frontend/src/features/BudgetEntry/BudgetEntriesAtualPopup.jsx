import { useEffect, useRef, useState } from "react";
import Rest from "../../js/rest.js";
import "./BudgetEntriesAtualPopup.css";

const escapeHtml = (value) => {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const buildActionButtonMarkup = (isEnabled, entryIndex) => {
  const disabledClass = isEnabled
    ? ""
    : " budget-entries-popup__action-button--disabled";
  const disabledAttribute = isEnabled ? "" : " disabled";
  return `
  <div class="budget-entries-popup__actions">
    <button
      type="button"
      class="budget-entries-popup__action-button${disabledClass}"
      aria-label="Copy to budget entry"
      title="Copy to budget entry"
      data-entry-index="${entryIndex}"
      ${disabledAttribute}
    >
      C
    </button>
  </div>`;
};

const ACTIONS_COLUMN_HEADER = "<th>Actions</th>";

const formatPopupDate = (value) => {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return parsed.toISOString().split("T")[0];
};

const formatAmountWithCurrency = (amount, currency) => {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) {
    return "—";
  }
  const formattedNumber = Math.abs(parsed).toFixed(2);
  const label = currency ? ` ${currency}` : "";
  return parsed < 0
    ? `(${formattedNumber}${label})`
    : `${formattedNumber}${label}`;
};

const renderPopupCurrencyValue = (rawValue, formattedValue) => {
  const parsed = Number(rawValue);
  const isNegative =
    Number.isFinite(parsed) && parsed < 0
      ? " budget-entries-popup__value--negative"
      : "";
  return `<span class="budget-entries-popup__value${isNegative}">${escapeHtml(
    formattedValue
  )}</span>`;
};

const ACTUAL_ENTRY_SORTABLE_COLUMNS = [
  { key: "Date", label: "Date" },
  { key: "Description", label: "Description" },
  { key: "Account", label: "Account" },
  { key: "Category", label: "Category" },
  { key: "Amount", label: "Amount" },
  { key: "BaseAmount", label: "Base Amount" },
];

const getActualEntrySortValue = (entry, key) => {
  if (!entry) {
    return "";
  }
  switch (key) {
    case "Date": {
      const parsed = entry.Date ? new Date(entry.Date) : null;
      const timestamp =
        parsed && Number.isFinite(parsed.getTime())
          ? parsed.getTime()
          : Number.NEGATIVE_INFINITY;
      return timestamp;
    }
    case "Amount": {
      const value = Number(entry.Amount);
      return Number.isFinite(value) ? value : 0;
    }
    case "BaseAmount": {
      const value = Number(entry.BaseAmount);
      return Number.isFinite(value) ? value : 0;
    }
    case "Description":
      return (
        entry.Description1 ??
        entry.Description2 ??
        entry.Note ??
        ""
      ).toLowerCase();
    case "Account":
      return (entry.Account ?? "").toLowerCase();
    case "Category":
      return (entry.Category ?? "").toLowerCase();
    default:
      return "";
  }
};

const compareActualEntries = (a, b, key) => {
  const valueA = getActualEntrySortValue(a, key);
  const valueB = getActualEntrySortValue(b, key);
  if (typeof valueA === "number" && typeof valueB === "number") {
    if (valueA === valueB) {
      return 0;
    }
    return valueA < valueB ? -1 : 1;
  }
  const normalizedA = String(valueA ?? "");
  const normalizedB = String(valueB ?? "");
  return normalizedA.localeCompare(normalizedB, undefined, {
    sensitivity: "base",
  });
};

const sortActualEntries = (entries, sortState) => {
  if (!Array.isArray(entries)) {
    return [];
  }
  const sorted = [...entries];
  sorted.sort((a, b) => {
    const comparison = compareActualEntries(a, b, sortState.key);
    return sortState.direction === "asc" ? comparison : -comparison;
  });
  return sorted;
};

const BudgetEntriesAtualPopup = ({ request }) => {
  const [entries, setEntries] = useState([]);
  const [sortState, setSortState] = useState({
    key: ACTUAL_ENTRY_SORTABLE_COLUMNS[0].key,
    direction: "desc",
  });
  const [statusMessage, setStatusMessage] = useState("Loading entries…");
  const [isError, setIsError] = useState(false);
  const modalRef = useRef(null);
  const contentRef = useRef(null);

  const {
    row,
    actualYear,
    selectedAccounts,
    expandedCategories,
    formatCurrencyValue,
    budgetEntryAvailable,
    onActualEntryCopy,
    onClose,
  } = request || {};

  const budgetEntryEnabled = budgetEntryAvailable ?? true;
  const copyEntryCallback =
    typeof onActualEntryCopy === "function" ? onActualEntryCopy : null;

  const accountsToFilter = (
    Array.isArray(selectedAccounts) ? selectedAccounts : []
  ).filter((account) => account && account !== "All");

  const safeExpandedCategories = Array.isArray(expandedCategories)
    ? expandedCategories
    : [];

  const safeFormatCurrencyValue =
    typeof formatCurrencyValue === "function"
      ? formatCurrencyValue
      : (value) => formatAmountWithCurrency(value);

  const handleClose = () => {
    if (typeof onClose === "function") {
      onClose();
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleSortChange = (key) => {
    const normalizedKey = typeof key === "string" ? key.trim() : "";
    if (
      !ACTUAL_ENTRY_SORTABLE_COLUMNS.some(
        (column) => column.key === normalizedKey
      )
    ) {
      return;
    }
    setSortState((prev) => ({
      key: normalizedKey,
      direction:
        prev.key === normalizedKey
          ? prev.direction === "asc"
            ? "desc"
            : "asc"
          : "asc",
    }));
  };

  const buildEntriesMarkup = (entriesToRender, sortState) => {
    const sortedEntries = sortActualEntries(entriesToRender, sortState);
    const headerCells = ACTUAL_ENTRY_SORTABLE_COLUMNS.map((column) => {
      const isActive = sortState.key === column.key;
      const ariaSort = isActive
        ? sortState.direction === "asc"
          ? "ascending"
          : "descending"
        : "none";
      const marker = isActive
        ? sortState.direction === "asc"
          ? " ▲"
          : " ▼"
        : "";
      return `<th aria-sort="${ariaSort}">
        <button
          type="button"
          class="budget-entries-popup__sort-button"
          data-sort-key="${column.key}"
        >
          ${escapeHtml(column.label)}${marker}
        </button>
      </th>`;
    }).join("");

    const rowsHtml = sortedEntries
      .map((entry, entryIndex) => {
        const description = escapeHtml(
          entry.Description1 ?? entry.Description2 ?? entry.Note ?? "—"
        );
        const dateText = escapeHtml(formatPopupDate(entry.Date));
        const account = escapeHtml(entry.Account ?? "—");
        const category = escapeHtml(entry.Category ?? "—");
        const originalAmountMarkup = renderPopupCurrencyValue(
          entry.Amount,
          formatAmountWithCurrency(entry.Amount, entry.Currency)
        );
        const baseAmountMarkup = renderPopupCurrencyValue(
          entry.BaseAmount,
          safeFormatCurrencyValue(entry.BaseAmount)
        );
        return `<tr>
          <td>${dateText}</td>
          <td>${description}</td>
          <td>${account}</td>
          <td>${category}</td>
          <td>${originalAmountMarkup}</td>
          <td>${baseAmountMarkup}</td>
          <td>${buildActionButtonMarkup(budgetEntryEnabled, entryIndex)}</td>
        </tr>`;
      })
      .join("");

    return `
      <table class="budget-entries-popup__table">
        <thead>
          <tr>
            ${headerCells}
            ${ACTIONS_COLUMN_HEADER}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  };

  const attachSortListeners = () => {
    if (!contentRef.current) {
      return;
    }
    const sortButtons = contentRef.current.querySelectorAll("[data-sort-key]");
    sortButtons.forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        handleSortChange(button.dataset.sortKey);
      };
    });
  };

  const attachActionListeners = () => {
    if (!contentRef.current) {
      return;
    }
    const actionButtons = contentRef.current.querySelectorAll(
      ".budget-entries-popup__action-button"
    );
    actionButtons.forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        if (button.disabled || !copyEntryCallback) {
          return;
        }
        const indexAttr = button.dataset.entryIndex;
        const entryIndex = Number(indexAttr);
        if (!Number.isFinite(entryIndex)) {
          return;
        }
        const sortedEntries = sortActualEntries(entries, sortState);
        const entry = sortedEntries[entryIndex];
        if (!entry) {
          return;
        }
        copyEntryCallback(entry, row?.monthNumber);
        handleClose();
      };
    });
  };

  const fetchEntries = async () => {
    if (!row?.monthNumber) {
      return;
    }
    try {
      const payload = await Rest.fetchBudgetActualEntries({
        actualYear,
        month: row.monthNumber,
        categories: safeExpandedCategories,
        accounts: accountsToFilter,
        limit: 500,
      });

      const fetchedEntries = Array.isArray(payload?.entries)
        ? payload.entries
        : [];

      setEntries(fetchedEntries);
      if (!fetchedEntries.length) {
        setStatusMessage(
          `No entries found for ${row.monthLabel} ${actualYear}.`
        );
        setIsError(false);
      } else {
        setStatusMessage("");
        setIsError(false);
      }
    } catch (error) {
      console.error("[BudgetEntriesAtualPopup] Failed to load entries:", error);
      setStatusMessage(
        error?.message ?? "An unexpected error occurred."
      );
      setIsError(true);
    }
  };

  useEffect(() => {
    if (request?.row) {
      fetchEntries();
    }
  }, [request]);

  useEffect(() => {
    if (contentRef.current) {
      if (entries.length > 0) {
        contentRef.current.innerHTML = buildEntriesMarkup(entries, sortState);
        attachSortListeners();
        attachActionListeners();
      } else if (statusMessage) {
        const className = isError
          ? "budget-entries-popup__error"
          : "budget-entries-popup__empty";
        contentRef.current.innerHTML = `<p class="${className}">${escapeHtml(
          statusMessage
        )}</p>`;
      } else {
        contentRef.current.innerHTML = `<p class="budget-entries-popup__status">${escapeHtml(
          "Loading entries…"
        )}</p>`;
      }
    }
  }, [entries, sortState, statusMessage, isError]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  if (!request?.row) {
    return null;
  }

  const heading = `Entries for ${row.monthLabel} ${actualYear}`;

  return (
    <div
      ref={modalRef}
      className="budget-entries-modal-overlay"
      onClick={handleOverlayClick}
    >
      <div className="budget-entries-modal">
        <div className="budget-entries-modal__header">
          <h1>{heading}</h1>
          <button
            className="budget-entries-modal__close"
            onClick={handleClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>
        <div
          ref={contentRef}
          className="budget-entries-modal__content"
        ></div>
      </div>
    </div>
  );
};

export default BudgetEntriesAtualPopup;
