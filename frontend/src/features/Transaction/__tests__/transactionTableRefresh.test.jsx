import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import TransactionTable from "../TransactionTable.jsx";

// Rest is only used by the inline category editor; stub it so the table renders
// without a network call.
vi.mock("../../../js/rest", () => ({
  default: { fetchJson: vi.fn().mockResolvedValue({ data: [] }) },
}));

/**
 * A reload must not unmount the rows. Unmounting them collapses the scroller's
 * height, the browser clamps its scroll offset to the top, and remounting does
 * not put it back — so an edit made halfway down the list came back at the top.
 */

const config = { logPrefix: "ReviewNew" };
const rows = [
  {
    rowId: "r1",
    isSelected: false,
    entry: { id: 1, Date: "2026-09-21", Description1: "Le Bouchon", Amount: -0.5 },
  },
  {
    rowId: "r2",
    isSelected: false,
    entry: { id: 2, Date: "2026-09-22", Description1: "Chai Pascal", Amount: -33.15 },
  },
];

afterEach(cleanup);

const renderTable = (props) =>
  render(
    <TransactionTable
      config={config}
      error={null}
      hasTransactions
      hasFilteredTransactions
      sortedTransactions={rows}
      {...props}
    />
  );

describe("TransactionTable refresh", () => {
  it("keeps the rows mounted while a reload is in flight", () => {
    renderTable({ isLoading: true });

    expect(screen.getByText("Le Bouchon")).toBeTruthy();
    expect(screen.getByText("Chai Pascal")).toBeTruthy();
    expect(screen.queryByText(/Loading new transactions/i)).toBeNull();
    expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
  });

  it("still shows the loading message on a first load, when there are no rows", () => {
    renderTable({
      isLoading: true,
      hasTransactions: false,
      hasFilteredTransactions: false,
      sortedTransactions: [],
    });

    expect(screen.getByText(/Loading new transactions/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("drops the busy marker once the reload finishes", () => {
    renderTable({ isLoading: false });

    expect(screen.getByRole("table").getAttribute("aria-busy")).toBeNull();
    expect(screen.getByText("Le Bouchon")).toBeTruthy();
  });
});
