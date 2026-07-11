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
