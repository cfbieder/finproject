import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ReconcilePreviewModal from "./ReconcilePreviewModal.jsx";

/**
 * The refused state (CR080 guards + CR087 P0c preview).
 *
 * Regression: a refused accrue preview used to render "Accrual −2.52 · Books to
 * Interest Income · Dated 2026-08-30" with Apply enabled — a proposal for a
 * transaction the server had already decided it would not write. Clicking Apply
 * changed nothing but a toast. These pin that the dialog states the outcome.
 */

const account = { account_id: 8, name: "Wise - USD", currency: "USD", reconcile_mode: "accrue" };
const fmtNum = (n) => (n == null ? "—" : Number(n).toFixed(2));

const refusedPreview = {
  mode: "accrue",
  feed_date: "2026-09-01",
  book_date: "2026-08-30",
  accrual_amount: -2.52,
  category_name: "Interest Income",
  implied_apy: -0.0476,
  period_days: 5,
  implausible: true,
  refused: true,
  applied: false,
  note: "-2.52 over 5 day(s) on 3862.29 implies -4.76%/yr, outside the plausible band.",
};

const okPreview = { ...refusedPreview, accrual_amount: 1.52, implied_apy: 0.0287, implausible: false, refused: false, note: undefined };

const renderModal = (preview) =>
  render(
    <ReconcilePreviewModal
      open
      preview={preview}
      account={account}
      busy={false}
      error={null}
      stale={false}
      onCancel={() => {}}
      onApply={() => {}}
      fmtNum={fmtNum}
    />
  );

afterEach(cleanup);

describe("ReconcilePreviewModal — refused", () => {
  it("offers no Apply, and closes rather than cancels", () => {
    renderModal(refusedPreview);
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    // "Cancel" implies an action is pending. Nothing is; there is only Close
    // (the footer's, alongside Modal's own ✕ — same name, same effect).
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });

  it("states the outcome and the reason", () => {
    renderModal(refusedPreview);
    expect(screen.getByText("Not booked")).toBeTruthy();
    expect(screen.getByText(/Refused — nothing was written/)).toBeTruthy();
    expect(screen.getByText(/outside the plausible band/)).toBeTruthy();
  });

  it("names the figure a gap, and drops the category nothing books to", () => {
    renderModal(refusedPreview);
    expect(screen.getByText("Gap (not booked)")).toBeTruthy();
    expect(screen.queryByText("Accrual")).toBeNull();
    expect(screen.queryByText("Books to")).toBeNull();
    expect(screen.queryByText("Interest Income")).toBeNull();
    // The evidence for the refusal stays on the page.
    expect(screen.getByText("-4.76%/yr over 5d")).toBeTruthy();
  });

  it("a plausible preview is still a proposal with an Apply", () => {
    renderModal(okPreview);
    expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByText("Accrual")).toBeTruthy();
    expect(screen.getByText("Books to")).toBeTruthy();
    expect(screen.queryByText(/Refused/)).toBeNull();
  });
});
