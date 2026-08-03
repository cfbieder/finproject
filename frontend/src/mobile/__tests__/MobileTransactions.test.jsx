import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

/**
 * CR068 P1 — the mobile Actuals page.
 *
 * The load-bearing claim is that this page filters SERVER-side through the same
 * ACTUAL_CONFIG filter object the desktop page uses. So the assertions are
 * mostly about the filter object handed to useTransactions: if that drifts, the
 * two pages disagree about which rows a period contains and no rendering test
 * would notice.
 */

const ROWS = [
  {
    _id: "1",
    id: 1,
    Date: "2026-08-01",
    Description1: "JMP S.A. BIEDRONKA 4969",
    Description2: "card purchase",
    Amount: -101.74,
    Currency: "PLN",
    BaseAmount: -27.09,
    BaseCurrency: "USD",
    Account: "PKO VISA Infinity CB",
    Category: "Groceries",
  },
  {
    _id: "2",
    id: 2,
    Date: "2026-08-01",
    Description1: "ONEBILL MYBOX",
    Amount: -116.23,
    Currency: "EUR",
    BaseAmount: -133.49,
    BaseCurrency: "USD",
    Account: "Caixa EUR",
    Category: "Property Insurance - Spain",
  },
];

// Captures the filter object the page hands the shared hook.
const seenFilters = [];
const setTransactionLimit = vi.fn();

vi.mock("../../features/Transaction/hooks/useTransactions.js", () => ({
  useTransactions: (_config, filters) => {
    seenFilters.push(filters);
    return {
      transactions: ROWS,
      transactionLimit: 100,
      hasMoreTransactions: false,
      isLoading: false,
      error: "",
      setTransactionLimit,
      reload: vi.fn(),
    };
  },
}));

vi.mock("../../hooks/useCoa.js", () => ({
  useCoa: () => ({
    plTree: [
      { name: "Income", children: [{ name: "Salary" }] },
      {
        name: "Expense",
        children: [{ name: "Groceries" }, { name: "Property Insurance - Spain" }],
      },
    ],
    bsTree: [
      {
        name: "Assets",
        children: [
          {
            name: "Current Assets",
            children: [{ name: "Caixa EUR" }, { name: "PKO" }],
          },
        ],
      },
      {
        name: "Liabilities",
        children: [
          { name: "Credit Cards", children: [{ name: "PKO VISA Infinity CB" }] },
        ],
      },
    ],
  }),
}));

vi.mock("../../js/rest.js", () => ({
  default: {
    fetchJson: vi.fn(async () => ({
      entries: [
        { Amount: -101.74, Currency: "PLN", BaseAmount: -27.09 },
        { Amount: -116.23, Currency: "EUR", BaseAmount: -133.49 },
      ],
      truncated: false,
    })),
  },
}));

const { default: MobileTransactions } = await import(
  "../pages/MobileTransactions.jsx"
);

const latestFilters = () => seenFilters[seenFilters.length - 1];

