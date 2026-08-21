/**
 * CR085 P1 — turning a sensitivity run into ranked bars.
 *
 * ⚠️ THE METRICS ARE COMPUTED HERE, ON THE CLIENT, DELIBERATELY.
 * Net assets is `buildScenarioMatrix` and real terms is `fcRealTerms` — both frontend code that
 * CR084 explicitly refused to port to the server ("porting them would create a second
 * implementation of numbers the Review and Compare pages already render"). A server-side
 * net-assets sum that disagreed with Compare on any rule — sign conventions, which accounts roll
 * into assets — would produce a DIFFERENT RANKING with no error anywhere. So the server returns
 * raw entries per point and the ordering is decided by the same function Compare draws.
 *
 * P1 ships exactly TWO metrics. Real terms is NOT one of them, and that is arithmetic rather than
 * taste: `fcRealTerms` deflates by (scenario name, year), and every point in one run shares both,
 * so the deflator is one identical scalar across all 17 points. A real-terms ranking is therefore
 * IDENTICAL to the nominal one — it relabels the axis and cannot reorder a bar.
 */

import { buildScenarioMatrix } from "./fcCompareUtils.js";

export const METRICS = [
  {
    key: "netAssets",
    label: "Net assets at the final year",
    format: "currency",
    // Higher is better, so a knob that RAISES net assets is the favourable side.
    better: "higher",
  },
  {
    key: "shortfall",
    label: "Total unfunded shortfall",
    format: "currency",
    better: "lower",
  },
];

/** Years present in one point's entries — derived per point, never borrowed from the anchor. */
const yearsOf = (entries) =>
  [...new Set((entries || []).map((e) => Number(e.Year)))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

/**
 * Net assets in the LAST forecast year of a point.
 * Returns null when the matrix cannot be built — never 0, because 0 is a real net-assets value
 * and a failed point must not rank as "no impact".
 */
export function netAssetsAtEnd(entries, shared) {
  const years = yearsOf(entries);
  if (!years.length) return null;

  const matrix = buildScenarioMatrix({
    entries,
    years,
    periodStart: shared.periodStart,
    baseYearValues: shared.baseYearValues,
    lastActualBalance: shared.lastActualBalance,
    cashAccountMap: shared.cashAccountMap,
    balanceAccountMap: shared.balanceAccountMap,
    balanceRows: shared.balanceRows,
  });
  const series = matrix?.netAssets;
  if (!Array.isArray(series) || !series.length) return null;

  // The last NON-NULL value: an interior gap is a year the engine wrote no rows for, and reading
  // past it would report a gap as a collapse to zero.
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i] != null && Number.isFinite(Number(series[i]))) return Number(series[i]);
  }
  return null;
}

const metricValue = (point, metricKey, shared) =>
  metricKey === "shortfall"
    ? Number(point.shortfall ?? 0)
    : netAssetsAtEnd(point.entries, shared);

/**
 * Rank the knobs for one metric.
 *
 * ⚠️ DIRECTION COMES FROM THE METRIC, NEVER FROM THE FIELD'S ARITHMETIC SIGN.
 * Liabilities are stored negative, so "+10% on market_value" makes a house worth more and a
 * mortgage worth MORE NEGATIVE. A chart that labelled both ends by the sign of the perturbation
 * would be confidently backwards for every loan and credit-card module in the plan. Each bar is
 * therefore labelled by which way the METRIC moved.
 *
 * @returns {{anchor: number|null, rows: Array, incomparable: Array}}
 */
export function rankKnobs(result, metricKey, shared) {
  if (!result) return { anchor: null, rows: [], incomparable: [] };

  const anchor = metricKey === "shortfall"
    ? Number(result.anchor?.shortfall ?? 0)
    : netAssetsAtEnd(result.anchor?.entries, shared);

  const byKnob = new Map();
  for (const p of result.points || []) {
    if (!byKnob.has(p.knobId)) byKnob.set(p.knobId, {});
    byKnob.get(p.knobId)[p.side] = metricValue(p, metricKey, shared);
  }

  const rows = [];
  const incomparable = [];
  for (const knob of result.knobs || []) {
    const sides = byKnob.get(knob.knobId) || {};
    const lo = sides.low;
    const hi = sides.high;
    if (anchor == null || lo == null || hi == null) {
      // Surfaced, never dropped. A knob missing from a ranking reads as a knob that does not
      // matter, which is the one thing this chart must not say by omission.
      incomparable.push({ knob, reason: "a point could not be measured" });
      continue;
    }
    const dLow = lo - anchor;
    const dHigh = hi - anchor;
    const span = Math.max(Math.abs(dLow), Math.abs(dHigh));

    rows.push({
      knobId: knob.knobId,
      knob,
      low: dLow,
      high: dHigh,
      span,
      regimeChange: isRegimeChange(dLow, dHigh),
    });
  }

  rows.sort((a, b) => b.span - a.span);
  return { anchor, rows, incomparable };
}

/**
 * ⚠️ Asymmetry is INFORMATION, not noise — it is usually the cash sweep firing on one side.
 *
 * The model is path-dependent: a downward nudge can force a liquidation that changes everything
 * after it. Every point here is a real engine build so each number is true, but the tornado's
 * SHAPE implies a smooth, symmetric response that the sweep breaks. A knob whose two sides differ
 * by more than half the larger side is flagged rather than drawn as if it were linear.
 *
 * The threshold is a judgement, and it is deliberately loose: compounding alone makes a growth
 * knob mildly asymmetric (a live run showed −169,104 / +183,712, a 0.08 ratio), so a tighter
 * threshold would flag every knob and mean nothing.
 */
export const REGIME_CHANGE_RATIO = 0.5;

export function isRegimeChange(dLow, dHigh) {
  const a = Math.abs(dLow);
  const b = Math.abs(dHigh);
  const bigger = Math.max(a, b);
  if (bigger === 0) return false;
  // Same-direction moves mean the metric went the same way for BOTH ends of the knob, which no
  // monotone response produces — that is a regime change whatever the magnitudes.
  if (dLow !== 0 && dHigh !== 0 && Math.sign(dLow) === Math.sign(dHigh)) return true;
  return Math.abs(a - b) / bigger > REGIME_CHANGE_RATIO;
}

/** "±1pp" / "±10%" / "±0.25×" / "±2y" — printed on every bar, so the nudge is never implicit. */
export function bandLabel(knob) {
  const band = knob.band ?? knob.lowBand ?? knob.highBand;
  if (band == null) return "";
  switch (knob.kind) {
    case "rate": return `±${band}pp`;
    case "level": return `±${band}%`;
    case "multiplier": return `±${band}×`;
    case "timing": return `±${band}y`;
    default: return `±${band}`;
  }
}

/** The §6 layer-2 signal: how far the SAVED forecast has drifted from a fresh build. */
export function storedDrift(result, shared) {
  const fresh = netAssetsAtEnd(result?.anchor?.entries, shared);
  const stored = netAssetsAtEnd(result?.storedEntries, shared);
  if (fresh == null || stored == null) return null;
  const delta = fresh - stored;
  return Math.abs(delta) < 1 ? null : { fresh, stored, delta };
}
