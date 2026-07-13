import { useState, useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { formatAmount } from "./utils/fcReviewUtils.js";
import { transferAppliesToYear, transferSpanLabel } from "./utils/transferYear.js";
import Rest from "../../js/rest.js";
import Modal from "../../components/Modal/Modal.jsx";
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
        // The LIST endpoint does not return Invest/Dispose/IncomePct — only
        // GET /modules/:id does (it joins the three child tables). This modal read the
        // list, so `moduleData.Invest` was ALWAYS undefined and every year of every
        // module reported "no transfers for this year". The modal had never once shown a
        // transfer. Use the list only to resolve Name → id, then fetch the full module.
        const list = await Rest.fetchJson(
          `/api/v2/forecast/modules?scenario=${encodeURIComponent(scenarioName)}`
        );
        const summary = list.find((m) => m.Name === entry.Module);
        if (!summary) {
          setError("Module not found");
          return;
        }

        const full = await Rest.get(`/forecast/modules/${summary.id}`);
        setModuleData({ ...summary, ...(full?.data || {}) });
      } catch (err) {
        console.error("Failed to fetch module data:", err);
        setError("Failed to load module data");
      } finally {
        setLoading(false);
      }
    };

    fetchModuleData();
  }, [isOpen, entry?.Module, scenarioName]);

  // Transfers that produce an entry in the clicked year. The rule (and why it is not just
  // "the years match") lives in utils/transferYear.js, next to its tests.
  //
  // Each hit carries `_idx`, its index in the module's full array. handleSave used to
  // re-find the row by Date+Flag, which is not unique — two OneTime rows can share both —
  // so an edit could silently land on the wrong one.
  const transfersForYear = useMemo(() => {
    if (!moduleData || !entry?.Year) {
      return { invest: [], dispose: [] };
    }

    const pick = (list) =>
      (list || [])
        .map((t, _idx) => ({ ...t, _idx }))
        .filter((t) => transferAppliesToYear(t, entry.Year));

    return { invest: pick(moduleData.Invest), dispose: pick(moduleData.Dispose) };
  }, [moduleData, entry?.Year]);

  const hasPeriodic = [
    ...transfersForYear.invest,
    ...transfersForYear.dispose,
  ].some((t) => t.Flag === "Periodic");

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

        const target = type === "invest" ? updatedInvest : updatedDispose;
        const transfer = transfersForYear[type]?.[filteredIndex];
        // `_idx` is the row's position in the module's full array — the identity the old
        // Date+Flag lookup only approximated.
        if (!transfer || target[transfer._idx] === undefined) return;

        target[transfer._idx] = { ...target[transfer._idx], Amount: newAmount };
      });

      await Rest.fetchJson(`/api/v2/forecast/modules/${moduleData.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Invest: updatedInvest,
          Dispose: updatedDispose,
        }),
      });

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
    <Modal
      open={isOpen}
      onClose={onClose}
      bare
      dismissable={!isSaving}
      closeOnOutside={false}
      ariaLabel="Modify Transfer"
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
                              <td>{transferSpanLabel(transfer)}</td>
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
                              <td>{transferSpanLabel(transfer)}</td>
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

              {hasPeriodic && (
                <p className="fc-review-transfer-modal__note">
                  A <strong>Periodic</strong> transfer is one entry repeating across a range
                  of years, so it cannot be changed for a single year here — editing its
                  amount would rewrite every year in the range. Edit it in the module editor.
                </p>
              )}
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
                  <AlertTriangle size={16} />
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
    </Modal>
  );
}
