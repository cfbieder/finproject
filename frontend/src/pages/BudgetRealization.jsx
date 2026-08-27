import { useCallback, useMemo, useState, useEffect } from "react";
import {
  MONTH_OPTIONS,
  YEAR_OPTIONS,
  BUDGET_YEAR_OPTIONS,
} from "../features/BudgetEntry/utils/budgetInputUtils.js";
import BudgetRealizationContent from "../features/Budgets/BudgetRealizationContent.jsx";
import BudgetDetailModal from "../features/Budgets/BudgetDetailModal.jsx";
import Rest from "../js/rest.js";
import { useCoa } from "../hooks/useCoa.js";
import { exportBudgetRealization } from "../utils/excelExporter.js";
import "./PageLayout.css";

// ============================================================================
// CURRENCY FORMATTING
// ============================================================================

/**
 * Currency formatter for USD display
 */
const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats a currency value with proper sign handling
 * @param {number} value - Numeric value to format
 * @returns {string} Formatted currency string (negative values in parentheses)
 */
const formatCurrencyValue = (value) => {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const formatted = currencyFormatter.format(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
};

/**
 * Determines the CSS class string for table value cells, applying red text for negatives.
 * @param {number} value - Numeric value to evaluate
 * @param {boolean} hasValue - Whether the cell actually contains a numeric value
 * @param {string} extraClass - Additional class names to append
 * @returns {string} Computed class string
 */
const getValueCellClassName = (value, hasValue, extraClass = "") => {
  const classes = ["balance-report-table__value"];
  if (hasValue && Number(value) < 0) {
    classes.push("balance-report-table__value--negative");
  }
  if (extraClass) {
    classes.push(extraClass);
  }
  return classes.join(" ");
};

// ============================================================================
// UTILITY FUNCTIONS - Data Processing
// ============================================================================

/**
 * Builds a map of leaf node names to their total values
 * @param {Array} nodes - Tree nodes to process
 * @param {Map} map - Accumulator map
 * @returns {Map} Map of leaf node names to totals
 */
const buildLeafActualTotalsMap = (nodes, map = new Map()) => {
  if (!Array.isArray(nodes)) {
    return map;
  }

  for (const node of nodes) {
    if (!node || typeof node !== "object" || !node.name) {
      continue;
    }
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    if (!hasChildren) {
      const numericValue = Number.isFinite(Number(node.total))
        ? Number(node.total)
        : 0;
      map.set(node.name, numericValue);
      continue;
    }
    buildLeafActualTotalsMap(node.children, map);
  }

  return map;
};

/**
 * CR088 P5 — the ONE row-drop rule, used by the table and by the export.
 *
 * A row is dropped only when every SUBJECT column currently on screen would read
 * zero. It has to be shared rather than restated: `excelExporter.js` kept its own
 * `actual === 0 && budget === 0`, which stopped agreeing with the page the moment
 * the page learned about modes — and that file had already produced one
 * screen-vs-workbook disagreement (CR087 §4b, the duplicated sign branch).
 */
const makeShouldDropRow = ({
  showBudget, showActual, showLe, hasBudgetData, hasActualData,
}) => ({ budget, actual, le, lePresent }) => {
  const budgetIsBlank = !showBudget || budget === 0;
  const actualIsBlank = !showActual || actual === 0;
  const leIsBlank = !showLe || !lePresent || le === 0;
  return (
    (hasBudgetData || !showBudget) &&
    (hasActualData || !showActual) &&
    budgetIsBlank &&
    actualIsBlank &&
    leIsBlank
  );
};

/**
 * CR088 P2 — the set of leaf names the LE actually carries a line for.
 *
 * Separate from the totals map because the server's `hasLe` is the only way to
 * tell "the LE estimates zero here" from "the LE has no line here at all", and
 * the second must render `—`. Flattened the same way and keyed the same way, so
 * it lines up with the totals map row for row.
 */
const buildLeafLePresenceSet = (nodes, set = new Set()) => {
  if (!Array.isArray(nodes)) return set;

  for (const node of nodes) {
    if (!node || typeof node !== "object" || !node.name) continue;
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    if (hasChildren) {
      buildLeafLePresenceSet(node.children, set);
    } else if (node.hasLe) {
      set.add(node.name);
    }
  }

  return set;
};

/**
 * Computes the date range for the selected period
 * @param {string} fromMonth - Start month ("01"-"12")
 * @param {string} toMonth - End month ("01"-"12")
 * @param {number|string} year - Year value
 * @returns {Object|null} Object with start and end dates
 */
const computePeriodRange = (fromMonth, toMonth, year) => {
  const yearNumber = Number.parseInt(year, 10);
  if (!Number.isFinite(yearNumber)) {
    return null;
  }
  const startMonth = Number.parseInt(fromMonth, 10);
  const endMonth = Number.parseInt(toMonth, 10);
  if (!Number.isFinite(startMonth) || !Number.isFinite(endMonth)) {
    return null;
  }
  const start = new Date(yearNumber, startMonth - 1, 1);
  const end = new Date(yearNumber, endMonth, 0);
  return { start, end };
};

/**
 * Formats a Date object to ISO date string (YYYY-MM-DD)
 * @param {Date} value - Date to format
 * @returns {string|null} Formatted date string
 */
const formatDateParam = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Creates a resolver function that computes values with caching
 * @param {Map} leafTotals - Map of leaf node totals
 * @returns {Function} Resolver function
 */
const createActualValueResolver = (leafTotals) => {
  if (!leafTotals || typeof leafTotals.get !== "function") {
    return () => 0;
  }
  const cache = new Map();
  const resolve = (node, pathKey) => {
    if (!node || !pathKey) {
      return 0;
    }
    if (cache.has(pathKey)) {
      return cache.get(pathKey);
    }
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    const total = hasChildren
      ? node.children.reduce(
          (sum, child) => sum + resolve(child, `${pathKey}>${child.name}`),
          0
        )
      : leafTotals.get(node.name) ?? 0;
    cache.set(pathKey, total);
    return total;
  };
  return resolve;
};

/**
 * Safely converts a value to a number
 * @param {*} value - Value to convert
 * @returns {number} Converted number or 0
 */
const safeNumber = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

/**
 * Resolves the value for a top-level node by name
 * @param {Array} nodes - Array of nodes
 * @param {string} name - Node name to find
 * @param {Function} resolver - Value resolver function
 * @returns {number|null} Resolved value
 */
const resolveTopLevelNodeValue = (nodes, name, resolver) => {
  if (!Array.isArray(nodes) || !name || typeof resolver !== "function") {
    return null;
  }
  const node = nodes.find((entry) => entry && entry.name === name);
  if (!node) {
    return null;
  }
  return resolver(node, name);
};

/**
 * Computes total of Income and Expense nodes
 * @param {Array} nodes - Category tree nodes
 * @param {Function} resolver - Value resolver function
 * @returns {number} Combined total
 */
const computeIncomeExpenseTotal = (nodes, resolver) => {
  if (typeof resolver !== "function") {
    return 0;
  }
  const incomeValue = resolveTopLevelNodeValue(nodes, "Income", resolver);
  const expenseValue = resolveTopLevelNodeValue(nodes, "Expense", resolver);
  return safeNumber(incomeValue) + safeNumber(expenseValue);
};

// ============================================================================
// UTILITY FUNCTIONS - Category Tree Operations
// ============================================================================

/**
 * Builds a hierarchical category tree from flat data
 * @param {Array} items - Array of category items
 * @returns {Array} Hierarchical tree structure
 */

/**
 * Collects all paths that have children (can be collapsed)
 * @param {Array} nodes - Category tree nodes
 * @param {Array} path - Current path
 * @param {Set} accumulator - Accumulator set
 * @returns {Set} Set of collapsible path keys
 */
const collectCollapsiblePaths = (nodes, path = [], accumulator = new Set()) => {
  if (!Array.isArray(nodes)) {
    return accumulator;
  }

  for (const node of nodes) {
    if (!node || typeof node !== "object" || !node.name) {
      continue;
    }
    const currentPath = [...path, node.name];
    const pathKey = currentPath.join(">");
    if (Array.isArray(node.children) && node.children.length > 0) {
      accumulator.add(pathKey);
      collectCollapsiblePaths(node.children, currentPath, accumulator);
    }
  }

  return accumulator;
};

const collectLeafCategoryNames = (node) => {
  if (!node || typeof node !== "object") {
    return [];
  }
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  if (!hasChildren) {
    return node.name ? [node.name] : [];
  }
  return node.children.flatMap((child) => collectLeafCategoryNames(child));
};

// ============================================================================
// UTILITY FUNCTIONS - Rendering
// ============================================================================

/**
 * Renders the category rows.
 *
 * CR088 P2 changed the signature from eleven positional parameters to
 * `(nodes, ctx, level, path)`. It was already at nine and the LE columns needed
 * five more; a call whose tenth argument is `undefined` by accident is not a
 * mistake any reviewer catches.
 *
 * @param {Array} nodes - Category tree nodes
 * @param {Object} ctx - Everything the rows need; see `rowContext` on the page
 * @param {number} level - Indentation level
 * @param {Array} path - Current path
 * @returns {Array} Array of React elements
 */
const renderCategoryRows = (nodes, ctx, level = 0, path = []) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const {
    collapsedPaths,
    handleToggle,
    leafActualTotals,
    getActualValue,
    leafBudgetTotals,
    getBudgetValue,
    leafLeTotals,
    getLeValue,
    getLePresent,
    showBudget,
    showActual,
    showLe,
    varActBud,
    varLeBud,
    varActLe,
    onBudgetCellDoubleClick,
    onActualCellDoubleClick,
  } = ctx;

  return nodes.flatMap((node) => {
    if (!node || typeof node !== "object" || !node.name) {
      return [];
    }
    const currentPath = [...path, node.name];
    const pathKey = currentPath.join(">");
    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    const isCollapsed = collapsedPaths.has(pathKey);

    const hasActualData = leafActualTotals !== null;
    const hasBudgetData = leafBudgetTotals !== null;
    const hasLeData = showLe && leafLeTotals != null;
    const resolvedActualValue =
      hasActualData && typeof getActualValue === "function"
        ? getActualValue(node, pathKey)
        : 0;
    const resolvedBudgetValue =
      hasBudgetData && typeof getBudgetValue === "function"
        ? getBudgetValue(node, pathKey)
        : 0;
    // ⚠️ ABSENT is not ZERO. The LE's materialisation scope carries no line at
    // all for transfers or `Unrealized G/L`, so with either toggle ON those
    // rows have no estimate — and `$0.00` there would claim the owner estimated
    // nothing rather than that the LE has no view. CR087 P0b, which cost a page
    // of 100%-favourable variances rendered from a failed fetch.
    const leIsPresent =
      hasLeData && typeof getLePresent === "function"
        ? getLePresent(node, pathKey)
        : false;
    const resolvedLeValue =
      hasLeData && typeof getLeValue === "function"
        ? getLeValue(node, pathKey)
        : 0;

    // The shared rule — see `makeShouldDropRow`. The export calls the same one.
    if (
      makeShouldDropRow({
        showBudget, showActual, showLe, hasBudgetData, hasActualData,
      })({
        budget: resolvedBudgetValue,
        actual: resolvedActualValue,
        le: resolvedLeValue,
        lePresent: leIsPresent,
      })
    ) {
      return [];
    }
    const leafCategories = collectLeafCategoryNames(node);
    const actualDisplay = hasActualData
      ? formatCurrencyValue(resolvedActualValue)
      : "—";
    const budgetDisplay = hasBudgetData
      ? formatCurrencyValue(resolvedBudgetValue)
      : "—";
    const hasVarianceData = hasBudgetData || hasActualData;
    const budgetForVariance = hasBudgetData ? resolvedBudgetValue : 0;
    const actualForVariance = hasActualData ? resolvedActualValue : 0;
    // CR087 §4b. ⚠️ This USED to pick the sign from a substring match on
    // `currentPath[0]` — `.includes("expense") || .includes("income")` — so the
    // same column carried OPPOSITE signs depending on an owner-editable account
    // name, and renaming `Expenses` to `Spending` in COA Management would have
    // flipped every variance under it silently. The name-as-key pattern the
    // forecast rules already ban.
    //
    // The branch was not merely fragile, it was WRONG: expenses are stored
    // NEGATIVE on both sides (measured on prod 2026-08-24 — expense
    // `budget_entries` run min −71,968 / max 0 with 656 of 657 negative, and
    // 2026 expense transactions sum −180,215.35), so `actual − budget` is
    // already favourable-positive for income AND expense:
    //   income  actual 400 vs budget 300 → +100 favourable
    //   expense actual −80 vs budget −100 → +20 favourable (spent less)
    // Any root that matched neither word was getting the inverted convention.
    //
    // This also aligns the four surfaces that already computed it unconditionally
    // (`BudgetVariances`, `BudgetRealizationGraph` ×3, `MobileBudgetRealization`).
    const varianceValue = actualForVariance - budgetForVariance;
    const varianceDisplay = hasVarianceData
      ? formatCurrencyValue(varianceValue)
      : "—";

    // Three subjects, three pairwise comparisons. All use the SAME direction
    // convention as `actual − budget` above — expenses are stored negative on
    // both sides, so every one of these is favourable-positive without a
    // per-root branch (CR087 §4b).
    const leDisplay = leIsPresent ? formatCurrencyValue(resolvedLeValue) : "—";

    const leBudVarianceValue = resolvedLeValue - budgetForVariance;
    const leBudVarianceDisplay =
      leIsPresent && hasBudgetData ? formatCurrencyValue(leBudVarianceValue) : "—";

    // ⚠️ `actual − LE` is NOT a variance in the way the other two are, and the
    // page says so rather than letting the figure argue otherwise. Measured on
    // prod 2026-08-27: over a period entirely at or before the cut it is ZERO on
    // every row by construction (the LE holds those actuals); over the full year
    // it reads **+150,091 favourable on expenses**, of which essentially all is
    // that September–December have not happened — the LE covers twelve months
    // and the actual covers eight. It measures elapsed TIME unless the window is
    // both past the cut and fully elapsed. `compareProps.unelapsedMonths` drives
    // the warning that says so.
    const actLeVarianceValue = actualForVariance - resolvedLeValue;
    const actLeVarianceDisplay =
      leIsPresent && hasActualData ? formatCurrencyValue(actLeVarianceValue) : "—";

    // Which variance column comes first, so the subjects/comparisons seam can be
    // drawn on it. Order is fixed: act-bud, le-bud, act-le.
    const firstVar = varActBud ? "actbud" : varLeBud ? "lebud" : varActLe ? "actle" : null;
    const seam = (key) => (firstVar === key ? " budget-va__var-first" : "");

    const pathLabel = currentPath.join(" › ");

    const handleBudgetCellDoubleClick =
      hasBudgetData && typeof onBudgetCellDoubleClick === "function"
        ? (event) => {
            event.stopPropagation();
            onBudgetCellDoubleClick({
              type: "budget",
              name: node.name,
              path: currentPath,
              pathKey,
              pathLabel,
              budgetValue: resolvedBudgetValue,
              budgetDisplay,
              actualValue: resolvedActualValue,
              actualDisplay,
              varianceValue,
              varianceDisplay,
              hasBudgetData,
              hasActualData,
              hasVarianceData,
              categories: leafCategories,
            });
          }
        : undefined;

    const handleActualCellDoubleClick =
      hasActualData && typeof onActualCellDoubleClick === "function"
        ? (event) => {
            event.stopPropagation();
            onActualCellDoubleClick({
              type: "actual",
              name: node.name,
              path: currentPath,
              pathKey,
              pathLabel,
              budgetValue: resolvedBudgetValue,
              budgetDisplay,
              actualValue: resolvedActualValue,
              actualDisplay,
              varianceValue,
              varianceDisplay,
              hasBudgetData,
              hasActualData,
              hasVarianceData,
              categories: leafCategories,
            });
          }
        : undefined;

    const row = (
      <tr key={pathKey} data-level={level}>
        <td
          className="balance-report-table__name"
          style={{ "--report-indent-level": level }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleToggle(pathKey);
            }}
            disabled={!hasChildren}
            className="budget-va__toggle"
            aria-label={
              hasChildren
                ? `${isCollapsed ? "Expand" : "Collapse"} ${node.name}`
                : undefined
            }
          >
            {hasChildren ? (isCollapsed ? "+" : "−") : " "}
          </button>
          <span className="balance-report-table__name-text">{node.name}</span>
        </td>
        {/* SUBJECTS first, always in the same order — budget, actual, LE — so a
            column never moves when the mode changes. Then the VARIANCES, each
            with a header naming its own pair (see the note in the header row).
            §11 is why: a column called just "Variance" beside more than one
            subject is a column that can be read wrong, and it was. */}
        {showBudget && (
          <td
            className={getValueCellClassName(resolvedBudgetValue, hasBudgetData)}
            onDoubleClick={handleBudgetCellDoubleClick}
          >
            {budgetDisplay}
          </td>
        )}
        {showActual && (
          <td
            className={getValueCellClassName(resolvedActualValue, hasActualData)}
            onDoubleClick={handleActualCellDoubleClick}
          >
            {actualDisplay}
          </td>
        )}
        {showLe && (
          <td
            className={getValueCellClassName(
              resolvedLeValue,
              leIsPresent,
              leIsPresent ? "budget-va__le-cell" : "budget-va__le-cell budget-va__absent"
            )}
          >
            {leDisplay}
          </td>
        )}
        {varActBud && (
          <td className={getValueCellClassName(varianceValue, hasVarianceData, `budget-va__var-cell${seam("actbud")}`)}>
            {varianceDisplay}
          </td>
        )}
        {varLeBud && (
          <td
            className={getValueCellClassName(
              leBudVarianceValue,
              leIsPresent && hasBudgetData,
              `budget-va__var-cell${seam("lebud")}` +
                (leIsPresent && hasBudgetData ? "" : " budget-va__absent")
            )}
          >
            {leBudVarianceDisplay}
          </td>
        )}
        {varActLe && (
          <td
            className={getValueCellClassName(
              actLeVarianceValue,
              leIsPresent && hasActualData,
              `budget-va__var-cell${seam("actle")}` +
                (leIsPresent && hasActualData ? "" : " budget-va__absent")
            )}
          >
            {actLeVarianceDisplay}
          </td>
        )}
      </tr>
    );

    const childrenRows =
      hasChildren && !isCollapsed
        ? renderCategoryRows(node.children, ctx, level + 1, currentPath)
        : [];

    return hasChildren ? [row, ...childrenRows] : [row];
  });
};

