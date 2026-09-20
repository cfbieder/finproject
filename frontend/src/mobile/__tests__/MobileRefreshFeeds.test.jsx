import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";

/**
 * The mobile Refresh Feeds review queue.
 *
 * The load-bearing claims are that the phone drives the SAME endpoints as the
 * desktop page (so the two cannot disagree about what "categorized" or
 * "accepted" means), and that CR065's unpaired-leg warning is on every accept
 * path here too — a phone must not be the cheap way past a warning the desktop
 * makes.
 */

const REVIEW_ROWS = [
  {
    id: 1,
    transaction_date: "2026-09-19",
    description1: "SUMA VIRTUAL",
    amount: "-370.14",
    currency: "EUR",
    account_name: "Caixa EUR",
    category_name: "",
    needs_offset: false,
  },
  {
    id: 2,
    transaction_date: "2026-09-18",
    description1: "YOU BOUGHT OPENING",
    amount: "-388.99",
    currency: "USD",
    account_name: "Fidelity Options",
    category_name: "Option Trade",
    needs_offset: true,
  },
  {
    id: 3,
    transaction_date: "2026-09-17",
    description1: "MERCADONA",
    amount: "-40.21",
    currency: "EUR",
    account_name: "Caixa EUR",
    category_name: "",
    needs_offset: false,
  },
];

// 14 filler rows push the queue past PENDING_PREVIEW_COUNT (15), so the
// preview cap and the grouped counts are exercised on real quantities.
const FILLER = Array.from({ length: 14 }, (_, i) => ({
  id: 100 + i,
  transaction_date: "2026-09-10",
  description1: `FILLER ${i}`,
  amount: "-5.00",
  currency: "USD",
  account_name: "Wise USD",
  category_name: "Groceries",
  needs_offset: false,
}));
const ALL_ROWS = [...REVIEW_ROWS, ...FILLER];

let suggestions = [];

vi.mock("../../hooks/useCoa.js", () => ({
  useCoa: () => ({
    plTree: [
      { name: "Income", children: [{ name: "Salary" }] },
      { name: "Expense", children: [{ name: "Groceries" }] },
    ],
    bsTree: [],
  }),
}));

const fetchJson = vi.fn(async (url) => {
  if (url.includes("review-new-transactions")) return { data: ALL_ROWS };
  if (url.includes("category-suggestions")) return { data: suggestions };
  if (url.includes("appdata")) return [];
  return {};
});

vi.mock("../../js/rest.js", () => ({
  default: {
    fetchJson: (...args) => fetchJson(...args),
    buildUrl: (path) => `http://test${path}`,
  },
}));

const { default: MobileRefreshFeeds } = await import(
  "../pages/MobileRefreshFeeds.jsx"
);

/** Every PATCH the page issued, as { id, body }. */
const patches = () =>
  globalThis.fetch.mock.calls
    .filter(([, init]) => init?.method === "PATCH")
    .map(([url, init]) => ({
      id: Number(url.split("/").pop()),
      body: JSON.parse(init.body),
    }));

const rowCard = (text) =>
  screen.getByText(text).closest(".m-tx");

