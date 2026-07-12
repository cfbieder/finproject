import { describe, it, expect } from "vitest";
import {
  computeForecastWarnings,
  formatMoney,
  formatYearList,
} from "../fcWarnings.js";

const YEARS = [2025, 2026, 2027];

/** A healthy scenario: one ranked module, cash comfortably above the band. */
function healthy(overrides = {}) {
  return {
    years: YEARS,
    bankBalanceByYear: [400000, 410000, 420000],
    entries: [
      { Year: 2025, Account: "Fidelity Fixed Income", Amount: 1000000, Module: "FI" },
      { Year: 2026, Account: "Fidelity Fixed Income", Amount: 1050000, Module: "FI" },
      { Year: 2027, Account: "Fidelity Fixed Income", Amount: 1100000, Module: "FI" },
    ],
    modules: [
      { Name: "Fidelity Fixed Income", Account: "Fidelity Fixed Income", CashSweepPriority: 1 },
    ],
    cashSweepLow: 300000,
    ...overrides,
  };
}

const ids = (ws) => ws.map((w) => w.id);

describe("computeForecastWarnings", () => {
  it("returns nothing for a healthy scenario", () => {
    expect(computeForecastWarnings(healthy())).toEqual([]);
  });

  it("returns nothing when there are no years (nothing generated yet)", () => {
    expect(computeForecastWarnings({ ...healthy(), years: [] })).toEqual([]);
  });

  it("flags a scenario with no priority-1 module (the CR045 copy bug)", () => {
    const ws = computeForecastWarnings(
      healthy({
        modules: [
          { Name: "Fidelity Fixed Income", Account: "Fidelity Fixed Income", CashSweepPriority: null },
          { Name: "Fidelity Stocks", Account: "Fidelity Stock", CashSweepPriority: "" },
        ],
      })
    );
    expect(ids(ws)).toContain("no-sweep-module");
    expect(ws[0].severity).toBe("error");
  });

  it("does not flag a missing primary when a backup exists but no rank 1", () => {
    // Rank 2 without a rank 1 is still 'no primary' — the sweep has no deposit target.
    const ws = computeForecastWarnings(
      healthy({
        modules: [{ Name: "Stocks", Account: "Fidelity Stock", CashSweepPriority: 2 }],
      })
    );
    expect(ids(ws)).toContain("no-sweep-module");
  });

  it("stays quiet on a scenario with no modules at all", () => {
    const ws = computeForecastWarnings(healthy({ modules: [] }));
    expect(ids(ws)).not.toContain("no-sweep-module");
  });

  it("aggregates unfunded Cash Shortfall entries by year", () => {
    const ws = computeForecastWarnings(
      healthy({
        entries: [
          ...healthy().entries,
          { Year: 2026, Account: "Cash Shortfall", Amount: -100000, Module: "_cash_sweep" },
          { Year: 2027, Account: "Cash Shortfall", Amount: -250000, Module: "_cash_sweep" },
        ],
      })
    );
    const w = ws.find((x) => x.id === "unfunded-shortfall");
    expect(w.severity).toBe("error");
    expect(w.years).toEqual([2026, 2027]);
    expect(w.amount).toBe(-350000);
  });

  it("flags years where the bank balance goes negative, reporting the worst", () => {
    const ws = computeForecastWarnings(
      healthy({ bankBalanceByYear: [400000, -50000, -900000] })
    );
    const w = ws.find((x) => x.id === "negative-cash");
    expect(w.years).toEqual([2026, 2027]);
    expect(w.amount).toBe(-900000);
  });

  it("flags cash below the low band but not years already reported as negative", () => {
    const ws = computeForecastWarnings(
      healthy({ bankBalanceByYear: [400000, 250000, -10000] })
    );
    const below = ws.find((x) => x.id === "below-low-band");
    expect(below.severity).toBe("warning");
    expect(below.years).toEqual([2026]); // 2027 is negative-cash, not double-reported
  });

  it("skips the low-band check when the band is unknown", () => {
    const ws = computeForecastWarnings(
      healthy({ bankBalanceByYear: [400000, 250000, 260000], cashSweepLow: null })
    );
    expect(ids(ws)).not.toContain("below-low-band");
  });

  it("flags a ranked module drained to zero", () => {
    const ws = computeForecastWarnings(
      healthy({
        entries: [
          { Year: 2025, Account: "Fidelity Fixed Income", Amount: 1000000 },
          { Year: 2026, Account: "Fidelity Fixed Income", Amount: 500000 },
          { Year: 2027, Account: "Fidelity Fixed Income", Amount: 0 },
        ],
      })
    );
    const w = ws.find((x) => x.id === "sweep-source-exhausted");
    expect(w.years).toEqual([2027]);
    expect(w.detail).toContain("Fidelity Fixed Income (priority 1) is drained to zero by 2027");
  });

  it("does not call a module exhausted if it was never funded", () => {
    const ws = computeForecastWarnings(
      healthy({
        entries: [
          { Year: 2025, Account: "Fidelity Fixed Income", Amount: 0 },
          { Year: 2026, Account: "Fidelity Fixed Income", Amount: 0 },
        ],
      })
    );
    expect(ids(ws)).not.toContain("sweep-source-exhausted");
  });

  it("nets sweep withdrawals against the module's market value (the -$2,454 artifact)", () => {
    // Mirrors prod: the builder still books MV, the sweep books a bigger withdrawal.
    const ws = computeForecastWarnings(
      healthy({
        modules: [{ Name: "Fidelity Stocks", Account: "Fidelity Stock", CashSweepPriority: 1 }],
        entries: [
          { Year: 2025, Account: "Fidelity Stock", Amount: 1369072, Module: "Fidelity Stocks" },
          { Year: 2026, Account: "Fidelity Stock", Amount: 1237933, Module: "Fidelity Stocks" },
          { Year: 2026, Account: "Fidelity Stock", Amount: -1240387, Module: "_sweep_bal" },
        ],
      })
    );
    const w = ws.find((x) => x.id === "module-over-drained");
    expect(w.severity).toBe("warning");
    expect(w.years).toEqual([2026]);
    expect(Math.round(w.amount)).toBe(-2454);
  });

  it("reproduces the prod '2026 with House Purchase' shape: errors first, all three", () => {
    const ws = computeForecastWarnings(
      healthy({
        modules: [
          { Name: "Fidelity Fixed Income", Account: "Fidelity Fixed Income", CashSweepPriority: null },
          { Name: "Fidelity Stocks", Account: "Fidelity Stock", CashSweepPriority: null },
        ],
        bankBalanceByYear: [400000, -535123, -3743004],
        entries: [
          { Year: 2026, Account: "Cash Shortfall", Amount: -935123, Module: "_cash_sweep" },
          { Year: 2027, Account: "Cash Shortfall", Amount: -3207881, Module: "_cash_sweep" },
        ],
      })
    );
    expect(ids(ws)).toEqual(["no-sweep-module", "unfunded-shortfall", "negative-cash"]);
    expect(ws.every((w) => w.severity === "error")).toBe(true);
  });
});

describe("formatMoney", () => {
  it("renders millions, thousands and units, negatives in parens", () => {
    expect(formatMoney(-3350000)).toBe("($3.4M)");
    expect(formatMoney(300000)).toBe("$300K");
    expect(formatMoney(-2454)).toBe("($2K)");
    expect(formatMoney(950)).toBe("$950");
  });

  it("renders a dash for non-numbers", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
  });
});

describe("formatYearList", () => {
  it("lists short runs and collapses long ones", () => {
    expect(formatYearList([2027, 2026])).toBe("2026, 2027");
    expect(formatYearList([2029, 2030, 2031, 2032, 2033])).toBe("2029–2033 (5 years)");
    expect(formatYearList([])).toBe("");
  });
});
