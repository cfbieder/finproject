import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FCReviewWarnings from "../FCReviewWarnings.jsx";

const renderPanel = (warnings) =>
  render(
    <MemoryRouter>
      <FCReviewWarnings warnings={warnings} />
    </MemoryRouter>
  );

describe("FCReviewWarnings", () => {
  it("states the all-clear explicitly rather than rendering nothing", () => {
    // An empty panel would read the same as a healthy one — the exact failure
    // that hid a $20M unfunded shortfall on this page (CR045 §1).
    renderPanel([]);
    expect(screen.getByText(/Cash stays funded across every forecast year/)).toBeTruthy();
  });

  it("renders each warning with its years and amount, and counts the blocking ones", () => {
    renderPanel([
      {
        id: "unfunded-shortfall",
        severity: "error",
        title: "Cash shortfall the forecast could not fund",
        detail: "The sweep ran out of assets to sell.",
        years: [2060, 2061, 2062],
        amount: -3350000,
      },
      {
        id: "sweep-source-exhausted",
        severity: "warning",
        title: "Sweep source fully drained",
        detail: "Fidelity Fixed Income (priority 1) is drained to zero by 2060.",
        years: [2060],
        amount: null,
      },
    ]);

    expect(screen.getByText(/2 issues/)).toBeTruthy();
    expect(screen.getByText("1 blocking")).toBeTruthy();
    expect(screen.getByText("2060, 2061, 2062")).toBeTruthy();
    expect(screen.getByText("($3.4M)")).toBeTruthy();
    expect(screen.getByText("Sweep source fully drained")).toBeTruthy();
  });

  it("links a missing sweep module straight to the page that fixes it", () => {
    renderPanel([
      {
        id: "no-sweep-module",
        severity: "error",
        title: "No cash-sweep module configured",
        detail: "No module in this scenario has sweep priority 1.",
        years: [],
        amount: null,
      },
    ]);

    const link = screen.getByRole("link", { name: /Set a sweep priority/ });
    expect(link.getAttribute("href")).toBe("/forecast-modules");
  });
});
