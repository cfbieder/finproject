import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import NetWorthBridgeModal from "./NetWorthBridgeModal.jsx";

/**
 * CR092 — the display half.
 *
 * `status.md` records that nothing in this app checks that a CHART draws
 * everything it was handed, and that every display-side instance of CR085's
 * "state that exists, renders, and produces no visible effect" was found by a
 * person looking at the page. So the load-bearing test here is not that the
 * modal looks right — it is that EVERY driver in the payload reaches the DOM,
 * and that the one condition which invalidates the whole breakdown (`tieOk`
 * false) is impossible to miss.
 *
 * The hook is mocked because the arithmetic already has its own DB-backed
 * suite; what is untested until here is whether any of it is drawn.
 */

const payload = {
  data: {
    from: { date: "2025-10-31", netWorth: 16359821.91 },
    to: { date: "2026-09-05", netWorth: 14459334.24 },
    change: -1900487.67,
    summary: ["Net worth fell $1,900,488.", "Most of it is one thing."],
    drivers: [
      {
        key: "revaluation", label: "Investments & property re-valued", amount: -1741398,
        namedBy: "account",
        // Larger than its own driver, because other marks were positive. Real,
        // and the reason no percentage is rendered.
        contributors: [{ label: "United Beverages", amount: -1873619 }],
      },
      {
        key: "spending", label: "Money spent", amount: -482691,
        namedBy: "category", contributors: [],
      },
      {
        key: "income", label: "Money earned", amount: 412492, namedBy: "category",
        contributors: [{ label: "Financial Income - UB Dividend", amount: 186089 }],
      },
      {
        key: "currency", label: "Exchange-rate moves", amount: -65231, namedBy: "account",
        contributors: [{ label: "United Beverages", amount: -58629 }],
      },
      {
        key: "transfers", label: "Transfers that didn't net out", amount: -23621,
        namedBy: "account", contributors: [], offsetting: true, gross: 1746678,
      },
      {
        key: "uncategorised", label: "Uncategorised", amount: -39, namedBy: "account",
        contributors: [], offsetting: true, gross: 27224,
      },
    ],
    periods: [
      {
        key: "2025-11-30", label: "Nov 2025", start: "2025-10-31", end: "2025-11-30",
        partial: false, openingNetWorth: 16359821.91, closingNetWorth: 16512301.43,
        change: 152480,
        drivers: { revaluation: 14346, income: 9797, spending: -36620, currency: 165362, transfers: -406, other: 0, uncategorised: 0 },
      },
      {
        key: "2026-09-05", label: "Sep 2026", start: "2026-08-31", end: "2026-09-05",
        partial: true, openingNetWorth: 14404345.75, closingNetWorth: 14459334.24,
        change: 54988,
        drivers: { revaluation: 0, income: 4667, spending: -6904, currency: 57226, transfers: 0, other: 0, uncategorised: 0 },
      },
    ],
    movers: [
      {
        account: "United Beverages", path: "Assets / PL Investments / United Beverages",
        section: "Assets", currency: "PLN", openingUSD: 7504568, closingUSD: 5572320,
        change: -1932248,
        drivers: { revaluation: -1873619, income: 186089, spending: 0, currency: -58629, transfers: -186089, other: 0, uncategorised: 0 },
      },
    ],
  },
  meta: {
    basis: "ending-rate",
    basisNote: "Every figure is in today's dollars.",
    granularity: "month",
    rates: { USD: 1, PLN: 0.269353 },
    accountsExplained: 58,
    excludedSections: [],
    tie: 0,
    tieOk: true,
    caveats: ["Re-anchoring an opening balance rewrites history.", "Closing an account removes it."],
  },
};

let queryState = { data: payload, isPending: false, isError: false, error: null };

vi.mock("../../hooks/useReports.js", () => ({
  useNetWorthBridge: () => queryState,
}));

const renderModal = () =>
  render(
    <NetWorthBridgeModal
      open
      onClose={() => {}}
      fromDate="2025-10-31"
      toDate="2026-09-05"
    />
  );

