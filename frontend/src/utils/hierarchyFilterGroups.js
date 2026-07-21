/**
 * Build HierarchyFilter group lists ({ key, label, node }) from the COA trees.
 *
 * Extracted from BudgetWorksheetV2's inline derivation so the Cash Flow
 * "By Account" tab (CR054) reuses the exact same Categories/Accounts chip
 * grouping the Budget Worksheet uses.
 */

/**
 * Category groups from the P&L tree: Income, Expense (minus Transfers), and
 * Transfers split out as its own chip.
 */
export function buildCategoryFilterGroups(plTree) {
  if (!plTree?.length) return [];
  const groups = [];
  for (const node of plTree) {
    if (node.name === "Income") {
      groups.push({ key: "income", label: "Income", node });
    } else if (node.name === "Expense") {
      const transferNode = node.children?.find((c) => c.name === "Transfers");
      const expenseChildren = (node.children || []).filter(
        (c) => c.name !== "Transfers"
      );
      groups.push({
        key: "expense",
        label: "Expense",
        node: { ...node, children: expenseChildren },
      });
      if (transferNode) {
        groups.push({ key: "transfers", label: "Transfers", node: transferNode });
      }
    } else {
      groups.push({ key: node.name, label: node.name, node });
    }
  }
  return groups;
}

/**
 * Account groups from the balance-sheet tree: one chip per account type
 * (children of Assets/Liabilities), e.g. Bank Accounts, Fidelity Stock, …
 */
export function buildAccountFilterGroups(bsTree) {
  if (!bsTree?.length) return [];
  const groups = [];
  for (const topNode of bsTree) {
    if (topNode.children?.length) {
      for (const child of topNode.children) {
        groups.push({ key: child.name, label: child.name, node: child });
      }
    } else {
      groups.push({ key: topNode.name, label: topNode.name, node: topNode });
    }
  }
  return groups;
}
