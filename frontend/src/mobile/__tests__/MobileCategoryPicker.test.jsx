import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import MobileCategoryPicker, {
  pushRecentCategory,
} from "../MobileCategoryPicker.jsx";

/**
 * Gate for the CR068 P1 generalization.
 *
 * MobileCategoryPicker is about to become a thin single-select wrapper over the
 * new multi-select MobilePickerSheet. It had no test, and MobileRefreshFeeds —
 * the weekly review loop — depends on every behaviour asserted here. These
 * assertions were written against the ORIGINAL component and must keep passing
 * against the wrapper unchanged.
 */
const PL_TREE = [
  {
    name: "Income",
    children: [{ name: "Salary" }, { name: "Rental - Spain" }],
  },
  {
    name: "Expense",
    children: [
      { name: "Groceries" },
      { name: "Transfers", children: [{ name: "Internal Transfer" }] },
    ],
  },
];

describe("MobileCategoryPicker", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // vitest runs with `globals: false`, so testing-library never sees a global
  // afterEach to hook its auto-cleanup onto. Without this every render stays in
  // the document and the second one makes each query ambiguous.
  afterEach(cleanup);

  it("renders nothing when closed", () => {
    const { container } = render(
      <MobileCategoryPicker open={false} plTree={PL_TREE} />
    );
    expect(container.querySelector(".m-picker")).toBeNull();
  });

  it("groups leaves under their top-level parent, flattening nested branches", () => {
    render(<MobileCategoryPicker open plTree={PL_TREE} />);

    const headers = [...document.querySelectorAll(".m-picker__group-h")].map(
      (el) => el.textContent
    );
    expect(headers).toContain("Income");
    expect(headers).toContain("Expense");

    // "Internal Transfer" is two levels deep under Expense — it must surface as
    // an Expense leaf, not disappear and not become its own group.
    expect(screen.getByText("Internal Transfer")).toBeTruthy();
    expect(headers).not.toContain("Transfers");
  });

  it("filters the list as you search", () => {
    render(<MobileCategoryPicker open plTree={PL_TREE} />);

    fireEvent.change(screen.getByPlaceholderText("Search categories…"), {
      target: { value: "groc" },
    });

    expect(screen.getByText("Groceries")).toBeTruthy();
    expect(screen.queryByText("Salary")).toBeNull();
  });

  it("shows an empty state when nothing matches", () => {
    render(<MobileCategoryPicker open plTree={PL_TREE} />);

    fireEvent.change(screen.getByPlaceholderText("Search categories…"), {
      target: { value: "zzzz" },
    });

    expect(screen.getByText("No matching categories")).toBeTruthy();
  });

  it("calls onSelect with the leaf name when an item is tapped", () => {
    const onSelect = vi.fn();
    render(<MobileCategoryPicker open plTree={PL_TREE} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("Groceries"));

    expect(onSelect).toHaveBeenCalledWith("Groceries");
  });

  it("marks the current category", () => {
    render(<MobileCategoryPicker open plTree={PL_TREE} currentCategory="Salary" />);

    expect(
      screen.getByText("Salary").classList.contains("m-picker__item--current")
    ).toBe(true);
  });

  it("surfaces recents in their own section, most recent first", () => {
    pushRecentCategory("Groceries");
    pushRecentCategory("Salary");

    render(<MobileCategoryPicker open plTree={PL_TREE} />);

    const headers = [...document.querySelectorAll(".m-picker__group-h")].map(
      (el) => el.textContent
    );
    expect(headers[0]).toBe("Recent");

    const recentItems = [
      ...document.querySelectorAll(".m-picker__item"),
    ].slice(0, 2);
    expect(recentItems.map((el) => el.textContent)).toEqual([
      "Salary",
      "Groceries",
    ]);
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(<MobileCategoryPicker open plTree={PL_TREE} onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("Close"));

    expect(onClose).toHaveBeenCalled();
  });

  it("survives an absent or malformed tree", () => {
    const { container } = render(<MobileCategoryPicker open plTree={null} />);
    expect(container.querySelector(".m-picker")).not.toBeNull();
    expect(screen.getByText("No matching categories")).toBeTruthy();
  });
});
