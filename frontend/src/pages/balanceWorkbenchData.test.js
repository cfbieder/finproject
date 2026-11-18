import { describe, it, expect } from "vitest";
import { trailingDates, valuesByPath } from "./balanceWorkbenchData.js";

describe("trailingDates (CR105 S3)", () => {
  it("gives 12 month-ends ending at a past header month, across a year boundary", () => {
    const d = trailingDates(2025, 3);
    expect(d).toHaveLength(12);
    expect(d[0]).toBe("2024-04-30");
    expect(d[10]).toBe("2025-02-28");
    expect(d[11]).toBe("2025-03-31");
  });

  it("with 13 points spans a true year: the same month a year earlier to the header month", () => {
    const d = trailingDates(2025, 3, 13);
    expect(d[0]).toBe("2024-03-31");
    expect(d[12]).toBe("2025-03-31");
  });
});

describe("valuesByPath", () => {
  it("keys every node by its name path, so same-named leaves in different groups stay apart", () => {
    const m = valuesByPath([
      { name: "Assets", totalUSD: 30, children: [
        { name: "Bank", totalUSD: 10, children: [{ name: "Main", totalUSD: 10 }] },
        { name: "Brokerage", totalUSD: 20, children: [{ name: "Main", totalUSD: 20 }] },
      ] },
    ]);
    expect(m.get("Assets / Bank / Main")).toBe(10);
    expect(m.get("Assets / Brokerage / Main")).toBe(20);
    expect(m.get("Assets")).toBe(30);
  });
});
