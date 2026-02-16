import { useCallback, useMemo, useState } from "react";
import "./CategorySelector.css";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively flattens a plTree into a display-ordered list with depth/type
 * metadata.  Top-level nodes with children become "header", deeper branch
 * nodes become "parent", and childless nodes become "leaf" (selectable).
 */
function flattenPlTree(nodes, depth = 0) {
  const result = [];
  if (!Array.isArray(nodes)) return result;
  for (const node of nodes) {
    if (!node?.name) continue;
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    if (hasChildren) {
      result.push({
        type: depth === 0 ? "header" : "parent",
        name: node.name,
        depth,
      });
      result.push(...flattenPlTree(node.children, depth + 1));
    } else {
      result.push({ type: "leaf", name: node.name, depth });
    }
  }
  return result;
}

/**
 * Filters a flattened hierarchy list keeping only leaves whose name matches
 * the search text (case-insensitive substring), plus any ancestor
 * header/parent entries required to preserve hierarchy context.
 */
function filterHierarchy(flatList, searchText) {
  if (!searchText.trim()) return flatList;
  const lower = searchText.trim().toLowerCase();

  // Identify which leaf indices match
  const matchingLeafIndices = new Set();
  for (let i = 0; i < flatList.length; i++) {
    if (
      flatList[i].type === "leaf" &&
      flatList[i].name.toLowerCase().includes(lower)
    ) {
      matchingLeafIndices.add(i);
    }
  }
  if (matchingLeafIndices.size === 0) return [];

  // Walk forward, tracking the most-recent header/parent at each depth.
  // When a matching leaf is found, flush its ancestor chain into the result.
  const result = [];
  const added = new Set();
  const ancestorStack = []; // index → flatList item

  for (let i = 0; i < flatList.length; i++) {
    const item = flatList[i];
    if (item.type !== "leaf") {
      ancestorStack[item.depth] = item;
      ancestorStack.length = item.depth + 1;
      continue;
    }
    if (matchingLeafIndices.has(i)) {
      for (const ancestor of ancestorStack) {
        if (ancestor && !added.has(ancestor)) {
          added.add(ancestor);
          result.push(ancestor);
        }
      }
      result.push(item);
    }
  }
  return result;
}

/**
 * Derives a CSS modifier suffix from a group value string.
 * e.g. "__group__income" → "income", "__group__expense_operational" → "expense"
 */
function groupModifier(value) {
  if (typeof value !== "string") return "";
  if (value.includes("income")) return "income";
  if (value.includes("expense")) return "expense";
  return "";
}

// ============================================================================
// Component
// ============================================================================

/**
 * Searchable, COA-hierarchy-ordered category multi-select.
 *
 * Reusable shared component – accepts a `plTree` (from useCoa) to render
 * categories in hierarchy order with type-to-filter search and group presets.
 *
 * @param {Object} props
 * @param {Array}    props.plTree              – COA tree [{name, children}, …]
 * @param {string[]} props.selectedCategories  – Currently selected values
 * @param {Function} props.onCategoriesChange  – (nextSelected: string[]) => void
 * @param {Array}    props.categoryGroupOptions – [{value, label, disabled}]
 * @param {string}   [props.id]                – Root element ID
 * @param {string}   [props.className]         – Additional CSS class
 */
export default function CategorySelector({
  plTree = [],
  selectedCategories = [],
  onCategoriesChange,
  categoryGroupOptions = [],
  id = "category-selector",
  className = "",
}) {
  const [filterText, setFilterText] = useState("");

  // Flatten tree into ordered display list
  const flattenedHierarchy = useMemo(() => flattenPlTree(plTree), [plTree]);

  // Apply search filter
  const filteredItems = useMemo(
    () => filterHierarchy(flattenedHierarchy, filterText),
    [flattenedHierarchy, filterText]
  );

  // O(1) lookup for selected state
  const selectedSet = useMemo(
    () => new Set(selectedCategories),
    [selectedCategories]
  );

  const handleItemClick = useCallback(
    (categoryName) => {
      const next = selectedSet.has(categoryName)
        ? selectedCategories.filter((c) => c !== categoryName)
        : [...selectedCategories, categoryName];
      onCategoriesChange(next);
    },
    [selectedCategories, selectedSet, onCategoriesChange]
  );

  const handleGroupClick = useCallback(
    (groupValue) => {
      const next = selectedSet.has(groupValue)
        ? selectedCategories.filter((c) => c !== groupValue)
        : [...selectedCategories, groupValue];
      onCategoriesChange(next);
    },
    [selectedCategories, selectedSet, onCategoriesChange]
  );

  const handleFilterClear = () => setFilterText("");

  const handleItemKeyDown = useCallback(
    (event, categoryName) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleItemClick(categoryName);
      }
    },
    [handleItemClick]
  );

  return (
    <div className={`category-selector${className ? ` ${className}` : ""}`} id={id}>
      {/* Search */}
      <div className="category-selector__search">
        <input
          type="text"
          className="category-selector__search-input"
          placeholder="Filter categories\u2026"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          aria-label="Filter categories"
        />
        {filterText && (
          <button
            type="button"
            className="category-selector__search-clear"
            onClick={handleFilterClear}
            aria-label="Clear filter"
          >
            &times;
          </button>
        )}
      </div>

      {/* Group preset buttons */}
      {categoryGroupOptions.length > 0 && (
        <div className="category-selector__groups">
          {categoryGroupOptions.map((group) => {
            const mod = groupModifier(group.value);
            const isSelected = selectedSet.has(group.value);
            const classes = [
              "category-selector__group-item",
              mod && `category-selector__group-item--${mod}`,
              isSelected && "category-selector__group-item--selected",
              group.disabled && "category-selector__group-item--disabled",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button
                key={group.value}
                type="button"
                className={classes}
                disabled={group.disabled}
                onClick={() => handleGroupClick(group.value)}
                aria-pressed={isSelected}
              >
                {group.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Scrollable hierarchy list */}
      <div
        className="category-selector__list"
        role="listbox"
        aria-multiselectable="true"
        aria-label="Category list"
      >
        {filteredItems.length === 0 && filterText.trim() && (
          <div className="category-selector__empty">
            No matching categories
          </div>
        )}

        {filteredItems.map((item, index) => {
          if (item.type === "header") {
            return (
              <div
                key={`h-${item.name}-${index}`}
                className="category-selector__header"
                style={{ paddingLeft: `${item.depth * 0.75 + 0.5}rem` }}
              >
                {item.name}
              </div>
            );
          }

          if (item.type === "parent") {
            return (
              <div
                key={`p-${item.name}-${index}`}
                className="category-selector__parent"
                style={{ paddingLeft: `${item.depth * 0.75 + 0.5}rem` }}
              >
                {item.name}
              </div>
            );
          }

          // leaf – selectable
          const isSelected = selectedSet.has(item.name);
          return (
            <div
              key={`l-${item.name}-${index}`}
              role="option"
              aria-selected={isSelected}
              className={`category-selector__item${isSelected ? " category-selector__item--selected" : ""}`}
              style={{ paddingLeft: `${item.depth * 0.75 + 0.5}rem` }}
              onClick={() => handleItemClick(item.name)}
              onKeyDown={(e) => handleItemKeyDown(e, item.name)}
              tabIndex={0}
            >
              {item.name}
            </div>
          );
        })}
      </div>
    </div>
  );
}
