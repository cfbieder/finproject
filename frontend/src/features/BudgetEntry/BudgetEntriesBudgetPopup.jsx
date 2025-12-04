import { useEffect } from "react";
import Rest from "../../js/rest.js";
import popupStylesUrl from "./BudgetEntriesBudgetPopup.css?url";
// Utility helpers for formatting values that end up in the popup markup.
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

const MONTH_NAMES = [
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

const MONTH_OPTIONS = MONTH_NAMES.map(
  (name, index) => `<option value="${index + 1}">${name}</option>`
).join("");

const parseBudgetEntryDateParts = (value) => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
};

const buildBudgetEntryDate = (year, month, day) => {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedDay = Number(day);
  if (
    !Number.isInteger(normalizedYear) ||
    !Number.isInteger(normalizedMonth) ||
    !Number.isInteger(normalizedDay)
  ) {
    return "";
  }
  if (normalizedMonth < 1 || normalizedMonth > 12 || normalizedDay < 1) {
    return "";
  }
  const lastDayOfMonth = new Date(
    Date.UTC(normalizedYear, normalizedMonth, 0)
  ).getUTCDate();
  const safeDay = Math.min(normalizedDay, lastDayOfMonth);
  const constructed = new Date(
    Date.UTC(normalizedYear, normalizedMonth - 1, safeDay)
  );
  if (Number.isNaN(constructed.getTime())) {
    return "";
  }
  return constructed.toISOString().split("T")[0];
};

const parseEditorNumericValue = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const input = String(value);
  const normalized = input.replace(/[^0-9.-]+/g, "");
  if (
    normalized.length === 0 ||
    normalized === "-" ||
    normalized === "." ||
    normalized === "-."
  ) {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
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

const DEFAULT_BASE_CURRENCY = "USD";

const normalizeCurrencyCode = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
};

const resolveExchangeRateValue = (currencyValue, budgetRates, baseCurrency) => {
  const normalizedBaseCurrency =
    normalizeCurrencyCode(baseCurrency) || DEFAULT_BASE_CURRENCY;
  const normalizedCurrency = normalizeCurrencyCode(currencyValue);
  if (!normalizedCurrency || normalizedCurrency === normalizedBaseCurrency) {
    return 1;
  }

  const rate =
    budgetRates && typeof budgetRates === "object"
      ? budgetRates[normalizedCurrency]
      : undefined;
  return Number.isFinite(rate) ? rate : undefined;
};

const computeBaseAmountValue = (
  amountValue,
  currencyValue,
  budgetRates,
  baseCurrency
) => {
  const parsedAmount = Number(amountValue);
  if (!Number.isFinite(parsedAmount)) {
    return undefined;
  }

  const rate = resolveExchangeRateValue(
    currencyValue,
    budgetRates,
    baseCurrency
  );
  if (!Number.isFinite(rate)) {
    return undefined;
  }

  return parsedAmount * rate;
};

const buildDropdownOptions = (values = []) => {
  if (!Array.isArray(values)) {
    return "";
  }
  const seen = new Set();
  const fragments = [];
  for (const rawValue of values) {
    if (typeof rawValue !== "string") {
      continue;
    }
    const normalized = rawValue.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    const escaped = escapeHtml(normalized);
    fragments.push(`<option value="${escaped}">${escaped}</option>`);
  }
  return fragments.join("");
};

// Helpers to keep select dropdowns synchronized with the entry data.
const ensureSelectOption = (documentRef, selectElement, optionValue) => {
  if (!documentRef || !selectElement || !optionValue) {
    return;
  }
  const alreadyExists = Array.from(selectElement.options).some(
    (option) => option.value === optionValue
  );
  if (alreadyExists) {
    return;
  }
  const optionElement = documentRef.createElement("option");
  optionElement.value = optionValue;
  optionElement.textContent = optionValue;
  selectElement.appendChild(optionElement);
};

