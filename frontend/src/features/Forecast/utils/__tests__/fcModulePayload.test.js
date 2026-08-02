import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModulePayload } from "../fcModulePayload.js";
import { FIELD_SECTIONS, LOAN_FIELD_SECTIONS } from "../../fcModulesEditSections.js";

describe("buildModulePayload", () => {
  // The OTHER direction (CR043 N10). The first test below proves no editor field is
  // dropped on the way OUT of the browser. This one proves nothing we send is rejected
  // on the way IN: since the API now 400s on an unknown field, a key here that the route
  // does not know would break every save. Reads the server's allow-list directly, so the
  // two sides cannot drift apart again — which is the whole failure mode of this bug class.
  it("sends only fields the API's write contract accepts", () => {
    const routeSrc = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../../../server/src/v2/routes/forecast.js"
      ),
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

  // CR062 V16 — the Loan section is a SECOND set of rendered fields, and the guard
  // above only knows about the first. A loan field dropped here fails exactly the way
  // CR046's and CR047's did: typed, saved, silently gone.
  it("carries every field the LOAN editor renders", () => {
    const rendered = LOAN_FIELD_SECTIONS.flatMap(([, fields]) => fields.map(([, field]) => field));
    const payload = buildModulePayload({ Type: "Loan", LoanInterestRate: 5 });
    expect(rendered.filter((field) => !(field in payload))).toEqual([]);
  });

  it("sends a loan's derived schedules as EMPTY, never as stale rows", () => {
    // The route rejects a non-empty Invest/Dispose/IncomePct on a loan, and empty
    // arrays are how a retyped module clears the rows it arrived with. Sending the
    // old rows would 400 the save; omitting the keys would leave them in the DB.
    const payload = buildModulePayload(
      {
        Type: "Loan",
        LoanInterestRate: 5,
        Invest: [{ Date: "2030-07-01", Amount: 100 }],
        Dispose: [{ Date: "2031-07-01", Amount: 50, Flag: "Full" }],
        IncomePct: [{ Date: "2030-07-01", Value: 2 }],
        Amortization: [{ Date: "2028-07-01", Pct: "11.1111" }, { Date: "", Pct: 5 }],
      },
      { normalizeTransfers: (rows) => rows || [] }
    );

    expect(payload.Invest).toEqual([]);
    expect(payload.Dispose).toEqual([]);
    expect(payload.IncomePct).toEqual([]);
    // Rows without a year are dropped; percentages are coerced to numbers.
    expect(payload.Amortization).toEqual([{ Date: "2028-07-01", Pct: 11.1111 }]);
  });

  it("leaves a NON-loan module's schedules exactly as they were", () => {
    const payload = buildModulePayload(
      { Invest: [{ Date: "2030-07-01", Amount: 100 }] },
      { normalizeTransfers: (rows) => rows || [] }
    );
    expect(payload.Invest).toEqual([{ Date: "2030-07-01", Amount: 100 }]);
    expect(payload.Amortization).toBeUndefined();
  });

  it("sends a 0% loan rate as 0 — that is a real rate, not 'not a loan'", () => {
    expect(buildModulePayload({ LoanInterestRate: 0 }).LoanInterestRate).toBe(0);
    expect(buildModulePayload({ LoanInterestRate: "4.25" }).LoanInterestRate).toBe(4.25);
    expect(buildModulePayload({}).LoanInterestRate).toBeNull();
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

/**
 * CR064 P6 — income steps on the way out of the browser.
 *
 * `IncomeGrowth` is a plain field and is already covered by the FIELD_SECTIONS sweep
 * above (that test is the reason CR046's window and CR047's tax override cannot be
 * dropped again). The step SCHEDULE is not a FIELD_SECTIONS entry, so it needs its own.
 */
describe("CR064 — IncomeSteps", () => {
  const normalizeTransfers = (rows) => rows || [];

  it("normalizes rows and coerces a blank amount to 0", () => {
    const payload = buildModulePayload(
      { IncomeSteps: [
        { Date: "2027-07-01", Amount: "10000" },
        { Date: "2031-07-01", Amount: "" },
        { Date: "2033-07-01", Amount: -25000 },
      ] },
      { normalizeTransfers }
    );
    expect(payload.IncomeSteps).toEqual([
      { Date: "2027-07-01", Amount: 10000 },
      { Date: "2031-07-01", Amount: 0 },
      { Date: "2033-07-01", Amount: -25000 },
    ]);
  });

  it("drops a row with no year — it would have no effect and the table rejects it", () => {
    const payload = buildModulePayload(
      { IncomeSteps: [{ Amount: 500 }, { Date: "2029-07-01", Amount: 500 }] },
      { normalizeTransfers }
    );
    expect(payload.IncomeSteps).toHaveLength(1);
  });

  it("sends an EMPTY array on a loan — the only way a retyped module clears them", () => {
    const payload = buildModulePayload(
      { Type: "Loan", LoanInterestRate: 6, IncomeSteps: [{ Date: "2027-07-01", Amount: 10000 }] },
      { normalizeTransfers }
    );
    expect(payload.IncomeSteps).toEqual([]);
  });

  it("is absent when the caller does not normalize transfers", () => {
    expect(buildModulePayload({ IncomeSteps: [{ Date: "2027-07-01", Amount: 1 }] }).IncomeSteps)
      .toBeUndefined();
  });

  it("blank income growth stays null — null is 'grow at inflation' to the engine", () => {
    expect(buildModulePayload({ IncomeGrowth: "" }).IncomeGrowth).toBeNull();
    // 0 is a real multiplier (flat in nominal terms), not "unset".
    expect(buildModulePayload({ IncomeGrowth: 0 }).IncomeGrowth).toBe(0);
    expect(buildModulePayload({ IncomeGrowth: "0.5" }).IncomeGrowth).toBe(0.5);
  });
});
