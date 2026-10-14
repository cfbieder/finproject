import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import NetWorthHero from "./NetWorthHero.jsx";

/**
 * The desktop headline is hidden until asked for (owner, 2026-10-14 — the
 * mobile Home rule, because the browser is opened in public too). The chart
 * hides with it: its y-axis gives the magnitude away.
 */

const series = [
  { month: "2025-11", date: "2025-11-30", netWorth: 16513196 },
  { month: "2026-10", date: "2026-10-14", netWorth: 13923456 },
];

afterEach(cleanup);

describe("NetWorthHero", () => {
  it("opens with the figure, delta and chart hidden, and reveals them on click", () => {
    const { container } = render(
      <NetWorthHero series={series} current={13923456} delta={-2589740} />
    );

    expect(screen.queryByText("$13,923,456")).toBeNull();
    expect(screen.queryByText("$2,589,740")).toBeNull();
    expect(screen.queryByText("What changed?")).toBeNull();
    expect(container.querySelector(".nw-hero__chart")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show net worth" }));

    expect(screen.getByText("$13,923,456")).toBeTruthy();
    expect(screen.getByText("$2,589,740")).toBeTruthy();
    expect(container.querySelector(".nw-hero__chart")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hide net worth" }));
    expect(screen.queryByText("$13,923,456")).toBeNull();
  });
});
