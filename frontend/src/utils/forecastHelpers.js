/**
 * Forecast Helper Utilities
 *
 * Shared utilities for forecast calculations and data processing
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
 *
 * @example
 * const coa = [{ 'Assets': [{ 'Current Assets': ['Cash', 'Receivables'] }] }];
 * const { rows, mapping } = parseLevelAccounts(coa, true);
 * // rows: [{ label: 'Assets', level: 1 }, { label: 'Current Assets', level: 2 }]
 * // mapping: Map('Cash' -> { level1: 'Assets', level2: 'Current Assets' })
 */
export function parseLevelAccounts(data, includeMapping = false) {
  if (!Array.isArray(data)) {
    return { rows: [], mapping: new Map() };
  }

  const mapping = new Map();

  // Detect format: new format uses { name, children } objects from PostgreSQL
  const isTreeFormat =
    data.length > 0 && data[0] && typeof data[0].name === "string";

  if (isTreeFormat) {
    const rows = [];
    for (const level1Node of data) {
      if (!level1Node || !level1Node.name) continue;
      const level1 = level1Node.name;
      rows.push({ label: level1, level: 1 });

      const children = Array.isArray(level1Node.children)
        ? level1Node.children
        : [];
      for (const level2Node of children) {
        if (!level2Node || !level2Node.name) continue;
        const level2 = level2Node.name;
        rows.push({ label: level2, level: 2 });

        if (includeMapping) {
          mapping.set(level2, { level2, level1 });

          const addDescendants = (node) => {
            if (!node || typeof node !== "object") return;
            if (node.name) {
              mapping.set(node.name, { level2, level1 });
            }
            if (Array.isArray(node.children)) {
              for (const child of node.children) {
                addDescendants(child);
              }
            }
          };

          if (Array.isArray(level2Node.children)) {
            for (const child of level2Node.children) {
              addDescendants(child);
            }
          }
        }
      }
    }
    return { rows, mapping };
  }

  // Legacy format: [{ "Income": [{ "Salary": [...] }] }]
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

            if (includeMapping) {
              mapping.set(level2, { level2, level1 });

              const addLeaf = (node) => {
                if (typeof node === "string") {
                  mapping.set(node, { level2, level1 });
                  return;
                }
                if (Array.isArray(node)) {
                  node.forEach(addLeaf);
                  return;
                }
                if (typeof node === "object") {
                  Object.values(node).forEach(addLeaf);
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
}

/**
 * Aggregates forecast entries by category levels.
 *
 * Groups entries and sums their values by level1 (Income/Expense) and level2 (sub-categories).
 *
 * @param {Array} entries - Forecast entries from API
 * @param {Map} accountMap - Map of account name -> { level1, level2 }
 * @param {Array} years - Array of year numbers to aggregate
 * @returns {Object} { level1: Map, level2: Map, level3: Map }
 *
 * @example
 * const entries = [
 *   { Account: 'Salaries', '2024': 50000, '2025': 52000 }
 * ];
 * const map = new Map([['Salaries', { level1: 'Expense', level2: 'Personnel' }]]);
 * const result = aggregateForecastEntries(entries, map, [2024, 2025]);
 * // result.level1.get('Expense') -> { '2024': 50000, '2025': 52000 }
 */
export function aggregateForecastEntries(entries, accountMap, years) {
  const level1Map = new Map();
  const level2Map = new Map();
  const level3Map = new Map();

  if (!Array.isArray(entries) || !accountMap || !Array.isArray(years)) {
    return { level1: level1Map, level2: level2Map, level3: level3Map };
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const accountName = entry.Account;
    const parents = accountMap.get(accountName);

    if (!parents) {
      continue;
    }

    const { level1, level2 } = parents;

    // Aggregate for each year
    for (const year of years) {
      const value = parseFloat(entry[year]) || 0;

      // Level 3 (leaf accounts)
      if (!level3Map.has(accountName)) {
        level3Map.set(accountName, {});
      }
      const level3Entry = level3Map.get(accountName);
      level3Entry[year] = (level3Entry[year] || 0) + value;

      // Level 2 (sub-categories)
      if (!level2Map.has(level2)) {
        level2Map.set(level2, {});
      }
      const level2Entry = level2Map.get(level2);
      level2Entry[year] = (level2Entry[year] || 0) + value;

      // Level 1 (main categories)
      if (!level1Map.has(level1)) {
        level1Map.set(level1, {});
      }
      const level1Entry = level1Map.get(level1);
      level1Entry[year] = (level1Entry[year] || 0) + value;
    }
  }

  return { level1: level1Map, level2: level2Map, level3: level3Map };
}

/**
 * Calculates net cash flow for each year.
 *
 * @param {Map} level1Map - Map of level1 categories with year totals
 * @param {Array} years - Array of year numbers
 * @returns {Object} Map of year -> net cash flow value
 *
 * @example
 * const level1Map = new Map([
 *   ['Income', { '2024': 100000, '2025': 110000 }],
 *   ['Expense', { '2024': -60000, '2025': -65000 }]
 * ]);
 * const net = calculateNetCashFlow(level1Map, [2024, 2025]);
 * // net['2024'] = 40000, net['2025'] = 45000
 */
export function calculateNetCashFlow(level1Map, years) {
  const netCashFlow = {};

  if (!level1Map || !Array.isArray(years)) {
    return netCashFlow;
  }

  const incomeMap = level1Map.get("Income") || {};
  const expenseMap = level1Map.get("Expense") || {};

  for (const year of years) {
    const income = incomeMap[year] || 0;
    const expense = expenseMap[year] || 0;
    netCashFlow[year] = income + expense;
  }

  return netCashFlow;
}

/**
 * Formats table cell value with proper styling for positive/negative numbers.
 *
 * @param {number} value - Numeric value to format
 * @param {string} baseClass - Base CSS class name
 * @returns {Object} { value: string, className: string }
 *
 * @example
 * formatTableCell(1000, 'cell'); // { value: '1,000', className: 'cell' }
 * formatTableCell(-500, 'cell'); // { value: '(500)', className: 'cell cell--negative' }
 */
export function formatTableCell(value, baseClass = 'cell') {
  const formatted = {
    value: '—',
    className: baseClass,
  };

  if (typeof value !== 'number') {
    return formatted;
  }

  const absValue = Math.abs(value);
  const formattedNumber = new Intl.NumberFormat('en-US').format(absValue);

  formatted.value = value < 0 ? `(${formattedNumber})` : formattedNumber;
  formatted.className = value < 0 ? `${baseClass} ${baseClass}--negative` : baseClass;

  return formatted;
}
