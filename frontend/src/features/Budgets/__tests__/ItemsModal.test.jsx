import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ItemsModal from "../ItemsModal.jsx";

/**
 * CR103 P0 — a multi-row paste lands as several items in one update, and a bad paste applies
 * nothing. The modal's setters close over `rows`, so per-cell updates would lose all but the last.
 */
const LINE = { id: 1, category: "Interest Income", currency: "USD", leFy: 66591, accountType: "income", items: [] };
const RATES = { fx: { USD: { rate: 1 }, PLN: { rate: 3.94 }, EUR: { rate: 0.89 } } };
const tsv = (d, c, v) => [d, c, ...Array(12).fill(v)].join("\t");

function renderModal() {
  return render(
    <ItemsModal line={LINE} categoryLines={[LINE]} rates={RATES} reference={null} leYear={2026} targetYear={2027}
      readOnly={false} busy={false} error={null} onSave={() => {}} onClose={() => {}} />,
  );
}
const paste = (el, text) => fireEvent.paste(el, { clipboardData: { getData: () => text } });

describe("ItemsModal paste", () => {
  afterEach(cleanup);

  it("pastes three rows as three items", () => {
    renderModal();
    paste(screen.getByLabelText("Item 1 Mar"), [tsv("Bond coupons", "USD", "100"), tsv("Cash", "USD", "20"), tsv("Reinvest", "USD", "5")].join("\r\n"));
    expect(screen.getByLabelText("Item 1 description").value).toBe("Bond coupons");
    expect(screen.getByLabelText("Item 3 description").value).toBe("Reinvest");
    expect(screen.getByLabelText("Item 2 Dec").value).toBe("20");
    expect(screen.queryByText(/Paste not applied/)).toBeNull();
  });

  it("a bad cell applies nothing and names the cell", () => {
    renderModal();
    paste(screen.getByLabelText("Item 1 description"), [tsv("Good", "USD", "1"), tsv("Bad", "USD", "1820,50")].join("\n"));
    expect(screen.getByRole("alert").textContent).toMatch(/Row 2, Jan: "1820,50"/);
    expect(screen.getByLabelText("Item 1 description").value).toBe("");
    expect(screen.queryByLabelText("Item 2 description")).toBeNull();
  });
});
