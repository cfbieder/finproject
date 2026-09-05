import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import NetWorthDrivers from "../NetWorthDrivers.jsx";

/**
 * CR092 P2 — the drivers report.
 *
 * The arithmetic has a DB-backed suite and the shared rendering has the modal's,
 * so what is untested until here is what this page ADDS: that it asks for every
 * account rather than the modal's cap, that the grid it exists to show actually
 * sorts, and that an inverted period is explained instead of fired at an
 * endpoint that will 400.
 */

const mover = (account, change, drivers = {}) => ({
  account,
  path: "Assets / " + account,
  section: "Assets",
  currency: account.startsWith("PL") ? "PLN" : "USD",
  openingUSD: 0,
  closingUSD: change,
  change,
  drivers: {
    revaluation: 0, income: 0, spending: 0, currency: 0,
    transfers: 0, other: 0, uncategorised: 0, ...drivers,
  },
});

const payload = {
  data: {
    from: { date: "2025-12-31", netWorth: 16000000 },
    to: { date: "2026-09-05", netWorth: 14500000 },
    change: -1500000,
    summary: ["Net worth fell $1,500,000."],
    // ⚠️ Deliberately NOT the sum of `movers` below (those add to −1,300,200 of
    // re-valuation, not −1,700,000). That inconsistency is the point: a footer
    // that re-added the rendered rows would print the row sum, and a footer
    // reading the server's authoritative totals prints these. Only one of those
    // can pass the assertion.
    drivers: [
      {
        key: "revaluation", label: "Investments & property re-valued",
        amount: -1700000, namedBy: "account",
        contributors: [{ label: "United Beverages", amount: -1873619 }],
      },
      {
        key: "income", label: "Money earned", amount: 200000,
        namedBy: "category", contributors: [],
      },
    ],
    periods: [
      {
        key: "2026-01-31", label: "Jan 2026", start: "2025-12-31", end: "2026-01-31",
        partial: false, openingNetWorth: 16000000, closingNetWorth: 15900000,
        change: -100000,
        drivers: { revaluation: -100000, income: 0, spending: 0, currency: 0, transfers: 0, other: 0, uncategorised: 0 },
      },
      {
        key: "2026-02-28", label: "Feb 2026", start: "2026-01-31", end: "2026-02-28",
        partial: false, openingNetWorth: 15900000, closingNetWorth: 14500000,
        change: -1400000,
        drivers: { revaluation: -1400000, income: 0, spending: 0, currency: 0, transfers: 0, other: 0, uncategorised: 0 },
      },
    ],
    // Deliberately NOT in change-order, and with a currency column whose
    // ranking differs from the change ranking — so a sort that does nothing
    // cannot pass.
    movers: [
      mover("Big Mover", -900000, { revaluation: -900000, currency: -10 }),
      mover("Middle", -400000, { revaluation: -400000, currency: -50000 }),
      mover("PL Small", -200, { revaluation: -200, currency: 90000 }),
    ],
  },
  meta: {
    basis: "ending-rate",
    basisNote: "Every figure is in today's dollars.",
    granularity: "month",
    rates: { USD: 1 },
    accountsExplained: 3,
    moversShown: 3,
    moversTotal: 3,
    moversComplete: true,
    excludedSections: [],
    tie: 0,
    tieOk: true,
    caveats: ["Re-anchoring an opening balance rewrites history."],
  },
};

let queryState = { data: payload, isPending: false, isFetching: false, isError: false, error: null };
const calls = [];

vi.mock("../../hooks/useReports.js", () => ({
  useNetWorthBridge: (args) => {
    calls.push(args);
    return queryState;
  },
}));

afterEach(() => {
  cleanup();
  calls.length = 0;
  queryState = { data: payload, isPending: false, isFetching: false, isError: false, error: null };
});

// The account cell renders "PL Small PLN" — name plus a currency badge — so
// these are matched on prefix. An exact match silently dropped the one row
// whose ordering the sort test depends on, and the test still "passed" a
// weaker assertion.
const ACCOUNTS = ["Big Mover", "Middle", "PL Small"];

const accountOrder = () =>
  screen
    .getAllByRole("row")
    .map((r) => r.querySelector("th[scope='row']")?.textContent?.trim() ?? "")
    .map((t) => ACCOUNTS.find((a) => t.startsWith(a)))
    .filter(Boolean);

