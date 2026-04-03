import { useMemo } from "react";

/**
 * Flatten the {name, children} tree from coaSections into a list of categories.
 * coaSections format: [{ "Balance Sheet Accounts": [{name, children}, ...] }, ...]
 *
 * When includeAllNodes is false (default), only nodes with children are shown.
 * When includeAllNodes is true, ALL nodes are shown (for the move modal).
 */
function flattenNodes(coaSections, includeAllNodes = false) {
  const result = [];

  const walkNode = (node, path, depth) => {
    if (!node || typeof node !== "object" || !node.name) return;
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    if (hasChildren || includeAllNodes) {
      const fullPath = [...path, node.name];
      result.push({ name: node.name, path, fullPath, depth, isCategory: hasChildren });
      if (hasChildren) {
        for (const child of node.children) {
          walkNode(child, fullPath, depth + 1);
        }
      }
    }
  };

  for (const section of coaSections) {
    if (!section || typeof section !== "object") continue;
    for (const [sectionName, nodes] of Object.entries(section)) {
      result.push({
        name: sectionName,
        path: [],
        fullPath: [sectionName],
        depth: 0,
        isCategory: true,
      });
      if (Array.isArray(nodes)) {
        for (const node of nodes) {
          walkNode(node, [sectionName], 1);
        }
      }
    }
  }

  return result;
}

export default function COACategoryPicker({
  coaSections = [],
  selectedPath,
  onSelect,
  includeAllNodes = false,
  excludeName,
}) {
  const categories = useMemo(
    () => flattenNodes(coaSections, includeAllNodes),
    [coaSections, includeAllNodes]
  );

  const filtered = excludeName
    ? categories.filter((cat) => cat.name !== excludeName)
    : categories;

  const selectedKey = selectedPath ? selectedPath.join("|") : "";

  return (
    <div className="coa-category-picker">
      {filtered.map((cat, index) => {
        const pathKey = cat.fullPath.join("|");
        const isSelected = pathKey === selectedKey;
        return (
          <div
            key={`${pathKey}#${index}`}
            className={`coa-category-picker__item${isSelected ? " coa-category-picker__item--selected" : ""}${cat.isCategory ? " coa-category-picker__item--category" : ""}`}
            style={{ paddingLeft: `${cat.depth * 16 + 8}px` }}
            onClick={() => onSelect(cat.fullPath)}
          >
            {cat.name}
          </div>
        );
      })}
      {filtered.length === 0 && (
        <p style={{ margin: "0.5rem", color: "#A0AEB9", fontSize: "0.85rem" }}>
          No categories available.
        </p>
      )}
    </div>
  );
}
