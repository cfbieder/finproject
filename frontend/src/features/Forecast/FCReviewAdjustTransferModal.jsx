import { useState, useEffect, useMemo } from "react";
import { formatAmount } from "./utils/fcReviewUtils.js";
import Rest from "../../js/rest.js";
import "./FCReviewAdjustTransferModal.css";

export default function FCReviewAdjustTransferModal({
  isOpen,
  onClose,
  entry,
  scenarioName,
  onTransferComplete,
}) {
  const [moduleData, setModuleData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editedAmounts, setEditedAmounts] = useState({});
  const [focusedInput, setFocusedInput] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Fetch module data when modal opens
  useEffect(() => {
    if (!isOpen || !entry?.Module || !scenarioName) {
      setModuleData(null);
      setError(null);
      setEditedAmounts({});
      setFocusedInput(null);
      setSaveError("");
      return;
    }

    const fetchModuleData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Using v2 API (PostgreSQL)
        const response = await Rest.fetchJson(
          `/api/v2/forecast/modules?scenario=${encodeURIComponent(scenarioName)}`
        );
        const module = response.find((m) => m.Name === entry.Module);
        if (!module) {
          setError("Module not found");
        } else {
          setModuleData(module);
        }
      } catch (err) {
        console.error("Failed to fetch module data:", err);
        setError("Failed to load module data");
      } finally {
        setLoading(false);
      }
    };

    fetchModuleData();
  }, [isOpen, entry?.Module, scenarioName]);

  // Filter transfers for the relevant year
  const transfersForYear = useMemo(() => {
    if (!moduleData || !entry?.Year) {
      return { invest: [], dispose: [] };
    }

    const year = entry.Year;
    const yearStr = `${year}-12-31`;

    const invest = (moduleData.Invest || []).filter(
      (t) => t.Date === yearStr || new Date(t.Date).getFullYear() === year
    );

    const dispose = (moduleData.Dispose || []).filter(
      (t) => t.Date === yearStr || new Date(t.Date).getFullYear() === year
    );

    return { invest, dispose };
  }, [moduleData, entry?.Year]);

  const handleAmountChange = (type, index, value) => {
    const key = `${type}-${index}`;
    // Remove commas and parse the value
    const numericValue = value.replace(/,/g, "");
    setEditedAmounts((prev) => ({
      ...prev,
      [key]: numericValue,
    }));
  };

  const formatInputValue = (value) => {
    if (!value && value !== 0) return "";
    const numValue = parseFloat(String(value).replace(/,/g, ""));
    if (isNaN(numValue)) return "";
    return numValue.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleSave = async () => {
    setSaveError("");
    setIsSaving(true);

    try {
      // Create updated Invest and Dispose arrays
      const updatedInvest = [...(moduleData.Invest || [])];
      const updatedDispose = [...(moduleData.Dispose || [])];

      // Apply edited amounts to the arrays
      Object.keys(editedAmounts).forEach((key) => {
        const [type, indexStr] = key.split("-");
        const filteredIndex = parseInt(indexStr, 10);
        const newAmount = parseFloat(editedAmounts[key]);

        if (isNaN(newAmount)) return;

        if (type === "invest") {
          // Get the actual transfer from the filtered list
          const transfer = transfersForYear.invest[filteredIndex];
          if (!transfer) return;

          // Find this transfer in the full Invest array
          const fullArrayIndex = updatedInvest.findIndex(
            (t) => t.Date === transfer.Date && t.Flag === transfer.Flag
          );
          if (fullArrayIndex !== -1) {
            updatedInvest[fullArrayIndex] = {
              ...updatedInvest[fullArrayIndex],
              Amount: newAmount,
            };
          }
        } else if (type === "dispose") {
          // Get the actual transfer from the filtered list
          const transfer = transfersForYear.dispose[filteredIndex];
          if (!transfer) return;

          // Find this transfer in the full Dispose array
          const fullArrayIndex = updatedDispose.findIndex(
            (t) => t.Date === transfer.Date && t.Flag === transfer.Flag
          );
          if (fullArrayIndex !== -1) {
            updatedDispose[fullArrayIndex] = {
              ...updatedDispose[fullArrayIndex],
              Amount: newAmount,
            };
          }
        }
      });

      // Update the module using v2 API (PostgreSQL)
      await Rest.fetchJson(`/api/v2/forecast/modules/v1/${moduleData._id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Invest: updatedInvest,
          Dispose: updatedDispose,
        }),
      });

      // Generate forecast (v2 API wraps v1 generator)
      const encodedScenario = encodeURIComponent(scenarioName);
      await Rest.fetchJson(`/api/v2/forecast/generate/${encodedScenario}`, {
        method: "POST",
      });

      // Notify parent to reload data and close all modals
      if (onTransferComplete) {
        onTransferComplete();
      }

      // Close modal
      onClose();
    } catch (err) {
      console.error("Failed to save transfers:", err);
      setSaveError(err.message || "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="trans-budget-edit-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Modify Transfer"
    >
      <div className="trans-budget-edit-modal fc-review-transfer-modal">
        {/* Header */}
        <div className="fc-review-transfer-modal__header">
          <div>
            <p className="fc-review-transfer-modal__eyebrow">
              Modify Transfer
            </p>
            <div className="fc-review-transfer-modal__title-row">
              <h3 className="fc-review-transfer-modal__title">
                {entry?.Module || "Unknown Module"}
              </h3>
              <span className="fc-review-transfer-modal__currency">
                Currency: {moduleData?.Currency || entry?.Currency || "-"}
              </span>
            </div>
            <div className="fc-review-transfer-modal__meta-row">
              <span className="fc-review-transfer-modal__pill">
                Year: {entry?.Year || "-"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="fc-review-transfer-modal__close"
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="fc-review-transfer-modal__content">
          {loading ? (
            <div className="fc-review-transfer-modal__status fc-review-transfer-modal__status--loading">
              Loading transfers...
            </div>
          ) : error ? (
            <div className="fc-review-transfer-modal__status fc-review-transfer-modal__status--error">
              {error}
            </div>
          ) : (
            <div className="fc-review-transfer-modal__sections">
              {/* Invest Transfers (Transfer From Cash) */}
              <div className="fc-review-transfer-modal__card">
                <div className="fc-review-transfer-modal__card-header">
                  <h4 className="fc-review-transfer-modal__card-title">
                    <span className="fc-review-transfer-modal__indicator fc-review-transfer-modal__indicator--invest" />
                    Transfer From Cash (Invest)
                  </h4>
                </div>
                {transfersForYear.invest.length > 0 ? (
                  <div className="fc-review-transfer-modal__card-body">
                    <table className="trans-budget-table fc-review-transfer-modal__table">
                      <thead>
                        <tr>
                          <th className="fc-review-transfer-modal__table-heading">
                            Year
                          </th>
                          <th className="fc-review-transfer-modal__table-heading">
                            Flag
                          </th>
                          <th className="fc-review-transfer-modal__table-heading fc-review-transfer-modal__table-heading--amount">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {transfersForYear.invest.map((transfer, index) => {
                          const isOneTime = transfer.Flag === "OneTime";
                          const editKey = `invest-${index}`;
                          const currentValue =
                            editedAmounts[editKey] ?? transfer.Amount;
                          const isFocused = focusedInput === editKey;

                          // Display value depends on focus state
                          const displayValue = isFocused
                            ? String(currentValue).replace(/,/g, "")
                            : formatInputValue(currentValue);

                          return (
                            <tr key={`invest-${index}`}>
                              <td>
                                {transfer.Date
                                  ? new Date(transfer.Date).getFullYear()
                                  : "-"}
                              </td>
                              <td>{transfer.Flag || "-"}</td>
                              <td>
                                {isOneTime ? (
                                  <input
                                    type="text"
                                    value={displayValue}
                                    onChange={(e) =>
                                      handleAmountChange(
                                        "invest",
                                        index,
                                        e.target.value
                                      )
                                    }
                                    onFocus={() => setFocusedInput(editKey)}
                                    onBlur={() => setFocusedInput(null)}
                                    className="trans-budget-edit-input fc-review-transfer-modal__amount-input"
                                  />
                                ) : (
                                  formatAmount(transfer.Amount)
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="fc-review-transfer-modal__empty">
                    <p className="fc-review-transfer-modal__empty-text">
                      No invest transfers for this year
                    </p>
                  </div>
                )}
              </div>

              {/* Dispose Transfers (Transfer To Cash) */}
              <div className="fc-review-transfer-modal__card">
                <div className="fc-review-transfer-modal__card-header">
                  <h4 className="fc-review-transfer-modal__card-title">
                    <span className="fc-review-transfer-modal__indicator fc-review-transfer-modal__indicator--dispose" />
                    Transfer To Cash (Dispose)
                  </h4>
                </div>
                {transfersForYear.dispose.length > 0 ? (
                  <div className="fc-review-transfer-modal__card-body">
                    <table className="trans-budget-table fc-review-transfer-modal__table">
                      <thead>
                        <tr>
                          <th className="fc-review-transfer-modal__table-heading">
                            Year
                          </th>
                          <th className="fc-review-transfer-modal__table-heading">
                            Flag
                          </th>
                          <th className="fc-review-transfer-modal__table-heading fc-review-transfer-modal__table-heading--amount">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {transfersForYear.dispose.map((transfer, index) => {
                          const isOneTime = transfer.Flag === "OneTime";
                          const editKey = `dispose-${index}`;
                          const currentValue =
                            editedAmounts[editKey] ?? transfer.Amount;
                          const isFocused = focusedInput === editKey;

                          // Display value depends on focus state
                          const displayValue = isFocused
                            ? String(currentValue).replace(/,/g, "")
                            : formatInputValue(currentValue);

                          return (
                            <tr key={`dispose-${index}`}>
                              <td>
                                {transfer.Date
                                  ? new Date(transfer.Date).getFullYear()
                                  : "-"}
                              </td>
                              <td>{transfer.Flag || "-"}</td>
                              <td>
                                {isOneTime ? (
                                  <input
                                    type="text"
                                    value={displayValue}
                                    onChange={(e) =>
                                      handleAmountChange(
                                        "dispose",
                                        index,
                                        e.target.value
                                      )
                                    }
                                    onFocus={() => setFocusedInput(editKey)}
                                    onBlur={() => setFocusedInput(null)}
                                    className="trans-budget-edit-input fc-review-transfer-modal__amount-input"
                                  />
                                ) : (
                                  formatAmount(transfer.Amount)
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="fc-review-transfer-modal__empty">
                    <p className="fc-review-transfer-modal__empty-text">
                      No dispose transfers for this year
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer with Action Buttons */}
        {!loading && !error && (
          <div className="fc-review-transfer-modal__footer">
            {/* Error Display */}
            {saveError && (
              <div className="fc-review-transfer-modal__save-error">
                <span className="fc-review-transfer-modal__save-error-icon">
                  ⚠
                </span>
                <span>{saveError}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="fc-review-transfer-modal__actions">
              <div className="fc-review-transfer-modal__changes">
                {Object.keys(editedAmounts).length > 0 ? (
                  <span>
                    {Object.keys(editedAmounts).length} change
                    {Object.keys(editedAmounts).length !== 1 ? "s" : ""} pending
                  </span>
                ) : (
                  <span>No changes</span>
                )}
              </div>
              <div className="fc-review-transfer-modal__buttons">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSaving}
                  className="fc-review-transfer-modal__button fc-review-transfer-modal__button--secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || Object.keys(editedAmounts).length === 0}
                  className="fc-review-transfer-modal__button fc-review-transfer-modal__button--primary"
                >
                  {isSaving ? (
                    <span>
                      <span className="fc-review-transfer-modal__saving-icon">
                        ⏳
                      </span>
                      Saving...
                    </span>
                  ) : (
                    "Save Changes"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
