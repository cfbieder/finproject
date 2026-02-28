/**
 * BudgetRegionBudgetEntry Component
 *
 * A form component for entering budget transactions with automatic expense account
 * detection and sign normalization. The component:
 * - Validates expense accounts against the Chart of Accounts (COA)
 * - Automatically converts positive amounts to negative for expense accounts
 * - Supports math expression evaluation in amount fields (e.g., "100+50")
 * - Provides currency conversion with base amount display
 * - Conditionally disables the form when a category group is selected
 */

import AccountSelector from "../../components/AccountSelector/AccountSelector.jsx";
import "./BudgetRegionBudgetEntry.css";

const EMPTY_SET = new Set();
const EMPTY_MAP = new Map();

/**
 * Normalizes an account name value to a trimmed string.
 */
const normalizeAccountName = (value) =>
  typeof value === "string" ? value.trim() : "";

const getAccountCurrency = (account, currencyMap) => {
  const normalized = normalizeAccountName(account);
  if (!normalized || normalized === "None") return undefined;
  return currencyMap.get(normalized);
};

const isCoaExpenseAccount = (value, expenseNames) => {
  const normalized = normalizeAccountName(value);
  return normalized.length > 0 && expenseNames.has(normalized);
};

/**
 * Evaluates a mathematical expression or numeric value to a number.
 */
const evaluateMathExpression = (value) => {
  if (value === undefined || value === null) return undefined;
  const stringValue =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!stringValue.length) return undefined;

  const isSafeExpression = /^[\d+\-*/().\s]+$/.test(stringValue);
  if (isSafeExpression) {
    try {
      const evaluated = Function(`"use strict"; return (${stringValue});`)();
      if (typeof evaluated === "number" && Number.isFinite(evaluated))
        return evaluated;
    } catch {
      // fall through
    }
  }

  const parsed = Number(stringValue);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Ensures that amounts for expense accounts are negative.
 */
const ensureExpenseAmountSign = (value, account, expenseNames) => {
  if (!isCoaExpenseAccount(account, expenseNames)) return value;
  if (value === undefined || value === null) return value;

  const stringValue =
    typeof value === "string" ? value : String(value ?? undefined);
  if (!stringValue.length) return value;

  const parsed = evaluateMathExpression(stringValue);
  if (!Number.isFinite(parsed)) return value;
  if (parsed > 0) return String(-Math.abs(parsed));
  return stringValue;
};

// No-op function for default prop values
const noop = () => {};

/**
 * BudgetRegionBudgetEntry - Budget transaction entry form component
 *
 * @param {Object} props
 * @param {Set<string>} [props.expenseAccountNames] - Set of expense account names from useCoa()
 * @param {Map<string,string>} [props.accountCurrencyMap] - Account name → currency map from useCoa()
 */
