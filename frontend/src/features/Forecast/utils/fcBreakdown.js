/**
 * fcBreakdown.js — CR046: expand a clicked Forecast Review row into the accounts
 * beneath it, so the graph shows a stacked breakdown instead of a single line.
 *
 * "Net Assets" already did this (`netAssetsAccountBreakdown` in FCReview). This
 * generalises it to any row on either side of the table:
 *
 *   level 1 (Assets, Liabilities, Income, Expense) → its level-2 accounts
 *   level 2 (Fidelity Stock, Salary, …)            → its level-3 leaves, if it has any
 *
 * A row with nothing beneath it returns [], and the caller falls back to the
 * single-line chart — which is the old behavior, so nothing is lost.
 *
 * `excludeChildren` exists so a breakdown always reconciles with the row it came from.
 * The P&L's Expense row is displayed NET of Transfers (FCReview's getCellValue subtracts
 * them, and Transfers gets its own row), even though `Transfer - Bank` maps to
 * level1 "Expense" / level2 "Transfers". Stacking Transfers under Expense would total to
 * a number the row above it does not show.
 *
 * Pure: every input is already computed by the page.
 */

/** Distinct level-2 account labels sitting under a level-1 section. */
export function level2ChildrenOf(level1Label, accountMap) {
  const seen = new Set();
  for (const [, mapping] of accountMap) {
    if (mapping?.level1 !== level1Label) continue;
    if (mapping?.level2) seen.add(mapping.level2);
  }
  return [...seen];
}

/** Leaf accounts under a level-2 account (excluding the level-2 row itself). */
export function leafChildrenOf(level2Label, accountMap) {
  const leaves = [];
  for (const [name, mapping] of accountMap) {
    if (mapping?.level2 !== level2Label) continue;
    if (name === level2Label) continue; // the row is not its own child
    leaves.push(name);
  }
  return leaves;
}

/**
 * Build the stacked series for a clicked row.
 *
 * @param {Object} p
 * @param {string} p.label - the clicked row's label
 * @param {number} p.level - 1 or 2 (synthetic rows have no level and are not expandable)
 * @param {Array} p.sortedYears
 * @param {Map} p.accountMap - Map<accountName, {level1, level2}> (balance or cash side)
 * @param {Function} p.valuesForLevel2 - (label) => number[] aligned to sortedYears
 * @param {Map} p.leafValues - Map<accountName, Map<year, number>> from the raw entries
 * @param {string[]} p.palette - colors, cycled
 * @returns {Array<{id,label,values,color}>} — empty when the row has fewer than two children
 */
export function buildBreakdownSeries({
  label,
  level,
  sortedYears = [],
  accountMap,
  valuesForLevel2,
  leafValues,
  palette = [],
  excludeChildren = [],
}) {
  if (!label || !accountMap || !sortedYears.length) return [];

  const excluded = new Set(excludeChildren);
  let children = [];

  if (level === 1) {
    children = level2ChildrenOf(label, accountMap)
      .filter((childLabel) => !excluded.has(childLabel))
      .map((childLabel) => ({
        label: childLabel,
        values: (valuesForLevel2?.(childLabel) || []).map(toNumber),
      }))
      .filter((c) => c.values.some((v) => v !== 0));
  } else if (level === 2) {
    children = leafChildrenOf(label, accountMap)
      .map((leaf) => ({
        label: leaf,
        values: sortedYears.map((year) => toNumber(leafValues?.get(leaf)?.get(Number(year)))),
      }))
      .filter((c) => c.values.some((v) => v !== 0));
  }

  // One child is just the row again in disguise — not worth a stacked chart.
  if (children.length < 2) return [];

  return children.map((child, idx) => ({
    id: `breakdown-${label}-${child.label}`,
    label: child.label,
    values: child.values,
    color: palette.length ? palette[idx % palette.length] : undefined,
  }));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
