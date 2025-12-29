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

import "./BudgetRegionBudgetEntry.css";
import coaData from "../../../../components/data/coa.json";
import coaTraits from "../../../../components/data/coa_traits.json";

// Chart of Accounts structure constants
const PROFIT_LOSS_SECTION_LABEL = "Profit & Loss Accounts";
const INCOME_GROUP_LABEL = "Income";
const EXPENSE_GROUP_LABEL = "Expense";

/**
 * Builds a Set of all expense account names from the Chart of Accounts.
 *
 * Traverses the COA JSON structure to find all accounts nested under the
 * "Expense" group within the "Profit & Loss Accounts" section.
 *
 * @param {Array} coa - The Chart of Accounts data structure
 * @returns {Set<string>} A Set containing all expense account names (trimmed)
 *
 * @example
 * const coa = [{ "Profit & Loss Accounts": { "Expense": { ... } } }];
 * const expenses = buildExpenseAccountSet(coa);
 * // Returns Set containing expense account names
 */
const buildExpenseAccountSet = (coa) => {
  const expenseAccounts = new Set();

  // Validate input is an array
  if (!Array.isArray(coa)) {
    return expenseAccounts;
  }

  // Find the Profit & Loss section in the COA
  const profitLossSection = coa.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      Object.prototype.hasOwnProperty.call(entry, PROFIT_LOSS_SECTION_LABEL)
  );

  if (!profitLossSection) {
    return expenseAccounts;
  }

  /**
   * Recursively traverses the COA tree structure to collect expense accounts.
   * Tracks the current group context (Income/Expense) as it traverses.
   *
   * @param {*} node - Current node in the tree (can be array, object, or string)
   * @param {string|null} currentGroup - Current group context (Income/Expense/null)
   */
  const traverse = (node, currentGroup = null) => {
    // Handle array nodes - traverse each child
    if (Array.isArray(node)) {
      node.forEach((child) => traverse(child, currentGroup));
      return;
    }

    // Handle object nodes - traverse each property
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        // Update group context when we encounter Income or Expense keys
        const nextGroup =
          key === EXPENSE_GROUP_LABEL || key === INCOME_GROUP_LABEL
            ? key
            : currentGroup;
        traverse(value, nextGroup);
      }
      return;
    }

    // Handle leaf nodes - collect if it's an expense account
    if (
      currentGroup === EXPENSE_GROUP_LABEL &&
      typeof node === "string" &&
      node.trim().length
    ) {
      expenseAccounts.add(node.trim());
    }
  };

  traverse(profitLossSection[PROFIT_LOSS_SECTION_LABEL], null);
  return expenseAccounts;
};

// Build the expense account set once at module load time for O(1) lookups
const EXPENSE_COA_ACCOUNTS = buildExpenseAccountSet(coaData);

/**
 * Normalizes an account name value to a trimmed string.
 *
 * @param {*} value - The value to normalize (typically a string)
 * @returns {string} The normalized account name (empty string if invalid)
 */
const normalizeAccountName = (value) =>
  typeof value === "string" ? value.trim() : "";

// Map accounts to their configured currency from coa_traits
const ACCOUNT_CURRENCY_MAP = (() => {
  const map = new Map();
  Object.entries(coaTraits || {}).forEach(([account, traits]) => {
    const currency =
      traits &&
      typeof traits === "object" &&
      typeof traits.Currency === "string"
        ? traits.Currency.trim()
        : "";
    const normalizedAccount = normalizeAccountName(account);
    if (normalizedAccount && currency) {
      map.set(normalizedAccount, currency);
    }
  });
  return map;
})();

const getAccountCurrency = (account) => {
  const normalizedAccount = normalizeAccountName(account);
  if (!normalizedAccount || normalizedAccount === "None") {
    return undefined;
  }
  return ACCOUNT_CURRENCY_MAP.get(normalizedAccount);
};

/**
 * Checks if a given account name is an expense account in the Chart of Accounts.
 *
 * @param {*} value - The account name to check
 * @returns {boolean} True if the account is a valid expense account, false otherwise
 *
 * @example
 * isCoaExpenseAccount("Office Supplies"); // true
 * isCoaExpenseAccount("Revenue"); // false
 */
const isCoaExpenseAccount = (value) => {
  const normalized = normalizeAccountName(value);
  return normalized.length > 0 && EXPENSE_COA_ACCOUNTS.has(normalized);
};

/**
 * Evaluates a mathematical expression or numeric value to a number.
 *
 * Supports:
 * - Simple numbers: "100" -> 100
 * - Math expressions: "100+50" -> 150, "200*0.5" -> 100
 * - Parentheses: "(100+50)/2" -> 75
 *
 * Security: Only allows safe mathematical operators and digits to prevent code injection.
 *
 * @param {*} value - The value to evaluate (string or number)
 * @returns {number|undefined} The evaluated number, or undefined if invalid
 *
 * @example
 * evaluateMathExpression("100+50"); // 150
 * evaluateMathExpression("200*0.5"); // 100
 * evaluateMathExpression("invalid"); // undefined
 */
