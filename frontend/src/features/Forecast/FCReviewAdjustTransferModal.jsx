import { useState, useEffect, useMemo } from "react";
import { formatAmount } from "./utils/fcReviewUtils.js";
import Rest from "../../js/rest.js";

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
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Fetch module data when modal opens
  useEffect(() => {
    if (!isOpen || !entry?.Module || !scenarioName) {
      setModuleData(null);
      setError(null);
      setEditedAmounts({});
      setSaveError("");
      return;
    }

    const fetchModuleData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await Rest.fetchJson(
          `/api/forecast/modules?scenario=${encodeURIComponent(scenarioName)}`
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
        const index = parseInt(indexStr, 10);
        const newAmount = parseFloat(editedAmounts[key]);

        if (isNaN(newAmount)) return;

        if (type === "invest") {
          const transferIndex = updatedInvest.findIndex(
            (t, i) => i === index && transfersForYear.invest.includes(t)
          );
          if (transferIndex !== -1) {
            updatedInvest[transferIndex] = {
              ...updatedInvest[transferIndex],
              Amount: newAmount,
            };
          }
        } else if (type === "dispose") {
          const transferIndex = updatedDispose.findIndex(
            (t, i) => i === index && transfersForYear.dispose.includes(t)
          );
          if (transferIndex !== -1) {
            updatedDispose[transferIndex] = {
              ...updatedDispose[transferIndex],
              Amount: newAmount,
            };
          }
        }
      });

      // Update the module
      await Rest.fetchJson(`/api/forecast/modules/${moduleData._id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Invest: updatedInvest,
          Dispose: updatedDispose,
        }),
      });

      // Generate forecast
      const encodedScenario = encodeURIComponent(scenarioName);
      await Rest.fetchJson(`/api/forecast/generate/${encodedScenario}`, {
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
      <div
        className="trans-budget-edit-modal"
        style={{
          width: "min(900px, 95vw)",
          maxHeight: "85vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
            padding: "1.5rem",
            borderBottom: "2px solid var(--border)",
            backgroundColor: "var(--surface-muted)",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: "0.75rem",
                color: "var(--muted)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Modify Transfer
            </p>
            <h3
              style={{
                margin: "0.5rem 0 0",
                color: "var(--ink)",
                fontSize: "1.25rem",
                fontWeight: 700,
              }}
            >
              {entry?.Module || "Unknown Module"}
            </h3>
            <div
              style={{
                display: "flex",
                gap: "1rem",
                marginTop: "0.5rem",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "0.25rem 0.75rem",
                  backgroundColor: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                  color: "var(--ink)",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                }}
              >
                Year: {entry?.Year || "-"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              color: "var(--muted)",
              cursor: "pointer",
              padding: "0.25rem 0.5rem",
              lineHeight: 1,
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--ink)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted)";
            }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: "2rem", overflowY: "auto" }}>
          {loading ? (
            <div
              style={{
                color: "var(--muted)",
                padding: "3rem",
                textAlign: "center",
                fontWeight: 600,
                fontSize: "1rem",
              }}
            >
              Loading transfers...
            </div>
          ) : error ? (
            <div
              style={{
                color: "var(--danger)",
                padding: "3rem",
                textAlign: "center",
                fontWeight: 600,
                fontSize: "1rem",
              }}
            >
              {error}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            {/* Invest Transfers (Transfer From Cash) */}
            <div
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "1rem 1.25rem",
                  backgroundColor: "var(--surface-muted)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <h4
                  style={{
                    margin: 0,
                    color: "var(--ink)",
                    fontSize: "1rem",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: "4px",
                      height: "16px",
                      backgroundColor: "var(--success)",
                      borderRadius: "2px",
                    }}
                  />
                  Transfer From Cash (Invest)
                </h4>
              </div>
              {transfersForYear.invest.length > 0 ? (
                <div style={{ padding: "1.25rem" }}>
                  <table
                    className="trans-budget-table"
                    style={{ marginBottom: 0 }}
                  >
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Year</th>
                        <th style={{ textAlign: "left" }}>Flag</th>
                        <th style={{ textAlign: "left", minWidth: "140px" }}>
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
                                  value={formatInputValue(currentValue)}
                                  onChange={(e) =>
                                    handleAmountChange(
                                      "invest",
                                      index,
                                      e.target.value
                                    )
                                  }
                                  onFocus={(e) => {
                                    // Remove formatting on focus for easier editing
                                    const numericValue = String(currentValue).replace(/,/g, "");
                                    e.target.value = numericValue;
                                  }}
                                  onBlur={(e) => {
                                    // Reapply formatting on blur
                                    e.target.value = formatInputValue(currentValue);
                                  }}
                                  className="trans-budget-edit-input"
                                  style={{
                                    width: "140px",
                                    padding: "0.25rem 0.5rem",
                                    fontSize: "0.95rem",
                                    border: "1px solid var(--border)",
                                    borderRadius: "4px",
                                    backgroundColor: "var(--surface)",
                                    color: "var(--ink)",
                                    textAlign: "right",
                                  }}
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
                <div
                  style={{
                    padding: "2rem 1.25rem",
                    textAlign: "center",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      color: "var(--muted)",
                      fontWeight: 600,
                      fontSize: "0.95rem",
                    }}
                  >
                    No invest transfers for this year
                  </p>
                </div>
              )}
            </div>

            {/* Dispose Transfers (Transfer To Cash) */}
            <div
              style={{
                backgroundColor: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "1rem 1.25rem",
                  backgroundColor: "var(--surface-muted)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <h4
                  style={{
                    margin: 0,
                    color: "var(--ink)",
                    fontSize: "1rem",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: "4px",
                      height: "16px",
                      backgroundColor: "var(--primary)",
                      borderRadius: "2px",
                    }}
                  />
                  Transfer To Cash (Dispose)
                </h4>
              </div>
              {transfersForYear.dispose.length > 0 ? (
                <div style={{ padding: "1.25rem" }}>
                  <table
                    className="trans-budget-table"
                    style={{ marginBottom: 0 }}
                  >
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Year</th>
                        <th style={{ textAlign: "left" }}>Flag</th>
                        <th style={{ textAlign: "left", minWidth: "140px" }}>
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
                                  value={formatInputValue(currentValue)}
                                  onChange={(e) =>
                                    handleAmountChange(
                                      "dispose",
                                      index,
                                      e.target.value
                                    )
                                  }
                                  onFocus={(e) => {
                                    // Remove formatting on focus for easier editing
                                    const numericValue = String(currentValue).replace(/,/g, "");
                                    e.target.value = numericValue;
                                  }}
                                  onBlur={(e) => {
                                    // Reapply formatting on blur
                                    e.target.value = formatInputValue(currentValue);
                                  }}
                                  className="trans-budget-edit-input"
                                  style={{
                                    width: "140px",
                                    padding: "0.25rem 0.5rem",
                                    fontSize: "0.95rem",
                                    border: "1px solid var(--border)",
                                    borderRadius: "4px",
                                    backgroundColor: "var(--surface)",
                                    color: "var(--ink)",
                                    textAlign: "right",
                                  }}
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
                <div
                  style={{
                    padding: "2rem 1.25rem",
                    textAlign: "center",
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      color: "var(--muted)",
                      fontWeight: 600,
                      fontSize: "0.95rem",
                    }}
                  >
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
          <div
            style={{
              padding: "1.5rem 2rem",
              borderTop: "2px solid var(--border)",
              backgroundColor: "var(--surface-muted)",
              position: "sticky",
              bottom: 0,
            }}
          >
            {/* Error Display */}
            {saveError && (
              <div
                style={{
                  padding: "1rem 1.25rem",
                  backgroundColor: "rgba(220, 38, 38, 0.08)",
                  border: "1px solid var(--danger)",
                  borderRadius: "6px",
                  color: "var(--danger)",
                  fontSize: "0.95rem",
                  marginBottom: "1rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                }}
              >
                <span style={{ fontSize: "1.25rem" }}>⚠</span>
                <span>{saveError}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <div
                style={{
                  fontSize: "0.875rem",
                  color: "var(--muted)",
                  fontWeight: 500,
                }}
              >
                {Object.keys(editedAmounts).length > 0 ? (
                  <span>
                    {Object.keys(editedAmounts).length} change
                    {Object.keys(editedAmounts).length !== 1 ? "s" : ""} pending
                  </span>
                ) : (
                  <span>No changes</span>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "0.75rem",
                }}
              >
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSaving}
                  style={{
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    backgroundColor: "var(--surface)",
                    color: "var(--ink)",
                    cursor: isSaving ? "not-allowed" : "pointer",
                    opacity: isSaving ? 0.5 : 1,
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSaving) {
                      e.currentTarget.style.backgroundColor =
                        "var(--surface-muted)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--surface)";
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || Object.keys(editedAmounts).length === 0}
                  style={{
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    border: "none",
                    borderRadius: "6px",
                    backgroundColor: "var(--primary)",
                    color: "white",
                    cursor:
                      !isSaving && Object.keys(editedAmounts).length > 0
                        ? "pointer"
                        : "not-allowed",
                    opacity:
                      !isSaving && Object.keys(editedAmounts).length > 0
                        ? 1
                        : 0.5,
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    if (
                      !isSaving &&
                      Object.keys(editedAmounts).length > 0
                    ) {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow =
                        "0 4px 12px rgba(0, 0, 0, 0.15)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  {isSaving ? (
                    <span>
                      <span style={{ marginRight: "0.5rem" }}>⏳</span>
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
