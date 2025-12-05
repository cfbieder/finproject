import "./BudgetRegionBudgetEntry.css";
import coaData from "../../../../components/data/coa.json";

const PROFIT_LOSS_SECTION_LABEL = "Profit & Loss Accounts";
const INCOME_GROUP_LABEL = "Income";
const EXPENSE_GROUP_LABEL = "Expense";

const buildExpenseAccountSet = (coa) => {
  const expenseAccounts = new Set();
  if (!Array.isArray(coa)) {
    return expenseAccounts;
  }

  const profitLossSection = coa.find(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      Object.prototype.hasOwnProperty.call(entry, PROFIT_LOSS_SECTION_LABEL)
  );
  if (!profitLossSection) {
    return expenseAccounts;
  }

  const traverse = (node, currentGroup = null) => {
    if (Array.isArray(node)) {
      node.forEach((child) => traverse(child, currentGroup));
      return;
    }

    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        const nextGroup =
          key === EXPENSE_GROUP_LABEL || key === INCOME_GROUP_LABEL
            ? key
            : currentGroup;
        traverse(value, nextGroup);
      }
      return;
    }

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

const EXPENSE_COA_ACCOUNTS = buildExpenseAccountSet(coaData);

const normalizeAccountName = (value) =>
  typeof value === "string" ? value.trim() : "";

const isCoaExpenseAccount = (value) => {
  const normalized = normalizeAccountName(value);
  return normalized.length ? EXPENSE_COA_ACCOUNTS.has(normalized) : false;
};

const ensureExpenseAmountSign = (value, account) => {
  if (!isCoaExpenseAccount(account)) {
    return value;
  }

  if (value === undefined || value === null) {
    return value;
  }

  const stringValue =
    typeof value === "string" ? value : String(value ?? undefined);
  if (!stringValue.length) {
    return value;
  }

  const parsed = Number(stringValue);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  if (parsed > 0) {
    return String(-Math.abs(parsed));
  }

  return stringValue;
};

const noop = () => {};
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
  const computedBaseAmountIsNegative =
    Number.isFinite(computedBaseAmount) && computedBaseAmount < 0;
  const handleFieldChange = (field) => (event) => {
    const nextValue = event?.target?.value;
    setEntryForm((previous) => ({
      ...previous,
      [field]: nextValue,
    }));
  };

  const handleAccountChange = (event) => {
    const nextValue = event?.target?.value;
    setEntryForm((previous) => ({
      ...previous,
      account: nextValue,
      amount: ensureExpenseAmountSign(previous.amount, nextValue),
    }));
  };

  const handleAmountChange = (event) => {
    const nextValue = event?.target?.value;
    setEntryForm((previous) => ({
      ...previous,
      amount: ensureExpenseAmountSign(nextValue, previous.account),
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
    <section className="budget-region input-area">
      <div>
        <p className="budget-region__label">Budget Entry</p>
        <p className="budget-region__description">
          Submit a budget entry to persist a new record via the API.
        </p>
      </div>
      {derivedCategoryIsGroup ? (
        <div className="budget-entry-form budget-entry-form--disabled">
          <p className="budget-entry-form__disabled-message">
            Budget entry input is unavailable while “{derivedCategoryLabel}” is
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
            <div className="budget-entry-form__control">
              <span className="budget-entry-form__label">Category</span>
              <div className="budget-entry-form__derived-value">
                {entryForm.category || "Selected above"}
              </div>
            </div>
            <label className="budget-entry-form__control">
              <span className="budget-entry-form__label">Amount</span>
              <input
                type="number"
                step="0.01"
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
                onChange={handleFieldChange("currency")}
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
              {entryStatus.loading ? "Submitting…" : "Save Budget Entry"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
