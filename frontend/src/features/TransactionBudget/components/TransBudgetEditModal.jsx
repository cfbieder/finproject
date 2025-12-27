import {
  TransactionBudgetDateSelector,
  TRANSACTION_DESCRIPTION_FIELD_KEY,
} from "../TransactionBudgetTable.jsx";
import { EDIT_FIELDS } from "../utils/transBudgetUtils.js";

/**
 * TransBudgetEditModal Component
 *
 * Modal for editing selected budget transactions.
 * Displays form fields for all editable transaction properties.
 * Supports batch editing with consensus value detection.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is visible
 * @param {number} props.selectedCount - Number of transactions to edit
 * @param {boolean} props.isEditing - Whether save is in progress
 * @param {string} props.error - Error message to display (if any)
 * @param {Object} props.formValues - Current form values
 * @param {Array<string>} props.categoryOptions - Available category values (raw)
 * @param {Array<string>} props.accountOptions - Available account values (raw)
 * @param {Array<string>} props.currencyOptions - Available currency values (raw)
 * @param {Array<string>} props.safeCategoryOptions - Normalized category options
 * @param {Array<string>} props.safeAccountOptions - Normalized account options
 * @param {Array<string>} props.safeCurrencyOptions - Normalized currency options
 * @param {Function} props.onFieldChange - Callback when field value changes (fieldKey, value)
 * @param {Function} props.onCancel - Callback when cancel is clicked
 * @param {Function} props.onSubmit - Callback when form is submitted (event)
 */
export default function TransBudgetEditModal({
  isOpen,
  selectedCount,
  isEditing,
  error,
  formValues,
  categoryOptions,
  accountOptions,
  currencyOptions,
  safeCategoryOptions,
  safeAccountOptions,
  safeCurrencyOptions,
  onFieldChange,
  onCancel,
  onSubmit,
}) {
  if (!isOpen) {
    return null;
  }

  const descriptionField = EDIT_FIELDS.find(
    (field) => field.key === TRANSACTION_DESCRIPTION_FIELD_KEY
  );
  const categoryField = EDIT_FIELDS.find((field) => field.key === "Category");
  const dataFields = EDIT_FIELDS.filter(
    (field) =>
      field.key !== TRANSACTION_DESCRIPTION_FIELD_KEY &&
      field.key !== "Category"
  );

  /**
   * Renders an edit form field (input, select, or date selector).
   * @param {Object} field - Field configuration object
   * @param {string} extraClass - Additional CSS class name
   * @returns {JSX.Element|null} Rendered field element
   */
  const renderEditField = (field, extraClass = "") => {
    if (!field) {
      return null;
    }
    const fieldValue = formValues[field.key] ?? "";
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
          <TransactionBudgetDateSelector
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
        {error && <p className="trans-budget-edit-modal__error">{error}</p>}
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
