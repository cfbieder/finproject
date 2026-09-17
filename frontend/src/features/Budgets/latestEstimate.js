import { useEffect, useMemo, useState } from "react";
import Rest from "../../js/rest.js";

// CR088 — the Latest Estimate as a third subject, shared by the three
// /budget-vs-actual tabs (Realization, Chart, Variances). It lived inline in
// BudgetRealization.jsx until the other two tabs needed the same comparison;
// copying it would have put the cut and unelapsed-month warnings — the parts
// that stop Act vs LE being read as performance — in three places to drift.

// ⚠️ The modes name a PAIR, not "what the budget is compared against". P2 used
// the second framing and it is what produced §11's mislabelled column: with
// three subjects the budget is not privileged, and a control that implies it is
// will keep generating headers that name the wrong benchmark.
export const COMPARE_MODES = [
  { key: "act-bud", label: "Act vs Bud" },
  { key: "act-le", label: "Act vs LE" },
  { key: "le-bud", label: "LE vs Bud" },
  { key: "all", label: "All" },
];

// Which subjects and which variances a mode renders.
//   act-bud  BUDGETED · ACTUALS            · ACT vs BUD   (the default)
//   act-le   ACTUALS  · LE                 · ACT vs LE
//   le-bud   BUDGETED · LE                 · LE vs BUD
//   all      BUDGETED · ACTUALS · LE       · all three
export const compareFlags = (mode) => ({
  showBudget: mode === "act-bud" || mode === "le-bud" || mode === "all",
  showActual: mode === "act-bud" || mode === "act-le" || mode === "all",
  showLe: mode === "act-le" || mode === "le-bud" || mode === "all",
  varActBud: mode === "act-bud" || mode === "all",
  varLeBud: mode === "le-bud" || mode === "all",
  varActLe: mode === "act-le" || mode === "all",
});

const formatDateParam = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildLeafTotalsMap = (nodes, map = new Map()) => {
  if (!Array.isArray(nodes)) return map;
  for (const node of nodes) {
    if (!node || typeof node !== "object" || !node.name) continue;
    if (Array.isArray(node.children) && node.children.length > 0) {
      buildLeafTotalsMap(node.children, map);
    } else {
      map.set(node.name, Number.isFinite(Number(node.total)) ? Number(node.total) : 0);
    }
  }
  return map;
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
    if (Array.isArray(node.children) && node.children.length > 0) {
      buildLeafLePresenceSet(node.children, set);
    } else if (node.hasLe) {
      set.add(node.name);
    }
  }
  return set;
};

/**
 * The compare mode, the LE for the budget year, and the LE's leaf totals over
 * `lePeriodRange` — fetched only while a mode that shows the LE is selected.
 *
 * Everything that depends on an argument is DERIVED from a keyed result rather
 * than reset inside an effect, so a stale LE never renders against a new period
 * and no `set-state-in-effect` debt is added.
 */
