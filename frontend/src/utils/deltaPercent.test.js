import { describe, it, expect } from "vitest";
import { deltaPercent } from "./deltaPercent.js";

describe("deltaPercent", () => {
  it("gives the change as a share of the base, not of the current value", () => {
    // base 100 → current 110: +10% of the base (not 9.1% of 110)
    expect(deltaPercent(110, 10)).toBe("10%");
    expect(deltaPercent(780, 32)).toBe("4.3%");
  });

  it("is a magnitude — the chip's arrow carries the direction", () => {
    expect(deltaPercent(90, -10)).toBe("10%");
  });

  it("works on a negative base that stays negative (an expense line)", () => {
    // −1,000 budget → −1,200 actual: 20% more spent
    expect(deltaPercent(-1200, -200)).toBe("20%");
  });

  it("is withheld when the base is zero or the value crosses zero", () => {
    expect(deltaPercent(500, 500)).toBeNull(); // base 0
    expect(deltaPercent(5000, 7000)).toBeNull(); // −2,000 → +5,000
    expect(deltaPercent(-100, -300)).toBeNull(); // +200 → −100
    expect(deltaPercent(0, -50)).toBeNull(); // lands on zero
  });

  it("is withheld for a missing figure or a change too small to show", () => {
    expect(deltaPercent(null, 10)).toBeNull();
    expect(deltaPercent(100, undefined)).toBeNull();
    expect(deltaPercent(1_000_000, 1)).toBeNull();
  });

  it("keeps one decimal below 10% and none from 10%, judged after rounding", () => {
    expect(deltaPercent(109.96, 9.96)).toBe("10%"); // 9.96% rounds to 10.0 → "10%"
    expect(deltaPercent(109.94, 9.94)).toBe("9.9%");
  });
});