describe("MobileTransactions", () => {
  beforeEach(() => {
    seenFilters.length = 0;
    setTransactionLimit.mockClear();
    vi.useRealTimers();
  });

  afterEach(cleanup);

  it("renders a card per transaction with date, account and category", () => {
    render(<MobileTransactions />);

    expect(screen.getByText("JMP S.A. BIEDRONKA 4969")).toBeTruthy();
    expect(screen.getByText("(101.74)")).toBeTruthy();
    expect(
      screen.getByText(/PKO VISA Infinity CB · Groceries/)
    ).toBeTruthy();
  });

  it("defaults to the current month, single-month enabled", () => {
    render(<MobileTransactions />);

    const f = latestFilters();
    const now = new Date();
    expect(f.yearEnabled).toBe(true);
    expect(f.year).toBe(String(now.getFullYear()));
    expect(f.monthEnabled).toBe(true);
    expect(f.month).toBe(now.getMonth());
  });

  it("expands a row to reveal the base amount, and collapses again", () => {
    render(<MobileTransactions />);

    expect(screen.queryByText("card purchase")).toBeNull();

    const row = screen.getByText("JMP S.A. BIEDRONKA 4969").closest(".m-tx");
    fireEvent.click(row);
    expect(screen.getByText("card purchase")).toBeTruthy();
    expect(screen.getByText(/\(27\.09\)/)).toBeTruthy();

    fireEvent.click(row);
    expect(screen.queryByText("card purchase")).toBeNull();
  });

  it("puts the search term on the FILTER (server-side), not on the loaded rows", async () => {
    vi.useFakeTimers();
    render(<MobileTransactions />);

    fireEvent.change(screen.getByLabelText("Search descriptions"), {
      target: { value: "biedronka" },
    });

    // Debounced — nothing yet.
    expect(latestFilters().descriptionEnabled).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(latestFilters().descriptionEnabled).toBe(true);
    expect(latestFilters().description).toBe("biedronka");

    // Both rows are still rendered: the page did NOT filter them locally — the
    // server decides what comes back.
    expect(screen.getByText("ONEBILL MYBOX")).toBeTruthy();
    vi.useRealTimers();
  });

  it("applies selected categories as leaf names and resets paging", () => {
    render(<MobileTransactions />);

    fireEvent.click(screen.getByText("Categories"));
    fireEvent.click(screen.getByText("Groceries", { selector: ".m-picker__item" }));
    fireEvent.click(screen.getByText("Apply (1)"));

    const f = latestFilters();
    expect(f.categoryEnabled).toBe(true);
    expect(f.category).toEqual(["Groceries"]);
    expect(setTransactionLimit).toHaveBeenCalledWith(100);
  });

  it("groups accounts by their balance-sheet parent, not by Assets/Liabilities", () => {
    render(<MobileTransactions />);

    fireEvent.click(screen.getByText("Accounts"));

    // firstChild, not textContent: in multi mode the header also holds the
    // per-section All/None button, so textContent reads "Current AssetsAll".
    const headers = [...document.querySelectorAll(".m-picker__group-h")].map(
      (el) => el.firstChild.textContent
    );
    expect(headers).toContain("Current Assets");
    expect(headers).toContain("Credit Cards");
    expect(headers).not.toContain("Assets");
  });

  it("clears a filter from its chip", () => {
    render(<MobileTransactions />);

    fireEvent.click(screen.getByText("Accounts"));
    fireEvent.click(screen.getByText("Caixa EUR", { selector: ".m-picker__item" }));
    fireEvent.click(screen.getByText("Apply (1)"));
    expect(latestFilters().accountEnabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Clear account filter"));
    expect(latestFilters().accountEnabled).toBe(false);
    expect(latestFilters().account).toEqual([]);
  });

  it("steps the period a month at a time and emits the matching filter fields", () => {
    render(<MobileTransactions />);

    fireEvent.click(screen.getByText(/^\w{3} \d{4}$/));
    fireEvent.click(screen.getByLabelText("Previous month"));
    fireEvent.click(screen.getByText("Apply"));

    const now = new Date();
    const expected = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const f = latestFilters();
    expect(f.year).toBe(String(expected.getFullYear()));
    expect(f.month).toBe(expected.getMonth());
    expect(f.monthEnabled).toBe(true);
  });

  it("totals in base, and does not add the currencies together", async () => {
    render(<MobileTransactions />);

    // Awaits the totals fetch resolving.
    expect(await screen.findByText(/\(160\.58\) base/)).toBeTruthy();
    expect(screen.getByText("(101.74) PLN")).toBeTruthy();
    expect(screen.getByText("(116.23) EUR")).toBeTruthy();
    // 101.74 + 116.23 = 217.97 — the defect this page must not reproduce.
    expect(screen.queryByText(/217\.97/)).toBeNull();
  });
});