export function useLatestEstimate({
  budgetYear,
  lePeriodRange,
  actualPeriodRange,
  includeTransfers = false,
  logTag = "LatestEstimate",
}) {
  const [requestedMode, setMode] = useState("act-bud");
  const [leList, setLeList] = useState({ year: null, header: null });

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
        setLeList({
          year: budgetYear,
          header: head
            ? {
                id: head.id,
                name: head.name,
                actualThrough: String(head.actual_through).slice(0, 10),
              }
            : null,
        });
      })
      .catch((error) => {
        if (!isActive) return;
        console.error(`[${logTag}] Failed to load the LE list:`, error);
        setLeList({ year: budgetYear, header: null });
      });
    return () => {
      isActive = false;
    };
  }, [budgetYear, logTag]);

  const leHeader = leList.year === budgetYear ? leList.header : null;

  // A year with no LE cannot offer the comparison; fall back rather than render
  // an empty column that looks like "the estimate is nothing". Derived, so the
  // chosen mode comes back once a year that has an LE is selected again.
  const mode = leHeader ? requestedMode : "act-bud";
  const flags = compareFlags(mode);

  const fromDate = lePeriodRange ? formatDateParam(lePeriodRange.start) : null;
  const toDate = lePeriodRange ? formatDateParam(lePeriodRange.end) : null;
  const transfers = includeTransfers ? "include" : "exclude";
  const requestKey =
    flags.showLe && leHeader && fromDate && toDate
      ? `${leHeader.id}|${fromDate}|${toDate}|${transfers}`
      : null;

  const [leResult, setLeResult] = useState({ key: null });

  useEffect(() => {
    if (!requestKey) return undefined;
    let isActive = true;
    Rest.fetchLeCashFlowReport({ leId: leHeader.id, fromDate, toDate, transfers })
      .then((report) => {
        if (!isActive) return;
        const nodes = Array.isArray(report && report.nodes) ? report.nodes : [];
        setLeResult({
          key: requestKey,
          totals: buildLeafTotalsMap(nodes),
          present: buildLeafLePresenceSet(nodes),
          error: false,
        });
      })
      .catch((error) => {
        if (!isActive) return;
        console.error(`[${logTag}] Failed to load the LE:`, error);
        // ⚠️ null, never an empty map. An empty map resolves every row to 0 and
        // renders a page of figures that look like real estimates of nothing —
        // the exact failure CR087 P0b closed on the actuals side.
        setLeResult({ key: requestKey, totals: null, present: null, error: true });
      });
    return () => {
      isActive = false;
    };
    // requestKey encodes every other input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const current = requestKey && leResult.key === requestKey ? leResult : null;
  const leafLeTotals = current ? current.totals : null;
  const leafLePresent = current ? current.present : null;
  const leError = Boolean(current && current.error);

  // Whether the selected period reaches PAST the LE's cut. `budget_le_lines`
  // carries the transactions verbatim for every closed month, so for a period
  // ending on or before the cut the LE is byte-identical to the actual
  // (measured on prod: 0 of 111 leaves differ over Jan–Jul, sums tie to the
  // cent). Two figures that agree by construction read as corroboration and are not.
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
  // whole-period figures.
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

  const compareProps = useMemo(
    () => ({
      mode,
      onChange: setMode,
      leAvailable: Boolean(leHeader),
      leName: leHeader ? leHeader.name : null,
      leCut: leHeader ? leHeader.actualThrough : null,
      periodReachesPastCut,
      unelapsedMonths,
      ...compareFlags(mode),
    }),
    [mode, leHeader, periodReachesPastCut, unelapsedMonths]
  );

  return {
    mode,
    ...flags,
    leHeader,
    leafLeTotals,
    leafLePresent,
    leError,
    compareProps,
  };
}

// ---- chart helpers (the Chart tab and its drill-down modal) ---------------

// The bars a mode draws, in the Realization tab's fixed subject order.
export const chartSeries = (flags) =>
  [
    flags.showBudget && { key: "budget", label: "Budget" },
    flags.showActual && { key: "actual", label: "Actual" },
    flags.showLe && { key: "le", label: "LE" },
  ].filter(Boolean);

// The variances a mode states, each named after its own pair (CR088 §11), as
// `a − b` — favourable-positive for income and expense alike (CR087 §4b).
export const chartVariances = (flags) =>
  [
    flags.varActBud && { key: "actBud", label: "Act vs Bud", a: "actual", b: "budget" },
    flags.varLeBud && { key: "leBud", label: "LE vs Bud", a: "le", b: "budget" },
    flags.varActLe && { key: "actLe", label: "Act vs LE", a: "actual", b: "le" },
  ].filter(Boolean);

export const varianceOf = (node, v) =>
  node[v.a] == null || node[v.b] == null ? null : node[v.a] - node[v.b];

// "Does the LE have a view on this node at all" — true if any leaf beneath it
// carries a line. An LE that estimates a category at exactly zero is a real
// answer and must not render as `—`.
export const createLePresenceResolver = (leafLePresent) => {
  if (!leafLePresent) return null;
  const cache = new Map();
  const resolve = (node, pathKey) => {
    if (!node || !pathKey) return false;
    if (cache.has(pathKey)) return cache.get(pathKey);
    const present =
      Array.isArray(node.children) && node.children.length > 0
        ? node.children.some((child) => resolve(child, `${pathKey}>${child.name}`))
        : leafLePresent.has(node.name);
    cache.set(pathKey, present);
    return present;
  };
  return resolve;
};
