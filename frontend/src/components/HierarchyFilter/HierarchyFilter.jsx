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
 * In `multiGroup` mode the pills become TOGGLES: several groups can be active
 * at once and the checklist stacks them under sub-headers, so a selection can
 * span groups (Bank Accounts *and* PLN Credit Cards). The emitted value is the
 * union of the checked leaves. ⚠️ Off by default on purpose — in the standard
 * mode a second pill click REPLACES the selection, and six other surfaces
 * (Ledger, TransActual, TransBudget, BalanceTrends, BudgetWorksheetV2, the FC
 * line drill-down) depend on that. The groups this filter is built from are
 * disjoint (`buildAccountFilterGroups` emits one chip per account-type node),
 * so the union can never double-count a leaf.
 *
 * Props:
 *   groups       — [{ key, label, node }]  where node is a { name, children } tree node
 *   onSelectionChange(leafNames[])  — called with the final list of selected leaf names
 *   extraSlot    — optional React node rendered after the checklist (e.g. Transfer Match Status)
 *   singleSelect — radio-style single pick (default false)
 *   selectedLeaf — controlled single selection (only used when singleSelect)
 *   multiGroup   — pills toggle; the selection may span groups (default false)
 *   getItemSuffix(name) — optional fn returning a suffix string per item (e.g. currency)
 *   onGroupChange(key)  — notified when the active group changes
 *   initialGroupKey — open on this group instead of "All". For a filter that arrives
 *                     ALREADY narrowed (the FC-line drill-down opens on the line's own
 *                     accounts), starting on "All" would contradict the rows on screen.
 */
