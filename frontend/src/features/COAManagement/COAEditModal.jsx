export default function COAEditModal({
  open,
  row,
  onClose,
  onFieldChange,
  onSave,
  typeOptions,
  currencyOptions,
  editError,
  editSaving,
  customTypeEnabled,
  setCustomTypeEnabled,
  customTypeValue,
  setCustomTypeValue,
}) {
  if (!open || !row) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
        padding: "1rem",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "14px",
          width: "520px",
          maxWidth: "95vw",
          boxShadow: "0 18px 40px -18px rgba(15,23,42,0.35)",
          padding: "1.25rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3 style={{ margin: 0 }}>Edit Account</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid var(--border)",
              background: "#fff",
              borderRadius: "8px",
              padding: "0.4rem 0.75rem",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}
        >
          <span style={{ fontWeight: 700, color: "#0f172a" }}>Account</span>
          <input
            className="form-input"
            value={row.name}
            onChange={(event) => onFieldChange("name", event.target.value)}
          />
        </label>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}
        >
          <span style={{ fontWeight: 700, color: "#0f172a" }}>Type</span>
          <select
            className="form-input"
            value={
              customTypeEnabled && !typeOptions.includes(row.type)
                ? "__custom"
                : row.type
            }
            onChange={(event) => {
              const value = event.target.value;
              if (value === "__custom") {
                setCustomTypeEnabled(true);
                setCustomTypeValue("");
                onFieldChange("type", "");
              } else {
                setCustomTypeEnabled(false);
                setCustomTypeValue("");
                onFieldChange("type", value);
              }
            }}
          >
            {(typeOptions || [])
              .filter((option) => option !== "all")
              .map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            <option value="__custom">Add new type…</option>
          </select>
          {customTypeEnabled && (
            <input
              className="form-input"
              style={{ marginTop: "0.35rem" }}
              placeholder="Enter new type"
              value={customTypeValue}
              onChange={(event) => {
                setCustomTypeValue(event.target.value);
                onFieldChange("type", event.target.value);
              }}
            />
          )}
        </label>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}
        >
          <span style={{ fontWeight: 700, color: "#0f172a" }}>Currency</span>
          <select
            className="form-input"
            value={row.currency || ""}
            onChange={(event) => onFieldChange("currency", event.target.value)}
          >
            <option value="">Select currency</option>
            {currencyOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}
        >
          <span style={{ fontWeight: 700, color: "#0f172a" }}>Account #</span>
          <input
            className="form-input"
            value={row.accountNumber}
            onChange={(event) =>
              onFieldChange("accountNumber", event.target.value)
            }
          />
        </label>
        {editError && (
          <p style={{ margin: 0, color: "#b91c1c", fontWeight: 700 }}>
            {editError}
          </p>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
            marginTop: "0.5rem",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="coa-action-button"
            style={{ borderColor: "var(--border)" }}
            disabled={editSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="coa-action-button coa-action-button--edit"
            style={{
              color: "#fff",
              background: "#2563eb",
              borderColor: "#2563eb",
            }}
            disabled={editSaving}
          >
            {editSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
