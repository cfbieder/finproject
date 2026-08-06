import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FCLineDrilldownModal from "../FCLineDrilldownModal.jsx";

/**
 * CR072 QA — the drill-down modal.
 *
 * The first version of this file asserted only that the modal MOUNTED, and it passed while the
 * component crashed the whole page in a browser. The reason is the shape of the assertion: the
 * mock returned no transactions, so `TransactionTable` rendered its empty-state message and never
 * reached a cell. The defect lived one layer further in — `sortedTransactions` is not a list of
 * transactions but of `{ entry, rowId, isSelected }` wrappers, so every cell read
 * `entry[column.key]` off `undefined` and threw, taking the module editor down with it.
 *
 * So these tests deliberately return ROWS. A drill-down that renders no rows proves nothing about
 * a drill-down, and the crash was in the row.
 */

const TXN = {
  id: 91,
  transaction_date: "2025-03-04",
  description1: "Roof repair",
  amount: "-1200.55",
  currency: "PLN",
  base_amount: "-300.10",
  base_currency: "USD",
  account_name: "Millennium PLN",
  category_name: "House Maintenance - PL",
};

const BUDGET_ROW = {
  id: 5,
  entry_date: "2026-02-01",
  description: "Planned roof",
  amount: "-900.00",
  currency: "EUR",
  base_amount: "-980.00",
  account_name: "Budget EUR",
  category_name: "House Maintenance - PL",
};

const fetchJson = vi.fn();

vi.mock("../../../js/rest.js", () => ({
  default: {
    fetchFcLineActualBreakdown: vi.fn().mockResolvedValue([
      { account_id: 1, account_name: "House Maintenance - PL" },
      { account_id: 2, account_name: "House Insurance" },
    ]),
    fetchFcLineBudgetBreakdown: vi.fn().mockResolvedValue([
      { account_id: 1, account_name: "House Maintenance - PL" },
    ]),
    fetchJson: (...args) => fetchJson(...args),
    fetchCategoriesV2: vi.fn().mockResolvedValue([]),
    // The category filter is the shared HierarchyFilter over the COA tree, so the modal now
    // pulls `useCoa`. Two leaves under Expense, one of which is also on the line — enough for
    // the line group and a real group to coexist.
    fetchAccountTraitsV2: vi.fn().mockResolvedValue({}),
    fetchAccountTreeV2: vi.fn().mockImplementation(({ section }) =>
      Promise.resolve(section === "profit_loss"
        ? [{ name: "Profit & Loss Accounts", children: [
            { name: "Expense", children: [
              { name: "House Maintenance - PL" },
              { name: "Groceries" },
            ] },
          ] }]
        : [{ name: "Balance Sheet Accounts", children: [] }])
    ),
    rows: () => [],
  },
}));

// No global setup file, so RTL does not auto-unmount between tests — without this the
// previous modal is still in the document and every query finds two of everything.
afterEach(cleanup);

beforeEach(() => {
  fetchJson.mockReset();
});

const open = (props = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <FCLineDrilldownModal
      isOpen
      onClose={() => {}}
      year={2025}
      fcLineId={18}
      lineName="Property Costs"
      kind="actual"
      {...props}
    />
    </QueryClientProvider>
  );

