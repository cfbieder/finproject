import { useMemo } from "react";

/**
 * Flatten the {name, children} tree from coaSections into a list of categories.
 * coaSections format: [{ "Balance Sheet Accounts": [{name, children}, ...] }, ...]
 * A node is a category if it has children with their own children (i.e. not a leaf).
 */
function flattenCategories(coaSections) {
  const result = [];

  const walkNode = (node, path, depth) => {
    if (!node || typeof node !== "object" || !node.name) return;
    const hasChildBranches = Array.isArray(node.children) && node.children.length > 0;
    if (hasChildBranches) {
      const fullPath = [...path, node.name];
      result.push({ name: node.name, path, fullPath, depth });
      for (const child of node.children) {
        walkNode(child, fullPath, depth + 1);
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
}) {
  const categories = useMemo(
    () => flattenCategories(coaSections),
    [coaSections]
  );

  const selectedKey = selectedPath ? selectedPath.join("|") : "";

  return (
    <div className="coa-category-picker">
      {categories.map((cat, index) => {
        const pathKey = cat.fullPath.join("|");
        const isSelected = pathKey === selectedKey;
        return (
          <div
            key={`${pathKey}#${index}`}
            className={`coa-category-picker__item${isSelected ? " coa-category-picker__item--selected" : ""}`}
            style={{ paddingLeft: `${cat.depth * 16 + 8}px` }}
            onClick={() => onSelect(cat.fullPath)}
          >
            {cat.name}
          </div>
        );
      })}
      {categories.length === 0 && (
        <p style={{ margin: "0.5rem", color: "#94a3b8", fontSize: "0.85rem" }}>
          No categories available.
        </p>
      )}
    </div>
  );
}
