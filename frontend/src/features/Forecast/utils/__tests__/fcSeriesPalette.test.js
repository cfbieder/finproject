/**
 * CR067 P1 — the palette's values are pinned HERE, in a `.js` file.
 *
 * Two reasons this is not folded into the chart render tests: `check-inline-hex.sh` scans
 * `*.jsx` only, so hex literals belong in a `.js` module and its `.js` test; and a palette
 * that only one component's snapshot pins is a palette nobody notices changing.
 *
 * These are CR040's validated pairs, moved verbatim in the P1 extraction. A change here is a
 * deliberate re-validation against the dataviz six-checks in BOTH themes, not a tidy-up.
 */
import { describe, it, expect } from "vitest";
import {
  chartChrome,
  compareABColors,
  seriesColors,
  tooltipStyle,
  MAX_SERIES,
} from "../fcSeriesPalette.js";

describe("fcSeriesPalette", () => {
  it("keeps CR040's A/B pairs exactly, in both themes", () => {
    expect(compareABColors("light")).toEqual({
      a: "#3E8A3E",
      b: "#4A72B0",
      pos: "#4A72B0",
      neg: "#C0504D",
    });
    expect(compareABColors("dark")).toEqual({
      a: "#45A045",
      b: "#3987E5",
      pos: "#3987E5",
      neg: "#E05252",
    });
  });

  it("keeps the chart chrome exactly, in both themes", () => {
    expect(chartChrome("light")).toEqual({ grid: "#E8E6DF", ink: "#4A5568" });
    expect(chartChrome("dark")).toEqual({ grid: "#33383E", ink: "#AEB4BB" });
  });

  it("treats any unknown theme as light", () => {
    // useTheme only ever yields "light" | "dark", but a caller passing undefined during a
    // first render must not get an undefined color — that renders a line with no stroke.
    expect(chartChrome(undefined)).toEqual(chartChrome("light"));
    expect(compareABColors("")).toEqual(compareABColors("light"));
  });

  it("carries the CR067 categorical set — same length, distinct hues, both themes", () => {
    for (const theme of ["light", "dark"]) {
      const hues = seriesColors(theme);
      expect(hues).toHaveLength(MAX_SERIES);
      expect(new Set(hues).size).toBe(MAX_SERIES); // two scenarios must never share a colour
      for (const hex of hues) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("re-steps the dark column rather than reusing the light one", () => {
    // Six of the seven move for the dark surface. Green (#008300) is deliberately the same in
    // both — it validated on either surface — so this asserts "mostly different", not "all".
    const light = seriesColors("light");
    const dark = seriesColors("dark");
    const moved = light.filter((hex, i) => hex !== dark[i]).length;
    expect(moved).toBe(MAX_SERIES - 1);
  });

  it("keeps the base's slot first, so slot 0 is stable across themes", () => {
    // The page assigns slot 0 to the base and 1..6 to variants by their own position; a
    // reordering here would silently repaint every chart.
    expect(seriesColors("light")[0]).toBe("#2a78d6");
    expect(seriesColors("dark")[0]).toBe("#3987e5");
  });

  it("tokenizes the tooltip rather than freezing hex into it", () => {
    // The tooltip is HTML, not SVG, so var() resolves — and it therefore MUST use tokens,
    // or it stays light-themed inside a dark page.
    for (const value of Object.values(tooltipStyle)) {
      if (typeof value === "string") expect(value).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
    }
  });
});
