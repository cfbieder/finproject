import { useEffect } from "react";
import Rest from "../js/rest.js";

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

const BUDGET_ENTRIES_POPUP_STYLE = `
  body {
    font-family: "Inter", "Segoe UI", system-ui, sans-serif;
    margin: 0;
    padding: 16px;
    background: #fff;
    color: #111;
  }
  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 1rem;
    font-size: 0.9rem;
  }
  th,
  td {
    padding: 0.45rem 0.65rem;
    border: 1px solid rgba(0, 0, 0, 0.1);
    text-align: left;
  }
  th {
    background: #f6f7fb;
    font-size: 0.75rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .budget-entries-popup__status {
    margin-top: 1rem;
    font-size: 0.95rem;
  }
  .budget-entries-popup__empty,
  .budget-entries-popup__error {
    margin-top: 1rem;
    font-size: 0.95rem;
    color: #555;
  }
  .budget-entries-popup__error {
    color: #c33;
  }
  .budget-entries-popup__value {
    font-weight: 600;
  }
  .budget-entries-popup__value--negative {
    color: #c33;
  }
`;

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

    const accountsToFilter = (Array.isArray(selectedAccounts)
      ? selectedAccounts
      : []
    ).filter((account) => account && account !== "All");

    const safeExpandedCategories = Array.isArray(expandedCategories)
      ? expandedCategories
      : [];

    const safeFormatCurrencyValue =
      typeof formatCurrencyValue === "function"
        ? formatCurrencyValue
        : (value) => formatAmountWithCurrency(value);

    const heading = `Entries for ${row.monthLabel} ${actualYear}`;
    const sanitizedHeading = escapeHtml(heading);
    const popupName = `budget-entries-${actualYear}-${row.monthNumber}-${Date.now()}`;
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

    popup.document.write(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>${sanitizedHeading}</title>
          <style>${BUDGET_ENTRIES_POPUP_STYLE}</style>
        </head>
        <body>
          <h1>${sanitizedHeading}</h1>
          <p class="budget-entries-popup__status">Loading entries…</p>
        </body>
      </html>
    `);
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

        const rowsHtml = entries
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

        const tableMarkup = `
          <table class="budget-entries-popup__table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Base Amount</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        `;
        setPopupContent(tableMarkup);
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
