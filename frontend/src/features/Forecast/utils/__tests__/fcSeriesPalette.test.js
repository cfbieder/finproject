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
import { chartChrome, compareABColors, tooltipStyle } from "../fcSeriesPalette.js";

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

  it("tokenizes the tooltip rather than freezing hex into it", () => {
    // The tooltip is HTML, not SVG, so var() resolves — and it therefore MUST use tokens,
    // or it stays light-themed inside a dark page.
    for (const value of Object.values(tooltipStyle)) {
      if (typeof value === "string") expect(value).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
    }
  });
});
