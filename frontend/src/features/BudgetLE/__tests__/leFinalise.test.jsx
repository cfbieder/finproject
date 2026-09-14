import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import LEGrid from "../LEGrid.jsx";
import LEAdvisories from "../LEAdvisories.jsx";

/**
 * CR083 P0b — the parts of finalise a reader sees: the memo line that sits BELOW
 * the total (§2.1), and a warnings panel that shows only what fired (§9).
 */

const grid = (over = {}) => ({
  le: {
    id: 1, name: "LE-08-26", label: null, status: "final", budgetYear: 2026,
    actualThrough: "2026-07-31", actualMonths: 7, finalizedAt: "2026-08-20T10:00:00Z",
  },
  estimateMonths: ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"],
  rows: [],
  totals: { ytdActual: 0, estimateTotal: 0, fyTotal: 0, budgetFy: 0, variance: 0 },
  fxBasis: "",
  scopeNote: "",
  unallocated: { rows: 72, estimateRows: 30, fy: -86789, estimateWindow: -35892 },
  ...over,
});

describe("LEGrid — the unallocated allowance memo line", () => {
  afterEach(cleanup);

  it("renders below NET, labelled as outside the total", () => {
    render(<LEGrid grid={grid()} onOpenCategory={() => {}} />);
    const memo = screen.getByText(/Unallocated budget allowance/).closest("tr");
    expect(memo.className).toContain("le-grid__memo");
    expect(memo.textContent).toMatch(/not in NET/);
    // The memo row comes AFTER the NET row in the footer.
    const foot = memo.parentElement;
    expect(foot.tagName).toBe("TFOOT");
    expect(foot.firstElementChild.textContent).toMatch(/^NET/);
  });

  it("is absent when there are no uncategorised budget rows", () => {
    render(<LEGrid grid={grid({ unallocated: { rows: 0, estimateRows: 0, fy: 0, estimateWindow: 0 } })} onOpenCategory={() => {}} />);
    expect(screen.queryByText(/Unallocated budget allowance/)).toBeNull();
  });

  it("names a finalised LE's status in the print header", () => {
    render(<LEGrid grid={grid()} onOpenCategory={() => {}} />);
    expect(screen.getByText(/· final/)).toBeTruthy();
  });
});

describe("LEAdvisories — only what fires", () => {
  afterEach(cleanup);

  const advisories = {
    advisories: [
      { id: "L1", label: "month may be incomplete", fires: true, message: "LE-08-26 was finalised 2 days after JUL ended." },
      { id: "L6", label: "uncategorised budget", fires: false, message: "should not render" },
    ],
  };
  const drift = {
    drifted: [{ month: "2026-07", sentence: "LE-08-26 froze JUL at ($46,115.00) over 520 rows; the ledger now says ($45,451.00) over 605 — 85 rows / +$664.00 have landed since." }],
  };

  it("renders fired advisories and drifted months, and nothing that did not fire", () => {
    render(<LEAdvisories advisories={advisories} drift={drift} />);
    expect(screen.getByText(/finalised 2 days after JUL/)).toBeTruthy();
    expect(screen.getByText(/froze JUL at/)).toBeTruthy();
    expect(screen.queryByText(/should not render/)).toBeNull();
  });

  it("renders nothing at all when nothing fires", () => {
    const { container } = render(
      <LEAdvisories advisories={{ advisories: [{ ...advisories.advisories[1] }] }} drift={{ drifted: [] }} />
    );
    expect(container.innerHTML).toBe("");
  });
});
