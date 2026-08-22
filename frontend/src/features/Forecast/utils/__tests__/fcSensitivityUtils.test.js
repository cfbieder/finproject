/**
 * CR085 P1 — the ranking, which IS the product.
 *
 * Every case here is a way the chart could be confidently wrong while looking right.
 */
import { describe, expect, it } from "vitest";
import {
  adverseSideFor, bandLabel, combinationsFor, formatKnobValue, interactionSummary,
  isRegimeChange, knobTrajectory, rankKnobs, REGIME_CHANGE_RATIO,
} from "../fcSensitivityUtils.js";
import { vi } from "vitest";

const knob = (id, kind = "rate", band = 1) => ({
  knobId: id, module: id, field: "growth_rate", label: "Growth", kind, band,
});

/** A result whose metric is the shortfall, so no matrix build is needed. */
const shortfallResult = (spec, anchor = 0) => ({
  anchor: { shortfall: anchor, entries: [] },
  knobs: spec.map((s) => knob(s.id)),
  points: spec.flatMap((s) => [
    { knobId: s.id, side: "low", shortfall: s.low, entries: [] },
    { knobId: s.id, side: "high", shortfall: s.high, entries: [] },
  ]),
});

describe("rankKnobs", () => {
  it("sorts by the LARGER of the two impacts, not by their sum or their spread", () => {
    const r = rankKnobs(
      shortfallResult([
        { id: "small", low: -10, high: 10 },
        { id: "big", low: -100, high: 5 },
        { id: "mid", low: -40, high: 40 },
      ]),
      "shortfall",
      {}
    );
    expect(r.rows.map((x) => x.knobId)).toEqual(["big", "mid", "small"]);
    expect(r.rows[0].span).toBe(100);
  });

  it("reports deltas AGAINST THE ANCHOR, not raw values", () => {
    const r = rankKnobs(shortfallResult([{ id: "k", low: 900, high: 1100 }], 1000), "shortfall", {});
    expect(r.anchor).toBe(1000);
    expect(r.rows[0].low).toBe(-100);
    expect(r.rows[0].high).toBe(100);
  });

  it("⚠️ SURFACES an unmeasurable knob instead of dropping it", () => {
    // A knob missing from a ranking reads as a knob that does not matter. That is the one thing
    // a ranked chart must never say by omission, so it goes in `incomparable` and the page
    // prints it under "Not ranked".
    const r = rankKnobs(
      {
        anchor: { shortfall: 0, entries: [] },
        knobs: [knob("a"), knob("ghost")],
        points: [
          { knobId: "a", side: "low", shortfall: -5, entries: [] },
          { knobId: "a", side: "high", shortfall: 5, entries: [] },
          { knobId: "ghost", side: "low", shortfall: -5, entries: [] },
          // no `high` point for `ghost`
        ],
      },
      "shortfall",
      {}
    );
    expect(r.rows.map((x) => x.knobId)).toEqual(["a"]);
    expect(r.incomparable).toHaveLength(1);
    expect(r.incomparable[0].knob.knobId).toBe("ghost");
  });

  it("returns an empty ranking rather than throwing on no result", () => {
    expect(rankKnobs(null, "shortfall", {})).toEqual({ anchor: null, rows: [], incomparable: [] });
  });
});

describe("isRegimeChange — asymmetry is information, not noise", () => {
  it("does not flag the mild asymmetry that compounding alone produces", () => {
    // A real run on 2026 Base: growth ±0.25× gave -169,104 / +183,712, a ratio of about 0.08.
    // A threshold tight enough to flag that would flag every knob and mean nothing.
    expect(isRegimeChange(-169104, 183712)).toBe(false);
  });

  it("flags a knob whose two ends differ by more than half the larger side", () => {
    expect(isRegimeChange(-1000, 100)).toBe(true);
    expect(REGIME_CHANGE_RATIO).toBe(0.5);
  });

  it("⚠️ flags SAME-DIRECTION ends whatever their size", () => {
    // The metric moved the same way for both ends of the knob. No monotone response does that;
    // it means something switched — a forced sale on one side, typically.
    expect(isRegimeChange(-500, -480)).toBe(true);
  });

  it("does not flag a knob that moved nothing", () => {
    expect(isRegimeChange(0, 0)).toBe(false);
  });
});