afterEach(() => {
  cleanup();
  queryState = { data: payload, isPending: false, isError: false, error: null };
});

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("NetWorthBridgeModal", () => {
  it("draws EVERY driver it was handed, with a bar and a figure", () => {
    renderModal();
    // Not "some bars rendered" — each label and each amount, by name. A driver
    // silently dropped from the waterfall is a cause the reader concludes did
    // not happen.
    for (const d of payload.data.drivers) {
      const row = screen.getByRole("row", { name: new RegExp(d.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
      expect(row).toBeTruthy();
      const abs = Math.abs(d.amount).toLocaleString("en-US", {
        style: "currency", currency: "USD", maximumFractionDigits: 0,
      });
      expect(within(row).getByText(new RegExp(abs.replace(/[$.]/g, "\\$&")))).toBeTruthy();
    }
  });

  it("NAMES the big item under its driver, with its own figure", () => {
    // The owner's ask: "re-valued −$1.74M" is a category, "United Beverages
    // −$1,873,619" is an answer. Every contributor in the payload must reach
    // the DOM, same rule as the drivers themselves.
    renderModal();
    for (const d of payload.data.drivers) {
      for (const c of d.contributors) {
        // getAllBy, not getBy: `United Beverages` is legitimately the named
        // item under BOTH the re-valuation and the currency move, so a unique
        // lookup here would fail on correct output.
        const rows = screen.getAllByRole("row", { name: new RegExp(escape(c.label)) });
        const abs = Math.abs(c.amount).toLocaleString("en-US", {
          style: "currency", currency: "USD", maximumFractionDigits: 0,
        });
        const matched = rows.filter(
          (r) => within(r).queryByText(new RegExp(escape(abs))) !== null
        );
        expect(matched.length).toBeGreaterThan(0);
      }
    }
    // …and no percentage anywhere near it: the UB figure EXCEEDS its own driver
    // (other marks were positive), so a share would render as "108%".
    expect(screen.queryByText(/\d+%/)).toBeNull();
  });

  it("says a cancelling driver cancelled, instead of naming its biggest legs", () => {
    // Transfers net to −$23,621 out of $1,746,678 of movement. Listing the
    // ±$500K legs under that line is individually true and collectively a lie
    // about what the line means — the server suppresses them and the page says
    // what actually happened to the money.
    renderModal();
    expect(screen.getByText(/\$1,746,678 moved in both directions and almost entirely cancelled/)).toBeTruthy();
    expect(screen.queryByText("SP - Panorama Mar 4")).toBeNull();
  });

  it("says so when a driver has no dominant item, rather than showing nothing", () => {
    // Spending is genuinely diffuse — its biggest item is 13.5%. Silence there
    // would read as missing data.
    renderModal();
    expect(screen.getByText(/Spread across many categories/)).toBeTruthy();
  });

  it("anchors the waterfall on both endpoints, so the bars have something to span", () => {
    renderModal();
    expect(screen.getByText("$16,359,822")).toBeTruthy();
    expect(screen.getByText("$14,459,334")).toBeTruthy();
  });

  it("leads with the plain-English summary", () => {
    renderModal();
    for (const line of payload.data.summary) {
      expect(screen.getByText(line)).toBeTruthy();
    }
  });

  it("SHOUTS when the drivers do not add up", () => {
    // The single condition that makes every figure above it untrustworthy. A
    // breakdown that silently fails to tie is worse than no breakdown.
    queryState = {
      data: { ...payload, meta: { ...payload.meta, tie: -1234.5, tieOk: false } },
      isPending: false, isError: false, error: null,
    };
    renderModal();
    expect(screen.getByText(/do not add up/i)).toBeTruthy();
    expect(screen.getByText(/\$1,235/)).toBeTruthy();
  });

  it("says nothing about ties when they hold", () => {
    renderModal();
    expect(screen.queryByText(/do not add up/i)).toBeNull();
  });

  it("hides the month and account tables until asked, then draws them", () => {
    renderModal();
    expect(screen.queryByText("Nov 2025")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Month by month/i }));
    expect(screen.getByText("Nov 2025")).toBeTruthy();
    // A short closing period must not read as a quiet full month.
    expect(screen.getByText(/\(part\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Which accounts moved/i }));
    // Keyed on the mover's own TOTAL, which appears nowhere else — the account
    // name itself is now also a named contributor in the waterfall above.
    expect(screen.getByText("−$1,932,248")).toBeTruthy();
  });

  it("renders the basis and every caveat rather than dropping meta", () => {
    // `Rest.unwrap()` would have discarded `meta` entirely; this pins that the
    // caveats survive to the screen.
    renderModal();
    expect(screen.getByText(payload.meta.basisNote)).toBeTruthy();
    for (const c of payload.meta.caveats) {
      expect(screen.getByText(c)).toBeTruthy();
    }
  });

  it("shows a working state and an error state instead of an empty dialog", () => {
    queryState = { data: null, isPending: true, isError: false, error: null };
    const { unmount } = renderModal();
    expect(screen.getByText(/Working out what moved/i)).toBeTruthy();
    unmount();

    queryState = { data: null, isPending: false, isError: true, error: new Error("boom") };
    renderModal();
    expect(screen.getByText(/boom/)).toBeTruthy();
  });
});