describe("CR072 QA — the FC line drill-down", () => {
  test("it renders the transaction ROWS, not just the shell", async () => {
    fetchJson.mockResolvedValue({ data: [TXN] });
    open();
    expect(await screen.findByText(/Property Costs — 2025/)).toBeTruthy();
    // The cell itself. This is the assertion the earlier test lacked, and the one the crash
    // would have failed.
    expect(await screen.findByText("Roof repair")).toBeTruthy();
  });

  test("the local currency is reported beside the base, never merged into it", async () => {
    fetchJson.mockResolvedValue({ data: [TXN] });
    open();
    await screen.findByText("Roof repair");
    // Scoped to the totals strip: "PLN" also appears in the row's own Currency cell, and the
    // claim here is about the SUMMARY — a line routinely spans several currencies, so only the
    // base column may be summed. One tile per currency plus the base, not a single "total".
    const totals = screen.getByText("USD (base)").closest(".fc-drill__totals");
    expect(totals.textContent).toContain("PLN");
    expect(totals.textContent).toContain("USD (base)");
    expect(totals.textContent).toContain("1,201");   // the PLN tile, summed in PLN
    expect(totals.textContent).toContain("300");     // the base tile, summed in USD
  });

  test("it opens pre-filtered to the line's own accounts", async () => {
    fetchJson.mockResolvedValue({ data: [TXN] });
    open();
    await screen.findByText("Roof repair");
    // The leaves arrive on a second render pass, so the pre-filtered query is the LATER call.
    await waitFor(() => {
      const url = fetchJson.mock.calls.at(-1)[0];
      expect(url).toContain("category=House+Maintenance+-+PL");
      expect(url).toContain("category=House+Insurance");
      // A whole calendar year — not the current month, which is what the Actuals defaults carry.
      expect(url).toContain("fromDate=2025-01-01");
      expect(url).toContain("toDate=2026-01-01");
    });
  });

  test("the category filter opens on the line's own accounts, and unticking one narrows the QUERY", async () => {
    fetchJson.mockResolvedValue({ data: [TXN] });
    open();
    await screen.findByText("Roof repair");

    // The line's leaves are the checklist, all ticked — the filter agrees with the figure that
    // opened the modal rather than starting at "everything".
    await waitFor(() => {
      expect(document.querySelectorAll(".hf__checkbox:checked").length).toBe(2);
    });

    const item = [...document.querySelectorAll(".hf__item")]
      .find((el) => el.textContent.includes("House Insurance"));
    fireEvent.click(item.querySelector("input"));

    // Narrowing must reach the SERVER, not just hide loaded rows — filtering the loaded page is
    // the CR068 P1 defect, and here it would also leave the totals covering rows no longer shown.
    await waitFor(() => {
      const url = fetchJson.mock.calls.at(-1)[0];
      expect(url).toContain("category=House+Maintenance+-+PL");
      expect(url).not.toContain("House+Insurance");
    });
  });

  test("right-click selects only that category", async () => {
    fetchJson.mockResolvedValue({ data: [TXN] });
    open();
    await screen.findByText("Roof repair");
    await waitFor(() => {
      expect(document.querySelectorAll(".hf__checkbox:checked").length).toBe(2);
    });

    const item = [...document.querySelectorAll(".hf__item")]
      .find((el) => el.textContent.includes("House Insurance"));
    fireEvent.contextMenu(item);

    await waitFor(() => {
      expect(fetchJson.mock.calls.at(-1)[0]).toContain("category=House+Insurance");
    });
    const url = fetchJson.mock.calls.at(-1)[0];
    expect(url).not.toContain("House+Maintenance");
    expect(document.querySelectorAll(".hf__checkbox:checked").length).toBe(1);
  });

  test("the All pill drops the category restriction entirely", async () => {
    fetchJson.mockResolvedValue({ data: [TXN] });
    open();
    await screen.findByText("Roof repair");
    await waitFor(() => {
      expect(fetchJson.mock.calls.at(-1)[0]).toContain("category=");
    });

    fireEvent.click([...document.querySelectorAll(".hf__pill")]
      .find((el) => el.textContent.trim() === "All"));

    await waitFor(() => {
      expect(fetchJson.mock.calls.at(-1)[0]).not.toContain("category=");
    });
    expect(screen.getByText(/every category/)).toBeTruthy();
  });

  test("a budget drill reads budget entries and drops the search it cannot honour", async () => {
    fetchJson.mockResolvedValue({ data: [BUDGET_ROW] });
    open({ kind: "budget", year: 2026 });
    expect(await screen.findByText(/Property Costs — 2026/)).toBeTruthy();
    expect(fetchJson.mock.calls.at(-1)[0]).toContain("/budget/entries");
    // BUDGET_CONFIG has no description filter; offering a box that does nothing is worse
    // than offering none.
    expect(screen.queryByPlaceholderText(/Search descriptions/)).toBeNull();
  });
});