describe("bandLabel — every bar carries its own ±", () => {
  it("uses the unit the KIND actually has", () => {
    // The whole point: a ±1pp on a rate and a ±10% on a level are not the same size of question,
    // so "biggest bar" cannot be read as "biggest risk" without seeing the nudge.
    expect(bandLabel({ kind: "rate", band: 1 })).toBe("±1pp");
    expect(bandLabel({ kind: "level", band: 10 })).toBe("±10%");
    expect(bandLabel({ kind: "multiplier", band: 0.25 })).toBe("±0.25×");
    expect(bandLabel({ kind: "timing", band: 2 })).toBe("±2y");
  });

  it("is empty rather than misleading when there is no band", () => {
    expect(bandLabel({ kind: "rate" })).toBe("");
  });
});


/**
 * CR085 P2 — the trajectory behind one bar.
 *
 * `buildScenarioMatrix` is mocked: these assert the ALIGNMENT and the delta arithmetic, which is
 * where this can be silently wrong. What the matrix itself computes is Compare's own test's job.
 */
vi.mock("../fcCompareUtils.js", () => ({
  buildScenarioMatrix: ({ entries }) => {
    // Each fixture entry is { Year, Amount }; the mock returns them as a netAssets row.
    const years = entries.map((e) => Number(e.Year));
    return { years, netAssets: entries.map((e) => e.Amount), totalAssets: [], cash: new Map() };
  },
}));

const run = (knobId, side, pairs) => ({
  knobId, side, entries: pairs.map(([Year, Amount]) => ({ Year, Amount })),
});

const COLORS = { base: "#000", adverse: "#a00", favourable: "#00a" };

describe("knobTrajectory", () => {
  const result = {
    anchor: { entries: [[2027, 100], [2028, 110], [2029, 120]].map(([Year, Amount]) => ({ Year, Amount })) },
    points: [
      run("k", "low", [[2027, 90], [2028, 95], [2029, 100]]),
      run("k", "high", [[2027, 105], [2028, 120], [2029, 140]]),
    ],
  };

  it("returns base, down and up in the absolute view", () => {
    const { years, series } = knobTrajectory(result, "k", {}, "netAssets", COLORS);
    expect(years).toEqual([2027, 2028, 2029]);
    expect(series.map((s) => s.name)).toEqual(["base", "down", "up"]);
    expect(series[0].values).toEqual([100, 110, 120]);
    expect(series[2].values).toEqual([105, 120, 140]);
  });

  it("⚠️ the delta view subtracts the base and DROPS it as a series", () => {
    // The base is the zero line in that view; drawing it would be a flat line labelled "base"
    // sitting on the axis.
    const { series } = knobTrajectory(result, "k", {}, "netAssets", COLORS, "delta");
    expect(series.map((s) => s.name)).toEqual(["down", "up"]);
    expect(series[0].values).toEqual([-10, -15, -20]);
    expect(series[1].values).toEqual([5, 10, 20]);
  });

  it("⚠️ keys by YEAR, never by array position", () => {
    // Each matrix trims to its own PeriodStart, so a positional plot would shift two runs
    // against each other — same index, different year, no error. CR067 §4's trap.
    const shifted = {
      anchor: result.anchor,
      points: [
        run("k", "low", [[2028, 95], [2029, 100]]),          // starts a year LATER
        run("k", "high", [[2027, 105], [2028, 120], [2029, 140]]),
      ],
    };
    const { years, series } = knobTrajectory(shifted, "k", {}, "netAssets", COLORS);
    expect(years).toEqual([2027, 2028, 2029]);
    const down = series.find((s) => s.name === "down");
    expect(down.values[0]).toBeNull();     // 2027 has no low run
    expect(down.values[1]).toBe(95);       // 95 lands on 2028, not on 2027
  });

  it("returns nothing rather than a half chart when the knob has no runs", () => {
    expect(knobTrajectory(result, "missing", {}, "netAssets", COLORS).series
      .filter((s) => s.name !== "base")).toHaveLength(0);
  });
});