describe("MobileRefreshFeeds — review queue", () => {
  beforeEach(() => {
    suggestions = [];
    fetchJson.mockClear();
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    window.localStorage.clear();
  });

  afterEach(cleanup);

  it("lists the queue with its count, account and category", async () => {
    render(<MobileRefreshFeeds />);

    expect(await screen.findByText("SUMA VIRTUAL")).toBeTruthy();
    expect(screen.getByText("17")).toBeTruthy(); // section count
    expect(screen.getAllByText(/Caixa EUR/).length).toBe(2);
    expect(screen.getByText("Option Trade")).toBeTruthy();
    // Uncategorized rows say so on a tappable pill, not with an em-dash.
    expect(screen.getAllByText("Set category").length).toBe(2);
  });

  it("badges a securities-trade leg that has no offsetting entry", async () => {
    render(<MobileRefreshFeeds />);
    await screen.findByText("YOU BOUGHT OPENING");

    const badge = document.querySelector(".m-tx__flag");
    expect(badge.textContent).toBe("no offset");
    // The badge must sit in the meta line: .m-tx__desc is nowrap + ellipsis,
    // so a badge inside it is clipped away on long descriptions.
    expect(badge.closest(".m-tx__meta")).toBeTruthy();
  });

  it("groups rows under their account when Group is tapped", async () => {
    render(<MobileRefreshFeeds />);
    await screen.findByText("SUMA VIRTUAL");

    fireEvent.click(screen.getByText("Group"));

    const headers = [...document.querySelectorAll(".m-tx-section-h")].map(
      (el) => el.textContent
    );
    expect(headers).toContain("Caixa EUR2"); // name + count badge
    expect(headers).toContain("Fidelity Options1");
    expect(screen.getByText("Grouped")).toBeTruthy();
  });

  it("caps the flat list at a preview, and groups the WHOLE queue", async () => {
    render(<MobileRefreshFeeds />);
    await screen.findByText("SUMA VIRTUAL");

    // Flat: 15 of 17, with the rest behind "Show all".
    expect(document.querySelectorAll(".m-tx").length).toBe(15);
    expect(screen.getByText("Show all 17")).toBeTruthy();

    // Grouped: every row, and a group count that matches what is under it —
    // grouping the 15-row preview would render "Wise USD 12" over 12 of 14.
    fireEvent.click(screen.getByText("Group"));
    expect(document.querySelectorAll(".m-tx").length).toBe(17);
    const headers = [...document.querySelectorAll(".m-tx-section-h")].map(
      (el) => el.textContent
    );
    expect(headers).toContain("Wise USD14");
    expect(screen.queryByText("Show all 17")).toBeNull();
  });

  it("suggests categories for the uncategorized rows only, and applies them", async () => {
    suggestions = [
      { id: 1, category_id: 40, category_name: "Groceries" },
      { id: 3, category_id: 40, category_name: "Groceries" },
    ];
    render(<MobileRefreshFeeds />);
    await screen.findByText("SUMA VIRTUAL");

    fireEvent.click(screen.getByText("Suggest"));

    await waitFor(() => expect(patches().length).toBe(2));
    const call = fetchJson.mock.calls.find(([url]) =>
      url.includes("category-suggestions")
    );
    // Row 2 already has a category, so it is not re-asked.
    expect(JSON.parse(call[1].body)).toEqual({ ids: [1, 3] });
    expect(patches()).toEqual([
      { id: 1, body: { Category: "Groceries" } },
      { id: 3, body: { Category: "Groceries" } },
    ]);
  });

  it("sets one row's category through the picker", async () => {
    render(<MobileRefreshFeeds />);
    await screen.findByText("SUMA VIRTUAL");

    fireEvent.click(
      rowCard("SUMA VIRTUAL").querySelector(".m-tx__cat")
    );
    // Scope to the picker: "Groceries" is also a row's category pill.
    const picker = document.querySelector(".m-picker");
    fireEvent.click(within(picker).getByText("Groceries"));

    await waitFor(() =>
      expect(patches()).toEqual([{ id: 1, body: { Category: "Groceries" } }])
    );
    expect(await screen.findByText("Category set to Groceries")).toBeTruthy();
  });

  it("accepts a paired row without asking", async () => {
    render(<MobileRefreshFeeds />);
    await screen.findByText("SUMA VIRTUAL");

    fireEvent.click(
      rowCard("SUMA VIRTUAL").querySelector(".m-tx__action")
    );

    await waitFor(() =>
      expect(patches()).toEqual([{ id: 1, body: { accepted: true } }])
    );
  });

  it("CR065: warns before accepting an unpaired leg, and writes nothing if cancelled", async () => {
    render(<MobileRefreshFeeds />);
    await screen.findByText("YOU BOUGHT OPENING");

    fireEvent.click(
      rowCard("YOU BOUGHT OPENING").querySelector(".m-tx__action")
    );

    expect(
      await screen.findByText("Accept without the offsetting leg?")
    ).toBeTruthy();
    expect(patches()).toEqual([]);

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() =>
      expect(screen.queryByText("Accept without the offsetting leg?")).toBeNull()
    );
    expect(patches()).toEqual([]);
  });

  it("CR065: the same warning gates Accept all, and proceeding writes every row", async () => {
    render(<MobileRefreshFeeds />);
    await screen.findByText("SUMA VIRTUAL");

    fireEvent.click(screen.getByText("Accept all (17)"));

    expect(
      await screen.findByText("Accept without the offsetting leg?")
    ).toBeTruthy();
    expect(patches()).toEqual([]);

    fireEvent.click(screen.getByText("Accept anyway"));

    await waitFor(() => expect(patches().length).toBe(17));
    expect(patches().every((p) => p.body.accepted === true)).toBe(true);
  });
});
