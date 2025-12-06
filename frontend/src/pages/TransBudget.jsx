import { useCallback, useEffect, useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import TransactionBudgetFilter from "../features/TransactionBudget/TransactionBudgetFilter.jsx";
import TransactionBudgetTable, {
  TRANSACTION_DESCRIPTION_FIELD_KEY,
  useTransactionBudgetAccountOptions,
  useTransactionBudgetCategoryOptions,
  useTransactionBudgetCurrencyOptions,
  TransactionBudgetDateSelector,
  useTransactionBudgetExchangeRates,
  computeTransactionBudgetBaseAmount,
  DEFAULT_TRANSACTION_BASE_CURRENCY,
} from "../features/TransactionBudget/TransactionBudgetTable.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

const EDIT_FIELDS = [
  { key: "Date", label: "Date", type: "date" },
  { key: "Description1", label: "Description", type: "text" },
  { key: "Amount", label: "LC Amount", type: "number" },
  { key: "Currency", label: "Currency", type: "text" },
  { key: "BaseAmount", label: "USD Amount", type: "number" },
  { key: "Account", label: "Account", type: "text" },
  { key: "Category", label: "Category", type: "text" },
];
const DEFAULT_SORT = { key: "Date", direction: "desc" };
const SELECTION_COLUMN_KEY = "selected";

const getSortValue = (entry, key, meta = {}) => {
  if (!entry) {
    return null;
  }

  if (key === SELECTION_COLUMN_KEY) {
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

const createEditFieldMap = (initialValue) =>
  EDIT_FIELDS.reduce((map, field) => {
    map[field.key] = initialValue;
    return map;
  }, {});

const formatIsoInputDate = (value) => {
  if (!value) {
    return "";
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
};

const getComparableFieldValue = (entry, fieldKey) => {
  if (!entry) {
    return null;
  }
  if (fieldKey === "Date") {
    const date = parseEntryDate(entry);
    return date ? date.toISOString() : null;
  }
  const value = entry[fieldKey];
  if (value === undefined || value === null) {
    return null;
  }
  return value;
};

const getConsensusValue = (entries, fieldKey) => {
  if (!entries.length) {
    return null;
  }
  const reference = getComparableFieldValue(entries[0], fieldKey);
  for (let index = 1; index < entries.length; index += 1) {
    if (getComparableFieldValue(entries[index], fieldKey) !== reference) {
      return null;
    }
  }
  return reference;
};

const formatEditInputValue = (value, fieldType) => {
  if (value === null || value === undefined) {
    return "";
  }
  if (fieldType === "date") {
    return formatIsoInputDate(value);
  }
  if (fieldType === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  return String(value);
};

const parseEditFormValue = (rawValue, fieldType) => {
  const normalized = rawValue?.toString().trim() ?? "";
  if (!normalized) {
    return { valid: true, parsed: null };
  }
  if (fieldType === "number") {
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return { valid: false, parsed: null };
    }
    return { valid: true, parsed };
  }
  if (fieldType === "date") {
    const parsed = new Date(normalized);
    if (!Number.isFinite(parsed.getTime())) {
      return { valid: false, parsed: null };
    }
    return { valid: true, parsed };
  }
  return { valid: true, parsed: normalized };
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
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormValues, setEditFormValues] = useState(() =>
    createEditFieldMap("")
  );
  const [editTouchedFields, setEditTouchedFields] = useState(() =>
    createEditFieldMap(false)
  );
  const [editConsensusFields, setEditConsensusFields] = useState(() =>
    createEditFieldMap(false)
  );
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState("");

  const categoryOptions = useTransactionBudgetCategoryOptions();
  const accountOptions = useTransactionBudgetAccountOptions();
  const currencyOptions = useTransactionBudgetCurrencyOptions();
  const budgetRates = useTransactionBudgetExchangeRates();

  const safeCategoryOptions = useMemo(() => {
    const baseOptions = Array.isArray(categoryOptions) ? categoryOptions : [];
    const seen = new Set();
    const normalized = [];
    for (const option of baseOptions) {
      if (typeof option !== "string") {
        continue;
      }
      if (!seen.has(option)) {
        seen.add(option);
        normalized.push(option);
      }
    }
    const fallbackCategory = editFormValues.Category ?? "";
    if (
      fallbackCategory &&
      typeof fallbackCategory === "string" &&
      !seen.has(fallbackCategory)
    ) {
      normalized.push(fallbackCategory);
    }
    return normalized;
  }, [categoryOptions, editFormValues.Category]);

  const safeAccountOptions = useMemo(() => {
    const baseOptions = Array.isArray(accountOptions) ? accountOptions : [];
    const seen = new Set();
    const normalized = [];
    for (const option of baseOptions) {
      if (typeof option !== "string") {
        continue;
      }
      if (!seen.has(option)) {
        seen.add(option);
        normalized.push(option);
      }
    }
    const fallbackAccount = editFormValues.Account ?? "";
    if (
      fallbackAccount &&
      typeof fallbackAccount === "string" &&
      !seen.has(fallbackAccount)
    ) {
      normalized.push(fallbackAccount);
    }
    return normalized;
  }, [accountOptions, editFormValues.Account]);

  const safeCurrencyOptions = useMemo(() => {
    const baseOptions = Array.isArray(currencyOptions) ? currencyOptions : [];
    const normalized = new Map();
    for (const option of baseOptions) {
      if (typeof option !== "string") {
        continue;
      }
      const trimmed = option.trim();
      if (!trimmed) {
        continue;
      }
      const key = trimmed.toUpperCase();
      if (!normalized.has(key)) {
        normalized.set(key, trimmed);
      }
    }
    const fallbackCurrency = editFormValues.Currency;
    if (
      typeof fallbackCurrency === "string" &&
      fallbackCurrency.trim()
    ) {
      const fallbackKey = fallbackCurrency.trim().toUpperCase();
      if (!normalized.has(fallbackKey)) {
        normalized.set(fallbackKey, fallbackCurrency.trim());
      }
    }
    return Array.from(normalized.values());
  }, [currencyOptions, editFormValues.Currency]);

  const loadTransactions = useCallback(async (signal) => {
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
  }, []);

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

  const handleEditRequest = useCallback(() => {
    if (!selectedRows.size) {
      return;
    }
    const entries = Array.from(selectedRows.values());
    const nextValues = {};
    const nextConsensus = {};
    for (const field of EDIT_FIELDS) {
      const consensus = getConsensusValue(entries, field.key);
      nextConsensus[field.key] = consensus !== null && consensus !== undefined;
      nextValues[field.key] = formatEditInputValue(consensus, field.type);
    }
    setEditFormValues(nextValues);
    setEditTouchedFields(createEditFieldMap(false));
    setEditConsensusFields(nextConsensus);
    setEditError("");
    setShowEditModal(true);
  }, [selectedRows]);

  const handleEditFieldChange = (fieldKey, value) => {
    setEditFormValues((previous) => ({
      ...previous,
      [fieldKey]: value,
    }));
    setEditTouchedFields((previous) => ({
      ...previous,
      [fieldKey]: true,
    }));
  };

  const descriptionField = EDIT_FIELDS.find(
    (field) => field.key === TRANSACTION_DESCRIPTION_FIELD_KEY
  );
  const categoryField = EDIT_FIELDS.find((field) => field.key === "Category");
  const dataFields = EDIT_FIELDS.filter(
    (field) =>
      field.key !== TRANSACTION_DESCRIPTION_FIELD_KEY &&
      field.key !== "Category"
  );

  const renderEditField = (field, extraClass = "") => {
    if (!field) {
      return null;
    }
    const fieldValue = editFormValues[field.key] ?? "";
    const isCategoryField = field.key === "Category";
    const isAccountField = field.key === "Account";
    const isCurrencyField = field.key === "Currency";
    const isSelectField = isCategoryField || isAccountField || isCurrencyField;
    let selectOptions = [];
    let placeholderMessage = "";
    if (isSelectField) {
      selectOptions = isCategoryField
        ? safeCategoryOptions
        : isAccountField
          ? safeAccountOptions
          : safeCurrencyOptions;
      placeholderMessage = isCategoryField
        ? categoryOptions.length
          ? "Select category"
          : "Loading categories..."
        : isAccountField
          ? accountOptions.length
            ? "Select account"
            : "Loading accounts..."
          : currencyOptions.length
            ? "Select currency"
            : "Loading currencies...";
    }
    const isDateField = field.type === "date";
    const isBaseAmountField = field.key === "BaseAmount";
    const className = ["trans-budget-edit-modal__field", extraClass]
      .filter(Boolean)
      .join(" ");

    return (
      <label key={field.key} className={className}>
        <span>{field.label}</span>
        {isSelectField ? (
          <select
            className="form-input"
            name={field.key}
            value={fieldValue}
            onChange={(event) =>
              handleEditFieldChange(field.key, event.target.value)
            }
            disabled={isEditing}
          >
            <option value="">{placeholderMessage}</option>
            {selectOptions.map((option) => (
              <option value={option} key={option}>
                {option}
              </option>
            ))}
          </select>
        ) : isDateField ? (
          <TransactionBudgetDateSelector
            value={fieldValue}
            onChange={(nextValue) =>
              handleEditFieldChange(field.key, nextValue)
            }
            disabled={isEditing}
          />
        ) : (
          <input
            className="form-input"
            type={field.type}
            name={field.key}
            value={fieldValue}
            placeholder={field.type === "date" ? "yyyy-mm-dd" : undefined}
            inputMode={field.type === "number" ? "decimal" : undefined}
            step={field.type === "number" ? "any" : undefined}
            onChange={(event) =>
              handleEditFieldChange(field.key, event.target.value)
            }
            disabled={isEditing}
            readOnly={isBaseAmountField}
            aria-readonly={isBaseAmountField ? "true" : undefined}
            autoComplete="off"
          />
        )}
      </label>
    );
  };

  const amountInputValue = editFormValues.Amount;
  const currencyInputValue = editFormValues.Currency;

  useEffect(() => {
    const derivedBaseAmount = computeTransactionBudgetBaseAmount(
      amountInputValue,
      currencyInputValue,
      budgetRates,
      DEFAULT_TRANSACTION_BASE_CURRENCY
    );
    const nextBaseValue = Number.isFinite(derivedBaseAmount)
      ? String(derivedBaseAmount)
      : "";
    setEditFormValues((previous) => {
      if (previous.BaseAmount === nextBaseValue) {
        return previous;
      }
      return { ...previous, BaseAmount: nextBaseValue };
    });
  }, [amountInputValue, currencyInputValue, budgetRates]);

  const buildEditPayload = () => {
    const payload = {};
    for (const field of EDIT_FIELDS) {
      const shouldInclude =
        editTouchedFields[field.key] || editConsensusFields[field.key];
      if (!shouldInclude) {
        continue;
      }
      const { valid, parsed } = parseEditFormValue(
        editFormValues[field.key],
        field.type
      );
      if (!valid) {
        return {
          payload: null,
          error: `Invalid ${field.label.toLowerCase()} value.`,
        };
      }
      if (parsed === null) {
        continue;
      }
      payload[field.key] = parsed;
    }

    const shouldRecalculateBaseAmount =
      payload.Amount !== undefined || payload.Currency !== undefined;

    if (shouldRecalculateBaseAmount) {
      const derivedBaseAmount = computeTransactionBudgetBaseAmount(
        editFormValues.Amount,
        editFormValues.Currency,
        budgetRates,
        DEFAULT_TRANSACTION_BASE_CURRENCY
      );
      if (Number.isFinite(derivedBaseAmount)) {
        payload.BaseAmount = derivedBaseAmount;
      } else if (payload.BaseAmount !== undefined) {
        delete payload.BaseAmount;
      }
    }

    return { payload, error: null };
  };

  const handleEditCancel = () => {
    if (isEditing) {
      return;
    }
    setShowEditModal(false);
    setEditError("");
  };

  const handleEditSubmit = async (event) => {
    event.preventDefault();
    if (!selectedRows.size) {
      return;
    }
    const { payload, error: payloadError } = buildEditPayload();
    if (payloadError) {
      setEditError(payloadError);
      return;
    }
    if (!payload || !Object.keys(payload).length) {
      setEditError("Please make a change before saving.");
      return;
    }
    setIsEditing(true);
    setEditError("");
    try {
      await Promise.all(
        Array.from(selectedRows.values()).map((entry) => {
          const id = entry?._id;
          if (!id) {
            throw new Error("Some selected entries cannot be edited.");
          }
          return fetch(Rest.buildUrl(`/api/budget/${id}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).then(async (response) => {
            if (!response.ok) {
              const responseBody = await response.json().catch(() => null);
              throw new Error(responseBody?.error || "Failed to update entry");
            }
            return response.json().catch(() => null);
          });
        })
      );
      setShowEditModal(false);
      setSelectedRows(new Map());
      await loadTransactions();
    } catch (err) {
      console.error("[TransBudget] Failed to update entries:", err);
      setEditError(err?.message ?? "Failed to update selected entries");
    } finally {
      setIsEditing(false);
    }
  };

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
    const hasAccountFilter = !!(accountEnabled && normalizedAccount.length > 0);
    const hasCategoryFilter = !!(
      categoryEnabled && normalizedCategory.length > 0
    );
    const hasBaseFromFilter =
      valueFromEnabled &&
      typeof valueFrom === "number" &&
      Number.isFinite(valueFrom);
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
        const baseValue =
          typeof entryBase === "number" ? entryBase : Number(entryBase);
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

  const hasTransactions = transactions.length > 0;
  const hasFilteredTransactions = normalizedTransactions.length > 0;

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        <TransactionBudgetFilter
          onFiltersChange={handleFilterChange}
          onDeleteClick={handleDeleteRequest}
          onEditClick={handleEditRequest}
          onSelectAllToggle={handleSelectAllToggle}
          canDelete={selectedRows.size > 0}
          canEdit={selectedRows.size > 0}
          isAllSelected={isAllSelected}
        />
        <TransactionBudgetTable
          isLoading={isLoading}
          error={error}
          hasTransactions={hasTransactions}
          hasFilteredTransactions={hasFilteredTransactions}
          sortedTransactions={sortedTransactions}
          sortConfig={sortConfig}
          onSort={handleSort}
          onRowToggle={toggleRowSelection}
        />
        {showEditModal && (
          <div
            className="trans-budget-edit-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${selectedRows.size} selected transaction${
              selectedRows.size === 1 ? "" : "s"
            }`}
          >
            <div className="trans-budget-edit-modal">
              <h3>Edit selected transactions</h3>
              <p className="trans-budget-edit-modal__count">
                Updating {selectedRows.size} transaction
                {selectedRows.size === 1 ? "" : "s"}.
              </p>
              {editError && (
                <p className="trans-budget-edit-modal__error">{editError}</p>
              )}
              <form onSubmit={handleEditSubmit}>
                <div className="trans-budget-edit-modal__grid">
                  {dataFields.map((field) =>
                    renderEditField(
                      field,
                      field.type === "date"
                        ? "trans-budget-edit-modal__field--full-row"
                        : ""
                    )
                  )}
                </div>
                {categoryField &&
                  renderEditField(
                    categoryField,
                    "trans-budget-edit-modal__field--full-row"
                  )}
                {descriptionField &&
                  renderEditField(
                    descriptionField,
                    "trans-budget-edit-modal__field--full-row"
                  )}
                <div className="trans-budget-edit-modal__actions">
                  <button
                    className="generate-report-button"
                    type="button"
                    onClick={handleEditCancel}
                    disabled={isEditing}
                  >
                    Cancel
                  </button>
                  <button
                    className="generate-report-button"
                    type="submit"
                    disabled={isEditing}
                  >
                    {isEditing ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
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