/**
 * Filters category tree based on inclusion options
 * @param {Array} nodes - Category tree nodes
 * @param {Object} options - Filter options
 * @param {boolean} options.includeUnrealized - Include unrealized G/L
 * @param {boolean} options.includeTransfers - Include transfers
 * @returns {Array} Filtered category tree
 */
const filterCategoryTree = (nodes, { includeUnrealized, includeTransfers }) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  return nodes
    .map((node) => {
      if (!node || typeof node !== "object" || !node.name) {
        return null;
      }
      if (!includeUnrealized && node.name === "Unrealized G/L") {
        return null;
      }
      if (!includeTransfers && node.name === "Transfers") {
        return null;
      }
      const filteredChildren = filterCategoryTree(node.children, {
        includeUnrealized,
        includeTransfers,
      });
      const nextNode = { ...node };
      if (filteredChildren.length > 0) {
        nextNode.children = filteredChildren;
      } else {
        delete nextNode.children;
      }
      return nextNode;
    })
    .filter(Boolean);
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * BudgetRealization - the Budget Analysis reporting page (CR088 P5 renamed it;
 * the /budget-vs-actual route is deliberately unchanged)
 *
 * This component provides functionality for:
 * - Comparing budget to actual performance by category
 * - Viewing variance between budget and actual
 * - Filtering by time period (month, YTD, full year)
 * - Collapsible category tree structure
 * - Optional inclusion of unrealized G/L and transfers
 */
