/**
 * COA tree → picker sections.
 *
 * Plain module, not a component file: `react-refresh/only-export-components` is
 * a ratchet that may only shrink, and exporting these from MobileCategoryPicker
 * would add to it.
 *
 * A "section" is `{ name, items: string[] }` — exactly what MobilePickerSheet
 * renders, and `items` are leaf names, which is what the transactions API
 * filters on (`?category=`/`?account=` take leaf names).
 */

/** Every leaf name under `node`, depth-first. */
const collectLeaves = (node, out = []) => {
  const children = Array.isArray(node?.children) ? node.children : [];
  if (children.length === 0) {
    if (node?.name) out.push(node.name);
    return out;
  }
  for (const child of children) collectLeaves(child, out);
  return out;
};

/**
 * Group a tree's leaves under their TOP-LEVEL parent.
 * For the P&L tree that is Income / Expense, with nested branches (Transfers)
 * flattened into their top-level group rather than becoming groups of their own.
 */
export function collectGroupedLeaves(tree) {
  const groups = [];
  if (!Array.isArray(tree)) return groups;
  for (const top of tree) {
    const leaves = collectLeaves(top);
    if (leaves.length > 0) {
      groups.push({ name: top.name, items: leaves.sort() });
    }
  }
  return groups;
}

/**
 * Group the balance-sheet tree one level DEEPER than collectGroupedLeaves.
 *
 * Grouping accounts by the top level would give two sections — Assets and
 * Liabilities — one of them 30+ items long, which is a scroll, not a choice.
 * Desktop's HierarchyFilter groups by the children of each top node (Current
 * Assets, Investments, Credit Cards …); this matches it so the two pages offer
 * the same buckets.
 */
export function collectAccountSections(bsTree) {
  const groups = [];
  if (!Array.isArray(bsTree)) return groups;
  for (const top of bsTree) {
    const children = Array.isArray(top?.children) ? top.children : [];
    if (children.length === 0) {
      const leaves = collectLeaves(top);
      if (leaves.length > 0) groups.push({ name: top.name, items: leaves.sort() });
      continue;
    }
    for (const child of children) {
      const leaves = collectLeaves(child);
      if (leaves.length > 0) {
        groups.push({ name: child.name, items: leaves.sort() });
      }
    }
  }
  return groups;
}
