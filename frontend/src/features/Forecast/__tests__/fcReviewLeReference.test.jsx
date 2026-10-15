import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import FCReviewTable from "../FCReviewTable.jsx";
import FCReviewLeNote from "../FCReviewLeNote.jsx";

/**
 * CR083 §8.1 — the Latest Estimate as a READ-ONLY reference column on Forecast Review.
 *
 * Owner decision 2026-10-15: build it first, and it must move NO forecast numbers. So the test
 * that matters is the comparison: render the table with and without the LE, and every cell that
 * is not the LE column must be identical. The LE column sits right after the base-year column,
 * carries the server's per-FC-line figures and nothing the page computed.
 */

const YEARS = [2025, 2026, 2027];
const BUDGET = { Salary: 100000, Travel: -40000 };
const LE = {
  le: { id: 2, name: "LE-09-26", label: null, status: "final", budgetYear: 2026, actualThrough: "2026-08-31" },
  baseYear: 2026,
  values: { Salary: 110000, Travel: -55000 },
  total: 55000,
  budgetTotal: 60000,
  gap: -5000,
  leNet: 55800,
  outsideLines: 800,
};

const forecast = { "Salary|2027": 120000, "Travel|2027": -41000, "Income|2027": 120000 };

function renderTable(leReference) {
  return render(
    <FCReviewTable
      leReference={leReference}
      sortedYears={YEARS}
      baseYears={new Set([2026])}
      lastActualYears={new Set([2025])}
      baseYearBudget={BUDGET}
      baseActualTotalsByYear={new Map()}
      categoryToLineMap={new Map()}
      cashAccountMap={new Map([["Salary", { level1: "Income" }], ["Travel", { level1: "Expense" }]])}
      tableColSpan={YEARS.length + 1}
      selectedScenario="2026 Base"
      cashAccounts={[{ label: "Salary" }]}
      balanceAccounts={[]}
      cashRowsWithNet={[
        { label: "Income", level: 1 },
        { label: "Salary", level: 2 },
        { label: "Travel", level: 2 },
        { isCashFlow: true, label: "Cash Flow" },
      ]}
      transferDetailRows={[]}
      getCellValue={(row, year) => forecast[`${row.label}|${year}`] ?? null}
      balanceDisplayValues={new Map()}
      balanceAccountMap={new Map()}
      bankAccountLabels={[]}
      totalAssetsByYear={[]}
      netAssetsByYear={null}
    />
  );
}

/** Every row's cells as text, with the LE column's cells removed. */
function gridWithoutLe(container, leColumnIndex) {
  return [...container.querySelectorAll("table tr")].map((tr) =>
    [...tr.children]
      .filter((_, i) => leColumnIndex == null || i !== leColumnIndex)
      .map((c) => c.textContent)
  );
}

afterEach(cleanup);

describe("CR083 §8.1 — LE reference column", () => {
  it("adds one column, after the base year, labelled with the LE's name and marked as reference", () => {
    const { container } = renderTable(LE);
    const headers = [...container.querySelectorAll("thead tr:first-child th")].map((th) => th.textContent);
    // [select, Account, 2025, 2026, LE, 2027]
    expect(headers[3]).toMatch(/^2026/);
    expect(headers[4]).toBe("LE-09-26(reference)");
    expect(headers[5]).toMatch(/^2027/);
  });

  it("shows the server's per-line figures and its total — nothing computed on the page", () => {
    const { container } = renderTable(LE);
    const row = (label) =>
      [...container.querySelectorAll("tbody tr")].find((tr) => tr.children[1]?.textContent === label);
    expect(row("Salary").children[4].textContent).toBe("110,000");
    expect(row("Travel").children[4].textContent).toBe("(55,000)");
    expect(row("Cash Flow").children[4].textContent).toBe("55,000");
    // A roll-up the server did not send is blank, not a page-side sum.
    expect(row("Income").children[4].textContent).toBe("");
  });

  it("moves no other number: every non-LE cell is identical with and without it", () => {
    const without = gridWithoutLe(renderTable(null).container, null);
    cleanup();
    const withLe = gridWithoutLe(renderTable(LE).container, 4);
    expect(withLe).toEqual(without);
    // And the base-year column still reads the budget.
    expect(withLe.find((r) => r[1] === "Salary")[3]).toBe("100,000");
  });

  it("no final LE ⇒ no column", () => {
    const { container } = renderTable(null);
    expect(container.querySelector("thead tr:first-child").children).toHaveLength(2 + YEARS.length);
    expect(screen.queryByText(/reference/)).toBeNull();
  });
});

describe("CR083 §8.1 — the note", () => {
  it("states base year, LE, gap and what sits outside the FC lines, with sign colour", () => {
    render(<FCReviewLeNote leReference={LE} />);
    const note = screen.getByTestId("fc-review-le-note");
    expect(note.textContent).toMatch(/^Base year 2026: 60,000 \(budget\) · LE-09-26 says 55,000 \(−5,000\)\./);
    expect(note.textContent).toMatch(/LE-09-26's own net is 55,800; 800 of it sits on categories no FC line covers\./);
    const gap = within(note).getByText("−5,000");
    expect(gap.style.color).toBe("var(--danger)");
  });

  it("renders nothing without a final LE", () => {
    const { container } = render(<FCReviewLeNote leReference={null} />);
    expect(container.textContent).toBe("");
  });
});
