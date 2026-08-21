/**
 * CR085 P1 — the tornado's one load-bearing rule, pinned in the rendered SVG.
 *
 * ⚠️ COLOUR ENCODES *FAVOURABLE*, NOT THE SIGN OF THE NUMBER AND NOT WHICH END OF THE KNOB.
 * Two live cases make a sign-based palette confidently wrong:
 *   • liabilities are stored negative, so "+10% on market_value" grows a mortgage's DEBT;
 *   • on "total unfunded shortfall", DOWN is the good direction.
 * A chart that painted red-for-negative would call the best outcome the alarming one on one of
 * the two metrics this page ships. That is what this file exists to catch.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import FCTornadoChart from "../FCTornadoChart.jsx";
import { setTheme } from "../../../hooks/useTheme.js";
// The hexes themselves are pinned in the palette's own unit test; asserting against the module
// keeps naked hex out of a .jsx file, which `check-inline-hex.sh` ratchets on.
import { tornadoColors } from "../utils/fcSeriesPalette.js";

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // jsdom reports 0×0, so ResponsiveContainer would render nothing at all.
    ResponsiveContainer: ({ children }) => (
      <actual.ResponsiveContainer width={900} height={400}>
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

const knob = (over = {}) => ({
  knobId: "k1", module: "Sarasota House", label: "Growth (× inflation)",
  field: "growth_rate", kind: "multiplier", band: 0.25, ...over,
});

const rows = [{ knobId: "k1", knob: knob(), low: -120000, high: 90000, span: 120000, regimeChange: false }];

const HIGHER = { key: "netAssets", label: "Net assets at the final year", better: "higher" };
const LOWER = { key: "shortfall", label: "Total unfunded shortfall", better: "lower" };

const fills = () =>
  [...document.querySelectorAll(".recharts-rectangle")].map((n) => n.getAttribute("fill"));

afterEach(cleanup);

describe("FCTornadoChart colours by direction of the METRIC", () => {
  it("on a higher-is-better metric, the falling end is adverse and the rising end favourable", () => {
    setTheme("light");
    render(<FCTornadoChart rows={rows} metric={HIGHER} anchor={4000000} />);
    const c = tornadoColors("light");
    const painted = fills();
    expect(painted).toContain(c.adverse);      // low: -120,000 → net assets fell
    expect(painted).toContain(c.favourable);   // high: +90,000 → net assets rose
  });

  it("⚠️ on a lower-is-better metric the SAME numbers swap colour", () => {
    // Identical rows, different metric. A palette keyed on the sign of the delta would paint
    // these two renders identically, and be wrong in exactly one of them.
    setTheme("light");
    render(<FCTornadoChart rows={rows} metric={LOWER} anchor={0} />);
    const c = tornadoColors("light");
    const painted = fills();
    // -120,000 of SHORTFALL is good news.
    expect(painted).toContain(c.favourable);
    expect(painted).toContain(c.adverse);
  });

  it("re-steps for dark rather than flipping the light hues", () => {
    setTheme("dark");
    render(<FCTornadoChart rows={rows} metric={HIGHER} anchor={0} />);
    const dark = tornadoColors("dark");
    const light = tornadoColors("light");
    expect(fills()).toContain(dark.adverse);
    expect(dark.adverse).not.toBe(light.adverse);
  });
});

describe("what the chart says in words", () => {
  it("prints each knob's own ± , so a long bar is not read as a big risk", () => {
    setTheme("light");
    render(<FCTornadoChart rows={rows} metric={HIGHER} anchor={0} />);
    expect(screen.getByText("±0.25×")).toBeTruthy();
  });

  it("labels the midpoint 'anchor' rather than a rounded currency value", () => {
    // Left to itself recharts chose ticks that did not include zero — the centre read "$1.7K"
    // while the reference line sat at 0. On a diverging chart that is the one tick that must be
    // right: every bar is a distance from it.
    setTheme("light");
    render(<FCTornadoChart rows={rows} metric={HIGHER} anchor={0} />);
    expect(screen.getByText("anchor")).toBeTruthy();
  });

  it("flags an asymmetric knob as a regime change", () => {
    setTheme("light");
    render(
      <FCTornadoChart
        rows={[{ ...rows[0], regimeChange: true }]}
        metric={HIGHER}
        anchor={0}
      />
    );
    expect(screen.getByText(/not symmetric/)).toBeTruthy();
  });

  it("carries a legend for its two marks, naming the DIRECTION not the side", () => {
    setTheme("light");
    render(<FCTornadoChart rows={rows} metric={HIGHER} anchor={0} />);
    expect(screen.getByText("raises net assets")).toBeTruthy();
    expect(screen.getByText("lowers net assets")).toBeTruthy();
  });
});


describe("⚠️ the trajectory has to be FINDABLE", () => {
  it("gives every row a named control, not just a link-styled label", () => {
    // The first version made the assumption name a button with a faint border-coloured underline
    // and explained it in the table caption. The owner's reaction to the shipped page was "I do
    // not see the new graph" — it was there, one click away, and invisible as a feature. An
    // affordance nobody finds is the same as one that was never built.
    setTheme("light");
    const onSelect = vi.fn();
    render(<FCTornadoChart rows={rows} metric={HIGHER} anchor={0} onSelect={onSelect} />);
    const control = screen.getByRole("button", { name: /see the path/i });
    expect(control).toBeTruthy();
    control.click();
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
  });

  it("the assumption name opens it too, for anyone who reaches for the row label", () => {
    setTheme("light");
    const onSelect = vi.fn();
    render(<FCTornadoChart rows={rows} metric={HIGHER} anchor={0} onSelect={onSelect} />);
    screen.getByRole("button", { name: rows[0].knob.module + " · " + rows[0].knob.label }).click();
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
  });

  it("renders no control at all when there is nothing to open", () => {
    setTheme("light");
    render(<FCTornadoChart rows={rows} metric={HIGHER} anchor={0} />);
    expect(screen.queryByRole("button", { name: /see the path/i })).toBeNull();
  });
});
