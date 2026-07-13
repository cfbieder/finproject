import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import FCExpModal from "../FCExpModal.jsx";

/**
 * FCExpModal carries a rules-of-hooks violation that eslint flags: `if (!isOpen) return
 * null` sits ABOVE its useEffect, so a closed render calls 0 hooks and an open one calls
 * 1. FCExpSetup keeps the component MOUNTED and merely flips `isOpen` — exactly the shape
 * that normally produces React's "Rendered more hooks than during the previous render".
 *
 * It does not crash. Verified here, which is why the Expenses editor has always worked.
 * But it survives by accident of React's internals rather than by design, and the honest
 * fix (drop the early return and let <Modal open> gate it) first needs four `editForm.X`
 * reads in the JSX made optional — <Modal>'s children are evaluated even when closed.
 *
 * So this test pins the behaviour: if anyone reorders the hooks, or React tightens the
 * rule, it fails HERE — not in the owner's face when they open the modal.
 */

vi.mock("../../../js/rest.js", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    fetchCashFlowReportV2: vi.fn().mockResolvedValue([]),
  },
}));

afterEach(cleanup);

const props = {
  editForm: { Account: "A", Name: "n", BaseDate: "2026-01-01", Matched: false, Changes: [] },
  editError: "",
  editSaving: false,
  onClose: () => {},
  onFieldChange: () => {},
  onSubmit: () => {},
  accountOptions: [],
  accountNameOptions: {},
  periodYears: [2026],
};

describe("FCExpModal — hook order across an isOpen toggle", () => {
  it("does not throw when toggled closed → open while staying mounted", () => {
    const { rerender } = render(<FCExpModal isOpen={false} {...props} />);
    expect(() => rerender(<FCExpModal isOpen {...props} />)).not.toThrow();
  });

  it("and back open → closed", () => {
    const { rerender } = render(<FCExpModal isOpen {...props} />);
    expect(() => rerender(<FCExpModal isOpen={false} {...props} />)).not.toThrow();
  });
});