export default function HierarchyFilter({
  groups,
  onSelectionChange,
  onGroupChange,
  extraSlot,
  label,
  singleSelect = false,
  selectedLeaf = null,
  multiGroup = false,
  getItemSuffix,
  initialGroupKey = null,
}) {
  const isMultiGroup = multiGroup && !singleSelect;

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

  // The groups whose items are on screen and contributing to the selection.
  // Standard/singleSelect mode holds 0 or 1 keys, so the render below is
  // unchanged for every existing caller; multiGroup mode holds any number.
  const [activeKeys, setActiveKeys] = useState(() => {
    if (singleSelect) {
      const k = findGroupOfLeaf(selectedLeaf) ?? groups[0]?.key ?? null;
      return k ? [k] : [];
    }
    return initialGroupKey ? [initialGroupKey] : [];
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

  // The items on screen per active group, narrowed by filterText.
  const visibleByGroup = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return activeKeys.map((key) => {
      const all = groupLeaves[key] || [];
      return {
        key,
        items: q ? all.filter((n) => n.toLowerCase().includes(q)) : all,
      };
    });
  }, [activeKeys, groupLeaves, filterText]);

  const visibleCount = visibleByGroup.reduce((n, g) => n + g.items.length, 0);

  // Compute the effective selected leaves and notify parent. No active group
  // means no filter at all — NOT "everything checked" — which is what the
  // "All" pill has always emitted.
  const emitSelection = useCallback(
    (keys, deselectedMap) => {
      const selected = [];
      for (const key of keys) {
        const all = groupLeaves[key] || [];
        const ds = deselectedMap[key] || new Set();
        for (const n of all) if (!ds.has(n)) selected.push(n);
      }
      onSelectionChange(selected);
    },
    [groupLeaves, onSelectionChange]
  );

  const handleGroupClick = useCallback(
    (key) => {
      setFilterText("");
      onGroupChange?.(key);

      if (key === "__all__") {
        setActiveKeys([]);
        setDeselected({});
        onSelectionChange([]);
        return;
      }

      // Single-select only opens the group; selection happens on item click.
      if (singleSelect) {
        setActiveKeys([key]);
        return;
      }

      setActiveKeys((prevKeys) => {
        const isOn = prevKeys.includes(key);
        // multiGroup: toggle this group in/out. Standard: replace.
        const nextKeys = isMultiGroup
          ? isOn
            ? prevKeys.filter((k) => k !== key)
            : [...prevKeys, key]
          : [key];
        // A group that comes back on starts fully checked, matching what
        // opening a group has always done.
        setDeselected((prev) => {
          const next = { ...prev, [key]: new Set() };
          emitSelection(nextKeys, next);
          return next;
        });
        return nextKeys;
      });
    },
    [
      emitSelection,
      isMultiGroup,
      onGroupChange,
      onSelectionChange,
      singleSelect,
    ]
  );

  const handleItemToggle = useCallback(
    (groupKey, itemName) => {
      setDeselected((prev) => {
        const current = new Set(prev[groupKey] || []);
        if (current.has(itemName)) current.delete(itemName);
        else current.add(itemName);
        const next = { ...prev, [groupKey]: current };
        emitSelection(activeKeys, next);
        return next;
      });
    },
    [activeKeys, emitSelection]
  );

  // Right-click: solo-select one item (deselect all others). Across EVERY
  // active group — "only this item" has to mean the emitted list is exactly
  // this item, not "this item plus another group's whole list".
  const handleSoloSelect = useCallback(
    (groupKey, itemName, e) => {
      e.preventDefault();
      setDeselected((prev) => {
        const next = { ...prev };
        for (const key of activeKeys) {
          const all = groupLeaves[key] || [];
          next[key] = new Set(
            all.filter((n) => !(key === groupKey && n === itemName))
          );
        }
        emitSelection(activeKeys, next);
        return next;
      });
    },
    [activeKeys, groupLeaves, emitSelection]
  );

  // Single-select: pick exactly one leaf and emit it
  const handleSingleSelect = useCallback(
    (itemName) => {
      onSelectionChange([itemName]);
    },
    [onSelectionChange]
  );

  const hasActiveGroup = activeKeys.length > 0;
  const showGroupHeadings = isMultiGroup && activeKeys.length > 1;
  const firstActiveGroupObj = groups.find((g) => g.key === activeKeys[0]);
  const selectedCount = activeKeys.reduce((n, key) => {
    const all = groupLeaves[key] || [];
    const ds = deselected[key] || new Set();
    return n + all.filter((x) => !ds.has(x)).length;
  }, 0);

  return (
    <div className={`hf ${isMultiGroup ? "hf--multi" : ""}`}>
      {label && <span className="hf__label">{label}</span>}

      {/* Stage 1: Group pills */}
      <div className="hf__pills">
        {!singleSelect && (
          <button
            type="button"
            className={`hf__pill ${!hasActiveGroup ? "hf__pill--active" : ""}`}
            onClick={() => handleGroupClick("__all__")}
          >
            All
          </button>
        )}
        {groups.map((g) => {
          const on = activeKeys.includes(g.key);
          return (
            <button
              key={g.key}
              type="button"
              className={`hf__pill ${on ? "hf__pill--active" : ""}`}
              aria-pressed={isMultiGroup ? on : undefined}
              title={
                isMultiGroup
                  ? on
                    ? `Remove ${g.label} from the selection`
                    : `Add ${g.label} to the selection`
                  : undefined
              }
              onClick={() => handleGroupClick(g.key)}
            >
              {g.label}
              <span className="hf__pill-count">
                {(groupLeaves[g.key] || []).length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Type-to-narrow search (only when at least one group is active) */}
      {hasActiveGroup && (
        <div className="hf__search">
          <input
            type="text"
            className="hf__search-input"
            placeholder={
              showGroupHeadings
                ? "Filter selected items…"
                : `Filter ${firstActiveGroupObj?.label?.toLowerCase() || "items"}…`
            }
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

      {/* Stage 2: Item checklist, one section per active group */}
      {hasActiveGroup && visibleCount > 0 && (
        <div className="hf__list">
          {visibleByGroup.map(({ key, items }) => {
            if (items.length === 0) return null;
            const groupDeselected = deselected[key] || new Set();
            return (
              <div key={key} className="hf__section">
                {showGroupHeadings && (
                  <div className="hf__section-heading">
                    {groups.find((g) => g.key === key)?.label ?? key}
                  </div>
                )}
                {items.map((name) => {
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
                        {suffix && (
                          <span className="hf__item-suffix">{suffix}</span>
                        )}
                      </label>
                    );
                  }
                  const checked = !groupDeselected.has(name);
                  return (
                    <label
                      key={name}
                      className={`hf__item ${!checked ? "hf__item--off" : ""}`}
                      onContextMenu={(e) => handleSoloSelect(key, name, e)}
                      title="Right-click to select only this item"
                    >
                      <input
                        type="checkbox"
                        className="hf__checkbox"
                        checked={checked}
                        onChange={() => handleItemToggle(key, name)}
                      />
                      <span className="hf__item-name">{name}</span>
                      {suffix && (
                        <span className="hf__item-suffix">{suffix}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {hasActiveGroup && visibleCount === 0 && (
        <div className="hf__empty">No matching items</div>
      )}

      {/* What the pills add up to — without it, a selection spanning groups is
          only legible by clicking through every pill. */}
      {isMultiGroup && hasActiveGroup && (
        <div className="hf__summary">
          {selectedCount} selected across {activeKeys.length}{" "}
          {activeKeys.length === 1 ? "group" : "groups"}
        </div>
      )}

      {/* Extra slot — e.g. Transfer Match Status */}
      {hasActiveGroup && firstActiveGroupObj && extraSlot}
    </div>
  );
}
