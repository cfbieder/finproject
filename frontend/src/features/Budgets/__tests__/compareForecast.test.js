import { describe, expect, test } from "vitest";
import { delta, deltaPct } from "../compareForecast.js";

describe("compareForecast — CR102", () => {
  test("Δ is budget − forecast; unknown on either side is no difference", () => {
    expect(delta(-150, -100)).toBe(-50);
    expect(delta(300, 250)).toBe(50);
    expect(delta(null, 5)).toBeNull();
    expect(delta(5, null)).toBeNull();
  });

  test("Δ% is over |forecast|, so an expense over plan reads negative in both", () => {
    expect(deltaPct(-150, -100)).toBe(-50);
    expect(deltaPct(-80, -100)).toBe(20);
    expect(deltaPct(300, 250)).toBe(20);
  });

  test("no percentage against a zero or unknown forecast", () => {
    expect(deltaPct(100, 0)).toBeNull();
    expect(deltaPct(100, null)).toBeNull();
  });
});
