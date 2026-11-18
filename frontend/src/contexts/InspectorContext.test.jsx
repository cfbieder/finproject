import { afterEach, describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { InspectorPanel, InspectorPortal, InspectorProvider } from "./InspectorContext.jsx";
import { useInspector } from "./inspector.js";

/** CR105 S4 — the Workbench inspector. */
afterEach(cleanup);
function Harness({ children }) {
  return (
    <MemoryRouter initialEntries={["/a"]}>
      <InspectorProvider>
        {children}
        <InspectorPanel />
      </InspectorProvider>
    </MemoryRouter>
  );
}

function Opener({ k = "one", title = "Figure one" }) {
  const insp = useInspector();
  const nav = useNavigate();
  return (
    <>
      <button onClick={() => insp.open({ key: k, title, content: <p>body {k}</p> })}>open {k}</button>
      <button onClick={() => nav("/b")}>go</button>
    </>
  );
}

describe("InspectorProvider", () => {
  it("is null outside the Workbench layout", () => {
    function Probe() {
      return <span>{useInspector() === null ? "none" : "some"}</span>;
    }
    render(<Probe />);
    expect(screen.getByText("none")).toBeTruthy();
  });

  it("opens a figure, closes it on a second click of the same one", () => {
    render(
      <Harness>
        <Opener />
      </Harness>
    );
    fireEvent.click(screen.getByText("open one"));
    expect(screen.getByRole("complementary", { name: "Details: Figure one" })).toBeTruthy();
    fireEvent.click(screen.getByText("open one"));
    expect(screen.queryByText("body one")).toBeNull();
  });

  it("closes on Esc and on navigating to another page", () => {
    render(
      <Harness>
        <Opener />
      </Harness>
    );
    fireEvent.click(screen.getByText("open one"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("body one")).toBeNull();

    fireEvent.click(screen.getByText("open one"));
    expect(screen.getByText("body one")).toBeTruthy();
    fireEvent.click(screen.getByText("go"));
    expect(screen.queryByText("body one")).toBeNull();
  });

  it("renders live portal content, and routes ✕ to the page's own close", () => {
    const onClose = vi.fn();
    function Form() {
      const [v, setV] = useState("a");
      return (
        <InspectorPortal title="Edit 1 transaction" onClose={onClose}>
          <input aria-label="field" value={v} onChange={(e) => setV(e.target.value)} />
          <span>value {v}</span>
        </InspectorPortal>
      );
    }
    render(
      <Harness>
        <Form />
      </Harness>
    );
    const field = screen.getByLabelText("field");
    act(() => {
      fireEvent.change(field, { target: { value: "b" } });
    });
    expect(screen.getByText("value b")).toBeTruthy(); // live, not a snapshot
    fireEvent.keyDown(field, { key: "Escape" }); // Esc inside a field is the field's
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Close details"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
