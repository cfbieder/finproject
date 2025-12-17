import { useEffect } from "react";
import coa from "../../../../components/data/coa.json";
import coaTraits from "../../../../components/data/coa_traits.json";

const balanceSheetLevel2Options = (() => {
  const entries =
    Array.isArray(coa) &&
    coa.find((entry) =>
      Object.prototype.hasOwnProperty.call(entry, "Balance Sheet Accounts")
    )?.["Balance Sheet Accounts"];

  const results = [];

  const walk = (nodes, depth) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const [key, value] = Object.entries(node || {})[0] || [];
      if (!key) continue;
      if (depth === 2) {
        results.push(key);
      }
      if (Array.isArray(value)) {
        walk(value, depth + 1);
      } else if (value && typeof value === "object") {
        walk([value], depth + 1);
      }
    }
  };

  walk(entries, 1);
  return Array.from(new Set(results)).filter(
    (name) => name !== "Bank Accounts"
  );
})();

const getChildCategoriesForAccount = (accountName) => {
  if (!accountName) return [];

  const entries =
    Array.isArray(coa) &&
    coa.find((entry) =>
      Object.prototype.hasOwnProperty.call(entry, "Balance Sheet Accounts")
    )?.["Balance Sheet Accounts"];

  const children = [];

  const walk = (nodes, depth) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const [key, value] = Object.entries(node || {})[0] || [];
      if (!key) continue;

      if (depth === 2 && key === accountName) {
        if (Array.isArray(value)) {
          for (const child of value) {
            if (child && typeof child === "object") {
              const childKey = Object.keys(child)[0];
              if (childKey) {
                children.push(childKey);
              }
            } else if (typeof child === "string") {
              children.push(child);
            }
          }
        } else if (typeof value === "string") {
          children.push(value);
        }
        return;
      }

      if (Array.isArray(value)) {
        walk(value, depth + 1);
      } else if (value && typeof value === "object") {
        walk([value], depth + 1);
      }
    }
  };

  walk(entries, 1);
  return Array.from(new Set(children));
};

export default function FCModulesEditModal({
  isOpen,
  editForm,
  editError,
  editSaving,
  onClose,
  onFieldChange,
  onSubmit,
}) {
  const nameOptions = getChildCategoriesForAccount(editForm?.Account);
  const effectiveName =
    editForm?.Name || (nameOptions.length ? nameOptions[0] : "");
  const traitKey =
    (editForm?.Name && coaTraits?.[editForm.Name] ? editForm.Name : "") ||
    (effectiveName && coaTraits?.[effectiveName] ? effectiveName : "") ||
    editForm?.Account ||
    "";
  const accountTraits = coaTraits?.[traitKey] || {};
  const traitType = accountTraits?.Type ?? "";
  const traitCurrency = accountTraits?.Currency ?? "";

  useEffect(() => {
    if (!isOpen || !editForm) return;
    if (traitType && editForm.Type !== traitType) {
      onFieldChange("Type", traitType);
    }
    if (traitCurrency && editForm.Currency !== traitCurrency) {
      onFieldChange("Currency", traitCurrency);
    }
  }, [
    editForm?.Currency,
    editForm?.Type,
    isOpen,
    onFieldChange,
    traitCurrency,
    traitType,
  ]);

  if (!isOpen || !editForm) {
    return null;
  }

  const fields = [
    ["Account", "Account", "select"],
    ["Name", "Name", "select"],
    ["Type", "Type", "text"],
    ["Currency", "Currency", "text"],
    ["Base Date", "BaseDate", "date"],
    ["Base Value (USD)", "BaseValueUSD", "number"],
    ["Market Value (USD)", "MarketValueUSD", "number"],
    ["Base Value", "BaseValue", "number"],
    ["Market Value", "MarketValue", "number"],
    ["Growth %", "Growth", "number"],
    ["Expense Category", "ExpCategory", "text"],
    ["Expense", "Expense", "number"],
    ["Expense %", "ExpensePct", "number"],
    ["Income Category", "IncomeCategory", "text"],
    ["Income", "Income", "number"],
    ["Income %", "IncomePct", "number"],
    ["Currency", "Currency", "text", "traits"],
    ["Account Number", "AccountNumber", "text", "traits"],
  ];

  return (
    <div
      className="fc-scenarios-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit forecast module"
      onClick={onClose}
      style={{ alignItems: "flex-start", paddingTop: "7rem" }}
    >
      <div
        className="fc-scenarios-modal"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(760px, 96vw)",
          maxHeight: "72vh",
          marginTop: "2rem",
        }}
      >
        <h3 className="fc-scenarios-modal__title">Edit Module</h3>
        <form onSubmit={onSubmit}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "0.75rem 1rem",
            }}
          >
            {fields.map(([label, field, type, source]) => {
              if (field === "Account") {
                return (
                  <label key={field} className="fc-scenarios-modal__field">
                    <span>{label}</span>
                    <select
                      className="form-input"
                      value={editForm.Account ?? ""}
                      onChange={(event) =>
                        onFieldChange("Account", event.target.value)
                      }
                    >
                      {balanceSheetLevel2Options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      {editForm.Account &&
                        !balanceSheetLevel2Options.includes(
                          editForm.Account
                        ) && (
                          <option value={editForm.Account}>
                            {editForm.Account}
                          </option>
                        )}
                    </select>
                  </label>
                );
              }
              if (field === "Name") {
                return (
                  <label key={field} className="fc-scenarios-modal__field">
                    <span>{label}</span>
                    <select
                      className="form-input"
                      value={effectiveName}
                      onChange={(event) =>
                        onFieldChange("Name", event.target.value)
                      }
                    >
                      {nameOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      {editForm.Name &&
                        !nameOptions.includes(editForm.Name) && (
                          <option value={editForm.Name}>{editForm.Name}</option>
                        )}
                    </select>
                  </label>
                );
              }

              const isLockedField = field === "Type" || field === "Currency";
              const inputValue = isLockedField
                ? accountTraits[field] ?? ""
                : source === "traits"
                  ? accountTraits[field] ?? ""
                  : editForm[field] ?? "";

              return (
                <label key={field} className="fc-scenarios-modal__field">
                  <span>{label}</span>
                  <input
                    type={type}
                    className="form-input"
                    value={inputValue}
                    disabled={isLockedField}
                    onChange={
                      isLockedField
                        ? undefined
                        : (event) => onFieldChange(field, event.target.value)
                    }
                  />
                </label>
              );
            })}
            <label className="fc-scenarios-modal__field">
              <span>Matched</span>
              <input
                type="checkbox"
                checked={Boolean(editForm.Matched)}
                onChange={(event) =>
                  onFieldChange("Matched", event.target.checked)
                }
              />
            </label>
          </div>
          {editError && (
            <p className="trans-budget-edit-modal__error">{editError}</p>
          )}
          <div className="fc-scenarios-modal__actions">
            <button
              type="button"
              className="generate-report-button"
              onClick={onClose}
              disabled={editSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="generate-report-button"
              disabled={editSaving}
            >
              {editSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
