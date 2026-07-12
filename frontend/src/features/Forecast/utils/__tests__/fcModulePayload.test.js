import { describe, it, expect } from "vitest";
import { buildModulePayload } from "../fcModulePayload.js";
import { FIELD_SECTIONS } from "../../fcModulesEditSections.js";

describe("buildModulePayload", () => {
  // THE test. The payload is a whitelist, so a field the editor renders but the builder
  // omits is silently dropped on save: the user types a value, gets no error, and finds the
  // field empty when they come back. CR046's window dates and CR047's income tax override
  // both shipped that way — wired through the editor, the API, the engine and the copy
  // path, and thrown away here.
  it("carries every field the editor renders — no field can be silently dropped on save", () => {
    const rendered = FIELD_SECTIONS.flatMap(([, fields]) => fields.map(([, field]) => field));
    const payload = buildModulePayload({});

    const dropped = rendered.filter((field) => !(field in payload));
    expect(dropped).toEqual([]);
  });

  it("keeps a blank window date as null, and a picked year as its stored date", () => {
    const blank = buildModulePayload({});
    expect(blank.IncomeStartDate).toBeNull();
    expect(blank.ExpenseEndDate).toBeNull();

    const set = buildModulePayload({
      IncomeStartDate: "2030-07-01",
      ExpenseEndDate: "2040-07-01",
    });
    expect(set.IncomeStartDate).toBe("2030-07-01");
    expect(set.ExpenseEndDate).toBe("2040-07-01");
  });

  it("sends a 0% income tax override as 0, not as null", () => {
    // 0 is a real rate (income taxed at nothing), not 'unset' — the engine relies on that.
    expect(buildModulePayload({ IncomeTaxRateOverride: 0 }).IncomeTaxRateOverride).toBe(0);
    expect(buildModulePayload({ IncomeTaxRateOverride: "3" }).IncomeTaxRateOverride).toBe(3);
    expect(buildModulePayload({ IncomeTaxRateOverride: "" }).IncomeTaxRateOverride).toBeNull();
    expect(buildModulePayload({}).IncomeTaxRateOverride).toBeNull();
  });

  it("normalizes a cleared sweep priority to null and a set one to at least 1", () => {
    expect(buildModulePayload({ CashSweepPriority: "" }).CashSweepPriority).toBeNull();
    expect(buildModulePayload({ CashSweepPriority: "2" }).CashSweepPriority).toBe(2);
    expect(buildModulePayload({ CashSweepPriority: 0 }).CashSweepPriority).toBe(1);
  });
});
