import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildModulePayload } from "../fcModulePayload.js";
import { FIELD_SECTIONS } from "../../fcModulesEditSections.js";

describe("buildModulePayload", () => {
  // The OTHER direction (CR043 N10). The first test below proves no editor field is
  // dropped on the way OUT of the browser. This one proves nothing we send is rejected
  // on the way IN: since the API now 400s on an unknown field, a key here that the route
  // does not know would break every save. Reads the server's allow-list directly, so the
  // two sides cannot drift apart again — which is the whole failure mode of this bug class.
  it("sends only fields the API's write contract accepts", () => {
    const routeSrc = fs.readFileSync(
      path.resolve(__dirname, "../../../../../../server/src/v2/routes/forecast.js"),
      "utf8"
    );
    const block = routeSrc.match(/const MODULE_WRITE_FIELDS = \[([\s\S]*?)\];/);
    expect(block, "MODULE_WRITE_FIELDS not found in the forecast route").toBeTruthy();
    const allowed = [...block[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);

    const sent = Object.keys(
      buildModulePayload({}, { normalizeTransfers: () => [] })
    );
    const rejected = sent.filter((k) => !allowed.includes(k));
    expect(rejected).toEqual([]);
  });

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