describe("adverseSideFor — decided on the METRIC, never the arithmetic", () => {
  const row = (low, high) => ({ low, high });

  it("on a higher-is-better metric, the side that lowers it is adverse", () => {
    expect(adverseSideFor(row(-100, 50), { better: "higher" })).toBe("low");
    expect(adverseSideFor(row(100, -50), { better: "higher" })).toBe("high");
  });

  it("⚠️ on a lower-is-better metric the SAME numbers flip which side is adverse", () => {
    // On "total unfunded shortfall" a fall is good news. A rule keyed on the sign of the delta
    // would call the best outcome the bad one.
    expect(adverseSideFor(row(-100, 50), { better: "lower" })).toBe("high");
  });
});

describe("combinationsFor", () => {
  const rows = [
    { low: -100, high: 50, knob: { entity: "module", target: { module: "A" }, field: "growth_rate", band: 0.25 } },
    { low: 80, high: -90, knob: { entity: "stream", target: { module: "B" }, field: "amount", band: 10 } },
  ];

  it("builds an all-adverse and an all-favourable set, per knob", () => {
    const [adverse, favourable] = combinationsFor(rows, { better: "higher" });
    expect(adverse.label).toBe("All adverse");
    // Knob A is worst at low, knob B is worst at high — an "all adverse" set is a MIX of sides,
    // which is exactly why "all knobs at low" would not be the stress case.
    expect(adverse.knobs.map((k) => k.side)).toEqual(["low", "high"]);
    expect(favourable.knobs.map((k) => k.side)).toEqual(["high", "low"]);
  });

  it("carries the band through, so the combined run moves each knob by the same amount", () => {
    const [adverse] = combinationsFor(rows, { better: "higher" });
    expect(adverse.knobs.map((k) => k.band)).toEqual([0.25, 10]);
  });
});

describe("interactionSummary — the sum is only ever the COMPARISON", () => {
  const rows = [
    { low: -100, high: 50, knob: {} },
    { low: 80, high: -90, knob: {} },
  ];
  // Metric = shortfall so no matrix is needed; anchor 0.
  const combinedResult = (measured) => ({
    anchor: { shortfall: 0, entries: [] },
    combinations: [{ label: "All adverse", shortfall: measured, entries: [] }],
  });

  it("reports the measured combination, the sum, and the gap between them", () => {
    // lower-is-better: adverse side is whichever RAISES shortfall → A high (+50), B low (+80).
    const r = interactionSummary(rows, { key: "shortfall", better: "lower" }, combinedResult(150), {});
    expect(r.summed).toBe(130);      // 50 + 80, never displayed on its own
    expect(r.measured).toBe(150);
    expect(r.interaction).toBe(20);
    expect(r.worseThanSum).toBe(true);   // more shortfall than the parts predicted
  });

  it("⚠️ says OFFSET when the combination is milder than the parts", () => {
    // The whole reason this exists: the sweep sells different assets when several things move at
    // once, so the engine's answer is NOT the sum. Either direction is a real finding.
    const r = interactionSummary(rows, { key: "shortfall", better: "lower" }, combinedResult(110), {});
    expect(r.interaction).toBe(-20);
    expect(r.worseThanSum).toBe(false);
  });

  it("returns nothing rather than a misleading zero when the run is absent", () => {
    expect(interactionSummary(rows, { key: "shortfall", better: "lower" }, null, {})).toBeNull();
  });
});

describe("formatKnobValue — the band alone is unreadable", () => {
  it("renders each kind in its own unit", () => {
    // "±0.25×" does not tell anyone a growth of 0.8 lands at 0.55 and 1.05.
    expect(formatKnobValue("multiplier", "0.55")).toBe("0.55×");
    expect(formatKnobValue("rate", "19")).toBe("19%");
    expect(formatKnobValue("timing", "2040-07-01T00:00:00.000Z")).toBe("2040-07-01");
    expect(formatKnobValue("level", "28524.618000000002")).toBe("28,525");
  });

  it("is a dash, not a zero, when there is no value", () => {
    expect(formatKnobValue("level", null)).toBe("—");
  });
});
