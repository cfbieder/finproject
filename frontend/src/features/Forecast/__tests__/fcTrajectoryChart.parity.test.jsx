/**
 * CR067 P1 — the parity gate for extracting `FCTrajectoryChart` out of `FCCompareCharts`.
 *
 * WRITTEN BEFORE THE EXTRACTION, against the shipped component, and it must pass
 * UNCHANGED afterwards. That ordering is the whole point: `FCCompareCharts.jsx` and
 * `FCCompare.jsx` had no component tests at all, so "Compare's existing tests still pass"
 * would have asserted nothing about the component being moved. The build catches a broken
 * import; only this catches a silently different render.
 *
 * It therefore asserts what a reader of `/forecast-compare` would notice — the five metric
 * toggles, two lines in the right colors and weights, the legend names, the light/dark
 * palette swap, and the delta bar chart still being there — via rendered SVG attributes
 * rather than component internals, so the refactor is free to change the internals.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, cleanup } from "@testing-library/react";
import FCCompareCharts from "../FCCompareCharts.jsx";
import { setTheme } from "../../../hooks/useTheme.js";
// The exact hex is pinned in `utils/__tests__/fcSeriesPalette.test.js`; here we assert that
// Compare still draws A and B in the palette's A/B colors. Splitting it that way keeps naked
// hex out of a .jsx file, which is what `check-inline-hex.sh` ratchets on.
import { compareABColors } from "../utils/fcSeriesPalette.js";

// recharts' ResponsiveContainer measures its parent, and jsdom reports 0×0 — so the chart
// renders nothing at all. Give it fixed dimensions; everything below it is the real recharts.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => (
      <actual.ResponsiveContainer width={800} height={300}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

const YEARS = [2027, 2028, 2029];

// Distinct values per metric, so switching the toggle is observable in the rendered path.
const row = (a, b) => ({ a, b, delta: a.map((v, i) => b[i] - v) });

const COMPARE = {
  years: YEARS,
  totals: {
    netAssets: row([1000, 1100, 1200], [1000, 1300, 1600]),
    totalAssets: row([2000, 2100, 2200], [2000, 2300, 2600]),
    netCashFlow: row([300, 310, 320], [300, 400, 500]),
    income: row([500, 510, 520], [500, 600, 700]),
    expense: row([-400, -410, -420], [-400, -500, -600]),
  },
  rows: [
    {
      section: "cash",
      label: "Salary",
      level: 2,
      hasData: true,
      delta: [0, 200, 400],
    },
    {
      section: "cash",
      label: "Taxes",
      level: 2,
      hasData: true,
      delta: [0, -50, -120],
    },
  ],
};

const NAME_A = "2026 Base";
const NAME_B = "2026 Buy Business";

const lineCurves = (container) =>
  Array.from(container.querySelectorAll("path.recharts-line-curve"));

const renderCharts = () =>
  render(<FCCompareCharts compare={COMPARE} nameA={NAME_A} nameB={NAME_B} />);

describe("Compare trajectory chart — parity across the CR067 P1 extraction", () => {
  beforeEach(() => {
    cleanup();
    setTheme("light");
  });

  it("offers exactly the five metrics, with Net Assets selected first", () => {
    renderCharts();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Net Assets",
      "Total Assets",
      "Net Cash Flow",
      "Income",
      "Expenses",
    ]);
    expect(screen.getByRole("tab", { name: "Net Assets" }).getAttribute("aria-selected")).toBe(
      "true"
    );
  });

  it("draws exactly two lines, A green and B blue, both at weight 2", () => {
    const { a, b } = compareABColors("light");
    const { container } = renderCharts();
    const curves = lineCurves(container);
    expect(curves).toHaveLength(2);
    expect(curves.map((c) => c.getAttribute("stroke"))).toEqual([a, b]);
    expect(curves.map((c) => c.getAttribute("stroke-width"))).toEqual(["2", "2"]);
  });

  it("names both scenarios in the legend", () => {
    const { container } = renderCharts();
    const legend = container.querySelector(".recharts-legend-wrapper");
    expect(within(legend).getByText(NAME_A)).toBeTruthy();
    expect(within(legend).getByText(NAME_B)).toBeTruthy();
  });

  it("switching the metric re-plots the lines", () => {
    const { container } = renderCharts();
    const before = lineCurves(container).map((c) => c.getAttribute("d"));

    fireEvent.click(screen.getByRole("tab", { name: "Income" }));

    expect(screen.getByRole("tab", { name: "Income" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Net Assets" }).getAttribute("aria-selected")).toBe(
      "false"
    );
    expect(lineCurves(container).map((c) => c.getAttribute("d"))).not.toEqual(before);
  });

  it("uses the dark palette under the dark theme", () => {
    const dark = compareABColors("dark");
    expect(dark.a).not.toBe(compareABColors("light").a); // the swap has to be observable
    setTheme("dark");
    const { container } = renderCharts();
    expect(lineCurves(container).map((c) => c.getAttribute("stroke"))).toEqual([dark.a, dark.b]);
  });

  it("still renders the cumulative-difference bar chart below the trajectory", () => {
    // The extraction moves the LINE chart only; this asserts the second chart survives it.
    // Bar geometry is animated in, and jsdom never runs the frames, so the <path> inside each
    // rectangle group is absent here — the groups themselves and the sign-convention note are
    // what can be asserted without making production code test-aware.
    const { container } = renderCharts();
    expect(screen.getByText(/Cumulative P&L difference by FC Line/)).toBeTruthy();
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(2);
    expect(
      screen.getByText(new RegExp(`Blue = higher under “${NAME_B}”, red = lower`))
    ).toBeTruthy();
  });
});
