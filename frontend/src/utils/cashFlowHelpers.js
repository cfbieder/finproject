/**
 * Cash Flow Helper Utilities
 *
 * Specialized utilities for cash flow report processing
 */

/**
 * Adds a "Net cash flow" category to the report if not already present.
 * Calculates net cash flow as the sum of income and expenses.
 *
 * @param {Array} nodes - Array of top-level account nodes
 * @returns {Array} Modified array with Net cash flow category appended
 *
 * @example
 * const nodes = [
 *   { name: 'Income', total: 5000 },
 *   { name: 'Expenses', total: -3000 }
 * ];
 * addNetCashFlowCategory(nodes);
 * // Returns original array plus { name: 'Net cash flow', total: 2000 }
 */
export function addNetCashFlowCategory(nodes) {
  if (!Array.isArray(nodes)) {
    return [];
  }

  let incomeTotal = 0;
  let expenseTotal = 0;
  let hasNetCashFlow = false;

  const result = nodes.map((node) => {
    if (!node || typeof node !== "object") {
      return node;
    }

    const name = typeof node.name === "string" ? node.name : "";
    const normalized = name.toLowerCase();

    if (normalized === "income") {
      incomeTotal = typeof node.total === "number" ? node.total : 0;
    } else if (normalized === "expense" || normalized === "expenses") {
      expenseTotal = typeof node.total === "number" ? node.total : 0;
    } else if (normalized === "net cash flow") {
      hasNetCashFlow = true;
    }

    return node;
  });

  if (hasNetCashFlow) {
    return result;
  }

  return [
    ...result,
    { name: "Net cash flow", total: incomeTotal + expenseTotal },
  ];
}

/**
 * Builds a value map for cash flow nodes using 'total' field.
 * Similar to buildAccountValueMap but for cash flow reports.
 *
 * @param {Array} nodes - Array of cash flow nodes
 * @param {Array<string>} path - Current path in traversal
 * @param {Map<string, number>} map - Accumulated map of path -> value
 * @returns {Map<string, number>} Map of path strings to total values
 *
 * @example
 * const nodes = [{ name: 'Income', total: 5000, children: [...] }];
 * const map = buildCashFlowValueMap(nodes);
 * map.get('Income'); // 5000
 */
export function buildCashFlowValueMap(nodes, path = [], map = new Map()) {
  if (!Array.isArray(nodes)) {
    return map;
  }

  for (const node of nodes) {
    if (!node) continue;

    const key = [...path, node.name].join(">");
    map.set(key, node.total);

    if (Array.isArray(node.children) && node.children.length > 0) {
      buildCashFlowValueMap(node.children, [...path, node.name], map);
    }
  }

  return map;
}
