/**
 * FC Review Utility Functions
 * Pure utility functions for forecast review features
 */

/**
 * Parses hierarchical account data from Chart of Accounts.
 *
 * Converts nested COA structure into a flat array with level indicators,
 * and optionally creates a mapping from leaf accounts to their parent categories.
 *
 * @param {Array} data - Raw COA data from API
 * @param {boolean} includeMapping - Whether to build account-to-parent mapping
 * @returns {Object} { rows: Array, mapping: Map }
 *   - rows: Flat array of { label, level } objects
 *   - mapping: Map of account name -> { level1, level2 }
 */
export const parseLevelAccounts = (data, includeMapping = false) => {
  if (!Array.isArray(data)) {
    return { rows: [], mapping: new Map() };
  }

  const mapping = new Map();
  const rows = data.flatMap((group) => {
    if (!group || typeof group !== "object") {
      return [];
    }

    return Object.entries(group).flatMap(([level1, children]) => {
      const rows = [{ label: level1, level: 1 }];

      if (Array.isArray(children)) {
        for (const child of children) {
          if (!child || typeof child !== "object") {
            continue;
          }

          const [level2] = Object.keys(child);
          if (level2) {
            rows.push({ label: level2, level: 2 });

            // Build mapping for leaf accounts if requested
            if (includeMapping) {
              mapping.set(level2, { level2, level1 });

              // Recursively add all leaf account mappings
              const addLeaf = (node) => {
                if (typeof node === "string") {
                  mapping.set(node, { level2, level1 });
                  return;
                }
                if (Array.isArray(node)) {
                  node.forEach((item) => addLeaf(item));
                  return;
                }
                if (node && typeof node === "object") {
                  for (const [k, v] of Object.entries(node)) {
                    addLeaf(k);
                    addLeaf(v);
                  }
                }
              };

              addLeaf(child[level2]);
            }
          }
        }
      }

      return rows;
    });
  });

  return { rows, mapping };
};

/**
 * Formats a numeric amount for display.
 *
 * - Formats with thousands separators
 * - Displays negative numbers in parentheses
 * - Shows "-" for null/undefined/NaN values
 *
 * @param {number|null|undefined} value - Numeric value to format
 * @returns {string} Formatted string representation
 */
export const formatAmount = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  const num = Number(value);
  const formatted = Math.abs(num).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return num < 0 ? `(${formatted})` : formatted;
};
