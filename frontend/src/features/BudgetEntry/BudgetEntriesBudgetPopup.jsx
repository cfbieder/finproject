import { useEffect, useRef, useState } from "react";
import Rest from "../../js/rest.js";
import "./BudgetEntriesBudgetPopup.css";

// Utility helpers for formatting values
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

const BUDGET_ENTRY_SORTABLE_COLUMNS = [
  { key: "Date", label: "Date" },
  { key: "Description", label: "Description" },
  { key: "Account", label: "Account" },
  { key: "Category", label: "Category" },
  { key: "Amount", label: "Amount" },
  { key: "BaseAmount", label: "Base Amount" },
  { key: "Currency", label: "Currency" },
  { key: "BaseCurrency", label: "Base Currency" },
  { key: "Note", label: "Note" },
];

const getBudgetEntrySortValue = (entry, key) => {
  if (!entry) {
    return "";
  }
  switch (key) {
    case "Date": {
      const parsed = entry.Date ? new Date(entry.Date) : null;
      return parsed && Number.isFinite(parsed.getTime())
        ? parsed.getTime()
        : Number.NEGATIVE_INFINITY;
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
    case "Currency":
      return (entry.Currency ?? "").toLowerCase();
    case "BaseCurrency":
      return (entry.BaseCurrency ?? "").toLowerCase();
    case "Note":
      return (entry.Note ?? "").toLowerCase();
    default:
      return "";
  }
};

const compareBudgetEntries = (a, b, key) => {
  const valueA = getBudgetEntrySortValue(a, key);
  const valueB = getBudgetEntrySortValue(b, key);
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

const sortBudgetEntries = (entries, sortState) => {
  if (!Array.isArray(entries)) {
    return [];
  }
  const sorted = [...entries];
  sorted.sort((a, b) => {
    const comparison = compareBudgetEntries(a, b, sortState.key);
    return sortState.direction === "asc" ? comparison : -comparison;
  });
  return sorted;
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

  return parsedAmount / rate;
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

// React component that displays budget entries in a modal dialog
const BudgetEntriesBudgetPopup = ({ request }) => {
  const [entries, setEntries] = useState([]);
  const [sortState, setSortState] = useState({
    key: BUDGET_ENTRY_SORTABLE_COLUMNS[0].key,
    direction: "desc",
  });
  const [statusMessage, setStatusMessage] = useState("Loading entries…");
  const [statusType, setStatusType] = useState("muted");
  const pendingDeleteEntryIdRef = useRef(null);
  const modalRef = useRef(null);
  const contentRef = useRef(null);

  const {
    row,
    budgetYear,
    selectedAccounts,
    expandedCategories,
    onClose,
    categoryOptions,
    currencyOptions,
    accountOptions,
  } = request || {};

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
      !BUDGET_ENTRY_SORTABLE_COLUMNS.some(
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

  const syncEditorBaseAmountField = () => {
    if (!contentRef.current) {
      return undefined;
    }
    const editorForm = contentRef.current.querySelector(
      "#budget-entries-popup-editor-form"
    );
    const baseAmountInput = contentRef.current.querySelector(
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

  const buildEntriesMarkup = (entries, sortState) => {
    const sortedEntries = sortBudgetEntries(entries, sortState);
    const headerCells = BUDGET_ENTRY_SORTABLE_COLUMNS.map((column) => {
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
    });

    const rowsHtml = sortedEntries.length
      ? sortedEntries
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
              ${headerCells.join("")}
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

  const buildEditorMarkup = () =>
    buildBudgetEntriesEditorMarkup(
      safeCategoryOptions,
      safeCurrencyOptions,
      safeAccountOptions
    );

  const buildStatusMarkup = () => `
    <p
      id="budget-entries-popup-status"
      class="budget-entries-popup__status budget-entries-popup__status--${statusType}"
    >
      ${escapeHtml(statusMessage)}
    </p>
  `;

  const hideEditor = () => {
    if (!contentRef.current) {
      return;
    }
    const editor = contentRef.current.querySelector(
      "#budget-entries-popup-editor"
    );
    const editorForm = contentRef.current.querySelector(
      "#budget-entries-popup-editor-form"
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
    if (!contentRef.current) {
      return;
    }
    const entry = entries.find(
      (candidate) => String(candidate._id) === String(entryId)
    );
    if (!entry) {
      return;
    }

    const editor = contentRef.current.querySelector(
      "#budget-entries-popup-editor"
    );
    const editorForm = contentRef.current.querySelector(
      "#budget-entries-popup-editor-form"
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
          documentRef: document,
        });
      } else {
        accountSelect.value = "";
      }
    }
    const categorySelect = editorForm.querySelector("[name='category']");
    if (categorySelect) {
      setSelectValueSafely(categorySelect, entry.Category ?? "", {
        documentRef: document,
      });
    }
    const currencySelect = editorForm.querySelector("[name='currency']");
    if (currencySelect) {
      setSelectValueSafely(currencySelect, entry.Currency ?? "", {
        documentRef: document,
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
    setStatusMessage(`Editing ${escapeHtml(entry.Description1 ?? "budget entry")}…`);
    setStatusType("neutral");
  };

  const fetchEntries = async () => {
    if (!row?.monthNumber) {
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
      // Using v2 API (PostgreSQL)
      const payload = await Rest.fetchJson(
        `/api/v2/budget?${params.toString()}`
      );
      const fetchedEntries = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.entries)
        ? payload.entries
        : [];
      setEntries(fetchedEntries);
      setStatusMessage(
        fetchedEntries.length
          ? `Loaded ${fetchedEntries.length} budget entr${
              fetchedEntries.length === 1 ? "y" : "ies"
            }.`
          : `No budget entries found for ${row.monthLabel} ${safeBudgetYear}.`
      );
      setStatusType(fetchedEntries.length ? "neutral" : "muted");
    } catch (error) {
      console.error("[BudgetEntriesBudgetPopup] Failed to load entries:", error);
      setStatusMessage(
        error?.message ?? "An unexpected error occurred."
      );
      setStatusType("error");
    }
  };

  const submitEditorPayload = async (event) => {
    event.preventDefault();
    if (!contentRef.current) {
      return;
    }
    const editorForm = contentRef.current.querySelector(
      "#budget-entries-popup-editor-form"
    );
    if (!editorForm) {
      return;
    }

    const entryId = editorForm.dataset.budgetEntryId;
    if (!entryId) {
      setStatusMessage("Select an entry before saving.");
      setStatusType("error");
      return;
    }

    const payload = {};
    const dateMonthValue = editorForm.querySelector("[name='dateMonth']")?.value;
    const dateYearValue = editorForm.querySelector("[name='dateYear']")?.value;
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
      setStatusMessage("No changes detected.");
      setStatusType("error");
      return;
    }

    try {
      // Using v2 API (PostgreSQL)
      await Rest.fetchJson(`/api/v2/budget/entries/${entryId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      setStatusMessage("Budget entry updated.");
      setStatusType("success");
      fetchEntries();
      hideEditor();
    } catch (error) {
      setStatusMessage(error?.message || "Unable to update the budget entry.");
      setStatusType("error");
    }
  };

  const deleteEntryById = async (entryId) => {
    if (!entryId) {
      return;
    }
    try {
      console.log('[BudgetEntriesBudgetPopup] Deleting entry:', entryId);
      // Using v2 API (PostgreSQL)
      await Rest.fetchJson(`/api/v2/budget/entries/${entryId}`, {
        method: "DELETE",
      });
      console.log('[BudgetEntriesBudgetPopup] Entry deleted, refreshing list...');
      setStatusMessage("Budget entry deleted.");
      setStatusType("success");
      hideEditor();
      await fetchEntries();
      console.log('[BudgetEntriesBudgetPopup] List refreshed');
      handleClose();
    } catch (error) {
      console.error('[BudgetEntriesBudgetPopup] Delete error:', error);
      setStatusMessage(error?.message || "Unable to delete the budget entry.");
      setStatusType("error");
    }
  };

  const showDeleteConfirmation = (entryId, summary) => {
    if (!entryId || !contentRef.current) {
      return;
    }
    const confirmationPanel = contentRef.current.querySelector(
      "#budget-entries-popup-delete-confirmation"
    );
    if (!confirmationPanel) {
      return;
    }
    pendingDeleteEntryIdRef.current = entryId;
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
    if (!contentRef.current) {
      return;
    }
    const confirmationPanel = contentRef.current.querySelector(
      "#budget-entries-popup-delete-confirmation"
    );
    if (!confirmationPanel) {
      return;
    }
    confirmationPanel.classList.remove(
      "budget-entries-popup__delete-confirmation--visible"
    );
  };

  const confirmPendingDeleteEntry = async () => {
    const entryId = pendingDeleteEntryIdRef.current;
    hideDeleteConfirmation();
    pendingDeleteEntryIdRef.current = null;
    if (!entryId) {
      return;
    }
    await deleteEntryById(entryId);
  };

  const cancelPendingDelete = () => {
    hideDeleteConfirmation();
    pendingDeleteEntryIdRef.current = null;
  };

  const handleDeleteEntry = (entryId, summary) => {
    console.log('[BudgetEntriesBudgetPopup] Delete button clicked:', entryId, summary);
    if (!entryId) {
      return;
    }
    showDeleteConfirmation(entryId, summary);
  };

  const attachActionListeners = () => {
    if (!contentRef.current) {
      return;
    }

    const editButtons = contentRef.current.querySelectorAll(
      "[data-budget-entry-edit]"
    );
    editButtons.forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        startEditEntry(button.dataset.budgetEntryEdit);
      };
    });

    const deleteButtons = contentRef.current.querySelectorAll(
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

    const sortButtons = contentRef.current.querySelectorAll("[data-sort-key]");
    sortButtons.forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        handleSortChange(button.dataset.sortKey);
      };
    });

    const deleteConfirmation = contentRef.current.querySelector(
      "#budget-entries-popup-delete-confirmation"
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

    const editorForm = contentRef.current.querySelector(
      "#budget-entries-popup-editor-form"
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

    const cancelButton = contentRef.current.querySelector(
      '[data-budget-entry-editor-action="cancel"]'
    );
    if (cancelButton) {
      cancelButton.onclick = (event) => {
        event.preventDefault();
        hideEditor();
      };
    }
  };

  useEffect(() => {
    if (request?.row) {
      fetchEntries();
    }
  }, [request]);

  useEffect(() => {
    if (contentRef.current) {
      const fullMarkup = `
        ${buildEntriesMarkup(entries, sortState)}
        ${buildEditorMarkup()}
        ${BUDGET_ENTRIES_DELETE_CONFIRMATION_MARKUP}
        ${buildStatusMarkup()}
      `;
      contentRef.current.innerHTML = fullMarkup;
      attachActionListeners();
    }
  }, [entries, sortState, statusMessage, statusType]);

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

  const heading = `Budget entries for ${row.monthLabel} ${safeBudgetYear}`;

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

export default BudgetEntriesBudgetPopup;
