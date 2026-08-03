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

/**
 * CR067 P2 — the categorical set for Multi-Compare: slot 0 is the base, 1–6 the variants.
 *
 * Validated with the dataviz six-checks against **Fin's own surfaces** (`--surface` #FFFFFF
 * light / #1C1F22 dark), not the reference ones, on the adjacent pairlist that applies to
 * overlaid lines:
 *
 *   light — worst adjacent CVD ΔE 9.1 (protan), worst adjacent normal-vision ΔE 19.6
 *   dark  — worst adjacent CVD ΔE 8.4 (protan), worst adjacent normal-vision ΔE 19.3
 *
 * both clear of the ≥8 CVD target and the ≥15 normal-vision floor. The dark column is the
 * same seven hues re-stepped for the dark band, not an automatic flip.
 *
 * **Light mode carries a contrast WARN** — aqua, yellow and magenta sit below 3:1 on white —
 * so the relief rule applies and is discharged by the page, not here: every selected scenario
 * is listed with its color swatch AND its name beside the chart, so identity never rests on a
 * hue a reader has to resolve against the surface.
 *
 * ORDER IS THE VALIDATION. Re-order these and the adjacent pairs change; re-run
 * `scripts/validate_palette.js` before touching them. Assign by a scenario's stable position
 * in its base's variant list, never by its position in the *selected* subset — a filter that
 * changes the series count must not repaint the survivors.
 */
const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"],
};

/** How many scenarios one chart can carry — past this, colour stops distinguishing them. */
export const MAX_SERIES = SERIES.light.length;

export const chartChrome = (theme) => CHROME[key(theme)];
export const compareABColors = (theme) => COMPARE_AB[key(theme)];
export const seriesColors = (theme) => SERIES[key(theme)];

/** Tooltip chrome is tokenized (it is HTML, not SVG, so `var()` resolves). */
export const tooltipStyle = {
  background: "var(--surface-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--ink)",
  fontSize: "0.78rem",
};
