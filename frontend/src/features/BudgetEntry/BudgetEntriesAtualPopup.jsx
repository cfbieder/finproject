import { useEffect } from "react";
import Rest from "../../js/rest.js";
import popupStylesUrl from "./BudgetEntriesAtualPopup.css?url";
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
  useEffect(() => {
    if (!request?.row) {
      return undefined;
    }

    let isActive = true;
    const {
      row,
      actualYear,
      selectedAccounts,
      expandedCategories,
      formatCurrencyValue,
    } = request;

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

    let latestEntries = [];
    let currentSortState = {
      key: ACTUAL_ENTRY_SORTABLE_COLUMNS[0].key,
      direction: "desc",
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
        .map((entry) => {
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
          </tr>`;
        })
        .join("");

      return `
        <table class="budget-entries-popup__table">
          <thead>
            <tr>
              ${headerCells}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      `;
    };

    const renderEntriesTable = () => {
      if (!popup || popup.closed) {
        return;
      }
      setPopupContent(
        buildEntriesMarkup(latestEntries, currentSortState)
      );
      setTimeout(attachSortListeners, 0);
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
      if (currentSortState.key === normalizedKey) {
        currentSortState.direction =
          currentSortState.direction === "asc" ? "desc" : "asc";
      } else {
        currentSortState.key = normalizedKey;
        currentSortState.direction = "asc";
      }
      renderEntriesTable();
    };

    const attachSortListeners = () => {
      if (!popup || popup.closed) {
        return;
      }
      const sortButtons = popup.document.querySelectorAll(
        "[data-sort-key]"
      );
      sortButtons.forEach((button) => {
        button.onclick = (event) => {
          event.preventDefault();
          handleSortChange(button.dataset.sortKey);
        };
      });
    };

    const heading = `Entries for ${row.monthLabel} ${actualYear}`;
    const sanitizedHeading = escapeHtml(heading);
    const popupName = `budget-entries-${actualYear}-${
      row.monthNumber
    }-${Date.now()}`;
    // Create the popup window HTML content
    const popupHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>${sanitizedHeading}</title>
          <link rel="stylesheet" href="${popupStylesUrl}" />
          <style>
            html {
              background: linear-gradient(135deg, #f8f9fe 0%, #eef3fb 100%);
            }
            body {
              opacity: 0;
              animation: fadeIn 0.3s ease forwards;
            }
            @keyframes fadeIn {
              to { opacity: 1; }
            }
          </style>
        </head>
        <body>
          <h1>${sanitizedHeading}</h1>
          <p class="budget-entries-popup__status">Loading entries…</p>
        </body>
      </html>
    `;

    const popup = window.open(
      "",
      popupName,
      "width=960,height=640,scrollbars=yes,resizable=yes"
    );

    if (!popup) {
      return () => {
        isActive = false;
      };
    }

    popup.document.open();
    popup.document.write(popupHtml);
    popup.document.close();

    const setPopupContent = (content) => {
      if (!isActive || !popup || popup.closed) {
        return;
      }
      popup.document.title = sanitizedHeading;
      popup.document.body.innerHTML = `<h1>${sanitizedHeading}</h1>${content}`;
    };

    const fetchEntries = async () => {
      try {
        const payload = await Rest.fetchBudgetActualEntries({
          actualYear,
          month: row.monthNumber,
          categories: safeExpandedCategories,
          accounts: accountsToFilter,
          limit: 500,
        });

        if (!isActive) {
          return;
        }

        const entries = Array.isArray(payload?.entries) ? payload.entries : [];

        if (!entries.length) {
          setPopupContent(
            `<p class="budget-entries-popup__empty">No entries found for ${escapeHtml(
              row.monthLabel
            )} ${actualYear}.</p>`
          );
          return;
        }

        latestEntries = entries;
        renderEntriesTable();
      } catch (error) {
        if (!isActive) {
          return;
        }
        setPopupContent(
          `<p class="budget-entries-popup__error">Unable to load entries: ${escapeHtml(
            error?.message ?? "An unexpected error occurred."
          )}</p>`
        );
      }
    };

    fetchEntries();

    return () => {
      isActive = false;
    };
  }, [request]);

  return null;
};

export default BudgetEntriesAtualPopup;
