import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../js/rest.js", () => ({
  default: { get: vi.fn(), put: vi.fn(), unwrap: (r) => r.data },
}));
import Rest from "../../../js/rest.js";
import CashFlowModal from "../CashFlowModal.jsx";
import { monthRanges, parseAmount } from "../cashFlow.js";

/** CR104 — the summary line, the short-cash flags, the opening's stated source, the GBP line. */
const z = () => Array(12).fill(0);
const block = (opening, ending, extra = {}) => ({
  opening: { value: opening, source: "estimate", estimate: opening, balance: opening, remainder: 0, ...extra.opening },
  inflows: z(), outflows: z(), transfers: z(), ending,
  year: { inflows: 0, outflows: 0, transfers: 0, closing: ending[11], unassigned: 0 },
  ...(extra.cash ? { unassigned: z() } : {}),
});
const flat = (v) => Array(12).fill(v);
const USD_END = [5, -7, -15, 3, 3, 3, 3, 3, 3, 3, 3, -1];
const DATA = {
  build: { id: 12, targetYear: 2027, status: "draft", editable: true },
  snapshot: { asOf: "2026-10-31", le: { id: 10, name: "LE-11-26", actualThrough: "2026-10-31" } },
  rates: { USD: 1, PLN: 3.94, EUR: 0.89 },
  currencies: [
    { currency: "USD", cash: block(10, USD_END, { cash: true }), investments: block(100, flat(100)),
      other: { months: z(), year: 0, remainder: 0 }, short: { months: [2, 3, 12], lowest: -15 },
      flowTotal: 0, buildTotal: 0, reconciled: true },
    { currency: "PLN", cash: block(500, flat(500), { cash: true, opening: { source: "override", estimate: 420 } }),
      investments: block(0, flat(0)), other: { months: z(), year: 0, remainder: 0 }, short: null,
      flowTotal: 0, buildTotal: 0, reconciled: true },
    { currency: "EUR", cash: block(1, flat(1), { cash: true }), investments: block(0, flat(0)),
      other: { months: z(), year: 0, remainder: 0 }, short: null, flowTotal: 5, buildTotal: 9, reconciled: false },
  ],
  notModelled: [{ currency: "GBP", cash: 3.68, investments: 0 }],
  currencyMismatches: [],
  unassignedLines: 0,
  plan: { openings: [{ currency: "PLN", block: "cash", amount: 500 }], transfers: [] },
};

describe("CashFlowModal", () => {
  afterEach(cleanup);

  it("names the short months, flags them, states each opening's source, and lists GBP", async () => {
    Rest.get.mockResolvedValue({ data: DATA });
    render(<CashFlowModal buildId={12} buildLabel="2027 v6" onClose={() => {}} />);
    expect((await screen.findByTestId("cfm-summary")).textContent).toBe("⚠ USD cash short Feb–Mar, Dec (lowest -15)");
    const usd = screen.getByRole("region", { name: "USD cash flow" });
    expect(within(usd).getAllByLabelText("below zero")).toHaveLength(3);
    expect(within(screen.getByRole("region", { name: "PLN cash flow" })).getByText(/your figure · estimate 420/)).toBeTruthy();
    expect(within(usd).getAllByText(/estimate: balance 2026-10-31/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Not modelled: GBP \(cash 3\.68\)/)).toBeTruthy();
    expect(screen.getByText(/EUR: the months do not add up/)).toBeTruthy();
    expect(screen.getByLabelText("PLN Cash opening").value).toBe("500");
  });

  it("says so when no currency goes short, and a stored build is read-only", async () => {
    const calm = { ...DATA, build: { ...DATA.build, editable: false },
      currencies: DATA.currencies.map((c) => ({ ...c, short: null, reconciled: true })) };
    Rest.get.mockResolvedValue({ data: calm });
    render(<CashFlowModal buildId={12} buildLabel="2027 v5" onClose={() => {}} />);
    expect((await screen.findByTestId("cfm-summary")).textContent).toBe("No currency's cash goes below zero.");
    expect(screen.getByLabelText("USD Cash opening").disabled).toBe(true);
    expect(screen.queryByText("Add transfer")).toBeNull();
  });
});

describe("CashFlowModal saving", () => {
  afterEach(cleanup);

  it("saving an opening keeps a transfer row that is typed but not yet saved", async () => {
    Rest.get.mockResolvedValue({ data: DATA });
    Rest.put.mockResolvedValue({ data: { ...DATA, plan: { ...DATA.plan, openings: [...DATA.plan.openings, { currency: "USD", block: "cash", amount: 900 }] } } });
    render(<CashFlowModal buildId={12} buildLabel="2027 v6" onClose={() => {}} />);
    await screen.findByTestId("cfm-summary");
    fireEvent.click(screen.getByText("Add transfer"));
    fireEvent.change(screen.getByLabelText("Transfer 1 amount"), { target: { value: "5000" } });
    const usd = screen.getByLabelText("USD Cash opening");
    fireEvent.change(usd, { target: { value: "900" } });
    fireEvent.blur(usd);
    await waitFor(() => expect(Rest.put).toHaveBeenCalledWith("/budget-builder/12/cash-plan", expect.objectContaining({ openings: expect.any(Array) })));
    await waitFor(() => expect(screen.getByLabelText("USD Cash opening").value).toBe("900"));
    expect(screen.getByLabelText("Transfer 1 amount").value).toBe("5000");
    expect(screen.getByText(/Unsaved/)).toBeTruthy();
  });
});

describe("helpers", () => {
  it("monthRanges collapses runs", () => {
    expect(monthRanges([2, 3, 4, 7, 12])).toBe("Feb–Apr, Jul, Dec");
    expect(monthRanges([1])).toBe("Jan");
  });
  it("parseAmount refuses commas instead of guessing", () => {
    expect(parseAmount("150000")).toBe(150000);
    expect(parseAmount("-2500.50")).toBe(-2500.5);
    expect(parseAmount("1,820.50")).toBeNull();
    expect(parseAmount("1820,50")).toBeNull();
    expect(parseAmount("1.005")).toBeNull();
  });
});
