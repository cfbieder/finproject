import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import Rest from "../../js/rest.js";
import { useCoa } from "../useCoa.js";

/**
 * useCoa (CR043 Phase 3.1) — verifies the TanStack Query migration keeps the
 * exact fetch → normalize → derive contract the 15 consumers rely on.
 */

const PL = [
  {
    name: "Profit & Loss Accounts",
    children: [
      {
        name: "Income",
        children: [
          {
            name: "Financial Income",
            children: [{ name: "Dividends" }, { name: "Interest" }],
          },
        ],
      },
      {
        name: "Expense",
        children: [
          { name: "Financial Expenses", children: [{ name: "Bank Fees" }] },
          { name: "Property - Other", children: [{ name: "Repairs" }] },
        ],
      },
    ],
  },
];

const BS = [
  {
    name: "Balance Sheet Accounts",
    children: [
      {
        name: "Assets",
        children: [
          { name: "Bank Accounts", children: [] },
          { name: "Real Estate", children: [{ name: "House" }] },
        ],
      },
    ],
  },
];

const TRAITS = {
  House: { Type: "Asset", Currency: "USD" },
  Konto: { Type: "Asset", Currency: "PLN" },
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCoa (TanStack Query)", () => {
  beforeEach(() => {
    vi.spyOn(Rest, "fetchAccountTraitsV2").mockResolvedValue(TRAITS);
    vi.spyOn(Rest, "fetchAccountTreeV2").mockImplementation(({ section }) =>
      Promise.resolve(section === "profit_loss" ? PL : BS)
    );
  });

  it("starts loading, then unwraps section roots and derives options", async () => {
    const { result } = renderHook(() => useCoa(), { wrapper: makeWrapper() });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("");

    // section roots unwrapped to their children
    expect(result.current.plTree.map((n) => n.name)).toEqual([
      "Income",
      "Expense",
    ]);
    expect(result.current.bsTree.map((n) => n.name)).toEqual(["Assets"]);

    // derived selectors
    expect(result.current.incomeCategoryOptions).toEqual([
      "Dividends",
      "Interest",
    ]);
    expect(result.current.expenseCategoryOptions).toEqual(
      expect.arrayContaining(["Bank Fees", "Repairs", "Tax Reserve"])
    );
    expect(result.current.bsLevel2Options).toEqual(["Real Estate"]); // excludes Bank Accounts
    expect(result.current.getChildCategoriesForAccount("Real Estate")).toEqual([
      "House",
    ]);
    expect(result.current.accountCurrencyMap.get("Konto")).toBe("PLN");
    expect(result.current.currencyOptions).toEqual(
      expect.arrayContaining(["PLN", "USD"])
    );
  });

  it("dedupes: two mounts sharing a client trigger the fetch set once", async () => {
    const wrapper = makeWrapper();
    const a = renderHook(() => useCoa(), { wrapper });
    const b = renderHook(() => useCoa(), { wrapper });
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    // one shared query → traits fetched once despite two consumers
    expect(Rest.fetchAccountTraitsV2).toHaveBeenCalledTimes(1);
  });
});
