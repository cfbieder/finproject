import { useEffect } from "react";
import "./FCModulesEdit.css";
import "./FCExpModal.css";
import Rest from "../../js/rest.js";

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
  const nameOptionsForAccount = accountNameOptions[editForm?.Account] || [];
  const baseYear = (editForm?.BaseDate || "").slice(0, 4);
  const changes = Array.isArray(editForm?.Changes) ? editForm.Changes : [];
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
  const updateChangeField = (index, field, value) => {
    const next = changes.map((change, i) =>
      i === index ? { ...change, [field]: value } : change
    );
    onFieldChange("Changes", next);
  };

  const addChangeRow = () => {
    onFieldChange("Changes", [
      ...changes,
      {
        Date:
          periodYears && periodYears.length
            ? `${periodYears[0]}-12-31`
            : "",
        Amount: "",
        Flag: "",
      },
    ]);
  };

  const removeChangeRow = (index) => {
    const next = changes.filter((_, i) => i !== index);
    onFieldChange("Changes", next);
  };

  useEffect(() => {
    let cancelled = false;
    const year = (editForm?.BaseDate || "").slice(0, 4);
    if (!isOpen || !editForm?.Matched || !year || !editForm?.Name) return undefined;

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
              <option value="All">All</option>
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
          <span>Base Date</span>
          <input className="form-input" type="text" value={baseYear} readOnly />
        </div>
        <div className="fc-scenarios-modal__field">
          <span>Base Value (USD)</span>
          <input
            className="form-input"
            type="text"
            value={baseValueUsdDisplay}
            readOnly
            style={{ color: baseValueUsdNegative ? "red" : undefined }}
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
        <div className="fc-scenarios-modal__field">
          <span>Changes</span>
          <div className="fc-exp-modal__changes">
            {changes.map((change, index) => (
              <div className="fc-exp-modal__change-row" key={index}>
                <select
                  className="form-input"
                  value={(change?.Date || "").slice(0, 4)}
                  onChange={(e) =>
                    updateChangeField(
                      index,
                      "Date",
                      e.target.value
                        ? `${e.target.value}-12-31`
                        : ""
                    )
                  }
                  disabled={editSaving}
                >
                  <option value="">Year</option>
                  {periodYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <select
                  className="form-input"
                  value={change?.Flag || ""}
                  onChange={(e) =>
                    updateChangeField(index, "Flag", e.target.value)
                  }
                  disabled={editSaving}
                >
                  <option value="Fixed $">Fixed $</option>
                  <option value="Percent %">Percent %</option>
                </select>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  value={
                    change?.Amount === null || change?.Amount === undefined
                      ? ""
                      : change.Amount
                  }
                  onChange={(e) =>
                    updateChangeField(index, "Amount", e.target.value)
                  }
                  disabled={editSaving}
                />
                <input
                  className="form-input"
                  type="text"
                  value={formatChangeAmount(change?.Amount, change?.Flag)}
                  readOnly
                  style={{
                    color:
                      change?.Flag === "Fixed $" &&
                      Number(change?.Amount) < 0
                        ? "red"
                        : undefined,
                  }}
                />
                <button
                  type="button"
                  className="fc-scenarios-action-button"
                  onClick={() => removeChangeRow(index)}
                  disabled={editSaving}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="fc-scenarios-action-button fc-scenarios-action-button--primary"
              onClick={addChangeRow}
              disabled={editSaving}
            >
              Add Change
            </button>
          </div>
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
