import {
  TransactionDateSelector,
  TRANSACTION_DESCRIPTION_FIELD_KEY,
} from "./TransactionTable.jsx";
import CategorySelector from "../../components/CategorySelector/CategorySelector.jsx";

/**
 * Shared edit modal for bulk editing transactions.
 * Displays a form for editing multiple selected transactions at once.
 */
export default function TransactionEditModal({
  config,
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
  plTree,
  onFieldChange,
  onCancel,
  onSubmit,
}) {
  if (!isOpen) {
    return null;
  }

  const { editFields } = config;

  const descriptionField = editFields.find(
    (field) => field.key === TRANSACTION_DESCRIPTION_FIELD_KEY
  );
  const categoryField = editFields.find((field) => field.key === "Category");
  const dataFields = editFields.filter(
    (field) =>
      field.key !== TRANSACTION_DESCRIPTION_FIELD_KEY &&
      field.key !== "Category"
  );

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
          <TransactionDateSelector
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
          {categoryField && plTree?.length > 0 ? (
            <label className="trans-budget-edit-modal__field trans-budget-edit-modal__field--full-row">
              <span>{categoryField.label}</span>
              <CategorySelector
                plTree={plTree}
                selectedCategories={
                  formValues.Category ? [formValues.Category] : []
                }
                onCategoriesChange={(selected) => {
                  const picked = selected.length > 0
                    ? selected[selected.length - 1]
                    : "";
                  onFieldChange("Category", picked);
                }}
                categoryGroupOptions={[]}
              />
            </label>
          ) : (
            categoryField &&
            renderEditField(
              categoryField,
              "trans-budget-edit-modal__field--full-row"
            )
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