const evaluateMathExpression = (value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  // Convert to string and trim whitespace
  const stringValue =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();

  if (!stringValue.length) {
    return undefined;
  }

  // Security check: only allow digits, operators, parentheses, decimals, and whitespace
  const isSafeExpression = /^[\d+\-*/().\s]+$/.test(stringValue);

  if (isSafeExpression) {
    try {
      // Safely evaluate the mathematical expression using Function constructor
      // This is acceptable here because we've validated the input contains only safe characters
      const evaluated = Function(`"use strict"; return (${stringValue});`)();
      if (typeof evaluated === "number" && Number.isFinite(evaluated)) {
        return evaluated;
      }
    } catch (error) {
      // Expression is syntactically invalid, fall through to basic parsing
    }
  }

  // Fall back to simple number parsing if not a safe expression or evaluation failed
  const parsed = Number(stringValue);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Ensures that amounts for expense accounts are negative.
 *
 * For expense accounts in the COA, this function converts positive amounts
 * to negative values. This enforces the accounting convention where expenses
 * are represented as negative numbers.
 *
 * Behavior:
 * - Non-expense accounts: returns value unchanged
 * - Expense accounts with positive amounts: converts to negative
 * - Expense accounts with negative amounts: returns as-is
 * - Invalid/unparseable amounts: returns unchanged
 *
 * @param {*} value - The amount value (string or number)
 * @param {string} account - The account name to check against COA
 * @returns {*} The amount with corrected sign, or original value if not applicable
 *
 * @example
 * ensureExpenseAmountSign("100", "Office Supplies"); // "-100"
 * ensureExpenseAmountSign("-100", "Office Supplies"); // "-100"
 * ensureExpenseAmountSign("100", "Revenue"); // "100"
 */
const ensureExpenseAmountSign = (value, account) => {
  // Only apply to expense accounts
  if (!isCoaExpenseAccount(account)) {
    return value;
  }

  // Return null/undefined values unchanged
  if (value === undefined || value === null) {
    return value;
  }

  // Convert to string for processing
  const stringValue =
    typeof value === "string" ? value : String(value ?? undefined);

  if (!stringValue.length) {
    return value;
  }

  // Try to evaluate/parse the value
  const parsed = evaluateMathExpression(stringValue);

  // If not a valid number, return original value
  if (!Number.isFinite(parsed)) {
    return value;
  }

  // Convert positive amounts to negative for expense accounts
  if (parsed > 0) {
    return String(-Math.abs(parsed));
  }

  // Already negative or zero, return the string value
  return stringValue;
};

// No-op function for default prop values
const noop = () => {};

/**
 * BudgetRegionBudgetEntry - Budget transaction entry form component
 *
 * Provides a comprehensive form for entering budget transactions with features including:
 * - Month selection for transaction date
 * - Account selection with COA integration
 * - Automatic expense sign correction
 * - Math expression evaluation in amount fields
 * - Multi-currency support with base amount conversion
 * - Description and notes fields
 * - Form validation and submission handling
 *
 * @component
 * @param {Object} props - Component props
 * @param {boolean} [props.derivedCategoryIsGroup=false] - Whether the selected category is a group (disables form)
 * @param {string} [props.derivedCategoryLabel=""] - The label of the currently selected category
 * @param {Array<{value: string, label: string}>} [props.monthSelectOptions=[]] - Available month options for date selection
 * @param {Object} [props.entryForm={}] - Form state object containing all form field values
 * @param {string} props.entryForm.date - Selected transaction date
 * @param {string} props.entryForm.description - Transaction description
 * @param {string} props.entryForm.account - Selected account name
 * @param {string} props.entryForm.category - Transaction category
 * @param {string} props.entryForm.amount - Transaction amount (supports math expressions)
 * @param {string} props.entryForm.currency - Selected currency code
 * @param {string} props.entryForm.note - Additional notes
 * @param {Function} [props.setEntryForm=noop] - State setter function for the form
 * @param {Array<string>} [props.filteredAccountOptions=[]] - Available account options filtered by category
 * @param {number} [props.computedBaseAmount] - Computed amount in base currency (USD)
 * @param {Function} [props.formatCurrencyValue=(v)=>v] - Function to format currency values for display
 * @param {Array<string>} [props.currencyOptions=[]] - Available currency codes
 * @param {Object} [props.entryStatus={}] - Status object for form submission
 * @param {boolean} props.entryStatus.loading - Whether form is currently submitting
 * @param {string} props.entryStatus.error - Error message if submission failed
 * @param {string} props.entryStatus.message - Success or info message
 * @param {Function} [props.onSubmit=noop] - Form submission handler
 *
 * @example
 * <BudgetRegionBudgetEntry
 *   derivedCategoryLabel="Office Expenses"
 *   monthSelectOptions={[{value: "2024-01", label: "January 2024"}]}
 *   entryForm={formState}
 *   setEntryForm={setFormState}
 *   filteredAccountOptions={["Office Supplies", "Equipment"]}
 *   computedBaseAmount={100.50}
 *   formatCurrencyValue={(v) => `$${v.toFixed(2)}`}
 *   currencyOptions={["USD", "EUR", "GBP"]}
 *   entryStatus={{loading: false, error: null, message: null}}
 *   onSubmit={handleSubmit}
 * />
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
}) {
  // Check if the computed base amount should display as negative (red)
  const computedBaseAmountIsNegative =
    Number.isFinite(computedBaseAmount) && computedBaseAmount < 0;
  const currencyEditable =
    normalizeAccountName(entryForm.account) === "None" ||
    normalizeAccountName(entryForm.account) === "";

  /**
   * Generic field change handler factory.
   * Creates a handler that updates a specific field in the form state.
   *
   * @param {string} field - The field name to update
   * @returns {Function} Event handler function
   */
  const handleFieldChange = (field) => (event) => {
    const nextValue = event?.target?.value;
    setEntryForm((previous) => ({
      ...previous,
      [field]: nextValue,
    }));
  };

  /**
   * Handles account selection changes.
   * When the account changes, automatically adjusts the amount sign
   * if the new account is an expense account.
   *
   * @param {Event} event - The change event from the select element
   */
  const handleAccountChange = (event) => {
    const nextValue = event?.target?.value;
    const nextCurrency = getAccountCurrency(nextValue);
    setEntryForm((previous) => ({
      ...previous,
      account: nextValue,
      currency: nextCurrency ?? previous.currency,
      // Re-apply sign correction with new account
      amount: ensureExpenseAmountSign(previous.amount, nextValue),
    }));
  };

  /**
   * Handles amount field changes.
   * Automatically ensures the correct sign for expense accounts.
   *
   * @param {Event} event - The change event from the input element
   */
  const handleAmountChange = (event) => {
    const nextValue = event?.target?.value;
    setEntryForm((previous) => ({
      ...previous,
      amount: ensureExpenseAmountSign(nextValue, previous.account),
    }));
  };

  /**
   * Clears all form fields and resets to default values.
   * Preserves the currently selected category.
   */
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
    <section className="budget-region input-area">
      {/* Section header */}
      <div>
        <p className="budget-region__label">Budget Entry</p>
        <p className="budget-region__description">
          Submit a budget entry to persist a new record via the API.
        </p>
      </div>

      {/* Conditional rendering: show disabled message if a category group is selected */}
      {derivedCategoryIsGroup ? (
        <div className="budget-entry-form budget-entry-form--disabled">
          <p className="budget-entry-form__disabled-message">
            Budget entry input is unavailable while "{derivedCategoryLabel}" is
            selected. Please choose a specific category to enable the entry
            form.
          </p>
        </div>
      ) : (
        // Main budget entry form
        <form className="budget-entry-form" onSubmit={onSubmit}>
          <div className="budget-entry-form__grid">
            {/* Date selection - choose from available months */}
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

            {/* Account selection - triggers automatic expense sign correction */}
            <label className="budget-entry-form__control">
              <span className="budget-entry-form__label">Account</span>
              <select
                className="budget-entry-form__input"
                value={entryForm.account}
                onChange={handleAccountChange}
              >
                <option value="None">None</option>
                <option value="" disabled>
                  Select account
                </option>
                {filteredAccountOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            {/* Category - read-only field derived from parent selection */}
            <div className="budget-entry-form__control">
              <span className="budget-entry-form__label">Category</span>
              <div className="budget-entry-form__derived-value">
                {entryForm.category || "Selected above"}
              </div>
            </div>

            {/* Amount - supports math expressions like "100+50" */}
            <label className="budget-entry-form__control">
              <span className="budget-entry-form__label">Amount</span>
              <input
                type="text"
                className="budget-entry-form__input"
                value={entryForm.amount}
                onChange={handleAmountChange}
              />
            </label>

            {/* Base Amount - read-only computed value in USD */}
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

            {/* Currency selection */}
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

            {/* Description - multi-line text area spanning grid columns */}
            <label className="budget-entry-form__control budget-entry-form__control--spanning">
              <span className="budget-entry-form__label">Description</span>
              <textarea
                rows="3"
                className="budget-entry-form__input budget-entry-form__input--textarea"
                value={entryForm.description}
                onChange={handleFieldChange("description")}
              />
            </label>

            {/* Note - additional details spanning grid columns */}
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

          {/* Status messages for submission feedback */}
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

          {/* Form action buttons */}
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
              {entryStatus.loading ? "Submitting…" : "Save Budget Entry"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
