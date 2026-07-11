import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import DataTable from "./DataTable.jsx";

/** DataTable (CR042 U4) — sorting, rendering, numeric columns, empty state. */

const COLUMNS = [
  { key: "name", header: "Name", sortable: true },
  { key: "amount", header: "Amount", numeric: true, sortable: true },
];
const ROWS = [
  { id: 1, name: "Charlie", amount: 30 },
  { id: 2, name: "Alice", amount: 10 },
  { id: 3, name: "Bob", amount: 20 },
];

afterEach(cleanup);

function rowOrder() {
  return screen
    .getAllByRole("row")
    .slice(1) // drop header row
    .map((tr) => within(tr).getAllByRole("cell")[0].textContent);
}

describe("DataTable", () => {
  it("renders rows and cells in source order by default", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(rowOrder()).toEqual(["Charlie", "Alice", "Bob"]);
  });

  it("sorts ascending then descending on header click (uncontrolled)", () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    const nameHeader = screen.getByText("Name");
    fireEvent.click(nameHeader);
    expect(rowOrder()).toEqual(["Alice", "Bob", "Charlie"]);
    fireEvent.click(nameHeader);
    expect(rowOrder()).toEqual(["Charlie", "Bob", "Alice"]);
  });

  it("sorts numeric columns numerically, not lexically", () => {
    const rows = [
      { id: 1, name: "a", amount: 100 },
      { id: 2, name: "b", amount: 9 },
    ];
    render(<DataTable columns={COLUMNS} rows={rows} rowKey={(r) => r.id} />);
    fireEvent.click(screen.getByText("Amount"));
    expect(rowOrder()).toEqual(["b", "a"]); // 9 before 100
  });

  it("delegates sort to onSortChange when controlled", () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        sort={{ key: "name", dir: "asc" }}
        onSortChange={onSortChange}
      />
    );
    fireEvent.click(screen.getByText("Name"));
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", dir: "desc" });
  });

  it("renders the empty message spanning all columns when there are no rows", () => {
    render(
      <DataTable columns={COLUMNS} rows={[]} emptyMessage="Nothing here" />
    );
    const cell = screen.getByText("Nothing here");
    expect(cell.getAttribute("colspan")).toBe("2");
  });
});
