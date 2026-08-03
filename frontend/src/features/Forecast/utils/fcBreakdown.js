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
 * `baseLeafValues` fills the pre-forecast columns for a leaf breakdown, and is deliberately
 * applied AFTER the all-zero filter below. The engine writes many balance rows at level 2
 * ("Fidelity Stock", "Bank Accounts"), never at their leaves, so those rows have no leaf
 * breakdown at all and fall back to a line chart. The ledger, by contrast, has every leaf.
 * Overlaying it first would flip those rows into a stacked bar populated in the actuals
 * column and empty for every forecast year after it — Bank Accounts would become a
 * 24-segment stack with one filled column. Only leaves the engine already models get the
 * overlay; the rest keep falling back, which is the behavior that works today.
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
 * @param {Map} [p.baseLeafValues] - Map<year, Map<accountName, number>> for the pre-forecast
 *   years (ledger actuals). Applied only to leaves that already carry engine data.
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
  baseLeafValues,
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
      .map((leaf) => {
        const byYear = leafValues?.get(leaf);
        return {
          label: leaf,
          values: sortedYears.map((year) => toNumber(byYear?.get(Number(year)))),
          // Which years the engine actually wrote. A modelled zero (an asset sold) is a
          // real value, and reads identically to "no entry" once it is a number.
          modelledYears: byYear,
        };
      })
      // The engine-data filter runs BEFORE the overlay — see the header note.
      .filter((c) => c.values.some((v) => v !== 0))
      .map((c) => overlayBaseYears(c, sortedYears, baseLeafValues));
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

/**
 * Fills a leaf's pre-forecast years from the ledger, without ever overwriting a year the
 * engine actually modelled — a leaf the engine writes as a real zero (an asset sold that
 * year) keeps that zero, which is why this tests for the entry, not for a non-zero value.
 */
function overlayBaseYears(child, sortedYears, baseLeafValues) {
  if (!baseLeafValues || baseLeafValues.size === 0) return child;
  return {
    ...child,
    values: child.values.map((value, index) => {
      const year = Number(sortedYears[index]);
      if (child.modelledYears?.has(year)) return value;
      const base = baseLeafValues.get(year)?.get(child.label);
      return base == null ? value : toNumber(base);
    }),
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