const setSelectValueSafely = (
  selectElement,
  rawValue,
  { documentRef, fallbackToFirst = false } = {}
) => {
  if (!selectElement) {
    return "";
  }
  const normalized =
    rawValue !== undefined && rawValue !== null ? String(rawValue).trim() : "";
  if (normalized) {
    ensureSelectOption(documentRef, selectElement, normalized);
    selectElement.value = normalized;
    return normalized;
  }
  if (fallbackToFirst && selectElement.options.length) {
    const fallback = selectElement.options[0].value;
    selectElement.value = fallback;
    return fallback;
  }
  selectElement.value = "";
  return "";
};

const buildBudgetEntriesEditorMarkup = (
  categoryOptions = [],
  currencyOptions = [],
  accountOptions = []
) => {
  const categoryDropdownOptions = buildDropdownOptions(categoryOptions);
  const currencyDropdownOptions = buildDropdownOptions(currencyOptions);
  const accountDropdownOptions = buildDropdownOptions(accountOptions);
  return `
  <section
    id="budget-entries-popup-editor"
    class="budget-entries-popup__editor budget-entries-popup__editor--hidden"
  >
    <h2>Budget entry editor</h2>
    <form id="budget-entries-popup-editor-form">
      <div class="budget-entries-popup__editor-grid">
        <label>
          <span class="budget-entries-popup__editor-label">Month</span>
          <select
            name="dateMonth"
            class="budget-entries-popup__editor-input"
          >
            ${MONTH_OPTIONS}
          </select>
        </label>
        <input type="hidden" name="dateYear" />
        <label>
          <span class="budget-entries-popup__editor-label">Description</span>
          <input
            type="text"
            name="description"
            class="budget-entries-popup__editor-input"
          />
        </label>
        <label>
          <span class="budget-entries-popup__editor-label">Account</span>
          <select
            name="account"
            class="budget-entries-popup__editor-input"
          >
            <option value="">None</option>
            ${accountDropdownOptions}
          </select>
        </label>
        <label>
          <span class="budget-entries-popup__editor-label">Category</span>
          <select
            name="category"
            class="budget-entries-popup__editor-input"
          >
            <option value="">Select category</option>
            ${categoryDropdownOptions}
          </select>
        </label>
        <label>
          <span class="budget-entries-popup__editor-label">Amount</span>
          <input
            type="text"
            inputmode="decimal"
            name="amount"
            class="budget-entries-popup__editor-input"
          />
        </label>
        <label>
          <span class="budget-entries-popup__editor-label">Base Amount</span>
          <input
            type="text"
            name="baseAmount"
            class="budget-entries-popup__editor-input"
            data-budget-entry-base-amount
            readonly
          />
        </label>
        <label>
          <span class="budget-entries-popup__editor-label">Currency</span>
          <select
            name="currency"
            class="budget-entries-popup__editor-input"
          >
            ${currencyDropdownOptions}
          </select>
        </label>
      </div>
      <label>
        <span class="budget-entries-popup__editor-label">Note</span>
        <textarea
          name="note"
          rows="3"
          class="budget-entries-popup__editor-textarea"
        ></textarea>
      </label>
      <div class="budget-entries-popup__editor-actions">
        <button type="submit">Save entry</button>
        <button type="button" data-budget-entry-editor-action="cancel">
          Cancel
        </button>
      </div>
    </form>
  </section>
`;
};

const BUDGET_ENTRIES_DELETE_CONFIRMATION_MARKUP = `
  <section
    id="budget-entries-popup-delete-confirmation"
    class="budget-entries-popup__delete-confirmation"
    role="alertdialog"
    aria-live="assertive"
  >
    <p data-delete-confirmation-message></p>
    <div class="budget-entries-popup__delete-confirmation-actions">
      <button type="button" data-delete-confirmation-confirm>
        Delete entry
      </button>
      <button type="button" data-delete-confirmation-cancel>
        Cancel
      </button>
    </div>
  </section>
`;