export default function BudgetRegionBudgetEntry({
  derivedCategoryIsGroup = false,
  derivedCategoryLabel = "",
  monthSelectOptions = [],
  entryForm = {},
  setEntryForm = noop,
  filteredAccountOptions = [],
  computedBaseAmount,
  formatCurrencyValue = (value) => value,
  currencyOptions = [],
  entryStatus = {},
  onSubmit = noop,
  expenseAccountNames = EMPTY_SET,
  accountCurrencyMap = EMPTY_MAP,
}) {
  const computedBaseAmountIsNegative =
    Number.isFinite(computedBaseAmount) && computedBaseAmount < 0;
  const currencyEditable =
    normalizeAccountName(entryForm.account) === "None" ||
    normalizeAccountName(entryForm.account) === "";

  const handleFieldChange = (field) => (event) => {
    const nextValue = event?.target?.value;
    setEntryForm((previous) => ({
      ...previous,
      [field]: nextValue,
    }));
  };

  const handleAccountChange = (nextSelected) => {
    const nextValue =
      Array.isArray(nextSelected) && nextSelected.length > 0
        ? nextSelected[0]
        : "None";
    const nextCurrency = getAccountCurrency(nextValue, accountCurrencyMap);
    setEntryForm((previous) => ({
      ...previous,
      account: nextValue,
      currency: nextCurrency ?? previous.currency,
      amount: ensureExpenseAmountSign(
        previous.amount,
        nextValue,
        expenseAccountNames
      ),
    }));
  };

  const handleAmountChange = (event) => {
    const nextValue = event?.target?.value;
    setEntryForm((previous) => ({
      ...previous,
      amount: ensureExpenseAmountSign(
        nextValue,
        previous.account,
        expenseAccountNames
      ),
    }));
  };

  const handleClearForm = () => {
    setEntryForm((previous) => ({
      ...previous,
      date: "",
      description: "",
      account: "None",
      category: derivedCategoryLabel,
      amount: "",
      currency: "USD",
      note: "",
    }));
  };

  return (
    <div className="input-area">
      {derivedCategoryIsGroup ? (
        <div className="budget-entry-form budget-entry-form--disabled">
          <p className="budget-entry-form__disabled-message">
            Budget entry input is unavailable while "{derivedCategoryLabel}" is
            selected. Please choose a specific category to enable the entry
            form.
          </p>
        </div>
      ) : (
        <form className="budget-entry-form" onSubmit={onSubmit}>
          <div className="budget-entry-form__grid">
            <label className="budget-entry-form__control">
              <span className="budget-entry-form__label">Date</span>
              <select
                className="budget-entry-form__input"
                value={entryForm.date}
                onChange={handleFieldChange("date")}
              >
                {monthSelectOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="budget-entry-form__control">
              <span className="budget-entry-form__label">Account</span>
              <AccountSelector
                accountOptions={filteredAccountOptions}
                accountCurrencyMap={accountCurrencyMap}
                selectedAccounts={
                  entryForm.account && entryForm.account !== "None"
                    ? [entryForm.account]
                    : ["None"]
                }
                onAccountsChange={handleAccountChange}
                singleSelect
                showNone
                showAll={false}
                id="budget-entry-account"
                className="budget-entry-form__account-selector"
              />
            </div>

            <div className="budget-entry-form__control">
              <span className="budget-entry-form__label">Category</span>
              <div className="budget-entry-form__derived-value">
                {entryForm.category || "Selected above"}
              </div>
            </div>

            <label className="budget-entry-form__control">
              <span className="budget-entry-form__label">Amount</span>
              <input
                type="text"
                className="budget-entry-form__input"
                value={entryForm.amount}
                onChange={handleAmountChange}
              />
            </label>

            <label className="budget-entry-form__control">
              <span className="budget-entry-form__label">
                Base Amount (USD)
              </span>
              <input
                type="text"
                className={`budget-entry-form__input budget-entry-form__input--readonly budget-entry-form__input--shaded${
                  computedBaseAmountIsNegative
                    ? " budget-entry-form__input--negative"
                    : ""
                }`}
                value={
                  Number.isFinite(computedBaseAmount)
                    ? formatCurrencyValue(computedBaseAmount)
                    : ""
                }
                readOnly
              />
            </label>

            <label className="budget-entry-form__control">
              <span className="budget-entry-form__label">Currency</span>
              <select
                className="budget-entry-form__input"
                value={entryForm.currency}
                onChange={
                  currencyEditable ? handleFieldChange("currency") : noop
                }
                disabled={!currencyEditable}
              >
                {currencyOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="budget-entry-form__control budget-entry-form__control--spanning">
              <span className="budget-entry-form__label">Description</span>
              <textarea
                rows="3"
                className="budget-entry-form__input budget-entry-form__input--textarea"
                value={entryForm.description}
                onChange={handleFieldChange("description")}
              />
            </label>

            <label className="budget-entry-form__control budget-entry-form__control--spanning">
              <span className="budget-entry-form__label">Note</span>
              <textarea
                rows="5"
                className="budget-entry-form__input budget-entry-form__input--textarea"
                value={entryForm.note}
                onChange={handleFieldChange("note")}
              />
            </label>
          </div>

          <div className="budget-entry-form__meta">
            {entryStatus.error && (
              <p className="budget-entry-form__status budget-entry-form__status--error">
                {entryStatus.error}
              </p>
            )}
            {entryStatus.message && (
              <p className="budget-entry-form__status">{entryStatus.message}</p>
            )}
          </div>

          <div className="budget-entry-form__actions">
            <button
              type="button"
              className="budget-entry-form__clear"
              onClick={handleClearForm}
              disabled={entryStatus.loading}
            >
              Clear Form
            </button>
            <button
              type="submit"
              className="budget-entry-form__submit"
              disabled={entryStatus.loading}
            >
              {entryStatus.loading ? "Submitting\u2026" : "Save Budget Entry"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
