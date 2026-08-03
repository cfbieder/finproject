/**
 * CR067 P2 — turning N scenario matrices into N chart series.
 *
 * `buildScenarioMatrix` is already pure and single-scenario, so the whole computation is
 * calling it once per scenario. What this adds is the part that used to live inside
 * `compareMatrices` and is dropped along with it: **aligning scenarios that do not cover the
 * same years**.
 *
 * That alignment is the one thing here that can be silently wrong. Each matrix trims its own
 * years to `>= its own PeriodStart` (fcCompareUtils.js:108), so two scenarios starting in
 * different years have DIFFERENT year at the SAME index. Plotting the arrays positionally
 * shifts one scenario against the other — no error, no gap, just a chart that looks right and
 * isn't. Every scenario shares a PeriodStart today; CR064 P2 (the annual close) is about to
 * change that.
 */
import { MAX_SERIES } from "./fcSeriesPalette.js";

/**
 * The chart metric → the row on a matrix that actually backs it.
 *
 * `netCashFlow` is the trap: a matrix carries it TWICE — as a top-level array of plain
 * numbers (never null) and as `cash.get("Net Cash Flow")`, which is null in a year with no
 * Income/Expense/Transfers rows. Compare plots the second one, so this must too, or the two
 * pages draw 0 and a gap for the same year. `Expense` is likewise already net of Transfers.
 */
export function metricValues(matrix, metricKey) {
  if (!matrix) return [];
  switch (metricKey) {
    case "netAssets":
      return matrix.netAssets ?? [];
    case "totalAssets":
      return matrix.totalAssets ?? [];
    case "netCashFlow":
      return matrix.cash?.get("Net Cash Flow") ?? [];
    case "income":
      return matrix.cash?.get("Income") ?? [];
    case "expense":
      return matrix.cash?.get("Expense") ?? [];
    default:
      return [];
  }
}

/**
 * Align N scenarios onto the union of their years, keyed BY YEAR.
 *
 * @param {Array}  entries   - [{ name, matrix }] in display order
 * @param {string} metricKey - a METRICS key
 * @returns {{years: number[], series: Array<{name: string, values: Array<number|null>}>}}
 *   A year a scenario does not cover is `null`, which the chart renders as a gap rather than
 *   interpolating a trajectory nobody forecast.
 */
export function alignSeries(entries, metricKey) {
  const list = (entries || []).filter((e) => e?.matrix?.years?.length);
  const years = [...new Set(list.flatMap((e) => e.matrix.years.map(Number)))].sort(
    (a, b) => a - b
  );

  const series = list.map((entry) => {
    const values = metricValues(entry.matrix, metricKey);
    const byYear = new Map(entry.matrix.years.map((y, i) => [Number(y), values[i] ?? null]));
    return {
      name: entry.name,
      values: years.map((y) => (byYear.has(y) ? byYear.get(y) : null)),
    };
  });

  return { years, series };
}

/**
 * A scenario's colour slot: the base is always 0, a variant takes its position in the base's
 * OWN variant list — a stable property of the scenario, not of the current selection. Keying
 * off the selected subset would repaint every surviving line when one checkbox is cleared.
 */
export function colorIndexFor(name, baseName, variantNames) {
  if (name === baseName) return 0;
  const i = (variantNames || []).indexOf(name);
  // No wrap-around: a hue is never recycled for an extra series. The page refuses the
  // selection past MAX_SERIES instead, which is the honest answer to "an 8th variant".
  return i < 0 || i + 1 >= MAX_SERIES ? 0 : i + 1;
}