export default function BudgetRealization() {
  // ========== COA Data ==========
  const { plTree } = useCoa();

  // ========== State: Report Parameters ==========
  const currentMonthValue = MONTH_OPTIONS[new Date().getMonth()].value;
  const [fromMonth, setFromMonth] = useState(currentMonthValue);
  const [toMonth, setToMonth] = useState(currentMonthValue);
  const [actualYear, setActualYear] = useState(YEAR_OPTIONS[0]);
  const [budgetYear, setBudgetYear] = useState(YEAR_OPTIONS[0]);
  const [includeUnrealized, setIncludeUnrealized] = useState(false);
  const [includeTransfers, setIncludeTransfers] = useState(false);

  // ========== State: Data ==========
  const [leafActualTotals, setLeafActualTotals] = useState(null);
  const [leafBudgetTotals, setLeafBudgetTotals] = useState(null);

  // ---- CR088 P2/P5: the Latest Estimate as a third subject ----------------
  // ⚠️ P5 REFRAMED THIS. P2 modelled it as "what is the always-present BUDGET
  // compared against", which is why the LE variance ended up named after the
  // wrong benchmark (§11). There are three subjects — budget, actual, LE — and
  // therefore THREE pairwise comparisons, and the budget is not privileged among
  // them. `compareMode` now names the PAIR:
  //
  //   act-bud  BUDGETED · ACTUALS            · ACT vs BUD   (the default)
  //   act-le   ACTUALS  · LE                 · ACT vs LE
  //   le-bud   BUDGETED · LE                 · LE vs BUD
  //   all      BUDGETED · ACTUALS · LE       · all three
  //
  // `leafLePresent` is the ABSENT-vs-ZERO set — see the note in
  // renderCategoryRows.
  const [compareMode, setCompareMode] = useState("act-bud");
  const [leHeader, setLeHeader] = useState(null);
  const [leafLeTotals, setLeafLeTotals] = useState(null);
  const [leafLePresent, setLeafLePresent] = useState(null);

  // ========== State: UI ==========
  // Tracks what the user has EXPANDED. `collapsedPaths` is DERIVED from it below.
  //
  // It used to be the other way round — `collapsedPaths` was state, re-seeded by an effect
  // (`setCollapsedPaths(new Set(collapsiblePaths))`) every time `collapsiblePaths` changed.
  // But that memo recomputes whenever the tree OR the filters change, so toggling "include
  // transfers" — or any data reload — silently slammed every row you had opened shut again.
  // Storing the deviations instead means the default ("everything collapsed") is derived,
  // not re-imposed, and your expansions survive a reload.
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [entryDetail, setEntryDetail] = useState(null);

  // ========== Computed Values: Date Range ==========
  const budgetPeriodRange = useMemo(
    () => computePeriodRange(fromMonth, toMonth, budgetYear),
    [fromMonth, toMonth, budgetYear]
  );
  const actualPeriodRange = useMemo(
    () => computePeriodRange(fromMonth, toMonth, actualYear),
    [fromMonth, toMonth, actualYear]
  );

  // ========== Computed Values: Resolvers ==========
  const actualValueResolver = useMemo(
    () =>
      leafActualTotals ? createActualValueResolver(leafActualTotals) : null,
    [leafActualTotals]
  );

  const budgetValueResolver = useMemo(
    () =>
      leafBudgetTotals ? createActualValueResolver(leafBudgetTotals) : null,
    [leafBudgetTotals]
  );

  const leValueResolver = useMemo(
    () => (leafLeTotals ? createActualValueResolver(leafLeTotals) : null),
    [leafLeTotals]
  );

  // "Does the LE have a view on this node at all" — true if any leaf beneath it
  // carries a line. Deliberately a separate resolver rather than a truthiness
  // test on the total: an LE that estimates a category at exactly zero is a
  // real answer, and must not render as `—`.
  const lePresenceResolver = useMemo(() => {
    if (!leafLePresent) return null;
    const cache = new Map();
    const resolve = (node, pathKey) => {
      if (!node || !pathKey) return false;
      if (cache.has(pathKey)) return cache.get(pathKey);
      const hasChildren =
        Array.isArray(node.children) && node.children.length > 0;
      const present = hasChildren
        ? node.children.some((child) => resolve(child, `${pathKey}>${child.name}`))
        : leafLePresent.has(node.name);
      cache.set(pathKey, present);
      return present;
    };
    return resolve;
  }, [leafLePresent]);

  // ========== Computed Values: Category Tree ==========
  // plTree from useCoa() is already in { name, children } shape
  const categoryTree = plTree;

  const filteredCategoryTree = useMemo(
    () =>
      filterCategoryTree(categoryTree, {
        includeUnrealized,
        includeTransfers,
      }),
    [categoryTree, includeUnrealized, includeTransfers]
  );

  const collapsiblePaths = useMemo(
    () => collectCollapsiblePaths(filteredCategoryTree),
    [filteredCategoryTree]
  );

  // Collapsed by default: every collapsible path the user has not explicitly opened.
  const collapsedPaths = useMemo(() => {
    const next = new Set();
    for (const pathKey of collapsiblePaths) {
      if (!expandedPaths.has(pathKey)) next.add(pathKey);
    }
    return next;
  }, [collapsiblePaths, expandedPaths]);

  // ========== Computed Values: Net Totals ==========
  const hasActualData = leafActualTotals !== null;
  const hasBudgetData = leafBudgetTotals !== null;

  const netActualValue =
    hasActualData && actualValueResolver
      ? computeIncomeExpenseTotal(filteredCategoryTree, actualValueResolver)
      : null;

  const netBudgetValue =
    hasBudgetData && budgetValueResolver
      ? computeIncomeExpenseTotal(filteredCategoryTree, budgetValueResolver)
      : null;

  const showNetRow = hasActualData || hasBudgetData;

  const netBudgetDisplay = hasBudgetData
    ? formatCurrencyValue(netBudgetValue)
    : "—";

  const netActualDisplay = hasActualData
    ? formatCurrencyValue(netActualValue)
    : "—";

  const showNetVariance = hasBudgetData || hasActualData;
  const netVarianceValue =
    (hasActualData ? netActualValue : 0) - (hasBudgetData ? netBudgetValue : 0);
  const netVarianceDisplay = showNetVariance
    ? formatCurrencyValue(netVarianceValue)
    : "—";

  // ========== Computed Values: Per-Category KPI Values ==========
  const incomeActual =
    hasActualData && actualValueResolver
      ? resolveTopLevelNodeValue(filteredCategoryTree, "Income", actualValueResolver)
      : null;
  const incomeBudget =
    hasBudgetData && budgetValueResolver
      ? resolveTopLevelNodeValue(filteredCategoryTree, "Income", budgetValueResolver)
      : null;
  const expenseActual =
    hasActualData && actualValueResolver
      ? resolveTopLevelNodeValue(filteredCategoryTree, "Expense", actualValueResolver)
      : null;
  const expenseBudget =
    hasBudgetData && budgetValueResolver
      ? resolveTopLevelNodeValue(filteredCategoryTree, "Expense", budgetValueResolver)
      : null;

  const kpiData = useMemo(() => {
    if (!hasActualData && !hasBudgetData) return null;
    return {
      incomeActual: safeNumber(incomeActual),
      incomeBudget: safeNumber(incomeBudget),
      expenseActual: safeNumber(expenseActual),
      expenseBudget: safeNumber(expenseBudget),
      netActualValue: safeNumber(netActualValue),
      netBudgetValue: safeNumber(netBudgetValue),
      netVarianceValue,
    };
  }, [
    hasActualData, hasBudgetData,
    incomeActual, incomeBudget,
    expenseActual, expenseBudget,
    netActualValue, netBudgetValue, netVarianceValue,
  ]);

  // ---- CR083 P0a: the full-year landing ------------------------------------
  // Full-year and scope-fixed, so it is deliberately NOT driven by the period
  // selector or the transfer/unrealized toggles above it — only by the budget
  // year. It will not tie to the table below; that is stated on the strip.
  const [fyLanding, setFyLanding] = useState(null);

  useEffect(() => {
    if (!budgetYear) return undefined;
    let isActive = true;

    // Deliberately no synchronous reset to null here. It would add a
    // `react-hooks/set-state-in-effect` violation over the baseline (which may
    // only shrink), and it is also the better behaviour: while a new year
    // loads, the strip keeps showing the previous year's figures under the
    // previous year's own label — every figure it renders comes from one
    // payload, so it lags rather than going briefly inconsistent or blank.
    Rest.get(`/budget/fy-landing?year=${encodeURIComponent(budgetYear)}`)
      .then((payload) => {
        if (!isActive) return;
        setFyLanding(Rest.unwrap(payload) || null);
      })
      .catch((error) => {
        if (!isActive) return;
        console.error("[BudgetRealization] Failed to load FY landing:", error);
        setFyLanding(null);
      });

    return () => {
      isActive = false;
    };
  }, [budgetYear]);

  const netBudgetHasValue =
    netBudgetValue !== null && netBudgetValue !== undefined;
  const netActualHasValue =
    netActualValue !== null && netActualValue !== undefined;
  const netVarianceHasValue = showNetVariance;

  const netBudgetCellClass = getValueCellClassName(
    netBudgetValue ?? 0,
    netBudgetHasValue,
    "balance-report-table__value--bold"
  );
  const netActualCellClass = getValueCellClassName(
    netActualValue ?? 0,
    netActualHasValue,
    "balance-report-table__value--bold"
  );
  const netVarianceCellClass = getValueCellClassName(
    netVarianceValue,
    netVarianceHasValue,
    "balance-report-table__value--bold"
  );

  // ---- CR088 P5: which subjects and which variances this mode renders ------
  const showBudget = compareMode === "act-bud" || compareMode === "le-bud" || compareMode === "all";
  const showActual = compareMode === "act-bud" || compareMode === "act-le" || compareMode === "all";
  const showLe = compareMode === "act-le" || compareMode === "le-bud" || compareMode === "all";
  const varActBud = compareMode === "act-bud" || compareMode === "all";
  const varLeBud = compareMode === "le-bud" || compareMode === "all";
  const varActLe = compareMode === "act-le" || compareMode === "all";
  const hasLeData = showLe && leafLeTotals !== null;

  const netLeValue =
    hasLeData && leValueResolver
      ? computeIncomeExpenseTotal(filteredCategoryTree, leValueResolver)
      : null;
  const netLeDisplay = hasLeData ? formatCurrencyValue(netLeValue) : "—";

  const netLeBudVarianceValue =
    (hasLeData ? netLeValue : 0) - (hasBudgetData ? netBudgetValue : 0);
  const netLeBudVarianceDisplay =
    hasLeData && hasBudgetData ? formatCurrencyValue(netLeBudVarianceValue) : "—";

  const netActLeVarianceValue =
    (hasActualData ? netActualValue : 0) - (hasLeData ? netLeValue : 0);
  const netActLeVarianceDisplay =
    hasLeData && hasActualData ? formatCurrencyValue(netActLeVarianceValue) : "—";

  const netLeCellClass = getValueCellClassName(
    netLeValue ?? 0,
    hasLeData,
    "balance-report-table__value--bold"
  );
  const netLeBudVarianceCellClass = getValueCellClassName(
    netLeBudVarianceValue,
    hasLeData && hasBudgetData,
    "balance-report-table__value--bold budget-va__var-cell"
  );
  const netActLeVarianceCellClass = getValueCellClassName(
    netActLeVarianceValue,
    hasLeData && hasActualData,
    "balance-report-table__value--bold budget-va__var-cell"
  );

  // Whether the selected period reaches PAST the LE's cut. It is the whole
  // point of the note the page renders: `budget_le_lines` carries the
  // transactions verbatim for every closed month, so for a period ending on or
  // before the cut the LE column is byte-identical to the actual one (measured
  // on prod: 0 of 111 leaves differ over Jan–Jul, sums tie to the cent). Two
  // columns that agree by construction read as corroboration and are not.
  const periodReachesPastCut = useMemo(() => {
    if (!leHeader || !leHeader.actualThrough || !actualPeriodRange) return false;
    const end = formatDateParam(actualPeriodRange.end);
    return Boolean(end) && end > leHeader.actualThrough;
  }, [leHeader, actualPeriodRange]);

  // ⚠️ How many months of the selected window have NOT finished yet. This is the
  // guard that keeps `Act vs LE` honest, and it is not a nicety — measured on
  // prod 2026-08-27, over the full year that comparison reads **+150,091
  // favourable on expenses**, of which essentially all is that Sep–Dec have not
  // happened: the LE covers twelve months and the actual covers eight. The other
  // two comparisons cannot have this problem, because budget and LE are both
  // whole-period figures and actual is measured against a budget that is also
  // pro-rated to the same months.
  //
  // A month counts as unelapsed if its last day is still in the future. Compared
  // date-only, because a `new Date()` on a timestamp is Known Issue #3 (the
  // timezone rule) and a month-end is a date, not an instant.
  const unelapsedMonths = useMemo(() => {
    if (!actualPeriodRange) return { count: 0, total: 0 };
    const today = new Date();
    const todayKey = formatDateParam(
      new Date(today.getFullYear(), today.getMonth(), today.getDate())
    );
    let count = 0;
    let total = 0;
    const cursor = new Date(
      actualPeriodRange.start.getFullYear(),
      actualPeriodRange.start.getMonth(),
      1
    );
    while (cursor <= actualPeriodRange.end) {
      total += 1;
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      if (formatDateParam(monthEnd) > todayKey) count += 1;
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return { count, total };
  }, [actualPeriodRange]);

  // ========== Effects: Initialization ==========

  // ========== Effects: Data Fetching ==========

  // Fetch actuals when the selected actual period or filters change
  useEffect(() => {
    if (!actualPeriodRange) {
      setLeafActualTotals(null);
      return;
    }

    const fromDateParam = formatDateParam(actualPeriodRange.start);
    const toDateParam = formatDateParam(actualPeriodRange.end);
    if (!fromDateParam || !toDateParam) {
      setLeafActualTotals(null);
      return;
    }

    let isActive = true;
    setLeafActualTotals(null);
    const transfersMode = includeTransfers ? "include" : "exclude";

    const fetchActuals = async () => {
      try {
        const report = await Rest.fetchCashFlowReportV2({
          fromDate: fromDateParam,
          toDate: toDateParam,
          transfers: transfersMode,
          includeUnrealizedGL: includeUnrealized,
        });
        const nodes = Array.isArray(report) ? report : [];
        const totalsMap = buildLeafActualTotalsMap(nodes);
        if (!isActive) {
          return;
        }
        setLeafActualTotals(totalsMap);
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error("[BudgetRealization] Failed to load actuals:", error);
        setLeafActualTotals(null);
      }
    };

    fetchActuals();

    return () => {
      isActive = false;
    };
  }, [actualPeriodRange, includeTransfers, includeUnrealized]);

  // Fetch budgets when the selected budget period or filters change
  useEffect(() => {
    if (!budgetPeriodRange) {
      setLeafBudgetTotals(null);
      return;
    }

    const fromDateParam = formatDateParam(budgetPeriodRange.start);
    const toDateParam = formatDateParam(budgetPeriodRange.end);
    if (!fromDateParam || !toDateParam) {
      setLeafBudgetTotals(null);
      return;
    }

    let isActive = true;
    setLeafBudgetTotals(null);
    const transfersMode = includeTransfers ? "include" : "exclude";

    const fetchBudgets = async () => {
      try {
        const report = await Rest.fetchBudgetCashFlowReport({
          fromDate: fromDateParam,
          toDate: toDateParam,
          transfers: transfersMode,
          includeUnrealizedGL: includeUnrealized,
        });
        const nodes = Array.isArray(report) ? report : [];
        const totalsMap = buildLeafActualTotalsMap(nodes);
        if (!isActive) {
          return;
        }
        setLeafBudgetTotals(totalsMap);
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error(
          "[BudgetRealization] Failed to load budget totals:",
          error
        );
        setLeafBudgetTotals(null);
      }
    };

    fetchBudgets();

    return () => {
      isActive = false;
    };
  }, [budgetPeriodRange, includeTransfers, includeUnrealized]);

  // ---- CR088 P2: resolve the LE for the selected budget year --------------
  // `findAll` already orders newest first and excludes superseded rows, so the
  // head of the list is the LE to compare against. There is exactly one per
  // budget year today; taking the head rather than adding a picker is the
  // smaller thing that is also correct if that ever stops being true.
  useEffect(() => {
    if (!budgetYear) return undefined;
    let isActive = true;

    Rest.fetchBudgetLeList(budgetYear)
      .then((rows) => {
        if (!isActive) return;
        const head = rows[0];
        setLeHeader(
          head
            ? {
                id: head.id,
                name: head.name,
                actualThrough: String(head.actual_through).slice(0, 10),
              }
            : null
        );
      })
      .catch((error) => {
        if (!isActive) return;
        console.error("[BudgetRealization] Failed to load the LE list:", error);
        setLeHeader(null);
      });

    return () => {
      isActive = false;
    };
  }, [budgetYear]);

  // A year with no LE cannot offer the comparison; fall back rather than render
  // an empty column that looks like "the estimate is nothing".
  useEffect(() => {
    if (!leHeader && compareMode !== "act-bud") setCompareMode("act-bud");
  }, [leHeader, compareMode]);

  // Fetch the LE over the same period, with the same transfer convention, only
  // when a mode that shows it is selected.
  useEffect(() => {
    if (!showLe || !leHeader || !budgetPeriodRange) {
      setLeafLeTotals(null);
      setLeafLePresent(null);
      return undefined;
    }

    const fromDateParam = formatDateParam(budgetPeriodRange.start);
    const toDateParam = formatDateParam(budgetPeriodRange.end);
    if (!fromDateParam || !toDateParam) {
      setLeafLeTotals(null);
      setLeafLePresent(null);
      return undefined;
    }

    let isActive = true;
    const transfersMode = includeTransfers ? "include" : "exclude";

    Rest.fetchLeCashFlowReport({
      leId: leHeader.id,
      fromDate: fromDateParam,
      toDate: toDateParam,
      transfers: transfersMode,
    })
      .then((report) => {
        if (!isActive) return;
        const nodes = Array.isArray(report && report.nodes) ? report.nodes : [];
        setLeafLeTotals(buildLeafActualTotalsMap(nodes));
        setLeafLePresent(buildLeafLePresenceSet(nodes));
      })
      .catch((error) => {
        if (!isActive) return;
        console.error("[BudgetRealization] Failed to load the LE:", error);
        // ⚠️ null, never an empty map. An empty map resolves every row to 0 and
        // renders a page of figures that look like real estimates of nothing —
        // the exact failure CR087 P0b closed on the actuals side.
        setLeafLeTotals(null);
        setLeafLePresent(null);
      });

    return () => {
      isActive = false;
    };
  }, [showLe, leHeader, budgetPeriodRange, includeTransfers]);

  // ========== Event Handlers ==========

  /**
   * Toggles collapse state for a category path
   */
  const handleTogglePath = (pathKey) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey); // was expanded ⇒ collapse it
      } else {
        next.add(pathKey); // was collapsed ⇒ expand it
      }
      return next;
    });
  };

  const isFullyCollapsed =
    collapsiblePaths.size > 0 && collapsedPaths.size === collapsiblePaths.size;

  const isFullyExpanded =
    collapsiblePaths.size > 0 && collapsedPaths.size === 0;

  /**
   * Expands one layer of collapsed paths (shallowest collapsed depth)
   */
  const handleExpandOneLayer = () => {
    if (collapsedPaths.size === 0) return;
    let minDepth = Infinity;
    for (const pathKey of collapsedPaths) {
      const depth = pathKey.split(">").length - 1;
      if (depth < minDepth) minDepth = depth;
    }
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (const pathKey of collapsedPaths) {
        if (pathKey.split(">").length - 1 === minDepth) next.add(pathKey);
      }
      return next;
    });
  };

  /**
   * Collapses one layer of expanded paths (deepest expanded depth)
   */
  const handleCollapseOneLayer = () => {
    const open = [...collapsiblePaths].filter((pathKey) => expandedPaths.has(pathKey));
    if (open.length === 0) return;
    let maxDepth = -1;
    for (const pathKey of open) {
      const depth = pathKey.split(">").length - 1;
      if (depth > maxDepth) maxDepth = depth;
    }
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      for (const pathKey of open) {
        if (pathKey.split(">").length - 1 === maxDepth) next.delete(pathKey);
      }
      return next;
    });
  };

  const handleBudgetCellDoubleClick = (detail) => {
    if (!detail) {
      setEntryDetail(null);
      return;
    }
    const categories =
      Array.isArray(detail.categories) && detail.categories.length
        ? detail.categories
        : detail.name
        ? [detail.name]
        : [];
    setEntryDetail({
      ...detail,
      categories,
      period: budgetPeriodRange,
    });
  };

  const handleActualCellDoubleClick = (detail) => {
    if (!detail) {
      setEntryDetail(null);
      return;
    }
    const categories =
      Array.isArray(detail.categories) && detail.categories.length
        ? detail.categories
        : detail.name
        ? [detail.name]
        : [];
    setEntryDetail({
      ...detail,
      categories,
      period: actualPeriodRange,
    });
  };

  const handleBudgetDetailClose = () => {
    setEntryDetail(null);
  };

  // ========== Event Handlers: Period ==========
  const handlePeriodChange = useCallback(
    ({ fromMonth, toMonth, actualYear, budgetYear }) => {
      setFromMonth(fromMonth);
      setToMonth(toMonth);
      setActualYear(actualYear);
      setBudgetYear(budgetYear);
    },
    []
  );

  // ========== Computed Values: Toolbar Props ==========
  const periodProps = useMemo(
    () => ({
      fromMonth,
      toMonth,
      actualYear,
      budgetYear,
      monthOptions: MONTH_OPTIONS,
      yearOptions: YEAR_OPTIONS,
      budgetYearOptions: BUDGET_YEAR_OPTIONS,
      onChange: handlePeriodChange,
      defaultPreset: "this-month",
    }),
    [fromMonth, toMonth, actualYear, budgetYear, handlePeriodChange]
  );

  const toggleProps = useMemo(
    () => ({
      includeUnrealized,
      onIncludeUnrealizedChange: setIncludeUnrealized,
      includeTransfers,
      onIncludeTransfersChange: setIncludeTransfers,
      isFullyCollapsed,
      isFullyExpanded,
      onExpandOneLayer: handleExpandOneLayer,
      onCollapseOneLayer: handleCollapseOneLayer,
      hasCollapsiblePaths: collapsiblePaths.size > 0,
    }),
    [
      includeUnrealized,
      includeTransfers,
      isFullyCollapsed,
      isFullyExpanded,
      handleExpandOneLayer,
      handleCollapseOneLayer,
      collapsiblePaths.size,
    ]
  );

  // ========== Export ==========
  const handleExport = useCallback(() => {
    exportBudgetRealization(filteredCategoryTree, {
      getActualValue: actualValueResolver,
      getBudgetValue: budgetValueResolver,
      getLeValue: leValueResolver,
      getLePresent: lePresenceResolver,
      hasActualData,
      hasBudgetData,
      hasLeData,
      showBudget,
      showActual,
      showLe,
      varActBud,
      varLeBud: varLeBud && hasLeData,
      varActLe: varActLe && hasLeData,
      shouldDropRow: makeShouldDropRow({
        showBudget, showActual, showLe, hasBudgetData, hasActualData,
      }),
      leLabel: leHeader ? leHeader.name : "LE",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filteredCategoryTree, actualValueResolver, budgetValueResolver,
    leValueResolver, lePresenceResolver, hasActualData, hasBudgetData, hasLeData,
    showBudget, showActual, showLe, varActBud, varLeBud, varActLe, leHeader,
  ]);

  // ========== Row context (CR088 P2) ==========
  // One object instead of the eleven positional arguments `renderCategoryRows`
  // used to take. Memoised because `BudgetRealizationContent` is `memo`'d and a
  // fresh object every render would defeat that.
  const rowContext = useMemo(
    () => ({
      collapsedPaths,
      handleToggle: handleTogglePath,
      leafActualTotals,
      getActualValue: actualValueResolver,
      leafBudgetTotals,
      getBudgetValue: budgetValueResolver,
      leafLeTotals,
      getLeValue: leValueResolver,
      getLePresent: lePresenceResolver,
      showBudget,
      showActual,
      showLe: showLe && leafLeTotals !== null,
      varActBud,
      varLeBud: varLeBud && leafLeTotals !== null,
      varActLe: varActLe && leafLeTotals !== null,
      onBudgetCellDoubleClick: handleBudgetCellDoubleClick,
      onActualCellDoubleClick: handleActualCellDoubleClick,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      collapsedPaths,
      leafActualTotals,
      actualValueResolver,
      leafBudgetTotals,
      budgetValueResolver,
      leafLeTotals,
      leValueResolver,
      lePresenceResolver,
      showBudget,
      showActual,
      showLe,
      varActBud,
      varLeBud,
      varActLe,
    ]
  );

  const compareProps = useMemo(
    () => ({
      mode: compareMode,
      onChange: setCompareMode,
      leAvailable: Boolean(leHeader),
      leName: leHeader ? leHeader.name : null,
      leCut: leHeader ? leHeader.actualThrough : null,
      periodReachesPastCut,
      unelapsedMonths,
      showBudget,
      showActual,
      showLe,
      varActBud,
      varLeBud,
      varActLe,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      compareMode, leHeader, periodReachesPastCut, unelapsedMonths,
      showBudget, showActual, showLe, varActBud, varLeBud, varActLe,
    ]
  );

  // ========== Render ==========

  return (
    <>
      <main className="budget-realization-main budget-realization-main--single">
        <BudgetRealizationContent
          filteredCategoryTree={filteredCategoryTree}
          rowContext={rowContext}
          showNetRow={showNetRow}
          netBudgetDisplay={netBudgetDisplay}
          netActualDisplay={netActualDisplay}
          netVarianceDisplay={netVarianceDisplay}
          netBudgetCellClass={netBudgetCellClass}
          netActualCellClass={netActualCellClass}
          netVarianceCellClass={netVarianceCellClass}
          netLeDisplay={netLeDisplay}
          netLeBudVarianceDisplay={netLeBudVarianceDisplay}
          netActLeVarianceDisplay={netActLeVarianceDisplay}
          netLeCellClass={netLeCellClass}
          netLeBudVarianceCellClass={netLeBudVarianceCellClass}
          netActLeVarianceCellClass={netActLeVarianceCellClass}
          renderCategoryRows={renderCategoryRows}
          periodProps={periodProps}
          toggleProps={toggleProps}
          compareProps={compareProps}
          onExport={handleExport}
          canExport={hasActualData || hasBudgetData}
          kpiData={kpiData}
          fyLanding={fyLanding}
        />
      </main>
      <BudgetDetailModal
        detail={entryDetail}
        onClose={handleBudgetDetailClose}
      />
    </>
  );
}
