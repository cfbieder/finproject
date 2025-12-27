/**
 * Tree Traversal Utilities
 *
 * Shared utilities for working with hierarchical account/category trees
 */

/**
 * Recursively collects paths to all nodes that have children (collapsible nodes).
 * Used for managing expand/collapse state in tree views.
 *
 * @param {Array} nodes - Array of tree nodes with potential children
 * @param {Array<string>} path - Current path being traversed (for recursion)
 * @param {Set<string>} result - Accumulated set of collapsible path keys
 * @returns {Set<string>} Set of path strings in format "parent>child>grandchild"
 *
 * @example
 * const accounts = [
 *   { name: 'Assets', children: [{ name: 'Cash' }] },
 *   { name: 'Liabilities', children: [] }
 * ];
 * const paths = collectCollapsiblePaths(accounts);
 * // Returns Set(['Assets']) - only Assets has children
 */
export function collectCollapsiblePaths(nodes, path = [], result = new Set()) {
  if (!Array.isArray(nodes)) {
    return result;
  }

  for (const node of nodes) {
    const hasChildren =
      node &&
      Array.isArray(node.children) &&
      node.children.length > 0;

    if (hasChildren) {
      const key = [...path, node.name].join(">");
      result.add(key);
      collectCollapsiblePaths(node.children, [...path, node.name], result);
    }
  }

  return result;
}

/**
 * Builds a map of account paths to their values for quick lookup.
 * Used for comparison columns in reports.
 *
 * @param {Array} nodes - Array of account nodes with totalUSD or total values
 * @param {Array<string>} path - Current path in traversal
 * @param {Map<string, number>} map - Accumulated map of path -> value
 * @param {string} valueKey - Property name to extract (default: 'totalUSD')
 * @returns {Map<string, number>} Map of path strings to numeric values
 *
 * @example
 * const accounts = [
 *   { name: 'Assets', totalUSD: 1000, children: [
 *     { name: 'Cash', totalUSD: 500 }
 *   ]}
 * ];
 * const map = buildAccountValueMap(accounts);
 * map.get('Assets') // 1000
 * map.get('Assets>Cash') // 500
 */
export function buildAccountValueMap(
  nodes,
  path = [],
  map = new Map(),
  valueKey = 'totalUSD'
) {
  if (!Array.isArray(nodes)) {
    return map;
  }

  for (const node of nodes) {
    if (!node) continue;

    const key = [...path, node.name].join(">");
    map.set(key, node[valueKey]);

    if (Array.isArray(node.children) && node.children.length > 0) {
      buildAccountValueMap(node.children, [...path, node.name], map, valueKey);
    }
  }

  return map;
}

/**
 * Recursively collects all leaf node names from a tree structure.
 * Leaf nodes are nodes without children.
 *
 * @param {Object} node - Tree node with optional children array
 * @returns {Array<string>} Array of leaf node names
 *
 * @example
 * const tree = {
 *   name: 'Root',
 *   children: [
 *     { name: 'Branch', children: [{ name: 'Leaf1' }] },
 *     { name: 'Leaf2' }
 *   ]
 * };
 * collectLeafNames(tree); // ['Leaf1', 'Leaf2']
 */
export function collectLeafNames(node) {
  if (!node || typeof node !== "object") {
    return [];
  }

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  if (!hasChildren) {
    return typeof node.name === "string" && node.name.trim()
      ? [node.name]
      : [];
  }

  return node.children.flatMap(collectLeafNames);
}

/**
 * Finds a node in a tree by path.
 *
 * @param {Array} nodes - Root level nodes
 * @param {Array<string>} pathSegments - Path segments to traverse
 * @returns {Object|null} Found node or null
 *
 * @example
 * const nodes = [{ name: 'Assets', children: [{ name: 'Cash', total: 100 }] }];
 * const node = findNodeByPath(nodes, ['Assets', 'Cash']);
 * // Returns { name: 'Cash', total: 100 }
 */
export function findNodeByPath(nodes, pathSegments) {
  if (!Array.isArray(nodes) || !Array.isArray(pathSegments)) {
    return null;
  }

  if (pathSegments.length === 0) {
    return null;
  }

  const [first, ...rest] = pathSegments;
  const node = nodes.find(n => n && n.name === first);

  if (!node) {
    return null;
  }

  if (rest.length === 0) {
    return node;
  }

  return findNodeByPath(node.children || [], rest);
}
