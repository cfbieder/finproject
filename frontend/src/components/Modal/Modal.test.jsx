import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Modal from "./Modal.jsx";

/** Modal (CR042 U4) — open/close wiring, dismissable guard, accessibility. */

afterEach(cleanup);

describe("Modal", () => {
  it("renders title, body, and footer only when open", () => {
    const { rerender } = render(
      <Modal open={false} onClose={() => {}} title="Edit thing" footer={<button>Save</button>}>
        <p>Body content</p>
      </Modal>
    );
    expect(screen.queryByText("Body content")).toBeNull();

    rerender(
      <Modal open onClose={() => {}} title="Edit thing" footer={<button>Save</button>}>
        <p>Body content</p>
      </Modal>
    );
    expect(screen.getByText("Body content")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Edit thing")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("calls onClose when the ✕ button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Edit thing">
        <p>Body</p>
      </Modal>
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape when dismissable", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Edit thing">
        <p>Body</p>
      </Modal>
    );
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("bare mode renders the caller's card without the default chrome", () => {
    render(
      <Modal open onClose={() => {}} bare ariaLabel="Delete thing">
        <div className="my-card">Card body</div>
      </Modal>
    );
    // Caller card is present; no default ✕ close button or header chrome.
    expect(screen.getByText("Card body")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    // Still a proper dialog with an accessible name.
    expect(screen.getByRole("dialog", { name: "Delete thing" })).toBeTruthy();
  });

  it("suppresses the ✕ and Escape close when not dismissable (busy)", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Saving" dismissable={false}>
        <p>Body</p>
      </Modal>
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
