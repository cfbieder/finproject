import COACategoryPicker from "./COACategoryPicker.jsx";
import Modal from "../../components/Modal/Modal.jsx";

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

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
  coaSections = [],
  parentPath = [],
  onParentPathChange,
}) {
  if (!open || !row) {
    return null;
  }
  const isCategoryEdit = row.isCategory || row.type === "Category";
  const isAdd = mode === "add" || mode === "quickadd" || mode === "quickadd-category";
  const isQuickAdd = mode === "quickadd" || mode === "quickadd-category";
  const isQuickAddCategory = mode === "quickadd-category";
  const isCategoryAdd = isAdd && row.isCategory;
  const showCategoryPicker = isQuickAdd || (mode === "add" && !parentPath?.length);
  const title = isMultiEdit
    ? "Edit Accounts"
    : isQuickAddCategory
    ? "Add Missing Category"
    : mode === "quickadd"
    ? "Add Missing Account"
    : isCategoryAdd
    ? "Add Category"
    : isAdd
    ? "Add Account"
    : "Edit Account";
  const saveLabel = isAdd ? "Add" : "Save";
  const savingLabel = isAdd ? "Adding..." : "Saving...";

  return (
    // <Modal bare>: Radix supplies the portal, the overlay, the focus trap, ESC, and the
    // dialog ARIA role. The hand-rolled `position: fixed` overlay this replaces had NONE of
    // them — and it was not even a *bespoke* dialog, it was an unlabelled div, so assistive
    // tech was never told a dialog had opened at all. (That is why it never showed up in the
    // modal-adoption baseline: that guard counts overlays that at least declare themselves.)
    // `bare` keeps this card's own look, so the migration is visually 1:1 — the same pattern
    // used for the ten Forecast dialogs in CR042 U4.
    <Modal open={open} onClose={onClose} bare closeOnOutside={false} ariaLabel={title}>
      <div
        style={{
          background: "var(--surface)",
          borderRadius: "14px",
          width: isQuickAdd ? "600px" : "520px",
          maxWidth: "95vw",
          maxHeight: "90vh",
          overflowY: "auto",
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
              <p style={{ margin: 0, color: "#4A5568", fontSize: "0.9rem" }}>
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
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}
        >
          <label htmlFor="coa-edit-name" style={{ fontWeight: 700, color: "var(--ink)" }}>
            {isQuickAddCategory ? "Category" : "Account"}
          </label>
          <input
            id="coa-edit-name"
            className="form-input"
            value={isMultiEdit ? "Multiple accounts selected" : row.name}
            onChange={(event) => onFieldChange("name", event.target.value)}
            disabled={isMultiEdit}
            readOnly={isMultiEdit}
          />
        </div>
        {mode === "add" && !isQuickAdd && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 0.75rem",
              background: "#f8fafc",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={!!row.isCategory}
              onChange={(e) => onFieldChange("isCategory", e.target.checked)}
              style={{ width: "16px", height: "16px", accentColor: "#6B8E6B" }}
            />
            <span style={{ fontWeight: 600, color: "#4A5568", fontSize: "0.9rem" }}>
              Create as category (container for sub-accounts)
            </span>
          </label>
        )}
        {(isQuickAdd || showCategoryPicker) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.35rem",
            }}
          >
            <span style={{ fontWeight: 700, color: "#2D3436" }}>
              {isCategoryAdd || isQuickAddCategory ? "Place under parent category" : "Place under category"}
            </span>
            <COACategoryPicker
              coaSections={coaSections}
              selectedPath={parentPath}
              onSelect={onParentPathChange}
            />
            {parentPath && parentPath.length > 0 && (
              <span
                style={{
                  fontSize: "0.8rem",
                  color: "#4A5568",
                  marginTop: "0.15rem",
                }}
              >
                Selected: {parentPath.join(" \u203A ")}
              </span>
            )}
          </div>
        )}
        {/* Source Mappings — shown when the edited row has a corresponding category or account */}
        {!isAdd && (row.categoryId || row.accountId) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              padding: "0.75rem",
              background: "#f8fafc",
              borderRadius: "8px",
              border: "1px solid var(--border)",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#2D3436" }}>
              Source Mappings
            </span>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "#4A5568", fontWeight: 600 }}>
                PocketSmith Name
              </span>
              <input
                className="form-input"
                value={row.pocketsmithName ?? ""}
                onChange={(e) => onFieldChange("pocketsmithName", e.target.value)}
                placeholder="Not mapped"
              />
            </label>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <span style={{ fontSize: "0.8rem", color: "#4A5568", fontWeight: 600 }}>
                Quicken Name
              </span>
              <input
                className="form-input"
                value={row.quickenName ?? ""}
                onChange={(e) => onFieldChange("quickenName", e.target.value)}
                placeholder="Not mapped"
              />
            </label>
          </div>
        )}
        {/* The <label> must sit BESIDE the control, not wrap it. A label that wraps a <select>
            takes every <option>'s text into its accessible name — so this field announced
            itself as "Type asset liability equity income expense…" to a screen reader, and
            getByLabel("Type") could not find it either. htmlFor/id cannot fix that while the
            control is still inside the label; the wrapper has to become a plain div. */}
        {!isQuickAddCategory && !isCategoryAdd && <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}
        >
          <label htmlFor="coa-edit-type" style={{ fontWeight: 700, color: "var(--ink)" }}>
            Type
          </label>
          <select
            id="coa-edit-type"
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
                  {capitalize(option)}
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
        </div>}
        {!isQuickAddCategory && !isCategoryAdd && <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}
        >
          <label htmlFor="coa-edit-currency" style={{ fontWeight: 700, color: "var(--ink)" }}>
            Currency
          </label>
          <select
            id="coa-edit-currency"
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
        </div>}
        {!isQuickAddCategory && !isCategoryAdd && <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.35rem",
          }}
        >
          <label
            htmlFor="coa-edit-account-number"
            style={{ fontWeight: 700, color: "var(--ink)" }}
          >
            Account #
          </label>
          <input
            id="coa-edit-account-number"
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
        </div>}
        {editError && (
          <p style={{ margin: 0, color: "var(--danger)", fontWeight: 700 }}>
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
              background: "#6B8E6B",
              borderColor: "#6B8E6B",
            }}
            disabled={editSaving}
          >
            {editSaving ? savingLabel : saveLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