describe("NetWorthDrivers", () => {
  it("asks for EVERY account, not the modal's cap", () => {
    // The grid is the reason this page exists; inheriting the modal's top-12
    // would truncate it with nothing on screen to say so.
    render(<NetWorthDrivers />);
    expect(calls[0].movers).toBe(500);
  });

  it("sends the opening boundary, not the first day of the period", () => {
    render(<NetWorthDrivers />);
    // Default period is this year, so the opening boundary is last 31 December.
    expect(calls[0].fromDate).toMatch(/-12-31$/);
    expect(calls[0].fromDate < calls[0].toDate).toBe(true);
  });

  it("states the window it actually measured", () => {
    render(<NetWorthDrivers />);
    expect(screen.getByText(/Measured from/)).toBeTruthy();
    // and says why the start looks a day early, rather than leaving it puzzling
    expect(screen.getByText(/opening balance is read the day before/)).toBeTruthy();
  });

  it("SORTS the grid by a driver column, not just by change", () => {
    // The falsifiable half: `currency` ranks the three accounts differently
    // from `change`, so a sort control that renders but does nothing fails here.
    render(<NetWorthDrivers />);
    expect(accountOrder()).toEqual(["Big Mover", "Middle", "PL Small"]);

    fireEvent.click(screen.getByRole("button", { name: /Currency/i }));
    // Ranked on ABSOLUTE value: +90,000 outranks −50,000 outranks −10.
    expect(accountOrder()).toEqual(["PL Small", "Middle", "Big Mover"]);
  });

  it("reverses the sort on a second click", () => {
    render(<NetWorthDrivers />);
    const header = screen.getByRole("button", { name: /Currency/i });
    fireEvent.click(header);
    fireEvent.click(header);
    expect(accountOrder()).toEqual(["Big Mover", "Middle", "PL Small"]);
  });

  it("explains an inverted period instead of firing a request that 400s", () => {
    render(<NetWorthDrivers />);
    const callsBefore = calls.length;

    // Driven through the real control, not by poking state: Custom reveals the
    // month selects, and picking a To month before the From month inverts the
    // window the same way a person would.
    fireEvent.click(screen.getByRole("button", { name: /^Custom$/i }));
    fireEvent.change(screen.getByLabelText("Month (from)"), { target: { value: "06" } });
    fireEvent.change(screen.getByLabelText("Month (to)"), { target: { value: "02" } });

    expect(screen.getByText(/ends before it starts/i)).toBeTruthy();
    // and the query is disabled rather than sent to an endpoint that 400s
    expect(calls[calls.length - 1].enabled).toBe(false);
    expect(calls.length).toBeGreaterThan(callsBefore);
  });

  it("FOOTS both grids, and the footer reconstructs the drivers", () => {
    // The reason to foot at all: the rows and the driver totals are computed on
    // different paths, so a footer that re-added the rows would agree with
    // itself no matter what. These come from `data.drivers`.
    render(<NetWorthDrivers />);
    const accountsTotal = screen.getByRole("row", { name: /All accounts/ });
    // The server's re-valuation total, NOT the −$1,300,200 the rendered rows sum
    // to. A footer that added up the grid would print the latter.
    expect(within(accountsTotal).getByText("−$1,700,000")).toBeTruthy();
    expect(within(accountsTotal).getByText("+$200,000")).toBeTruthy();
    const rowRevaluation = payload.data.movers.reduce((a, m) => a + m.drivers.revaluation, 0);
    expect(rowRevaluation).toBe(-1300200);
    expect(within(accountsTotal).queryByText("−$1,300,200")).toBeNull();
    // This fixture shows every account, so there is nothing left over and no
    // remainder row — the shown rows are the whole story.
    expect(screen.queryByRole("row", { name: /Other accounts/ })).toBeNull();

    const periodTotal = screen.getByRole("row", { name: /^Total/ });
    expect(within(periodTotal).getByText("−$1,500,000")).toBeTruthy();
    // …and the period rows it foots really do add to it.
    const rowSum = payload.data.periods.reduce((a, p) => a + p.change, 0);
    expect(rowSum).toBe(payload.data.change);
  });

  it("renders the caveats rather than dropping meta", () => {
    render(<NetWorthDrivers />);
    expect(screen.getByText(payload.meta.basisNote)).toBeTruthy();
    for (const c of payload.meta.caveats) {
      expect(screen.getByText(c)).toBeTruthy();
    }
  });

  it("shows a working state and an error state instead of an empty page", () => {
    queryState = { data: null, isPending: true, isFetching: true, isError: false, error: null };
    const { unmount } = render(<NetWorthDrivers />);
    expect(screen.getByText(/Working out what moved/i)).toBeTruthy();
    unmount();

    queryState = { data: null, isPending: false, isFetching: false, isError: true, error: new Error("boom") };
    render(<NetWorthDrivers />);
    expect(screen.getByText(/boom/)).toBeTruthy();
  });
});
