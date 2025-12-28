import { useEffect } from "react";
import {
  TRANSACTION_DESCRIPTION_FIELD_KEY,
  TransactionActualDateSelector,
  computeTransactionActualBaseAmount,
  DEFAULT_TRANSACTION_BASE_CURRENCY,
} from "./TransactionActualTable.jsx";

/**
 * Edit modal for bulk editing actual transactions.
 * Displays a form for editing multiple selected transactions at once.
 *
 * @component
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {number} props.selectedCount - Number of selected transactions
 * @param {Array} props.editFields - Field configuration array
 * @param {Object} props.editFormValues - Current form values
 * @param {Object} props.safeCategoryOptions - Available category options
 * @param {Object} props.safeAccountOptions - Available account options
 * @param {Object} props.safeCurrencyOptions - Available currency options
 * @param {Array} props.categoryOptions - Raw category options for placeholder
 * @param {Array} props.accountOptions - Raw account options for placeholder
 * @param {Array} props.currencyOptions - Raw currency options for placeholder
 * @param {Object} props.actualRates - Exchange rates
 * @param {boolean} props.isEditing - Whether save is in progress
 * @param {string} props.editError - Error message
 * @param {Function} props.onFieldChange - Field change callback
 * @param {Function} props.onCancel - Cancel callback
 * @param {Function} props.onSubmit - Submit callback
 * @param {Function} props.setEditFormValues - Direct form values setter for BaseAmount
 * @returns {JSX.Element|null} Edit modal or null if not open
 */
export default function TransActualEditModal({
  isOpen,
  selectedCount,
  editFields,
  editFormValues,
  safeCategoryOptions,
  safeAccountOptions,
  safeCurrencyOptions,
  categoryOptions,
  accountOptions,
  currencyOptions,
  actualRates,
  isEditing,
  editError,
  onFieldChange,
  onCancel,
  onSubmit,
  setEditFormValues,
}) {
  if (!isOpen) {
    return null;
  }

  const descriptionField = editFields.find(
    (field) => field.key === TRANSACTION_DESCRIPTION_FIELD_KEY
  );
  const categoryField = editFields.find((field) => field.key === "Category");
  const dataFields = editFields.filter(
    (field) =>
      field.key !== TRANSACTION_DESCRIPTION_FIELD_KEY &&
      field.key !== "Category"
  );

  const amountInputValue = editFormValues.Amount;
  const currencyInputValue = editFormValues.Currency;

  // Auto-calculate BaseAmount when Amount or Currency changes
  useEffect(() => {
    const derivedBaseAmount = computeTransactionActualBaseAmount(
      amountInputValue,
      currencyInputValue,
      actualRates,
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
  }, [amountInputValue, currencyInputValue, actualRates, setEditFormValues]);

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
            onChange={(event) => onFieldChange(field.key, event.target.value)}
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
          <TransactionActualDateSelector
            value={fieldValue}
            onChange={(nextValue) => onFieldChange(field.key, nextValue)}
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
            onChange={(event) => onFieldChange(field.key, event.target.value)}
            disabled={isEditing}
            readOnly={isBaseAmountField}
            aria-readonly={isBaseAmountField ? "true" : undefined}
            autoComplete="off"
          />
        )}
      </label>
    );
  };

  return (
    <div
      className="trans-budget-edit-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${selectedCount} selected transaction${
        selectedCount === 1 ? "" : "s"
      }`}
    >
      <div className="trans-budget-edit-modal">
        <h3>Edit selected transactions</h3>
        <p className="trans-budget-edit-modal__count">
          Updating {selectedCount} transaction
          {selectedCount === 1 ? "" : "s"}.
        </p>
        {editError && (
          <p className="trans-budget-edit-modal__error">{editError}</p>
        )}
        <form onSubmit={onSubmit}>
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
              onClick={onCancel}
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
  );
}
