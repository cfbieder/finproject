import { useCallback, useMemo, useState } from "react";
import "./HierarchyFilter.css";

/**
 * Recursively collect all leaf node names from a { name, children } tree.
 */
const collectLeaves = (nodes, out = []) => {
  for (const n of nodes) {
    if (n.children?.length) collectLeaves(n.children, out);
    else if (n.name?.trim()) out.push(n.name.trim());
  }
  return out;
};

/**
 * HierarchyFilter — two-stage cascading filter.
 *
 * Stage 1: Quick-select pill buttons for top-level groups (+ "All").
 * Stage 2: Compact scrollable checklist of leaf items under the active group.
 *          Checking/unchecking narrows the selection within the group.
 *
 * In `singleSelect` mode the "All" pill is hidden and the checklist becomes a
 * radio-style single pick — selecting an item emits exactly one leaf. Used by
 * the Ledger, whose running balance only makes sense for one account.
 *
 * Props:
 *   groups       — [{ key, label, node }]  where node is a { name, children } tree node
 *   onSelectionChange(leafNames[])  — called with the final list of selected leaf names
 *   extraSlot    — optional React node rendered after the checklist (e.g. Transfer Match Status)
 *   singleSelect — radio-style single pick (default false)
 *   selectedLeaf — controlled single selection (only used when singleSelect)
 *   getItemSuffix(name) — optional fn returning a suffix string per item (e.g. currency)
 *   activeGroupKey / onActiveGroupChange — controlled group state (optional)
 */
