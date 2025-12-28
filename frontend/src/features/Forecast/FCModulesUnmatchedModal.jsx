/**
 * Modal for viewing and creating modules from unmatched items.
 * Displays a list of accounts/categories that aren't matched to forecast modules.
 *
 * @component
 * @param {Object} props - Component props
 * @param {boolean} props.isOpen - Whether modal is visible
 * @param {Array} props.unmatchedItems - Array of {name, category} unmatched items
 * @param {Object|null} props.selectedItem - Currently selected unmatched item
 * @param {boolean} props.loading - Whether items are being loaded
 * @param {boolean} props.creating - Whether module creation is in progress
 * @param {string} props.error - Error message if operation failed
 * @param {Function} props.onClose - Close modal callback
 * @param {Function} props.onSelectItem - Select item callback
 * @param {Function} props.onCreate - Create module from selected item callback
 * @returns {JSX.Element|null} Unmatched items modal or null if not open
 */
export default function FCModulesUnmatchedModal({
  isOpen,
  unmatchedItems,
  selectedItem,
  loading,
  creating,
  error,
  onClose,
  onSelectItem,
  onCreate,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fc-scenarios-modal-overlay">
      <div className="fc-scenarios-modal">
        <h3 className="fc-scenarios-modal__title">Unmatched Items</h3>
        <div
          style={{
            padding: "2rem 2.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
          }}
        >
          {error && (
            <div className="trans-budget-edit-modal__error">{error}</div>
          )}
          {loading ? (
            <div className="fc-modules-table__message">
              <div className="fc-modules-table__spinner" />
              <p>Loading unmatched items...</p>
            </div>
          ) : (
            <>
              <div
                style={{
                  border: "1px solid rgba(15, 23, 42, 0.1)",
                  borderRadius: "1rem",
                  maxHeight: "320px",
                  overflowY: "auto",
                }}
              >
                {unmatchedItems.length ? (
                  unmatchedItems.map((item) => (
                    <label
                      key={`${item.name}-${item.category}`}
                      className="fc-scenarios-modal__field"
                      style={{
                        margin: 0,
                        padding: "0.85rem 1rem",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                        }}
                      >
                        <input
                          type="radio"
                          name="unmatched-selection"
                          value={item.name}
                          checked={selectedItem?.name === item.name}
                          onChange={() => onSelectItem(item)}
                        />
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            lineHeight: "1.3",
                          }}
                        >
                          <span>{item.name}</span>
                          {item.category ? (
                            <span
                              style={{
                                color: "#475569",
                                fontSize: "0.9rem",
                              }}
                            >
                              {item.category}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </label>
                  ))
                ) : (
                  <div className="fc-modules-table__message">
                    <p>No unmatched items found.</p>
                  </div>
                )}
              </div>
              <div className="fc-scenarios-modal__actions">
                <button
                  type="button"
                  className="generate-report-button"
                  onClick={onClose}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="generate-report-button"
                  disabled={!selectedItem || creating}
                  onClick={onCreate}
                >
                  {creating ? "Creating..." : "+ Create"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
