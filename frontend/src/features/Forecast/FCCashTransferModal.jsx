import { useState, useEffect, useMemo } from "react";
import { useModules } from "./hooks/useModules.js";
import Rest from "../../js/rest.js";

export default function FCCashTransferModal({
  isOpen,
  onClose,
  title,
  year,
  scenarioName,
  onTransferComplete,
}) {
  const [transferDirection, setTransferDirection] = useState("to");
  const [amount, setAmount] = useState("");
  const [selectedModule, setSelectedModule] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const { modules, loading: modulesLoading } = useModules(scenarioName);

  // Group modules by type
  const groupedModules = useMemo(() => {
    const groups = new Map();

    for (const module of modules) {
      const type = module?.Type || "Other";
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type).push(module);
    }

    // Sort groups by type name, with "Other" at the end
    return Array.from(groups.entries())
      .sort(([typeA], [typeB]) => {
        if (typeA === "Other") return 1;
        if (typeB === "Other") return -1;
        return typeA.localeCompare(typeB);
      });
  }, [modules]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTransferDirection("to");
      setAmount("");
      setSelectedModule("");
      setSaveError("");
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleAddTransfer = async () => {
    setSaveError("");
    setIsSaving(true);

    try {
      // Find the selected module object
      const moduleToUpdate = modules.find((m) => m.Name === selectedModule);
      if (!moduleToUpdate) {
        throw new Error("Selected module not found");
      }

      // Determine transfer type based on direction
      const transferType = transferDirection === "to" ? "Dispose" : "Invest";

      // Create the transfer entry
      const transferEntry = {
        Date: `${year}-12-31`,
        Amount: parseFloat(amount),
        Flag: "OneTime",
      };

      // Get existing transfers for this type
      const existingTransfers = moduleToUpdate[transferType] || [];

      // Add new transfer to the array
      const updatedTransfers = [...existingTransfers, transferEntry];

      // Update the module with the new transfer
      const updatePayload = {
        [transferType]: updatedTransfers,
      };

      await Rest.fetchJson(`/api/forecast/modules/${moduleToUpdate._id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatePayload),
      });

      // Generate forecast (v2 API wraps v1 generator)
      const encodedScenario = encodeURIComponent(scenarioName);
      await Rest.fetchJson(`/api/v2/forecast/generate/${encodedScenario}`, {
        method: "POST",
      });

      // Notify parent and close modal
      if (onTransferComplete) {
        onTransferComplete();
      }
      onClose();
    } catch (error) {
      console.error("Failed to add transfer:", error);
      setSaveError(error.message || "Failed to add transfer");
    } finally {
      setIsSaving(false);
    }
  };

  const isFormValid = amount && selectedModule && !isNaN(parseFloat(amount));

  return (
    <div
      className="trans-budget-edit-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Cash Transfer"
    >
      <div
        className="trans-budget-edit-modal"
        style={{
          width: "min(600px, 95vw)",
          maxHeight: "75vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                color: "var(--muted)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Cash Transfer
            </p>
            <h3 style={{ margin: "0.25rem 0 0", color: "var(--ink)" }}>
              {title}
            </h3>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Transfer Direction Selector */}
          <div>
            <label
              htmlFor="transfer-direction"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.95rem",
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              Transfer Direction
            </label>
            <select
              id="transfer-direction"
              value={transferDirection}
              onChange={(e) => setTransferDirection(e.target.value)}
              className="trans-budget-edit-input"
              style={{
                width: "100%",
                padding: "0.75rem",
                fontSize: "0.95rem",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                backgroundColor: "var(--surface)",
                color: "var(--ink)",
              }}
            >
              <option value="to">Transfer To Cash</option>
              <option value="from">Transfer From Cash</option>
            </select>
          </div>

          {/* Amount Input */}
          <div>
            <label
              htmlFor="transfer-amount"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.95rem",
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              Amount of Transfer
            </label>
            <input
              id="transfer-amount"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
              className="trans-budget-edit-input"
              style={{
                width: "100%",
                padding: "0.75rem",
                fontSize: "0.95rem",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                backgroundColor: "var(--surface)",
                color: "var(--ink)",
              }}
            />
          </div>

          {/* Module Selector */}
          <div>
            <label
              htmlFor="transfer-module"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.95rem",
                fontWeight: 600,
                color: "var(--ink)",
              }}
            >
              Module
            </label>
            <select
              id="transfer-module"
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              className="trans-budget-edit-input"
              style={{
                width: "100%",
                padding: "0.75rem",
                fontSize: "0.95rem",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                backgroundColor: "var(--surface)",
                color: "var(--ink)",
              }}
              disabled={modulesLoading}
            >
              <option value="">
                {modulesLoading ? "Loading modules..." : "Select a module"}
              </option>
              {groupedModules.map(([type, moduleList], groupIndex) => (
                <optgroup key={type} label={type}>
                  {moduleList.map((module) => (
                    <option key={module.Name} value={module.Name}>
                      {module.Name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Error Display */}
          {saveError && (
            <div
              style={{
                padding: "0.75rem 1rem",
                backgroundColor: "rgba(220, 38, 38, 0.1)",
                border: "1px solid var(--danger)",
                borderRadius: "6px",
                color: "var(--danger)",
                fontSize: "0.95rem",
              }}
            >
              {saveError}
            </div>
          )}

          {/* Action Buttons */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.75rem",
              marginTop: "1rem",
            }}
          >
            <button
              type="button"
              className="generate-report-button"
              onClick={onClose}
              disabled={isSaving}
              style={{
                backgroundColor: "var(--surface-muted)",
                color: "var(--ink)",
                opacity: isSaving ? 0.5 : 1,
                cursor: isSaving ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="generate-report-button"
              onClick={handleAddTransfer}
              disabled={!isFormValid || isSaving}
              style={{
                opacity: isFormValid && !isSaving ? 1 : 0.5,
                cursor: isFormValid && !isSaving ? "pointer" : "not-allowed",
              }}
            >
              {isSaving ? "Adding Transfer..." : "Add Transfer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
