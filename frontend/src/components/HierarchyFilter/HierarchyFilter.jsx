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
 * Props:
 *   groups       — [{ key, label, node }]  where node is a { name, children } tree node
 *   onSelectionChange(leafNames[])  — called with the final list of selected leaf names
 *   extraSlot    — optional React node rendered after the checklist (e.g. Transfer Match Status)
 *   activeGroupKey / onActiveGroupChange — controlled group state (optional)
 */
export default function HierarchyFilter({
  groups,
  onSelectionChange,
  onGroupChange,
  extraSlot,
  label,
}) {
  const [activeGroup, setActiveGroup] = useState("__all__");
  // Per-group deselected items (items explicitly unchecked within the group)
  const [deselected, setDeselected] = useState({});

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

  // The currently displayed items
  const visibleItems = useMemo(() => {
    if (activeGroup === "__all__") return [];
    return groupLeaves[activeGroup] || [];
  }, [activeGroup, groupLeaves]);

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
      onGroupChange?.(key);
      // Reset deselections for the new group
      setDeselected((prev) => {
        const next = { ...prev, [key]: new Set() };
        emitSelection(key, next);
        return next;
      });
    },
    [emitSelection, onGroupChange]
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

  const activeDeselected = deselected[activeGroup] || new Set();
  const activeGroupObj = groups.find((g) => g.key === activeGroup);

  return (
    <div className="hf">
      {label && <span className="hf__label">{label}</span>}

      {/* Stage 1: Group pills */}
      <div className="hf__pills">
        <button
          type="button"
          className={`hf__pill ${activeGroup === "__all__" ? "hf__pill--active" : ""}`}
          onClick={() => handleGroupClick("__all__")}
        >
          All
        </button>
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

      {/* Stage 2: Item checklist */}
      {activeGroup !== "__all__" && visibleItems.length > 0 && (
        <div className="hf__list">
          {visibleItems.map((name) => {
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
              </label>
            );
          })}
        </div>
      )}

      {/* Extra slot — e.g. Transfer Match Status */}
      {activeGroup !== "__all__" && activeGroupObj && extraSlot}
    </div>
  );
}
