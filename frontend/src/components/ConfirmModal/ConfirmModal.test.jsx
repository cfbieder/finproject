import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ConfirmModal from "./ConfirmModal.jsx";

/**
 * ConfirmModal on the Radix <Modal> (CR086 §5). The hand-rolled overlay it replaced ignored
 * Escape and trapped no focus — on the confirms that gate delete and promote.
 */

afterEach(cleanup);

const state = { title: "Delete batch?", message: "This removes 12 rows.", danger: true, confirmLabel: "Delete" };

describe("ConfirmModal", () => {
  it("renders nothing without state", () => {
    render(<ConfirmModal state={null} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a real dialog with the message and both actions", () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal state={state} onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("This removes 12 rows.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels", () => {
    const onCancel = vi.fn();
    render(<ConfirmModal state={state} onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("while busy, Escape does nothing and both buttons are disabled", () => {
    const onCancel = vi.fn();
    render(<ConfirmModal state={state} busy onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Working…" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).disabled).toBe(true);
  });
});
