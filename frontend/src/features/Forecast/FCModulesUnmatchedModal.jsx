import { useEffect, useMemo, useState } from "react";
import Rest from "../../js/rest";
import EmptyState from "../../components/EmptyState.jsx";
import Modal from "../../components/Modal/Modal.jsx";

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
  const [coaTraits, setCoaTraits] = useState({});
  const [traitsLoaded, setTraitsLoaded] = useState(false);

  useEffect(() => {
    if (!isOpen || traitsLoaded) {
      return;
    }

    let cancelled = false;

    const loadTraits = async () => {
      try {
        // Using v2 API (PostgreSQL)
        const data = await Rest.fetchJson("/api/v2/util/coa-traits");
        if (!cancelled && data && typeof data === "object") {
          setCoaTraits(data);
        }
      } catch (err) {
        if (!cancelled) {
          setCoaTraits({});
        }
      } finally {
        if (!cancelled) {
          setTraitsLoaded(true);
        }
      }
    };

    loadTraits();

    return () => {
      cancelled = true;
    };
  }, [isOpen, traitsLoaded]);

  const groupedItems = useMemo(() => {
    if (!Array.isArray(unmatchedItems) || unmatchedItems.length === 0) {
      return [];
    }

    const groups = new Map();

    for (let i = 0; i < unmatchedItems.length; i++) {
      const item = unmatchedItems[i];
      if (!item) continue;

      const name = item.name ?? item.Name ?? "";
      const normalizedName = typeof name === "string" ? name.trim() : "";
      const typeValue = normalizedName && coaTraits?.[normalizedName]?.Type;
      const rawType =
        (typeof typeValue === "string" && typeValue.trim()) || "Other";
      const type = rawType.charAt(0).toUpperCase() + rawType.slice(1);

      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type).push(item);
    }

    return Array.from(groups.entries()).map(([type, items]) => ({
      type,
      items,
    }));
  }, [coaTraits, unmatchedItems]);

  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      bare
      dismissable={!creating}
      closeOnOutside={false}
      ariaLabel="Unmatched Items"
    >
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
                {groupedItems.length ? (
                  groupedItems.map(({ type, items }) => (
                    <div key={type}>
                      <div
                        style={{
                          padding: "0.6rem 1rem",
                          backgroundColor: "var(--surface-muted)",
                          borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
                          fontWeight: 600,
                          color: "var(--ink)",
                        }}
                      >
                        {type}
                      </div>
                      {items.map((item, index) => (
                        <label
                          key={`${type}-${index}-${item.name || item.category || "item"}`}
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
                                    color: "var(--ink-secondary)",
                                    fontSize: "0.9rem",
                                  }}
                                >
                                  {item.category}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  ))
                ) : (
                  <EmptyState variant="searching" message="No unmatched items found." />
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
    </Modal>
  );
}
