import { describe, it, expect } from "vitest";
import { transferAppliesToYear, transferSpanLabel } from "../transferYear.js";

// The real row that exposed the bug: OCME Sp. z o.o., 100,000 PLN/yr invested from 2026 to
// 2030. It generated a Transfer entry in 2028 that the Review showed and the Modify
// Transfer modal denied existed.
const OCME = { Date: "2026-07-01", DateEnd: "2030-07-01", Amount: 100000, Flag: "Periodic" };
const ONE_TIME = { Date: "2028-12-31", Amount: 50000, Flag: "OneTime" };
const OPEN_ENDED = { Date: "2026-07-01", DateEnd: null, Amount: 1000, Flag: "Periodic" };

describe("transferAppliesToYear", () => {
  it("matches a periodic transfer in EVERY year of its range, not just the first", () => {
    // The bug: only 2026 was true, so 2027–2030 showed "no transfers for this year".
    for (const year of [2026, 2027, 2028, 2029, 2030]) {
      expect(transferAppliesToYear(OCME, year), `year ${year}`).toBe(true);
    }
  });

  it("excludes the years either side of a periodic range", () => {
    expect(transferAppliesToYear(OCME, 2025)).toBe(false);
    expect(transferAppliesToYear(OCME, 2031)).toBe(false);
  });

  it("runs an open-ended periodic transfer to the horizon", () => {
    // No DateEnd ⇒ the engine keeps expanding it; so must we.
    expect(transferAppliesToYear(OPEN_ENDED, 2026)).toBe(true);
    expect(transferAppliesToYear(OPEN_ENDED, 2099)).toBe(true);
    expect(transferAppliesToYear(OPEN_ENDED, 2025)).toBe(false);
  });

  it("confines a one-time transfer to its own year", () => {
    expect(transferAppliesToYear(ONE_TIME, 2028)).toBe(true);
    expect(transferAppliesToYear(ONE_TIME, 2027)).toBe(false);
    expect(transferAppliesToYear(ONE_TIME, 2029)).toBe(false);
  });

  it("ignores rows with no date", () => {
    expect(transferAppliesToYear({ Amount: 1, Flag: "OneTime" }, 2028)).toBe(false);
    expect(transferAppliesToYear(null, 2028)).toBe(false);
  });
});

describe("transferSpanLabel", () => {
  it("labels a periodic row with its range, so it cannot pass as a single-year transfer", () => {
    expect(transferSpanLabel(OCME)).toBe("2026–2030");
    expect(transferSpanLabel(OPEN_ENDED)).toBe("2026 onwards");
  });

  it("labels a one-time row with its year", () => {
    expect(transferSpanLabel(ONE_TIME)).toBe("2028");
  });
});
