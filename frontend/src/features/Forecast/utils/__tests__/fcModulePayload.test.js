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
        Streams: [{ direction: "expense", mode: "derived", fc_line_id: 7, changes: [] }],
        Amortization: [{ Date: "2028-07-01", Pct: "11.1111" }, { Date: "", Pct: 5 }],
      },
      { normalizeTransfers: (rows) => rows || [] }
    );

    expect(payload.Invest).toEqual([]);
    expect(payload.Dispose).toEqual([]);
    // CR069 P3 — a loan's streams still go, because its DERIVED interest stream is the only
    // place its interest line lives. What must be empty is Invest/Dispose: the derivation owns
    // the principal movements.
    expect(payload.Streams).toHaveLength(1);
    expect(payload.Streams[0].Mode).toBe("derived");
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
    expect(blank.Streams).toEqual([]);
    const set = buildModulePayload(
      {
        Streams: [{
          direction: "income", mode: "amount", fc_line_id: 3, amount: 1000,
          start_date: "2030-07-01", end_date: null, changes: [],
        }],
      },
      { normalizeTransfers: (x) => x || [] }
    );
    expect(set.Streams[0].StartDate).toBe("2030-07-01");
    expect(set.Streams[0].EndDate).toBeNull();
  });

  it("sends a 0% income tax override as 0, not as null", () => {
    // 0 is a real rate (income taxed at nothing), not 'unset' — the engine relies on that.
    // CR069 P3 — the recurring-income override belongs to the income STREAM (which is what
    // makes two income streams taxed differently expressible). 0 is still a real rate.
    const p0 = buildModulePayload({ Streams: [{ direction: "income", tax_rate_override: 0, changes: [] }] });
    expect(p0.Streams[0].TaxRateOverride).toBe(0);
    const p3 = buildModulePayload({ Streams: [{ direction: "income", tax_rate_override: "3", changes: [] }] });
    expect(p3.Streams[0].TaxRateOverride).toBe(3);
    const pn = buildModulePayload({ Streams: [{ direction: "income", tax_rate_override: "", changes: [] }] });
    expect(pn.Streams[0].TaxRateOverride).toBeNull();
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
describe("CR069 P3 — stream changes (what IncomeSteps became)", () => {
  const normalizeTransfers = (rows) => rows || [];

  it("normalizes change rows and coerces a blank amount to 0", () => {
    // CR064 P6's income steps are `Fixed $` rows on a stream now — same semantics, same
    // normalization obligations, one shape instead of two.
    const payload = buildModulePayload(
      {
        Streams: [{
          direction: "income", mode: "amount", amount: 1000, changes: [
            { change_date: "2027-07-01", amount: "10000", flag: "Fixed $" },
            { change_date: "2031-07-01", amount: "", flag: "Fixed $" },
            { change_date: "2033-07-01", amount: -25000, flag: "Fixed $" },
          ],
        }],
      },
      { normalizeTransfers }
    );
    expect(payload.Streams[0].Changes).toEqual([
      { Date: "2027-07-01", Amount: 10000, Flag: "Fixed $" },
      { Date: "2031-07-01", Amount: 0, Flag: "Fixed $" },
      { Date: "2033-07-01", Amount: -25000, Flag: "Fixed $" },
    ]);
  });

  it("drops a change with no date — it would have no effect and the table rejects it", () => {
    const payload = buildModulePayload(
      {
        Streams: [{
          direction: "income", changes: [
            { amount: 500, flag: "Fixed $" },
            { change_date: "2029-07-01", amount: 500, flag: "Fixed $" },
          ],
        }],
      },
      { normalizeTransfers }
    );
    expect(payload.Streams[0].Changes).toHaveLength(1);
  });

  it("sends the amount as a MAGNITUDE — direction carries the sign", () => {
    // The column is CHECKed >= 0 (migration 057). A negative typed into the card is the
    // owner meaning "this much", not "negative this much".
    const payload = buildModulePayload(
      { Streams: [{ direction: "expense", amount: -4200, changes: [] }] },
      { normalizeTransfers }
    );
    expect(payload.Streams[0].Amount).toBe(4200);
  });

  it("keeps a blank growth multiplier NULL — blank means inflation, not zero", () => {
    const payload = buildModulePayload(
      { Streams: [{ direction: "income", growth_mult: "", changes: [] }] },
      { normalizeTransfers }
    );
    expect(payload.Streams[0].GrowthMult).toBeNull();
  });
});
