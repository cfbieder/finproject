import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import InvestmentIncome from "../InvestmentIncome.jsx";
import Rest from "../../js/rest.js";

/**
 * CR103 P1 — one tab per account, and the budget-year rows for the tab's account only. On plain
 * HTTP (dev, and jsdom) there is no clipboard, so the copy shows the text to copy by hand.
 */
const summary = (total) => ({
  window: { from: "2026-11-06", to: "2027-11-06" },
  scheduled: { total, holdings: [], callable_total: 0, maturing_total: 0 },
  estimated: { total: 0, holdings: [] },
  total, yield_on_portfolio: 0.03, by_month: [], no_answer: [], no_answer_value: "0.00",
});
const row = (account_id, account_name, basis, category, description, v) => ({
  account_id, account_name, basis, category, description, months: Array(12).fill(v), total: v * 12,
});
const DATA = {
  ...summary(300),
  dividends_as_of: "2026-11-06",
  dividends_age_days: 0,
  accounts: [
    { account_id: 31, account_name: "Bond Acct", ...summary(200) },
    { account_id: 26, account_name: "Stock Acct", ...summary(100) },
  ],
  budget: {
    year: 2027,
    rows: [
      row(31, "Bond Acct", "coupon", "interest", "Bond Acct — bond coupons", 100),
      row(31, "Bond Acct", "distribution_fund", "dividend", "Bond Acct — bond-fund distributions", 50),
      row(26, "Stock Acct", "distribution_stock", "dividend", "Stock Acct — stock & equity-fund dividends", 10),
    ],
    reinvest_rates: [], default_reinvest_rate: { rate: 3.29, source: "SPAXX" }, no_data: [],
  },
};

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/investments/income" element={<InvestmentIncome />} />
        <Route path="/investments/income/:accountId" element={<InvestmentIncome />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("InvestmentIncome by account (CR103 P1)", () => {
  beforeEach(() => { vi.spyOn(Rest, "fetchJson").mockResolvedValue({ data: DATA }); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("asks for next year's budget rows and shows a tab per account", async () => {
    renderAt("/investments/income");
    expect(await screen.findByRole("link", { name: "Bond Acct" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All accounts" }).getAttribute("aria-current")).toBe("page");
    expect(Rest.fetchJson.mock.calls[0][0]).toMatch(/year=\d{4}/);
    expect(screen.getByText("Stock Acct — stock & equity-fund dividends")).toBeTruthy();
  });

  it("an account tab shows only its own rows, and copy falls back to text on plain HTTP", async () => {
    renderAt("/investments/income/31");
    expect(await screen.findByText("Bond Acct — bond coupons")).toBeTruthy();
    expect(screen.queryByText("Stock Acct — stock & equity-fund dividends")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy Dividend rows" }));
    const box = await screen.findByLabelText("Rows to copy");
    expect(box.value).toBe(["Bond Acct — bond-fund distributions", "USD", ...Array(12).fill("50.00")].join("\t"));
  });
});
