import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The launcher renders each card's icon component. It is only ever referenced
// from JSX, and `eslint-plugin-react` is deliberately not installed, so
// `no-undef` never sees a JSX component name — dropping the `icon: Icon` binder
// from the map destructure (commit ba4ef7f) left `<Icon />` undefined and
// crashed the whole mobile home page while every other /m page kept working.
// Lint cannot catch that class; rendering the page can.
vi.mock("../../hooks/useOverview.js", async (importOriginal) => ({
  ...(await importOriginal()),
  useOverview: () => ({
    data: { netWorth: 108500, delta: 1500, income: 4000, expense: -2500, net: 1500 },
    isLoading: false,
    failed: false,
  }),
}));

const { default: MobileHome } = await import("../MobileHome.jsx");

describe("MobileHome", () => {
  it("renders the overview KPIs and every launcher card with its icon", () => {
    const { container } = render(
      <MemoryRouter>
        <MobileHome />
      </MemoryRouter>
    );

    expect(screen.getByText("Net Worth")).toBeTruthy();
    expect(screen.getByText("$108,500")).toBeTruthy();

    // Every card is present and links where it says it does.
    expect(container.querySelectorAll(".m-launcher__card")).toHaveLength(9);
    expect(screen.getByText("Reconcile").closest("a").getAttribute("href")).toBe(
      "/m/reconcile"
    );
    expect(
      screen.getByText("Transactions").closest("a").getAttribute("href")
    ).toBe("/m/transactions");

    // The icons themselves must render — an undefined component throws before this.
    expect(container.querySelectorAll(".m-launcher__icon svg")).toHaveLength(9);
  });
});
