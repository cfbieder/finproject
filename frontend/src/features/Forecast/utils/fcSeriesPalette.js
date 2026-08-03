/**
 * Forecast chart palette (CR067 P1).
 *
 * A `.js` module rather than a constant inside the chart component, and that is structural:
 * `Scripts/check-inline-hex.sh` scans `frontend/src/**\/*.jsx` only, and its baseline may
 * shrink but never grow. A palette lives in exactly one place, is unit-testable, and stays
 * out of the ratchet's way — which is what lets CR067 P2 add a seven-hue categorical set
 * without re-baselining anything.
 *
 * Hex is resolved at RUNTIME by theme, not through CSS custom properties: SVG presentation
 * attributes (`stroke`, `fill`) cannot read a CSS custom property.
 *
 * Values below are CR040's, moved verbatim — they were validated against the dataviz
 * six-checks in light and dark, and the app's muted brand hues that failed the
 * chroma-floor/lightness checks were already snapped to the nearest passing steps there.
 */

const key = (theme) => (theme === "dark" ? "dark" : "light");

/** Axis, grid and tick ink — the chart chrome, shared by every forecast chart. */
const CHROME = {
  light: { grid: "#E8E6DF", ink: "#4A5568" },
  dark: { grid: "#33383E", ink: "#AEB4BB" },
};

/**
 * CR040's two-scenario Compare palette: A (baseline) green, B (comparison) blue, and the
 * diverging delta bars where blue consistently means "B / B ahead".
 */
const COMPARE_AB = {
  light: { a: "#3E8A3E", b: "#4A72B0", pos: "#4A72B0", neg: "#C0504D" },
  dark: { a: "#45A045", b: "#3987E5", pos: "#3987E5", neg: "#E05252" },
};

export const chartChrome = (theme) => CHROME[key(theme)];
export const compareABColors = (theme) => COMPARE_AB[key(theme)];

/** Tooltip chrome is tokenized (it is HTML, not SVG, so `var()` resolves). */
export const tooltipStyle = {
  background: "var(--surface-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--ink)",
  fontSize: "0.78rem",
};
