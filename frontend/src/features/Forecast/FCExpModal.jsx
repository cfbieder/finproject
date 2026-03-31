import { useEffect } from "react";
import "./FCModulesEdit.css";
import "./FCExpModal.css";
import Rest from "../../js/rest.js";
/**
 * FCExpModal - Edit modal for forecast income/expense entries
 *
 * Comprehensive form for editing forecast entries with:
 * - Account and Name selection (matched vs unmatched modes)
 * - Base value auto-loading from historical cash flow data
 * - Growth rate configuration
 * - Periodic changes/adjustments (fixed dollar or percentage)
 *
 * @component
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether the modal is visible
 * @param {Object} props.editForm - Form data for the entry being edited
 * @param {string} props.editError - Error message to display
 * @param {boolean} props.editSaving - Whether save operation is in progress
 * @param {Function} props.onClose - Callback to close the modal
 * @param {Function} props.onFieldChange - Callback when a field changes
 * @param {Function} props.onSubmit - Callback to save the entry
 * @param {Array} props.accountOptions - List of available account names
 * @param {Object} props.accountNameOptions - Map of accounts to their leaf names
 * @param {Array} props.periodYears - Years in the forecast period
 * @returns {JSX.Element|null} The edit modal or null if not open
 */
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
  periodYears = [],
}) {
  if (!isOpen) return null;

  // Available names for the selected account (from COA hierarchy)
  const nameOptionsForAccount = accountNameOptions[editForm?.Account] || [];

  // Extract year from base date for display
  const baseYear = (editForm?.BaseDate || "").slice(0, 4);

  // Normalize changes array
  const changes = Array.isArray(editForm?.Changes) ? editForm.Changes : [];

  // Format base value for display
  const baseValueNumber = Number(editForm?.BaseValue);
  const baseValueDisplay = Number.isFinite(baseValueNumber)
    ? (() => {
        const abs = Math.abs(baseValueNumber).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        return baseValueNumber < 0 ? `(${abs})` : abs;
      })()
    : "";
  const baseValueNegative =
    Number.isFinite(baseValueNumber) && baseValueNumber < 0;

  // Format base value USD for display (with accounting notation for negatives)
  const baseValueUsdNumber = Number(editForm?.BaseValueUSD);
  const baseValueUsdDisplay = Number.isFinite(baseValueUsdNumber)
    ? (() => {
        const abs = Math.abs(baseValueUsdNumber).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        return baseValueUsdNumber < 0 ? `(${abs})` : abs;
      })()
    : "";
  const baseValueUsdNegative =
    Number.isFinite(baseValueUsdNumber) && baseValueUsdNumber < 0;

  /**
   * Format change amount based on flag type
   * @param {number} amount - Amount value
   * @param {string} flag - Type flag ("Fixed $", "Percent %", or "One-Off $")
   * @returns {string} Formatted amount string
   */
  const formatChangeAmount = (amount, flag) => {
    const num = Number(amount);
    if (!Number.isFinite(num)) return "";
    if (flag === "Percent %") {
      return `${num.toFixed(2)}%`;
    }
    const abs = Math.abs(num).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return num < 0 ? `($${abs})` : `$${abs}`;
  };

  /**
   * Update a specific field in a change entry
   * @param {number} index - Index of the change to update
   * @param {string} field - Field name to update
   * @param {any} value - New value
   */
  const updateChangeField = (index, field, value) => {
    const next = changes.map((change, i) =>
      i === index ? { ...change, [field]: value } : change
    );
    onFieldChange("Changes", next);
  };

  /**
   * Add a new change row with default values
   */
  const addChangeRow = () => {
    onFieldChange("Changes", [
      ...changes,
      {
        Date:
          periodYears && periodYears.length ? `${periodYears[0]}-12-31` : "",
        Amount: 0,
        Flag: "Fixed $",
      },
    ]);
  };

  /**
   * Remove a change row by index
   * @param {number} index - Index of the change to remove
   */
  const removeChangeRow = (index) => {
    const next = changes.filter((_, i) => i !== index);
    onFieldChange("Changes", next);
  };

  /**
   * Effect: Auto-load base year totals when in Matched mode.
   * If item has fc_line_id, uses budget-totals API (recursive children included).
   * Otherwise falls back to cash flow report lookup by name.
   */
  useEffect(() => {
    let cancelled = false;
    const year = (editForm?.BaseDate || "").slice(0, 4);
    if (!isOpen || !editForm?.Matched || !year || !editForm?.Name)
      return undefined;

    const normalizeNumber = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    const findCategoryTotals = (nodes, targets = []) => {
      if (!Array.isArray(nodes)) return null;
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        if (targets.includes(node.name)) {
          return {
            local: normalizeNumber(node.total),
            usd: normalizeNumber(
              node.totalUSD !== undefined && node.totalUSD !== null
                ? node.totalUSD
                : node.total
            ),
          };
        }
        const found = findCategoryTotals(node.children, targets);
        if (found) return found;
      }
      return null;
    };

    const loadBaseYearTotals = async () => {
      try {
        // If linked to an FC Line, use budget-totals API (includes recursive children)
        if (editForm?.FcLineId) {
          const budgetRes = await Rest.get(`/fc-lines/budget-totals?budgetYear=${year}`);
          if (cancelled) return;
          const match = (budgetRes.data || []).find((t) => t.fc_line_id === editForm.FcLineId);
          if (match) {
            const val = normalizeNumber(match.budget_total);
            if (val !== null && val !== normalizeNumber(editForm?.BaseValue)) {
              onFieldChange("BaseValue", val);
            }
            if (val !== null && val !== normalizeNumber(editForm?.BaseValueUSD)) {
              onFieldChange("BaseValueUSD", val);
            }
          }
          return;
        }

        // Fallback: search P&L report by name
        const fromDate = `${year}-01-01`;
        const toDate = `${year}-12-31`;
        const report = await Rest.fetchCashFlowReport({
          fromDate,
          toDate,
          transfers: "exclude",
          includeUnrealizedGL: false,
        });
        if (cancelled) return;
        const isAll = editForm?.Name === "All";
        const targets = Array.from(
          new Set(
            isAll
              ? [editForm?.Account].filter(Boolean)
              : [editForm?.Name].filter(Boolean)
          )
        );
        const totals = findCategoryTotals(report, targets);
        if (!totals) return;

        if (
          totals.local !== null &&
          totals.local !== normalizeNumber(editForm?.BaseValue)
        ) {
          onFieldChange("BaseValue", totals.local);
        }
        if (
          totals.usd !== null &&
          totals.usd !== normalizeNumber(editForm?.BaseValueUSD)
        ) {
          onFieldChange("BaseValueUSD", totals.usd);
        }
      } catch (error) {
        console.error("Failed to load base year totals:", error);
      }
    };

    loadBaseYearTotals();
    return () => {
      cancelled = true;
    };
  }, [
    editForm?.Account,
    editForm?.BaseDate,
    editForm?.Matched,
    editForm?.Name,
    isOpen,
    onFieldChange,
  ]);

  return (
    <div className="fc-exp-modal-overlay">
      <div className="fc-exp-modal" onClick={(event) => event.stopPropagation()}>
        {/* Header */}
        <div className="fc-exp-modal__header">
          <div className="fc-exp-modal__header-content">
            <div className="fc-exp-modal__icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15M9 5C9 6.10457 9.89543 7 11 7H13C14.1046 7 15 6.10457 15 5M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5M12 12H15M12 16H15M9 12H9.01M9 16H9.01"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h3 className="fc-exp-modal__title">Edit Forecast Entry</h3>
              <p className="fc-exp-modal__subtitle">
                Update income/expense forecast details
              </p>
            </div>
          </div>
          <button
            className="fc-exp-modal__close"
            onClick={onClose}
            disabled={editSaving}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 18L18 6M6 6L18 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="fc-exp-modal__body">
          {/* Basic Information Section */}
          <div className="fc-exp-modal__section">
            <div className="fc-exp-modal__section-header">
              <h4 className="fc-exp-modal__section-title">Basic Information</h4>
            </div>

            <div className="fc-exp-modal__fields-grid">
              {/* Matched Toggle */}
              <div className="fc-exp-modal__field fc-exp-modal__field--full">
                <label className="fc-exp-modal__toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(editForm?.Matched)}
                    onChange={(e) => !editForm?.FcLineId && onFieldChange("Matched", e.target.checked)}
                    disabled={Boolean(editForm?.FcLineId)}
                    className="fc-exp-modal__toggle-input"
                  />
                  <span className="fc-exp-modal__toggle-slider"></span>
                  <span className="fc-exp-modal__toggle-label">
                    <span className="fc-exp-modal__toggle-text">
                      Match to Chart of Accounts
                    </span>
                    <span className="fc-exp-modal__toggle-hint">
                      {editForm?.Matched
                        ? "Values auto-loaded from historical data"
                        : "Manual entry mode"}
                    </span>
                  </span>
                </label>
              </div>

              {/* Account */}
              <div className="fc-exp-modal__field">
                <label className="fc-exp-modal__label">Account</label>
                {editForm?.FcLineId ? (
                  <input
                    className="fc-exp-modal__input"
                    value={editForm?.Account || ""}
                    readOnly
                    disabled
                  />
                ) : (
                  <select
                    className="fc-exp-modal__input"
                    value={editForm?.Account || ""}
                    onChange={(e) => onFieldChange("Account", e.target.value)}
                  >
                    {accountOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Name */}
              <div className="fc-exp-modal__field">
                <label className="fc-exp-modal__label">Name</label>
                {editForm?.FcLineId ? (
                  <input
                    className="fc-exp-modal__input"
                    value={editForm?.Name || ""}
                    readOnly
                    disabled
                  />
                ) : editForm?.Matched ? (
                  <select
                    className="fc-exp-modal__input"
                    value={editForm?.Name || ""}
                    onChange={(e) => onFieldChange("Name", e.target.value)}
                  >
                    <option value="All">All</option>
                    {nameOptionsForAccount.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="fc-exp-modal__input"
                    type="text"
                    value={editForm?.Name || ""}
                    onChange={(e) => onFieldChange("Name", e.target.value)}
                    placeholder="Enter name"
                  />
                )}
              </div>

              {/* Type */}
              <div className="fc-exp-modal__field">
                <label className="fc-exp-modal__label">Type</label>
                <input
                  className="fc-exp-modal__input"
                  type="text"
                  value={editForm?.Type || ""}
                  onChange={(e) => !editForm?.FcLineId && onFieldChange("Type", e.target.value)}
                  readOnly={Boolean(editForm?.FcLineId)}
                  disabled={Boolean(editForm?.FcLineId)}
                  placeholder="Enter type"
                />
              </div>

              {/* Status */}
              <div className="fc-exp-modal__field">
                <label className="fc-exp-modal__label">Status</label>
                <select
                  className="fc-exp-modal__input"
                  value={editForm?.SetupStatus || "new"}
                  onChange={(e) => onFieldChange("SetupStatus", e.target.value)}
                >
                  <option value="new">New</option>
                  <option value="in_progress">In Progress</option>
                  <option value="complete">Complete</option>
                </select>
              </div>

              {/* Comment */}
              <div className="fc-exp-modal__field fc-exp-modal__field--full">
                <label className="fc-exp-modal__label">Comment</label>
                <textarea
                  className="fc-exp-modal__input fc-exp-modal__textarea"
                  value={editForm?.Comment || ""}
                  onChange={(e) => onFieldChange("Comment", e.target.value)}
                  placeholder="Add a comment or note"
                  rows="2"
                />
              </div>
            </div>
          </div>
          {/* Base Values Section */}
          <div className="fc-exp-modal__section">
            <div className="fc-exp-modal__section-header">
              <h4 className="fc-exp-modal__section-title">Base Values</h4>
              <span className="fc-exp-modal__section-badge">
                Year {baseYear}
              </span>
            </div>

            <div className="fc-exp-modal__fields-grid">
              {/* Base Date */}
              <div className="fc-exp-modal__field">
                <label className="fc-exp-modal__label">Base Year</label>
                <input
                  className="fc-exp-modal__input fc-exp-modal__input--readonly"
                  type="text"
                  value={baseYear}
                  readOnly
                />
              </div>

              {/* Base Value */}
              <div className="fc-exp-modal__field">
                <label className="fc-exp-modal__label fc-exp-modal__label--with-tooltip">
                  Base Value
                  <span
                    className="fc-exp-modal__tooltip-icon"
                    aria-hidden="true"
                  >
                    i
                  </span>
                  <div className="fc-exp-modal__tooltip" role="tooltip">
                    Enter a negative amount for cost.
                  </div>
                  {editForm?.Matched && (
                    <span className="fc-exp-modal__label-badge">
                      Auto-loaded
                    </span>
                  )}
                </label>
                {editForm?.Matched ? (
                  <input
                    className={`fc-exp-modal__input fc-exp-modal__input--readonly fc-exp-modal__input--currency ${
                      baseValueNegative
                        ? "fc-exp-modal__input--negative"
                        : "fc-exp-modal__input--positive"
                    }`}
                    type="text"
                    value={baseValueDisplay}
                    readOnly
                  />
                ) : (
                  <input
                    className={`fc-exp-modal__input fc-exp-modal__input--currency ${
                      baseValueNegative
                        ? "fc-exp-modal__input--negative"
                        : "fc-exp-modal__input--positive"
                    }`}
                    type="number"
                    step="0.01"
                    value={
                      editForm?.BaseValue === null ||
                      editForm?.BaseValue === undefined
                        ? ""
                        : editForm.BaseValue
                    }
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      onFieldChange("BaseValue", nextValue);
                      onFieldChange("BaseValueUSD", nextValue);
                    }}
                    placeholder="0.00"
                  />
                )}
              </div>

              {/* Base Value USD */}
              <div className="fc-exp-modal__field">
                <label className="fc-exp-modal__label">
                  Base Value (USD)
                  {editForm?.Matched && (
                    <span className="fc-exp-modal__label-badge">
                      Auto-loaded
                    </span>
                  )}
                </label>
                {editForm?.Matched ? (
                  <input
                    className={`fc-exp-modal__input fc-exp-modal__input--readonly fc-exp-modal__input--currency ${
                      baseValueUsdNegative
                        ? "fc-exp-modal__input--negative"
                        : "fc-exp-modal__input--positive"
                    }`}
                    type="text"
                    value={baseValueUsdDisplay}
                    readOnly
                  />
                ) : (
                  <input
                    className={`fc-exp-modal__input fc-exp-modal__input--currency ${
                      baseValueUsdNegative
                        ? "fc-exp-modal__input--negative"
                        : "fc-exp-modal__input--positive"
                    }`}
                    type="number"
                    step="0.01"
                    value={
                      editForm?.BaseValueUSD === null ||
                      editForm?.BaseValueUSD === undefined
                        ? ""
                        : editForm.BaseValueUSD
                    }
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      onFieldChange("BaseValueUSD", nextValue);
                      onFieldChange("BaseValue", nextValue);
                    }}
                    placeholder="0.00"
                  />
                )}
              </div>

              {/* Growth */}
              <div className="fc-exp-modal__field">
                <label className="fc-exp-modal__label">
                  Growth (x Inflation)
                </label>
                <input
                  className="fc-exp-modal__input"
                  type="number"
                  step="0.01"
                  title="Multiplier of inflation (e.g. 1 = inflation, 0 = no growth, 2 = 2x inflation)"
                  value={
                    editForm?.Growth === null || editForm?.Growth === undefined
                      ? ""
                      : editForm.Growth
                  }
                  onChange={(e) => onFieldChange("Growth", e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
          {/* Changes Section */}
          <div className="fc-exp-modal__section fc-exp-modal__section--changes">
            <div className="fc-exp-modal__section-header">
              <h4 className="fc-exp-modal__section-title">
                Periodic Adjustments
              </h4>
              <button
                type="button"
                className="fc-exp-modal__add-button"
                onClick={addChangeRow}
                disabled={editSaving}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12 5V19M5 12H19"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Add Change
              </button>
            </div>

            <div className="fc-exp-modal__changes">
              {changes.length === 0 ? (
                <div className="fc-exp-modal__changes-empty">
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15M9 5C9 6.10457 9.89543 7 11 7H13C14.1046 7 15 6.10457 15 5M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <p>No periodic changes defined</p>
                  <span>Click "Add Change" to create an adjustment</span>
                </div>
              ) : (
                changes.map((change, index) => (
                  <div className="fc-exp-modal__change-card" key={index}>
                    <div className="fc-exp-modal__change-number">
                      {index + 1}
                    </div>

                    <div className="fc-exp-modal__change-fields">
                      <div className="fc-exp-modal__change-field">
                        <label className="fc-exp-modal__change-label">
                          Year
                        </label>
                        <select
                          className="fc-exp-modal__change-input"
                          value={(change?.Date || "").slice(0, 4)}
                          onChange={(e) =>
                            updateChangeField(
                              index,
                              "Date",
                              e.target.value ? `${e.target.value}-12-31` : ""
                            )
                          }
                          disabled={editSaving}
                        >
                          <option value="">Select year</option>
                          {periodYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="fc-exp-modal__change-field">
                        <label className="fc-exp-modal__change-label">
                          Type
                          <span
                            className="fc-exp-modal__tooltip-icon"
                            aria-hidden="true"
                          >
                            i
                          </span>
                          <div className="fc-exp-modal__tooltip" role="tooltip">
                            <div className="fc-exp-modal__tooltip-title">
                              How adjustments work
                            </div>
                            <ul className="fc-exp-modal__tooltip-list">
                              <li>
                                <span className="fc-exp-modal__tooltip-flag">Fixed Amount</span>
                                {` `}adds or subtracts $X every year.
                              </li>
                              <li>
                                <span className="fc-exp-modal__tooltip-flag">Percent</span>
                                {` `}increases or decreases by X% each year.
                              </li>
                              <li>
                                <span className="fc-exp-modal__tooltip-flag">One-Off</span>
                                {` `}adds or subtracts $X only in the chosen year.
                              </li>
                            </ul>
                          </div>
                        </label>
                        <select
                          className="fc-exp-modal__change-input"
                          value={change?.Flag || "Fixed $"}
                          onChange={(e) =>
                            updateChangeField(index, "Flag", e.target.value)
                          }
                          disabled={editSaving}
                        >
                          <option value="Fixed $">Fixed Amount ($)</option>
                          <option value="Percent %">Percentage (%)</option>
                          <option value="One-Off $">One-Off ($)</option>
                        </select>
                      </div>

                      <div className="fc-exp-modal__change-field">
                        <label className="fc-exp-modal__change-label">
                          Amount
                        </label>
                        <input
                          className="fc-exp-modal__change-input"
                          type="number"
                          step="0.01"
                          value={
                            change?.Amount === null ||
                            change?.Amount === undefined
                              ? ""
                              : change.Amount
                          }
                          onChange={(e) =>
                            updateChangeField(index, "Amount", e.target.value)
                          }
                          disabled={editSaving}
                          placeholder="0.00"
                        />
                      </div>

                      <div className="fc-exp-modal__change-field">
                        <label className="fc-exp-modal__change-label">
                          Preview
                        </label>
                        <div className="fc-exp-modal__change-preview">
                          <span
                            className={`fc-exp-modal__change-amount ${
                              change?.Flag !== "Percent %" &&
                              Number(change?.Amount) < 0
                                ? "fc-exp-modal__change-amount--negative"
                                : "fc-exp-modal__change-amount--positive"
                            }`}
                          >
                            {formatChangeAmount(change?.Amount, change?.Flag)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="fc-exp-modal__change-remove"
                      onClick={() => removeChangeRow(index)}
                      disabled={editSaving}
                      title="Remove this change"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M19 7L18.1327 19.1425C18.0579 20.1891 17.187 21 16.1378 21H7.86224C6.81296 21 5.94208 20.1891 5.86732 19.1425L5 7M10 11V17M14 11V17M15 7V4C15 3.44772 14.5523 3 14 3H10C9.44772 3 9 3.44772 9 4V7M4 7H20"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Error Display */}
        {editError && (
          <div className="fc-exp-modal__error">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {editError}
          </div>
        )}

        {/* Footer Actions */}
        <div className="fc-exp-modal__footer">
          <button
            type="button"
            className="fc-exp-modal__button fc-exp-modal__button--cancel"
            onClick={onClose}
            disabled={editSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="fc-exp-modal__button fc-exp-modal__button--save"
            onClick={onSubmit}
            disabled={editSaving}
          >
            {editSaving ? (
              <>
                <span className="fc-exp-modal__spinner"></span>
                Saving...
              </>
            ) : (
              <>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M17 21V13H7V21M7 3V8H15"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
