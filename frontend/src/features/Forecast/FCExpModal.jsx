import "./FCModulesEdit.css";
import "./FCExpModal.css";

export default function FCExpModal({
  isOpen,
  editForm,
  editError,
  editSaving,
  onClose,
  onFieldChange,
  onSubmit,
  accountOptions = [],
  accountNameOptions = {},
}) {
  if (!isOpen) return null;
  const nameOptionsForAccount = accountNameOptions[editForm?.Account] || [];

  return (
    <div className="fc-scenarios-modal-overlay">
      <div className="fc-scenarios-modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="fc-scenarios-modal__title">Edit Entry</h3>
        <label className="fc-scenarios-modal__field fc-exp-modal__checkbox">
          <input
            type="checkbox"
            checked={Boolean(editForm?.Matched)}
            onChange={(e) => onFieldChange("Matched", e.target.checked)}
          />
          <span>Matched</span>
        </label>
        <div className="fc-scenarios-modal__field">
          <span>Account</span>
          <select
            className="form-input"
            value={editForm?.Account || ""}
            onChange={(e) => onFieldChange("Account", e.target.value)}
          >
            {accountOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="fc-scenarios-modal__field">
          <span>Name</span>
          {editForm?.Matched ? (
            <select
              className="form-input"
              value={editForm?.Name || ""}
              onChange={(e) => onFieldChange("Name", e.target.value)}
            >
              <option value="">Select name</option>
              {nameOptionsForAccount.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="form-input"
              type="text"
              value={editForm?.Name || ""}
              onChange={(e) => onFieldChange("Name", e.target.value)}
            />
          )}
        </div>
        <div className="fc-scenarios-modal__field">
          <span>Type</span>
          <input
            className="form-input"
            type="text"
            value={editForm?.Type || ""}
            onChange={(e) => onFieldChange("Type", e.target.value)}
          />
        </div>
        <div className="fc-scenarios-modal__field">
          <span>Currency</span>
          <input
            className="form-input"
            type="text"
            value={editForm?.Currency || ""}
            onChange={(e) => onFieldChange("Currency", e.target.value)}
          />
        </div>
        <div className="fc-scenarios-modal__field">
          <span>Base Date</span>
          <input
            className="form-input"
            type="date"
            value={editForm?.BaseDate || ""}
            onChange={(e) => onFieldChange("BaseDate", e.target.value)}
          />
        </div>
        <div className="fc-scenarios-modal__field">
          <span>Base Value</span>
          <input
            className="form-input"
            type="number"
            step="0.01"
            value={
              editForm?.BaseValue === null || editForm?.BaseValue === undefined
                ? ""
                : editForm.BaseValue
            }
            onChange={(e) => onFieldChange("BaseValue", e.target.value)}
          />
        </div>
        <div className="fc-scenarios-modal__field">
          <span>Base Value (USD)</span>
          <input
            className="form-input"
            type="number"
            step="0.01"
            value={
              editForm?.BaseValueUSD === null ||
              editForm?.BaseValueUSD === undefined
                ? ""
                : editForm.BaseValueUSD
            }
            onChange={(e) => onFieldChange("BaseValueUSD", e.target.value)}
          />
        </div>
        <div className="fc-scenarios-modal__field">
          <span>Growth (%)</span>
          <input
            className="form-input"
            type="number"
            step="0.01"
            value={
              editForm?.Growth === null || editForm?.Growth === undefined
                ? ""
                : editForm.Growth
            }
            onChange={(e) => onFieldChange("Growth", e.target.value)}
          />
        </div>
        {editError && (
          <div className="trans-budget-edit-modal__error">{editError}</div>
        )}
        <div className="fc-scenarios-modal__actions">
          <button
            type="button"
            className="fc-scenarios-action-button"
            onClick={onClose}
            disabled={editSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fc-scenarios-action-button fc-scenarios-action-button--primary"
            onClick={onSubmit}
            disabled={editSaving}
          >
            {editSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