export default function HierarchyFilter({
  groups,
  onSelectionChange,
  onGroupChange,
  extraSlot,
  label,
  singleSelect = false,
  selectedLeaf = null,
  getItemSuffix,
}) {
  const findGroupOfLeaf = (leaf) => {
    if (!leaf) return null;
    for (const g of groups) {
      const leaves = g.node?.children?.length
        ? collectLeaves(g.node.children)
        : g.node?.name
          ? [g.node.name]
          : [];
      if (leaves.includes(leaf)) return g.key;
    }
    return null;
  };

  const [activeGroup, setActiveGroup] = useState(() => {
    if (singleSelect) {
      return findGroupOfLeaf(selectedLeaf) ?? groups[0]?.key ?? "__all__";
    }
    return "__all__";
  });
  // Per-group deselected items (items explicitly unchecked within the group)
  const [deselected, setDeselected] = useState({});
  // Type-to-narrow text for the visible checklist
  const [filterText, setFilterText] = useState("");

  // Derive the leaves for each group
  const groupLeaves = useMemo(() => {
    const map = {};
    for (const g of groups) {
      map[g.key] = g.node?.children?.length
        ? collectLeaves(g.node.children)
        : g.node?.name
          ? [g.node.name]
          : [];
    }
    return map;
  }, [groups]);

  // The currently displayed items (narrowed by filterText)
  const visibleItems = useMemo(() => {
    if (activeGroup === "__all__") return [];
    const all = groupLeaves[activeGroup] || [];
    const q = filterText.trim().toLowerCase();
    if (!q) return all;
    return all.filter((n) => n.toLowerCase().includes(q));
  }, [activeGroup, groupLeaves, filterText]);

  // Compute the effective selected leaves and notify parent
  const emitSelection = useCallback(
    (groupKey, deselectedMap) => {
      if (groupKey === "__all__") {
        onSelectionChange([]);
        return;
      }
      const all = groupLeaves[groupKey] || [];
      const ds = deselectedMap[groupKey] || new Set();
      const selected = ds.size > 0 ? all.filter((n) => !ds.has(n)) : all;
      onSelectionChange(selected);
    },
    [groupLeaves, onSelectionChange]
  );

  const handleGroupClick = useCallback(
    (key) => {
      setActiveGroup(key);
      setFilterText("");
      onGroupChange?.(key);
      // Single-select only opens the group; selection happens on item click.
      if (singleSelect) return;
      // Reset deselections for the new group
      setDeselected((prev) => {
        const next = { ...prev, [key]: new Set() };
        emitSelection(key, next);
        return next;
      });
    },
    [emitSelection, onGroupChange, singleSelect]
  );

  const handleItemToggle = useCallback(
    (itemName) => {
      setDeselected((prev) => {
        const current = new Set(prev[activeGroup] || []);
        if (current.has(itemName)) current.delete(itemName);
        else current.add(itemName);
        const next = { ...prev, [activeGroup]: current };
        emitSelection(activeGroup, next);
        return next;
      });
    },
    [activeGroup, emitSelection]
  );

  // Right-click: solo-select one item (deselect all others)
  const handleSoloSelect = useCallback(
    (itemName, e) => {
      e.preventDefault();
      const all = groupLeaves[activeGroup] || [];
      setDeselected((prev) => {
        const ds = new Set(all.filter((n) => n !== itemName));
        const next = { ...prev, [activeGroup]: ds };
        emitSelection(activeGroup, next);
        return next;
      });
    },
    [activeGroup, groupLeaves, emitSelection]
  );

  // Single-select: pick exactly one leaf and emit it
  const handleSingleSelect = useCallback(
    (itemName) => {
      onSelectionChange([itemName]);
    },
    [onSelectionChange]
  );

  const activeDeselected = deselected[activeGroup] || new Set();
  const activeGroupObj = groups.find((g) => g.key === activeGroup);

  return (
    <div className="hf">
      {label && <span className="hf__label">{label}</span>}

      {/* Stage 1: Group pills */}
      <div className="hf__pills">
        {!singleSelect && (
          <button
            type="button"
            className={`hf__pill ${activeGroup === "__all__" ? "hf__pill--active" : ""}`}
            onClick={() => handleGroupClick("__all__")}
          >
            All
          </button>
        )}
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`hf__pill ${activeGroup === g.key ? "hf__pill--active" : ""}`}
            onClick={() => handleGroupClick(g.key)}
          >
            {g.label}
            <span className="hf__pill-count">{(groupLeaves[g.key] || []).length}</span>
          </button>
        ))}
      </div>

      {/* Type-to-narrow search (only when a specific group is active) */}
      {activeGroup !== "__all__" && (groupLeaves[activeGroup]?.length || 0) > 0 && (
        <div className="hf__search">
          <input
            type="text"
            className="hf__search-input"
            placeholder={`Filter ${activeGroupObj?.label?.toLowerCase() || "items"}…`}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            aria-label="Filter items"
          />
          {filterText && (
            <button
              type="button"
              className="hf__search-clear"
              onClick={() => setFilterText("")}
              aria-label="Clear filter"
            >
              &times;
            </button>
          )}
        </div>
      )}

      {/* Stage 2: Item checklist */}
      {activeGroup !== "__all__" && visibleItems.length > 0 && (
        <div className="hf__list">
          {visibleItems.map((name) => {
            const suffix = getItemSuffix?.(name);
            if (singleSelect) {
              const checked = selectedLeaf === name;
              return (
                <label
                  key={name}
                  className={`hf__item ${checked ? "hf__item--selected" : ""}`}
                >
                  <input
                    type="radio"
                    className="hf__radio"
                    name={`hf-single-${label || "group"}`}
                    checked={checked}
                    onChange={() => handleSingleSelect(name)}
                  />
                  <span className="hf__item-name">{name}</span>
                  {suffix && <span className="hf__item-suffix">{suffix}</span>}
                </label>
              );
            }
            const checked = !activeDeselected.has(name);
            return (
              <label
                key={name}
                className={`hf__item ${!checked ? "hf__item--off" : ""}`}
                onContextMenu={(e) => handleSoloSelect(name, e)}
                title="Right-click to select only this item"
              >
                <input
                  type="checkbox"
                  className="hf__checkbox"
                  checked={checked}
                  onChange={() => handleItemToggle(name)}
                />
                <span className="hf__item-name">{name}</span>
                {suffix && <span className="hf__item-suffix">{suffix}</span>}
              </label>
            );
          })}
        </div>
      )}

      {activeGroup !== "__all__" &&
        (groupLeaves[activeGroup]?.length || 0) > 0 &&
        visibleItems.length === 0 && (
          <div className="hf__empty">No matching items</div>
        )}

      {/* Extra slot — e.g. Transfer Match Status */}
      {activeGroup !== "__all__" && activeGroupObj && extraSlot}
    </div>
  );
}
