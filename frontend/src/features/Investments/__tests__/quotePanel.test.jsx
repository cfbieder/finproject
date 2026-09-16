import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QuotePanel } from "../investmentView.jsx";

// `globals: false` and no setup file, so testing-library's automatic cleanup is
// not registered: without this, each render stays in document.body and `screen`
// queries match the PREVIOUS test's DOM as well — which reads as "found multiple
// elements" on the second assertion of the same string.
afterEach(cleanup);

/**
 * CR090 P2 — the live-quote overlay panel.
 *
 * 🔴 The assertion the CR asks for by name: an account with nothing quotable
 * renders greyed and says WHY, and never a Δ of 0.00 — a zero reads as "the
 * market didn't move", which is CR085's dead-state defect class. Cash Mgt and
 * Options are exactly that case on live data (0% quotable, ~$1.15M).
 *
 * And the custodian balance stays on screen as the account total, beside the
 * hybrid figure rather than replaced by it.
 */

const account = (over = {}) => ({
  account_name: "Fidelity Stocks",
  currency: "USD",
  custodian_balance: "1185594.38",
  freshness: { quotable_share: 0.86, unquotable_by_nature: false },
  quotes: {
    quoted_positions: 29,
    coverage: 0.865,
    quoted_at_custodian: "1025000.00",
    quoted_live: "1006501.27",
    delta: "-18498.73",
    live_adjusted_total: "1167095.65",
    oldest_quote_at: "2026-09-15T19:26:14Z",
  },
  ...over,
});

describe("QuotePanel", () => {
  it("states the custodian balance, the hybrid figure and the difference", () => {
    render(<QuotePanel a={account()} />);
    expect(screen.getByText("$1,185,594.38")).toBeTruthy();
    expect(screen.getByText("$1,167,095.65")).toBeTruthy();
    expect(screen.getByText("-$18,498.73")).toBeTruthy();
    expect(screen.getByText(/the account total, unchanged/i)).toBeTruthy();
  });

  it("reports the STALEST quote time, never the newest", () => {
    render(<QuotePanel a={account()} />);
    expect(screen.getByText(/Oldest quote 2026-09-15 19:26 UTC/)).toBeTruthy();
  });

  it("states coverage both ways — what is quoted and what is not", () => {
    render(<QuotePanel a={account()} />);
    // 0.865 renders as 87%: 86.5 rounds up. The fixture's coverage is the live
    // Stocks figure, and the rounded percentage is what the owner reads.
    expect(screen.getByText(/87% of reported positions quoted \(29\)/)).toBeTruthy();
    expect(screen.getByText(/14% of this account has no market quote/)).toBeTruthy();
  });

  it("🔴 an account with nothing quotable is greyed and explains why — no zero delta", () => {
    const a = account({
      account_name: "Fidelity Cash Mgt",
      freshness: { quotable_share: 0, unquotable_by_nature: true },
      quotes: { quoted_positions: 0, coverage: 0, delta: null, live_adjusted_total: null, oldest_quote_at: null },
    });
    const { container } = render(<QuotePanel a={a} />);
    expect(screen.getByText(/no market quote by nature/i)).toBeTruthy();
    expect(container.querySelector(".inv-quotes--none")).not.toBeNull();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("an account that could be quoted but has no stored quotes says so differently", () => {
    const a = account({
      freshness: { quotable_share: 0.86, unquotable_by_nature: false },
      quotes: { quoted_positions: 0, coverage: 0, delta: null, live_adjusted_total: null, oldest_quote_at: null },
    });
    render(<QuotePanel a={a} />);
    expect(screen.getByText(/No quotes stored/i)).toBeTruthy();
  });
});
