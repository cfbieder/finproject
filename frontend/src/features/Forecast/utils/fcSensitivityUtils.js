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
import { BASE_DASH } from "./fcSeriesPalette.js";

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

  // Points are keyed by (knob, BAND, side) — a knob may carry several bands.
  const byKnob = new Map();
  const applied = new Map();
  for (const p of result.points || []) {
    const band = p.band ?? "_";
    if (!byKnob.has(p.knobId)) byKnob.set(p.knobId, new Map());
    const bands = byKnob.get(p.knobId);
    if (!bands.has(band)) bands.set(band, {});
    bands.get(band)[p.side] = metricValue(p, metricKey, shared);

    // What the knob was actually moved TO on this side, and from — carried through so the table
    // can print "±0.25× · at 0.55" instead of a band nobody can resolve.
    if (!applied.has(p.knobId)) applied.set(p.knobId, new Map());
    const av = applied.get(p.knobId);
    if (!av.has(band)) av.set(band, {});
    av.get(band)[p.side] = p.appliedValue;
    av.get(band)[`${p.side}Usd`] = p.appliedValueUsd;
    av.set("before", p.beforeValue);
    av.set("beforeUsd", p.beforeValueUsd);
  }

  const rows = [];
  const incomparable = [];
  for (const knob of result.knobs || []) {
    const bandMap = byKnob.get(knob.knobId) || new Map();
    const av = applied.get(knob.knobId) || new Map();

    /**
     * ⚠️ THE RANKING BAND IS ONE BAND, NAMED.
     *
     * If one knob is probed at ±50% and another only at ±10%, sorting by largest impact makes the
     * first look more important purely because it was pushed harder. That is the "±1pp vs ±10%"
     * comparability problem amplified, so the sort runs on the SMALLEST band every knob has —
     * the most conservative common footing — and the others are drawn as context.
     */
    const measured = [...bandMap.entries()]
      .filter(([, v]) => v.low != null && v.high != null)
      .map(([band, v]) => ({
        band: band === "_" ? (knob.band ?? null) : Number(band),
        low: v.low - anchor,
        high: v.high - anchor,
        lowValue: av.get(band)?.low,
        highValue: av.get(band)?.high,
        lowValueUsd: av.get(band)?.lowUsd ?? null,
        highValueUsd: av.get(band)?.highUsd ?? null,
      }))
      .sort((a, b) => (a.band ?? 0) - (b.band ?? 0));

    if (anchor == null || measured.length === 0) {
      // Surfaced, never dropped. A knob missing from a ranking reads as a knob that does not
      // matter, which is the one thing this chart must not say by omission.
      incomparable.push({ knob, reason: "a point could not be measured" });
      continue;
    }

    const rank = measured[0];
    const lo = rank.low + anchor;
    const hi = rank.high + anchor;
    const dLow = lo - anchor;
    const dHigh = hi - anchor;
    const span = Math.max(Math.abs(dLow), Math.abs(dHigh));

    // ⚠️ A knob that moved NOTHING is surfaced, not ranked. A zero-length bar in a ranked chart
    // reads "this assumption does not matter"; an empty 46px lane and a `$0 / $0` table row read
    // the same way. That is CR085's defining defect and it kept reaching the page. `Not ranked`
    // already exists for exactly this and carries the reason with it.
    if (span < ZERO_IMPACT) {
      incomparable.push({ knob, reason: "moved the plan by nothing measurable" });
      continue;
    }

    rows.push({
      knobId: knob.knobId,
      knob: {
        ...knob,
        currentValue: av.get("before") ?? knob.currentValue,
        currentValueUsd: av.get("beforeUsd") ?? null,
      },
      // The ranking band's numbers stay on the row, so every existing reader is unchanged.
      low: dLow,
      high: dHigh,
      lowValue: rank.lowValue,
      highValue: rank.highValue,
      lowValueUsd: rank.lowValueUsd,
      highValueUsd: rank.highValueUsd,
      rankBand: rank.band,
      /** Every band measured, smallest first — what the nested bars draw. */
      bands: measured,
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

/** Below a dollar either way, the knob did not move the plan. */
export const ZERO_IMPACT = 1;

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

/**
 * The three trajectories behind ONE bar — base, that knob's low run, its high run.
 *
 * ⚠️ WHY THIS EXISTS. The tornado ranks on a single end-year number, and that number cannot say
 * WHEN the damage lands. A knob costing 70K by 2062 but running the plan dry in 2041 is a
 * different problem from one that drifts gently for thirty-five years, and both draw the same bar.
 *
 * ⚠️ SERIES ARE KEYED BY YEAR, NEVER BY ARRAY POSITION. Each matrix trims its years to its own
 * `PeriodStart` (fcCompareUtils.js), so plotting the arrays positionally would silently shift two
 * runs against each other — same index, different year, no error, a wrong chart that looks right.
 * This is CR067 §4's trap; the runs here share a PeriodStart today, which is exactly what would
 * make a positional bug invisible.
 *
 * @returns {{years: number[], series: Array<{name, values, color, strokeWidth}>}}
 */
export function knobTrajectory(result, knobId, shared, metricKey, colors, mode = "absolute", row = null, metric = null) {
  if (!result) return { years: [], series: [] };

  const runs = [
    { key: "base", label: "base", entries: result.anchor?.entries, width: 2, color: colors.base, dash: BASE_DASH },
    ...["low", "high"].map((side) => {
      const p = (result.points || []).find((x) => x.knobId === knobId && x.side === side);
      // ⚠️ COLOUR FOLLOWS THE METRIC, NEVER THE SIDE — the same rule §4.2 sets for the bars.
      // This used to be `side === "low" ? adverse : favourable`, so the tornado and this chart
      // used OPPOSITE rules: `Car Expenses · Amount` down is +$256.5K and draws BLUE in the bar
      // (cutting an expense helps) and RED here, one click apart. On the shortfall metric, where
      // down is the good direction, every knob inverted.
      const adverseSide = row && metric ? adverseSideFor(row, metric) : "low";
      return {
        key: side,
        label: side === "low" ? "down" : "up",
        entries: p?.entries,
        width: 1.75,
        color: side === adverseSide ? colors.adverse : colors.favourable,
      };
    }),
  ].filter((r) => Array.isArray(r.entries) && r.entries.length);

  const matrices = runs.map((r) => ({ ...r, matrix: matrixFor(r.entries, shared) }))
    .filter((r) => r.matrix);
  if (!matrices.length) return { years: [], series: [] };

  const years = [...new Set(matrices.flatMap((r) => r.matrix.years || []))]
    .map(Number).filter(Number.isFinite).sort((a, b) => a - b);

  const perRun = matrices.map((r) => ({
    ...r,
    byYear: seriesByYear(r.matrix, metricKey),
  }));

  // ⚠️ THE ABSOLUTE VIEW HIDES MOST KNOBS. A ±0.25× growth knob moves ~180K against a $12M plan,
  // so all three lines overlap and the reader learns nothing about WHEN they separate — which is
  // the entire reason this chart exists beside the bar. The delta view subtracts the base, so the
  // base is a flat zero and the two runs fan out at whatever scale they actually have.
  const baseByYear = perRun.find((r) => r.key === "base")?.byYear;
  const asDelta = mode === "delta" && baseByYear;

  const series = perRun
    // In delta mode the base IS the zero line, so drawing it as a series would be a flat line
    // labelled "base" on top of the axis.
    .filter((r) => !(asDelta && r.key === "base"))
    .map((r) => ({
      name: r.label,
      color: r.color,
      dash: r.dash,
      strokeWidth: asDelta ? 2 : r.width,
      // Interior gaps stay gaps: a year the engine wrote no rows for is a break in the line,
      // not a collapse to zero.
      values: years.map((y) => {
        const v = r.byYear.has(y) ? r.byYear.get(y) : null;
        if (!asDelta) return v;
        const b = baseByYear.has(y) ? baseByYear.get(y) : null;
        return v == null || b == null ? null : v - b;
      }),
    }));

  return { years, series };
}

function matrixFor(entries, shared) {
  const years = yearsOf(entries);
  if (!years.length) return null;
  const m = buildScenarioMatrix({
    entries,
    years,
    periodStart: shared.periodStart,
    baseYearValues: shared.baseYearValues,
    lastActualBalance: shared.lastActualBalance,
    cashAccountMap: shared.cashAccountMap,
    balanceAccountMap: shared.balanceAccountMap,
    balanceRows: shared.balanceRows,
  });
  return m ? { ...m, years: m.years || years } : null;
}

/**
 * One metric's values keyed by YEAR.
 *
 * ⚠️ `netCashFlow` exists TWICE on a matrix — a top-level array of plain numbers that is never
 * null, and `cash.get("Net Cash Flow")` which IS null in a year carrying no Income/Expense/
 * Transfers rows. Compare plots the second; reading the first draws 0 where Compare draws a gap.
 */
function seriesByYear(matrix, metricKey) {
  const rowFor = {
    netAssets: () => matrix.netAssets,
    totalAssets: () => matrix.totalAssets,
    netCashFlow: () => matrix.cash?.get("Net Cash Flow"),
    income: () => matrix.cash?.get("Income"),
    expense: () => matrix.cash?.get("Expense"),
  }[metricKey];
  const values = rowFor ? rowFor() : null;
  const out = new Map();
  if (!Array.isArray(values)) return out;
  (matrix.years || []).forEach((y, i) => out.set(Number(y), values[i] ?? null));
  return out;
}


/** Format a knob value the way the picker does — the raw column value is not a thing anyone reads. */
export function formatKnobValue(kind, value) {
  if (value == null) return "—";
  if (kind === "timing") return String(value).slice(0, 10);
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (kind === "rate") return `${Number(n.toFixed(4))}%`;
  if (kind === "multiplier") return `${Number(n.toFixed(4))}×`;
  return Math.abs(n) >= 1000
    ? n.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : String(Number(n.toFixed(2)));
}

/**
 * A knob's value as the table should print it: USD first where the module is not USD, with the
 * typed native figure beneath.
 *
 * ⚠️ THIS IS A CORRECTNESS FIX, NOT FORMATTING. A knob moves the module's OWN-currency column, so
 * `United Beverages · Market value` reads 15,000,000 — which is PLN — while every impact on the
 * same row is USD. Printed side by side with nothing to tell them apart, the reader computes
 * "±50% of 15,000,000 moved the plan $4.1M", about 27%, when the truth is $4.1M against
 * $4,175,595 — nearly all of it. Wrong by 3.6×, and that ratio is the judgement the page exists
 * to support. Same class as CR054.
 *
 * @returns {{primary: string, secondary: string|null}}
 */
export function knobValuePair(kind, currency, value, valueUsd) {
  const native = formatKnobValue(kind, value);
  const isMoney = kind === "level";
  const foreign = isMoney && currency && currency !== "USD";
  if (!foreign || valueUsd == null) {
    return { primary: isMoney && value != null ? `$${native}` : native, secondary: null };
  }
  return {
    primary: `$${formatKnobValue(kind, valueUsd)}`,
    secondary: `${currency} ${native}`,
  };
}

/**
 * Which side of a knob moved the metric the WRONG way.
 *
 * ⚠️ Decided on the metric, never on the arithmetic. Liabilities are stored negative and on the
 * shortfall metric down is good, so "low" is not a synonym for "worse".
 */
export function adverseSideFor(row, metric) {
  const lowerIsBetter = metric?.better === "lower";
  const worse = (a, b) => (lowerIsBetter ? a > b : a < b);
  return worse(row.low, row.high) ? "low" : "high";
}

/**
 * The two combinations worth building from a finished ranking: everything against you, and
 * everything for you.
 */
export function combinationsFor(rows, metric) {
  const sideOf = (r) => adverseSideFor(r, metric);
  const flip = (side) => (side === "low" ? "high" : "low");
  const spec = (label, pick) => ({
    label,
    knobs: rows.map((r) => ({
      entity: r.knob.entity,
      target: r.knob.target,
      field: r.knob.field,
      band: r.knob.band ?? r.knob.lowBand ?? r.knob.highBand,
      side: pick(r),
    })),
  });
  return [
    spec("All adverse", (r) => sideOf(r)),
    spec("All favourable", (r) => flip(sideOf(r))),
  ];
}

/**
 * ⚠️ THE COMBINED RUN IS NOT THE SUM OF THE BARS, AND THE GAP IS THE PRODUCT.
 *
 * §5.4 forbids DISPLAYING a sum of impacts, because the model is path-dependent — the cash sweep
 * sells different assets when three things move at once than when each moves alone, so adding the
 * bars yields a figure the engine never produces. Measuring the combination instead is legitimate,
 * and the difference between the two is the interaction: the only honest answer to "do these risks
 * compound or cancel?", which is the question a tornado structurally cannot ask.
 *
 * The sum appears here ONLY as the thing the measurement is compared against — never on its own.
 */
export function interactionSummary(rows, metric, combinedResult, shared) {
  if (!combinedResult) return null;
  const anchor = metricOf(combinedResult.anchor, metric, shared);
  const adverse = combinedResult.combinations?.find((c) => c.label === "All adverse");
  if (anchor == null || !adverse) return null;

  const measured = metricOf(adverse, metric, shared);
  if (measured == null) return null;

  const summed = rows.reduce(
    (acc, r) => acc + (adverseSideFor(r, metric) === "low" ? r.low : r.high),
    0
  );
  const measuredDelta = measured - anchor;
  const interaction = measuredDelta - summed;
  const worseThanSum = metric?.better === "lower" ? interaction > 0 : interaction < 0;

  return { summed, measured: measuredDelta, interaction, worseThanSum, anchor };
}

function metricOf(run, metric, shared) {
  if (!run) return null;
  return metric?.key === "shortfall"
    ? Number(run.shortfall ?? 0)
    : netAssetsAtEnd(run.entries, shared);
}

/** base + the combinations, as trajectory series. */
export function combinedTrajectory(combinedResult, shared, metricKey, colors) {
  if (!combinedResult) return { years: [], series: [] };
  const runs = [
    { label: "base", entries: combinedResult.anchor?.entries, color: colors.base, width: 2, dash: BASE_DASH },
    ...(combinedResult.combinations || []).map((c) => ({
      label: c.label === "All adverse" ? "all adverse" : "all favourable",
      entries: c.entries,
      color: c.label === "All adverse" ? colors.adverse : colors.favourable,
      width: 2,
    })),
  ].filter((r) => Array.isArray(r.entries) && r.entries.length);

  const matrices = runs.map((r) => ({ ...r, matrix: matrixFor(r.entries, shared) }))
    .filter((r) => r.matrix);
  if (!matrices.length) return { years: [], series: [] };

  const years = [...new Set(matrices.flatMap((r) => r.matrix.years || []))]
    .map(Number).filter(Number.isFinite).sort((a, b) => a - b);

  return {
    years,
    series: matrices.map((r) => {
      const byYear = seriesByYear(r.matrix, metricKey);
      return {
        name: r.label,
        color: r.color,
        dash: r.dash,
        strokeWidth: r.width,
        values: years.map((y) => (byYear.has(y) ? byYear.get(y) : null)),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Custom bands — the presets are a starting point, not the question
// ---------------------------------------------------------------------------

/**
 * The bands offered per kind before the owner types one. These are a UI convenience ONLY: the
 * server's `bandsOf` accepts any finite band > 0 and the route validates none of them, so nothing
 * downstream is keyed to these nine numbers.
 */
export const BAND_PRESETS = Object.freeze({
  rate: [0.5, 1, 2],
  level: [10, 20, 50],
  multiplier: [0.25, 0.5, 1],
  timing: [1, 2, 5],
});

/** The unit a band is expressed in — for the input's accessible name and its suffix. */
export function bandUnit(kind) {
  return { rate: "pp", level: "%", multiplier: "×", timing: "y" }[kind] || "";
}

export function bandUnitLong(kind) {
  return { rate: "percentage points", level: "percent", multiplier: "multiples", timing: "years" }[kind]
    || "units";
}

/**
 * The chips to draw for a knob: the presets, plus whatever the owner typed, in order.
 *
 * A custom band lives only in the selection — untick it and the chip is gone next render, which is
 * the whole of its lifecycle. There is nothing to "manage" and nothing to clean up.
 */
export function bandChoices(kind, bands = []) {
  const set = new Set([...(BAND_PRESETS[kind] || []), ...bands.filter((b) => Number.isFinite(b) && b > 0)]);
  return [...set].sort((a, b) => a - b);
}

/**
 * ⚠️ THE PRESETS WERE ALSO HIDING THREE WAYS TO ASK FOR NONSENSE.
 *
 * `perturb` applies a LEVEL band as `base × (1 + sign × band / 100)` with no clamp, so ±100%
 * makes the low side exactly 0 and ±150% makes an asset NEGATIVE — and the engine builds it
 * without complaint. A TIMING band goes to `shiftYears(current, sign × band)`, where a fraction is
 * not a thing. And a band of 0 or below is two builds of the unchanged scenario drawn as a bar.
 *
 * A rate driven negative is NOT refused: a −2% return is a real scenario, and the applied-value
 * row already prints what the ± lands on, so it is visible rather than hidden.
 */
export function validateBand(kind, raw) {
  // ⚠️ `Number("")` is 0, not NaN — an empty box would otherwise be told "must be above zero",
  // which is an answer to a question nobody asked.
  const text = String(raw ?? "").trim();
  const v = text === "" ? NaN : Number(text);
  if (!Number.isFinite(v)) return { error: "Needs a number." };
  if (v <= 0) return { error: "Must be above zero — a ±0 band builds the same plan twice." };
  if (kind === "timing" && !Number.isInteger(v)) return { error: "Whole years only." };
  if (kind === "level" && v >= 100) {
    return { error: "±100% or more zeroes the value — the low side would be 0 or negative." };
  }
  if (kind === "rate" && v > 100) return { error: "Over 100 percentage points is not a nudge." };
  // ⚠️ A MULTIPLIER band is ABSOLUTE (`base + sign × band`), so ±150× on a growth of 0.8 is
  // −149.2× inflation: not a pessimistic scenario, a different model. Note this does NOT refuse a
  // negative multiplier as such — the ±1× PRESET already takes a 0.8 growth to −0.2×, and a stream
  // shrinking at a fraction of inflation is a real thing to ask about.
  if (kind === "multiplier" && v > 10) return { error: "Over 10× is a different model, not a band." };
  // Float noise off a typed "0.1" would otherwise make 0.30000000000000004 its own chip.
  return { value: Math.round(v * 1e4) / 1e4 };
}

/**
 * What a selection costs, in the server's own unit.
 *
 * ⚠️ THIS ONLY BECOMES NECESSARY WHEN BANDS ARE EDITABLE. With three fixed chips the ceiling was
 * 8 knobs × 3 bands + 1 anchor = 49 builds against a cap of 50, so the UI could not reach it. A
 * fourth band on any one knob can — and the refusal is a 409 raised after the whole composition is
 * done, which is the wrong moment to learn the run is too big.
 */
export const MAX_BUILDS = 50;

export function plannedBuilds(selected = []) {
  return selected.reduce((n, k) => n + (k.bands || [k.band]).filter(Boolean).length * 2, 1);
}

/** ~0.5s a build, the same figure the server's refusal message quotes. */
export function buildSeconds(builds) {
  return Math.round(builds * 0.5);
}

/**
 * ⚠️ THE RANKING USES THE SMALLEST BAND EACH KNOB CARRIES, so two knobs of the SAME kind probed at
 * different smallest bands are not ranked like for like — one bar is a ±10% question and the other
 * a ±35% one, side by side, sorted against each other.
 *
 * This was always possible (untick ±10% on one knob and it ranks at ±20%), but three fixed chips
 * made it a deliberate act. A typed band makes it the default outcome of answering a question about
 * one module, so it has to be said out loud rather than left in the chart's footnote.
 *
 * Kinds are NOT compared against each other: a rate's percentage points and a level's percent are
 * different units, and every bar prints its own band.
 */
export function bandMismatch(selected = []) {
  const byKind = new Map();
  for (const k of selected) {
    const smallest = Math.min(...(k.bands || [k.band]).filter((b) => Number.isFinite(b)));
    if (!Number.isFinite(smallest)) continue;
    if (!byKind.has(k.kind)) byKind.set(k.kind, new Set());
    byKind.get(k.kind).add(smallest);
  }
  return [...byKind.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([kind, set]) => ({ kind, bands: [...set].sort((a, b) => a - b) }));
}
