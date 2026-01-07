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
  mode = "edit",
  isMultiEdit = false,
  selectedCount = 0,
  mixedFields = {},
}) {
  if (!open || !row) {
    return null;
  }
  const isCategoryEdit = row.isCategory || row.type === "Category";
  const isAdd = mode === "add";
  const title = isMultiEdit
    ? "Edit Accounts"
    : isAdd
    ? "Add Account"
    : "Edit Account";
  const saveLabel = isAdd ? "Add" : "Save";
  const savingLabel = isAdd ? "Adding..." : "Saving...";

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
          <div>
            <h3 style={{ margin: 0 }}>{title}</h3>
            {isMultiEdit && (
              <p style={{ margin: 0, color: "#475569", fontSize: "0.9rem" }}>
                {selectedCount} selected
              </p>
            )}
          </div>
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
            value={isMultiEdit ? "Multiple accounts selected" : row.name}
            onChange={(event) => onFieldChange("name", event.target.value)}
            disabled={isMultiEdit}
            readOnly={isMultiEdit}
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
            disabled={isCategoryEdit}
            onChange={(event) => {
              if (isCategoryEdit) return;
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
            {isMultiEdit && mixedFields?.type && (
              <option value="">Multiple values</option>
            )}
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
              disabled={isCategoryEdit}
              onChange={(event) => {
                if (isCategoryEdit) return;
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
            disabled={isCategoryEdit}
            onChange={(event) => onFieldChange("currency", event.target.value)}
          >
            {isMultiEdit && mixedFields?.currency && (
              <option value="">Multiple values</option>
            )}
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
            placeholder={
              isMultiEdit && mixedFields?.accountNumber
                ? "Multiple values"
                : undefined
            }
            disabled={isCategoryEdit}
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
            {editSaving ? savingLabel : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
