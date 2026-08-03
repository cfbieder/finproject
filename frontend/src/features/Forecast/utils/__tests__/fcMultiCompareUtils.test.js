/**
 * CR067 P2 — the alignment that `compareMatrices` used to own.
 *
 * The first test is the one that matters. Every scenario shares a PeriodStart today, so a
 * positional implementation passes visual inspection and every other test here; it only breaks
 * when CR064 P2 (the annual close) starts moving PeriodStart per scenario, at which point it
 * draws one scenario's 2028 against another's 2027 with no error and no gap.
 */
import { describe, it, expect } from "vitest";
import { alignSeries, metricValues, colorIndexFor } from "../fcMultiCompareUtils.js";

/** A minimal buildScenarioMatrix-shaped result. */
const matrix = (years, { netAssets, cash } = {}) => ({
  years,
  netAssets: netAssets ?? years.map((_, i) => (i + 1) * 100),
  totalAssets: years.map((_, i) => (i + 1) * 200),
  netCashFlow: years.map(() => 0),
  cash: new Map(Object.entries(cash ?? {})),
});

describe("alignSeries", () => {
  it("aligns scenarios with DIFFERENT PeriodStarts by year, never by index", () => {
    // A runs 2027–2029, B runs 2028–2030. Index 0 is 2027 for A and 2028 for B.
    const a = matrix([2027, 2028, 2029], { netAssets: [10, 20, 30] });
    const b = matrix([2028, 2029, 2030], { netAssets: [200, 300, 400] });

    const { years, series } = alignSeries(
      [
        { name: "A", matrix: a },
        { name: "B", matrix: b },
      ],
      "netAssets"
    );

    expect(years).toEqual([2027, 2028, 2029, 2030]);
    // A has nothing in 2030; B has nothing in 2027 — and B's 200 lands on 2028, NOT on 2027.
    expect(series[0].values).toEqual([10, 20, 30, null]);
    expect(series[1].values).toEqual([null, 200, 300, 400]);
  });

  it("keeps every series the same length as the year axis", () => {
    const { years, series } = alignSeries(
      [
        { name: "A", matrix: matrix([2027, 2028]) },
        { name: "B", matrix: matrix([2030]) },
      ],
      "netAssets"
    );
    for (const s of series) expect(s.values).toHaveLength(years.length);
  });

  it("drops a scenario with no years rather than plotting an empty line", () => {
    const { years, series } = alignSeries(
      [
        { name: "Generated", matrix: matrix([2027, 2028]) },
        { name: "Never generated", matrix: matrix([]) },
        { name: "Not loaded", matrix: null },
      ],
      "netAssets"
    );
    expect(years).toEqual([2027, 2028]);
    expect(series.map((s) => s.name)).toEqual(["Generated"]);
  });

  it("keeps an interior gap a gap instead of coalescing it to zero", () => {
    // CR040's zero-coalescing lives only in the DELTA computation; the display arrays keep
    // their nulls, and connectNulls={false} then draws a break rather than inventing a line.
    const m = matrix([2027, 2028, 2029], { netAssets: [10, null, 30] });
    const { series } = alignSeries([{ name: "A", matrix: m }], "netAssets");
    expect(series[0].values).toEqual([10, null, 30]);
  });

  it("returns nothing at all when no scenario is selected", () => {
    expect(alignSeries([], "netAssets")).toEqual({ years: [], series: [] });
  });
});

describe("metricValues", () => {
  it("reads Net Cash Flow from the cash map, NOT the top-level array", () => {
    // The matrix carries both. The top-level one is never null; the cash-map one is null in a
    // year with no rows, which is what Compare plots. Reading the wrong one draws 0 where the
    // other page draws a gap — and the two pages then disagree about the same scenario.
    const m = {
      years: [2027, 2028],
      netCashFlow: [0, 0],
      cash: new Map([["Net Cash Flow", [null, 42]]]),
    };
    expect(metricValues(m, "netCashFlow")).toEqual([null, 42]);
  });

  it("maps each of the five chart metrics to a source", () => {
    const m = matrix([2027], {
      cash: { Income: [5], Expense: [-7], "Net Cash Flow": [-2] },
    });
    expect(metricValues(m, "netAssets")).toEqual([100]);
    expect(metricValues(m, "totalAssets")).toEqual([200]);
    expect(metricValues(m, "income")).toEqual([5]);
    expect(metricValues(m, "expense")).toEqual([-7]);
    expect(metricValues(m, "netCashFlow")).toEqual([-2]);
  });

  it("survives a matrix that is missing the row entirely", () => {
    expect(metricValues(matrix([2027]), "income")).toEqual([]);
    expect(metricValues(null, "netAssets")).toEqual([]);
  });
});

describe("colorIndexFor", () => {
  const VARIANTS = ["Upside", "Downside", "House", "Buy Business"];

  it("gives the base slot 0 and each variant its own", () => {
    expect(colorIndexFor("Base", "Base", VARIANTS)).toBe(0);
    expect(colorIndexFor("Upside", "Base", VARIANTS)).toBe(1);
    expect(colorIndexFor("Buy Business", "Base", VARIANTS)).toBe(4);
  });

  it("keys off the variant's own position, so unticking one does not repaint the rest", () => {
    // The colour follows the entity, never its rank in the current selection. If this keyed
    // off the selected subset, clearing "Upside" would slide every other line's hue along.
    const before = VARIANTS.map((v) => colorIndexFor(v, "Base", VARIANTS));
    const stillSelected = ["Downside", "House", "Buy Business"];
    const after = stillSelected.map((v) => colorIndexFor(v, "Base", VARIANTS));
    expect(after).toEqual(before.slice(1));
  });

  it("never recycles a hue past the palette's length", () => {
    const many = ["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8"];
    // Slots run 1..6 for variants; anything beyond is refused (0) rather than wrapping to a
    // hue already in use, which would make two different scenarios the same colour.
    expect(colorIndexFor("v6", "Base", many)).toBe(6);
    expect(colorIndexFor("v7", "Base", many)).toBe(0);
  });
});
