import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import LEGrid from "../LEGrid.jsx";
import LEAdvisories from "../LEAdvisories.jsx";
import LEDeviations from "../LEDeviations.jsx";

/**
 * CR083 P0b — what a reader of a finalised LE sees: the footer holds NET and
 * nothing else (the unallocated-allowance memo line was removed 2026-09-14 — a
 * budget is P&L only, so category-less budget rows are not budget), a warnings panel
 * that shows only what fired, and deviations that name a re-cut as the remedy on a
 * final LE.
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
  ...over,
});

describe("LEGrid", () => {
  afterEach(cleanup);

  it("has NET as the only footer row — no memo line", () => {
    const { container } = render(<LEGrid grid={grid()} onOpenCategory={() => {}} />);
    const rows = container.querySelectorAll("tfoot tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toMatch(/^NET/);
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
      { id: "L4", label: "budgeted, estimated at zero", fires: false, message: "should not render" },
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

describe("LEDeviations — the remedy on a final LE is a re-cut", () => {
  afterEach(cleanup);

  const deviations = (leStatus) => ({
    leId: 1, leStatus, actualMonths: 7, totalEffect: -2500,
    thresholds: { note: "Materiality is measured on the effect." },
    flags: [{
      categoryId: 9, categoryName: "Utilities", kind: "relevel", effect: -2500,
      reason: "Year-to-date ($3,000.00) against a budget of ($2,000.00).",
    }],
  });

  it("says re-cut on a final LE", () => {
    render(<LEDeviations data={deviations("final")} onOpenCategory={() => {}} />);
    expect(screen.getByText(/re-cutting to re-level/)).toBeTruthy();
  });

  it("keeps the edit wording on a draft", () => {
    render(<LEDeviations data={deviations("draft")} onOpenCategory={() => {}} />);
    expect(screen.queryByText(/re-cutting/)).toBeNull();
    expect(screen.getByText(/re-levelling/)).toBeTruthy();
  });
});