// React component that opens the budget entries popup for the provided request.
const BudgetEntriesBudgetPopup = ({ request }) => {
  useEffect(() => {
    if (!request?.row) {
      return undefined;
    }

    let isActive = true;
    let latestEntries = [];
    let pendingDeleteEntryId = null;

    const {
      row,
      budgetYear,
      selectedAccounts,
      expandedCategories,
      onClose,
      categoryOptions,
      currencyOptions,
      accountOptions,
    } = request;

    const safeBudgetRates =
      request && typeof request.budgetRates === "object"
        ? request.budgetRates
        : {};
    const effectiveBaseCurrency =
      normalizeCurrencyCode(request?.baseCurrency) || DEFAULT_BASE_CURRENCY;

    const safeBudgetYear = Number.isFinite(budgetYear)
      ? budgetYear
      : new Date().getFullYear();

    const accountsToFilter = (
      Array.isArray(selectedAccounts) ? selectedAccounts : []
    ).filter((account) => account && account !== "All");

    const safeExpandedCategories = Array.isArray(expandedCategories)
      ? expandedCategories
      : [];

    const safeCategoryOptions = Array.isArray(categoryOptions)
      ? categoryOptions
      : [];
    const safeCurrencyOptions = Array.isArray(currencyOptions)
      ? currencyOptions
      : [];
    const safeAccountOptions = Array.isArray(accountOptions)
      ? accountOptions
      : [];

    const markAmountInputNegative = (input) => {
      if (!input) {
        return;
      }
      const parsed = parseEditorNumericValue(input.value);
      input.classList.toggle(
        "budget-entries-popup__editor-input--negative",
        Number.isFinite(parsed) ? parsed < 0 : false
      );
    };

    const heading = `Budget entries for ${row.monthLabel} ${safeBudgetYear}`;
    const sanitizedHeading = escapeHtml(heading);
    const popupName = `budget-entries-${safeBudgetYear}-${
      row.monthNumber
    }-${Date.now()}-budget`;
    const popup = window.open(
      "",
      popupName,
      "width=1020,height=720,scrollbars=yes,resizable=yes"
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
          <link rel="stylesheet" href="${popupStylesUrl}" />
        </head>
        <body>
          <h1>${sanitizedHeading}</h1>
          <p class="budget-entries-popup__status budget-entries-popup__status--muted">
            Preparing entries…
          </p>
        </body>
      </html>
    `);
    popup.document.close();

    let closeMonitorId = null;
    let closeCallbackInvoked = false;
    const notifyClose = () => {
      if (closeCallbackInvoked) {
        return;
      }
      closeCallbackInvoked = true;
      if (typeof onClose === "function") {
        onClose();
      }
    };

    const setPopupContent = (content) => {
      if (!isActive || !popup || popup.closed) {
        return;
      }
      popup.document.title = sanitizedHeading;
      popup.document.body.innerHTML = `<h1>${sanitizedHeading}</h1>${content}`;
    };

    const setStatusText = (message, type = "muted") => {
      if (!isActive || !popup || popup.closed) {
        return;
      }
      const statusElement = popup.document.getElementById(
        "budget-entries-popup-status"
      );
      if (!statusElement) {
        return;
      }
      statusElement.textContent = message;
      statusElement.className = `budget-entries-popup__status budget-entries-popup__status--${type}`;
    };

    // Recalculate the base amount display whenever amount or currency changes.
    const syncEditorBaseAmountField = () => {
      if (!popup || popup.closed) {
        return undefined;
      }
      const editorForm = popup.document.getElementById(
        "budget-entries-popup-editor-form"
      );
      const baseAmountInput = popup.document.querySelector(
        "[data-budget-entry-base-amount]"
      );
      if (!editorForm || !baseAmountInput) {
        return undefined;
      }
      const amountValue = parseEditorNumericValue(
        editorForm.querySelector("[name='amount']")?.value
      );
      const currencyValue =
        editorForm.querySelector("[name='currency']")?.value ??
        effectiveBaseCurrency;
      const computed = computeBaseAmountValue(
        amountValue,
        currencyValue,
        safeBudgetRates,
        effectiveBaseCurrency
      );
      if (Number.isFinite(computed)) {
        baseAmountInput.value = formatAmountWithCurrency(
          computed,
          effectiveBaseCurrency
        );
        baseAmountInput.classList.toggle(
          "budget-entries-popup__editor-input--negative",
          computed < 0
        );
      } else {
        baseAmountInput.value = "";
        baseAmountInput.classList.remove(
          "budget-entries-popup__editor-input--negative"
        );
      }
      return computed;
    };

    // Build the table rows for the fetched entries, including action buttons.
    const buildEntriesMarkup = (entries) => {
      const rowsHtml = entries.length
        ? entries
            .map((entry) => {
              const description = escapeHtml(
                entry.Description1 ?? entry.Description2 ?? entry.Note ?? "—"
              );
              const account = escapeHtml(entry.Account ?? "—");
              const category = escapeHtml(entry.Category ?? "—");
              const note = escapeHtml(entry.Note ?? "");
              const dateText = escapeHtml(formatPopupDate(entry.Date));
              const amountMarkup = renderPopupCurrencyValue(
                entry.Amount,
                formatAmountWithCurrency(entry.Amount, entry.Currency)
              );
              const baseAmountMarkup = renderPopupCurrencyValue(
                entry.BaseAmount,
                formatAmountWithCurrency(
                  entry.BaseAmount,
                  entry.BaseCurrency ?? "USD"
                )
              );
              const currencyLabel = escapeHtml(entry.Currency ?? "—");
              const baseCurrencyLabel = escapeHtml(entry.BaseCurrency ?? "USD");
              const summaryParts = [];
              if (description && description !== "—") {
                summaryParts.push(description);
              }
              if (dateText && dateText !== "—") {
                summaryParts.push(dateText);
              }
              const amountSummary = escapeHtml(
                formatAmountWithCurrency(entry.Amount, entry.Currency)
              );
              if (amountSummary && amountSummary !== "—") {
                summaryParts.push(amountSummary);
              }
              const deleteSummary = summaryParts.join(" - ");
              return `<tr>
                <td>${dateText}</td>
                <td>${description}</td>
                <td>${account}</td>
                <td>${category}</td>
                <td class="budget-entries-popup__amount-cell">
                  ${amountMarkup}
                </td>
                <td class="budget-entries-popup__base-amount-cell">
                  ${baseAmountMarkup}
                </td>
                <td>${currencyLabel}</td>
                <td>${baseCurrencyLabel}</td>
                <td>${note || "—"}</td>
                <td>
                  <div class="budget-entries-popup__actions">
                    <button
                      type="button"
                      class="budget-entries-popup__action-button"
                      data-budget-entry-edit="${entry._id}"
                      aria-label="Edit budget entry"
                      title="Edit"
                    >
                      E
                    </button>
                    <button
                      type="button"
                      class="budget-entries-popup__action-button budget-entries-popup__action-button--delete"
                      data-budget-entry-delete="${entry._id}"
                      data-budget-entry-delete-summary="${deleteSummary}"
                      aria-label="Delete budget entry"
                      title="Delete"
                    >
                      D
                    </button>
                  </div>
                </td>
              </tr>`;
            })
            .join("")
        : `<tr>
            <td colspan="10" class="budget-entries-popup__empty">
              No budget entries found for ${escapeHtml(
                row.monthLabel
              )} ${safeBudgetYear}.
            </td>
          </tr>`;

      return `
        <div class="budget-entries-popup__table-wrapper">
          <table class="budget-entries-popup__table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Base Amount</th>
                <th>Currency</th>
                <th>Base Currency</th>
                <th>Note</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;
    };

    const hideEditor = () => {
      if (!popup || popup.closed) {
        return;
      }
      const editor = popup.document.getElementById(
        "budget-entries-popup-editor"
      );
      const editorForm = popup.document.getElementById(
        "budget-entries-popup-editor-form"
      );
      if (editorForm) {
        editorForm.dataset.budgetEntryId = "";
        editorForm.reset();
      }
      if (editor) {
        editor.classList.add("budget-entries-popup__editor--hidden");
      }
    };

    const startEditEntry = (entryId) => {
      if (!popup || popup.closed) {
        return;
      }
      const entry = latestEntries.find(
        (candidate) => String(candidate._id) === String(entryId)
      );
      if (!entry) {
        return;
      }

      const editor = popup.document.getElementById(
        "budget-entries-popup-editor"
      );
      const editorForm = popup.document.getElementById(
        "budget-entries-popup-editor-form"
      );
      if (!editor || !editorForm) {
        return;
      }

      editorForm.dataset.budgetEntryId = String(entry._id);
      const dateMonthSelect = editorForm.querySelector("[name='dateMonth']");
      const dateYearInput = editorForm.querySelector("[name='dateYear']");
      const dateParts = parseBudgetEntryDateParts(entry.Date);
      if (dateMonthSelect) {
        dateMonthSelect.value = dateParts?.month ? String(dateParts.month) : "";
      }
      if (dateYearInput) {
        dateYearInput.value = dateParts?.year ? String(dateParts.year) : "";
      }
      const descriptionInput = editorForm.querySelector("[name='description']");
      if (descriptionInput) {
        descriptionInput.value = entry.Description1 ?? "";
      }
      const accountSelect = editorForm.querySelector("[name='account']");
      if (accountSelect) {
        const accountValue = entry.Account ?? "";
        if (accountValue) {
          setSelectValueSafely(accountSelect, accountValue, {
            documentRef: popup.document,
          });
        } else {
          accountSelect.value = "";
        }
      }
      const categorySelect = editorForm.querySelector("[name='category']");
      if (categorySelect) {
        // ensure the category exists in the dropdown before selecting it
        setSelectValueSafely(categorySelect, entry.Category ?? "", {
          documentRef: popup.document,
        });
      }
      const currencySelect = editorForm.querySelector("[name='currency']");
      if (currencySelect) {
        // keep currency dropdown synced with the entry (fallback to first option)
        setSelectValueSafely(currencySelect, entry.Currency ?? "", {
          documentRef: popup.document,
          fallbackToFirst: true,
        });
      }
      const amountInput = editorForm.querySelector("[name='amount']");
      if (amountInput) {
        amountInput.value =
          entry.Amount !== undefined && entry.Amount !== null
            ? String(entry.Amount)
            : "";
        markAmountInputNegative(amountInput);
      }
      const baseAmountInput = editorForm.querySelector("[name='baseAmount']");
      if (baseAmountInput) {
        baseAmountInput.value = "";
      }
      const noteInput = editorForm.querySelector("[name='note']");
      if (noteInput) {
        noteInput.value = entry.Note ?? "";
      }

      syncEditorBaseAmountField();

      editor.classList.remove("budget-entries-popup__editor--hidden");
      setStatusText(
        `Editing ${escapeHtml(entry.Description1 ?? "budget entry")}…`,
        "neutral"
      );
    };

    const submitEditorPayload = async (event) => {
      event.preventDefault();
      if (!popup || popup.closed) {
        return;
      }
      const editorForm = popup.document.getElementById(
        "budget-entries-popup-editor-form"
      );
      if (!editorForm) {
        return;
      }

      const entryId = editorForm.dataset.budgetEntryId;
      if (!entryId) {
        setStatusText("Select an entry before saving.", "error");
        return;
      }

      const payload = {};
      const dateMonthValue =
        editorForm.querySelector("[name='dateMonth']")?.value;
      const dateYearValue =
        editorForm.querySelector("[name='dateYear']")?.value;
      const isoDate = buildBudgetEntryDate(dateYearValue, dateMonthValue, 1);
      if (isoDate) {
        payload.Date = isoDate;
      }
      const descriptionValue = editorForm
        .querySelector("[name='description']")
        ?.value?.trim();
      if (descriptionValue) {
        payload.Description1 = descriptionValue;
      }
      const accountValue = editorForm
        .querySelector("[name='account']")
        ?.value?.trim();
      if (accountValue) {
        payload.Account = accountValue;
      }
      const categoryValue = editorForm
        .querySelector("[name='category']")
        ?.value?.trim();
      if (categoryValue) {
        payload.Category = categoryValue;
      }
      const amountValue = editorForm.querySelector("[name='amount']")?.value;
      const parsedAmount = parseEditorNumericValue(amountValue);
      if (Number.isFinite(parsedAmount)) {
        payload.Amount = parsedAmount;
      }
      const currencyValue = editorForm
        .querySelector("[name='currency']")
        ?.value?.trim();
      if (currencyValue) {
        payload.Currency = currencyValue;
      }
      const noteValue = editorForm
        .querySelector("[name='note']")
        ?.value?.trim();
      if (noteValue) {
        payload.Note = noteValue;
      }

      const computedBaseAmount = syncEditorBaseAmountField();
      if (Number.isFinite(computedBaseAmount)) {
        payload.BaseAmount = computedBaseAmount;
      }

      if (!Object.keys(payload).length) {
        setStatusText("No changes detected.", "error");
        return;
      }

      try {
        await Rest.fetchJson(`/api/budget/${entryId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        setStatusText("Budget entry updated.", "success");
        hideEditor();
        await fetchEntries();
      } catch (error) {
        setStatusText(
          error?.message || "Unable to update the budget entry.",
          "error"
        );
      }
    };

    const deleteEntryById = async (entryId) => {
      if (!entryId || !popup || popup.closed) {
        return;
      }
      try {
        await Rest.fetchJson(`/api/budget/${entryId}`, {
          method: "DELETE",
        });
        setStatusText("Budget entry deleted.", "success");
        hideEditor();
        await fetchEntries();
      } catch (error) {
        setStatusText(
          error?.message || "Unable to delete the budget entry.",
          "error"
        );
      }
    };

    const showDeleteConfirmation = (entryId, summary) => {
      if (!entryId || !popup || popup.closed) {
        return;
      }
      const confirmationPanel = popup.document.getElementById(
        "budget-entries-popup-delete-confirmation"
      );
      if (!confirmationPanel) {
        return;
      }
      pendingDeleteEntryId = entryId;
      const messageElement = confirmationPanel.querySelector(
        "[data-delete-confirmation-message]"
      );
      const trimmedSummary = summary?.trim();
      const message =
        trimmedSummary && trimmedSummary !== ""
          ? `Delete ${trimmedSummary}?`
          : "Do you really want to delete this budget entry?";
      if (messageElement) {
        messageElement.textContent = message;
      }
      confirmationPanel.classList.add(
        "budget-entries-popup__delete-confirmation--visible"
      );
    };

    const hideDeleteConfirmation = () => {
      if (!popup || popup.closed) {
        return;
      }
      const confirmationPanel = popup.document.getElementById(
        "budget-entries-popup-delete-confirmation"
      );
      if (!confirmationPanel) {
        return;
      }
      confirmationPanel.classList.remove(
        "budget-entries-popup__delete-confirmation--visible"
      );
    };

    const confirmPendingDeleteEntry = async () => {
      const entryId = pendingDeleteEntryId;
      hideDeleteConfirmation();
      pendingDeleteEntryId = null;
      if (!entryId) {
        return;
      }
      await deleteEntryById(entryId);
    };

    const cancelPendingDelete = () => {
      hideDeleteConfirmation();
      pendingDeleteEntryId = null;
    };

    const handleDeleteEntry = (entryId, summary) => {
      if (!entryId || !popup || popup.closed) {
        return;
      }
      showDeleteConfirmation(entryId, summary);
    };

    const attachActionListeners = () => {
      if (!popup || popup.closed) {
        return;
      }
      const editButtons = popup.document.querySelectorAll(
        "[data-budget-entry-edit]"
      );
      editButtons.forEach((button) => {
        button.onclick = (event) => {
          event.preventDefault();
          startEditEntry(button.dataset.budgetEntryEdit);
        };
      });

      const deleteButtons = popup.document.querySelectorAll(
        "[data-budget-entry-delete]"
      );
      deleteButtons.forEach((button) => {
        button.onclick = (event) => {
          event.preventDefault();
          handleDeleteEntry(
            button.dataset.budgetEntryDelete,
            button.dataset.budgetEntryDeleteSummary
          );
        };
      });

      const deleteConfirmation = popup.document.getElementById(
        "budget-entries-popup-delete-confirmation"
      );
      if (deleteConfirmation) {
        const confirmButton = deleteConfirmation.querySelector(
          "[data-delete-confirmation-confirm]"
        );
        const cancelButton = deleteConfirmation.querySelector(
          "[data-delete-confirmation-cancel]"
        );
        if (confirmButton) {
          confirmButton.onclick = (event) => {
            event.preventDefault();
            confirmPendingDeleteEntry();
          };
        }
        if (cancelButton) {
          cancelButton.onclick = (event) => {
            event.preventDefault();
            cancelPendingDelete();
          };
        }
      }

      const editorForm = popup.document.getElementById(
        "budget-entries-popup-editor-form"
      );
      if (editorForm) {
        editorForm.onsubmit = submitEditorPayload;
        const amountInput = editorForm.querySelector("[name='amount']");
        const currencyInput = editorForm.querySelector("[name='currency']");
        if (amountInput) {
          amountInput.oninput = () => {
            markAmountInputNegative(amountInput);
            syncEditorBaseAmountField();
          };
        }
        if (currencyInput) {
          currencyInput.oninput = () => {
            syncEditorBaseAmountField();
          };
        }
      }

      const cancelButton = popup.document.querySelector(
        '[data-budget-entry-editor-action="cancel"]'
      );
      if (cancelButton) {
        cancelButton.onclick = (event) => {
          event.preventDefault();
          hideEditor();
        };
      }
    };

    const buildStatusMarkup = () => `
      <p
        id="budget-entries-popup-status"
        class="budget-entries-popup__status budget-entries-popup__status--muted"
      >
        Loading entries…
      </p>
    `;

    const fetchEntries = async () => {
      if (!isActive || !popup || popup.closed) {
        return;
      }
      const startDate = new Date(safeBudgetYear, row.monthNumber - 1, 1);
      const endDate = new Date(safeBudgetYear, row.monthNumber, 0);
      const params = new URLSearchParams();
      params.set("fromDate", startDate.toISOString().split("T")[0]);
      params.set("toDate", endDate.toISOString().split("T")[0]);
      for (const category of safeExpandedCategories) {
        params.append("category", category);
      }
      for (const account of accountsToFilter) {
        params.append("account", account);
      }
      params.set("limit", "500");
      try {
        const payload = await Rest.fetchJson(
          `/api/budget?${params.toString()}`
        );
        const entries = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.entries)
          ? payload.entries
          : [];
        latestEntries = entries;
        const tableMarkup = buildEntriesMarkup(entries);
        const editorMarkup = buildBudgetEntriesEditorMarkup(
          safeCategoryOptions,
          safeCurrencyOptions,
          safeAccountOptions
        );
        setPopupContent(
          `${tableMarkup}${editorMarkup}${BUDGET_ENTRIES_DELETE_CONFIRMATION_MARKUP}${buildStatusMarkup()}`
        );
        setStatusText(
          entries.length
            ? `Loaded ${entries.length} budget entr${
                entries.length === 1 ? "y" : "ies"
              }.`
            : `No budget entries found for ${row.monthLabel} ${safeBudgetYear}.`,
          entries.length ? "neutral" : "muted"
        );
        setTimeout(attachActionListeners, 0);
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

    const monitorPopup = () => {
      if (!popup || popup.closed) {
        notifyClose();
        if (closeMonitorId) {
          clearInterval(closeMonitorId);
          closeMonitorId = null;
        }
      }
    };

    closeMonitorId = window.setInterval(monitorPopup, 400);
    popup.addEventListener("beforeunload", notifyClose);

    fetchEntries();

    return () => {
      isActive = false;
      if (closeMonitorId) {
        clearInterval(closeMonitorId);
        closeMonitorId = null;
      }
      if (popup && !popup.closed) {
        popup.removeEventListener("beforeunload", notifyClose);
      }
    };
  }, [request]);

  return null;
};

export default BudgetEntriesBudgetPopup;
