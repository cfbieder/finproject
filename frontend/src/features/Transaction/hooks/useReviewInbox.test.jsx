import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { InspectorProvider } from "../../../contexts/InspectorContext.jsx";
import useReviewInbox from "./useReviewInbox.js";
import { useGoChords } from "../../../components/Workbench/keys.js";
import { WORKBENCH_SECTIONS } from "../../../components/Workbench/sections.js";
import Modal from "../../../components/Modal/Modal.jsx";

/** CR105 S5 — the review list as a keyboard inbox. */
afterEach(cleanup);

const ROWS = ["r1", "r2", "r3"].map((rowId, i) => ({
  rowId,
  entry: { id: i + 1, Description1: `Shop ${rowId}`, Account: i === 2 ? "PKO" : "Chase" },
}));

function Inbox({ onAccept, onCategory, rows = ROWS }) {
  const { searchRef, tableRef, search, setSearch, rows: shown, cursorId } = useReviewInbox({
    rows,
    active: true,
    onAccept,
    onCategory,
    busy: false,
  });
  return (
    <>
      <input ref={searchRef} aria-label="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      <table ref={tableRef}>
        <tbody>
          {shown.map((r) => (
            <tr key={r.rowId} data-row-id={r.rowId}>
              <td>{r.rowId === cursorId ? `> ${r.rowId}` : r.rowId}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const wrap = (ui, workbench = true) =>
  render(<MemoryRouter>{workbench ? <InspectorProvider>{ui}</InspectorProvider> : ui}</MemoryRouter>);
const press = (key) => act(() => fireEvent.keyDown(window, { key }));
// An accept is async (the page's PATCH): fire it inside act and let its promise
// settle there, rather than poll for the result under a loaded test run.
const pressAsync = (key, init = {}) =>
  act(async () => {
    fireEvent.keyDown(window, { key, ...init });
  });

describe("useReviewInbox", () => {
  it("j / k move a cursor through the rows as drawn", async () => {
    wrap(<Inbox onAccept={vi.fn()} onCategory={vi.fn()} />);
    press("j");
    expect(screen.getByText("> r1")).toBeTruthy();
    press("j");
    press("j");
    press("j"); // stops at the last row
    expect(screen.getByText("> r3")).toBeTruthy();
    press("k");
    expect(screen.getByText("> r2")).toBeTruthy();
  });

  it("a accepts the cursor row and moves to the next; a refused accept stays put", async () => {
    const onAccept = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    wrap(<Inbox onAccept={onAccept} onCategory={vi.fn()} />);
    press("j");
    await pressAsync("a");
    expect(onAccept).toHaveBeenCalledWith("r1", ROWS[0].entry);
    await waitFor(() => expect(screen.getByText("> r2")).toBeTruthy());
    await pressAsync("a"); // e.g. the no-offset warning was cancelled
    expect(onAccept).toHaveBeenLastCalledWith("r2", ROWS[1].entry);
    expect(screen.getByText("> r2")).toBeTruthy();
  });

  it("c opens the category for the cursor row; nothing without a cursor", () => {
    const onCategory = vi.fn();
    wrap(<Inbox onAccept={vi.fn()} onCategory={onCategory} />);
    press("c");
    expect(onCategory).not.toHaveBeenCalled();
    press("j");
    press("c");
    expect(onCategory).toHaveBeenCalledWith("r1", ROWS[0].entry);
  });

  it("/ focuses the search, which filters; letters typed there are not shortcuts", () => {
    const onAccept = vi.fn();
    wrap(<Inbox onAccept={onAccept} onCategory={vi.fn()} />);
    press("/");
    const box = screen.getByLabelText("search");
    expect(document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: "pko" } });
    expect(screen.queryByText("r1")).toBeNull();
    expect(screen.getByText("r3")).toBeTruthy();
    fireEvent.keyDown(box, { key: "a" });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("does nothing outside the Workbench layout", () => {
    const onAccept = vi.fn();
    wrap(<Inbox onAccept={onAccept} onCategory={vi.fn()} />, false);
    press("j");
    press("a");
    expect(screen.queryByText(/^> /)).toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe("inbox safety (the S5 review's must-fixes)", () => {
  it("no key acts on the rows while one of the app's own (Radix) dialogs is open", () => {
    const onAccept = vi.fn();
    wrap(
      <>
        <Inbox onAccept={onAccept} onCategory={vi.fn()} />
        <Modal open onClose={() => {}} title="No offset">
          <button>Accept anyway</button>
        </Modal>
      </>
    );
    press("j");
    press("a");
    expect(screen.queryByText(/^> /)).toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("a held-down a accepts one row, not the next ones as the key repeats", async () => {
    const onAccept = vi.fn().mockResolvedValue(true);
    wrap(<Inbox onAccept={onAccept} onCategory={vi.fn()} />);
    press("j");
    await pressAsync("a");
    await waitFor(() => expect(screen.getByText("> r2")).toBeTruthy());
    await pressAsync("a", { repeat: true });
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("a mistyped jump (g a) does not accept", () => {
    const onAccept = vi.fn();
    function Both() {
      useGoChords(WORKBENCH_SECTIONS, useNavigate());
      return <Inbox onAccept={onAccept} onCategory={vi.fn()} />;
    }
    wrap(<Both />);
    press("j");
    press("g");
    press("a");
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe("useGoChords", () => {
  function Nav() {
    useGoChords(WORKBENCH_SECTIONS, useNavigate());
    return null;
  }
  it("g then a section letter jumps there", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Nav />
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route path="/budget-vs-actual" element={<p>budget</p>} />
        </Routes>
      </MemoryRouter>
    );
    press("g");
    press("b");
    expect(screen.getByText("budget")).toBeTruthy();
  });
});
