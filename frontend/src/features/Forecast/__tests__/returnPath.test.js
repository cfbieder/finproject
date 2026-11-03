import { describe, expect, test } from "vitest";
import { buildModulePayload } from "../utils/fcModulePayload.js";
import { computeModuleIntegrityWarnings } from "../utils/fcWarnings.js";
import { fieldLabel, formatSchedule, isScheduleField } from "../fcFieldLabels.js";

// CR099 — a module's per-year return path, on the client: what is sent, what the variant panel
// prints, and when the owner is told a row does nothing.

describe("buildModulePayload — Returns", () => {
  const form = (over = {}) => ({ Name: "Stocks", HasValuation: true, Returns: [], ...over });

  test("sent sorted by year, as numbers, on the save AND the preview payload", () => {
    const rows = [{ Year: "2028", Pct: "15" }, { Year: 2027, Pct: -50 }];
    const expected = [{ Year: 2027, Pct: -50 }, { Year: 2028, Pct: 15 }];
    expect(buildModulePayload(form({ Returns: rows }), { normalizeTransfers: (x) => x || [] }).Returns).toEqual(expected);
    // The save-time preview builds the payload WITHOUT normalizeTransfers; it must still carry
    // the path, or a path edit previews as "no change".
    expect(buildModulePayload(form({ Returns: rows })).Returns).toEqual(expected);
  });

  test("a blank return is sent as null, so the save is refused rather than the row dropped; a loan or a flow module sends none", () => {
    expect(buildModulePayload(form({ Returns: [{ Year: 2027, Pct: "" }] })).Returns).toEqual([{ Year: 2027, Pct: null }]);
    expect(buildModulePayload(form({ HasValuation: false, Returns: [{ Year: 2027, Pct: -50 }] })).Returns).toEqual([]);
    expect(buildModulePayload(form({ LoanInterestRate: 5, Returns: [{ Year: 2027, Pct: -50 }] })).Returns).toEqual([]);
  });
});

describe("the variant panel prints a return path", () => {
  test("named, and shown as years and percents rather than a count", () => {
    expect(fieldLabel("module", "returns")).toBe("Return path");
    expect(isScheduleField("returns")).toBe(true);
    expect(formatSchedule("returns", [{ year: 2027, pct: -50 }, { year: 2028, pct: 15 }])).toBe("2027: -50%, 2028: 15%");
  });

  test("amortization, the ride-along, likewise", () => {
    expect(fieldLabel("module", "amortization")).toBe("Amortization schedule");
    expect(formatSchedule("amortization", [{ effective_date: "2028-07-01", pct: 11.1111 }])).toMatch(/^2028: 11\.11.*%$/);
  });
});

describe("computeModuleIntegrityWarnings — return-path rows that do nothing", () => {
  const mod = (over = {}) => ({
    Name: "Stocks", HasValuation: true, BaseDate: "2025-12-31", Streams: [], Returns: [], ...over,
  });
  const ids = (mods) => computeModuleIntegrityWarnings(mods, { periodStart: 2027 }).map((w) => w.id);

  test("silent when every row is after the base year", () => {
    expect(ids([mod({ Returns: [{ Year: 2027, Pct: -50 }] })])).not.toContain("return-path-ignored-Stocks");
  });

  test("names a row on or before the base year", () => {
    const [w] = computeModuleIntegrityWarnings([mod({ Returns: [{ Year: 2025, Pct: -50 }, { Year: 2027, Pct: 5 }] })], { periodStart: 2027 })
      .filter((x) => x.id === "return-path-ignored-Stocks");
    expect(w.years).toEqual([2025]);
  });

  test("names a row past the plan's end, and one after the module is sold in full", () => {
    const w = computeModuleIntegrityWarnings(
      [mod({ DisposeFullFirstYear: 2030, Returns: [{ Year: 2029, Pct: 5 }, { Year: 2031, Pct: 5 }, { Year: 2070, Pct: 5 }] })],
      { periodStart: 2027, periodEnd: 2062 },
    ).find((x) => x.id === "return-path-ignored-Stocks");
    expect(w.years).toEqual([2031, 2070]);
    expect(w.detail).toMatch(/2031 is after the module is sold in full \(2030\)/);
    expect(w.detail).toMatch(/2070 is after the plan ends \(2062\)/);
  });

  test("names every row on a loan or a flow module", () => {
    expect(ids([mod({ LoanInterestRate: 5, Returns: [{ Year: 2027, Pct: -50 }] })])).toContain("return-path-ignored-Stocks");
    expect(ids([mod({ HasValuation: false, Returns: [{ Year: 2027, Pct: -50 }] })])).toContain("return-path-ignored-Stocks");
  });

  test("the disposal wording does not claim a gain or a loss from Growth alone on a pathed module", () => {
    const sold = mod({ BaseValue: 100, MarketValue: 100, GrowthRate: 1, DisposeFullCount: 1, DisposeCount: 1, Returns: [{ Year: 2027, Pct: -50 }] });
    const w = computeModuleIntegrityWarnings([sold], { periodStart: 2027 }).find((x) => x.id === "disposal-no-gain-Stocks");
    expect(w.title).toMatch(/cost basis typed from its base-date value/);
    expect(w.detail).not.toMatch(/understating the gain/);
  });
});
