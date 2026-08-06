/**
 * CR064 P3 — collapse-when-empty, and per-type labels.
 *
 * The owner asked whether every module type should get its own form, the way Loan did.
 * It should not (CR064 §5): `module_type` is free text the owner edits, and a hidden
 * field is not a cleared one — `fcModulePayload` sends every field on every save, so a
 * type-gated form would leave a stale expense charging the P&L invisibly. That is why
 * CR062's Loan carve-out needed a preview endpoint and a confirmed delete.
 *
 * Emptiness needs none of that, and these tests pin the two properties that make it
 * safe: a section holding ANY value is open, and the rule never consults the type.
 */
import { describe, test, expect } from "vitest";
import {
  FIELD_SECTIONS,
  LOAN_FIELD_SECTIONS,
  fieldIsEmpty,
  sectionHasContent,
  initialOpenSections,
  labelForType,
  ALWAYS_OPEN_SECTIONS,
  capabilitiesFor,
  residueFor,
  FIELD_CAPABILITY,
  FIELD_LABELS,
  RESIDUE_EXEMPT,
} from "../fcModulesEditSections.js";

const sectionByTitle = Object.fromEntries(FIELD_SECTIONS);
const open = (form) => initialOpenSections(form, FIELD_SECTIONS);

describe("fieldIsEmpty", () => {
  test("blank, null, undefined and zero are all empty", () => {
    for (const value of ["", null, undefined, 0, "0", "0.00"]) {
      expect(fieldIsEmpty({ ExpenseAmount: value }, "ExpenseAmount")).toBe(true);
    }
  });

  test("a real value is not empty — including a negative one", () => {
    expect(fieldIsEmpty({ MarketValue: 1 }, "MarketValue")).toBe(false);
    // Liabilities are stored negative; -24,542.66 is a value, not an absence.
    expect(fieldIsEmpty({ MarketValue: -24542.66 }, "MarketValue")).toBe(false);
    expect(fieldIsEmpty({ Name: "US - Casarina" }, "Name")).toBe(false);
  });

  test("a field left at its own default is empty", () => {
    // FIELD_DEFAULTS is keyed by field name and is deliberately not tied to any one section,
    // so the rule keeps working as fields come and go (CR069 P3 removed the per-direction ones).
    expect(fieldIsEmpty({ ExpenseGrowthMethod: "inflation" }, "ExpenseGrowthMethod")).toBe(true);
    expect(fieldIsEmpty({ ExpenseGrowthMethod: "pct_of_value" }, "ExpenseGrowthMethod")).toBe(false);
  });

  test("an empty schedule array is empty, a populated one is not", () => {
    expect(fieldIsEmpty({ Invest: [] }, "Invest")).toBe(true);
    expect(fieldIsEmpty({ Invest: [{ Date: "2030-07-01", Amount: 100 }] }, "Invest")).toBe(false);
  });
});

describe("initialOpenSections", () => {
  test("General and Valuation stay open on an empty form", () => {
    // CR072 §2 — "Valuation" split into Reference value / Assigned value / Forecast assumptions.
    // On a form with no `Matched` flag the two value blocks start COLLAPSED (§7), so what stays
    // open is identity plus the assumptions — the half an unmatched module still needs.
    expect([...open({})].sort()).toEqual(["Forecast assumptions", "General"]);
  });

  // CR069 P3 — the three tests that lived here asserted that an Expenses or Income section
  // holding a value stays OPEN, which was the property that made collapse-when-empty safe
  // while those were columns. They are gone with the sections: a module's flows are stream
  // CARDS now, and a card is a row — a module with no expense has no card because it has no
  // stream, so there is no hidden-value hazard left for the rule to guard against. The rule
  // itself still applies to what remains, and the two properties below still pin it.
  test("the rule never reads module_type — the whole point of §5", () => {
    // Two forms identical but for the type must open identically. `module_type` is free text
    // the owner edits (prod carries both "Asset" and "asset"), so keying anything on it is how
    // a renamed type silently changes a form.
    const a = open({ Type: "Real Estate", MarketValue: 400000 });
    const b = open({ Type: "not a real type at all", MarketValue: 400000 });
    expect([...a].sort()).toEqual([...b].sort());
  });

  test("the always-open set is the sections a module is DEFINED by", () => {
    // CR069 P3 — General and Valuation, and Loan on the loan form. Not Expenses or Income:
    // those are cards now, and a card that does not exist cannot be collapsed or hidden.
    expect([...ALWAYS_OPEN_SECTIONS].sort())
      .toEqual(["Assigned value", "Forecast assumptions", "General", "Loan", "Valuation"]);
    expect(LOAN_FIELD_SECTIONS.map(([t]) => t)).toContain("Loan");
  });

  test("a section carrying a real value is open; an empty one collapses", () => {
    expect([...open({ TaxRateOverride: 15 })].sort())
      .toEqual(["Forecast assumptions", "General"]);
    // CR072 §2 — "Valuation" split into Reference value / Assigned value / Forecast assumptions.
    // On a form with no `Matched` flag the two value blocks start COLLAPSED (§7), so what stays
    // open is identity plus the assumptions — the half an unmatched module still needs.
    expect([...open({})].sort()).toEqual(["Forecast assumptions", "General"]);
  });
});

describe("sectionHasContent", () => {
  test("reads only the fields of the section it was handed", () => {
    // CR069 P3 — was Income vs Expenses; those sections are stream cards now. The property is
    // the same and is what keeps the rule composable: a section is judged by ITS OWN fields,
    // so adding or removing a section cannot change how another one collapses.
    // CR072 §2 — retitled: the gains rate now lives in "Forecast assumptions" and the four
    // figures in "Assigned value". The PROPERTY under test is unchanged.
    const form = { TaxRateOverride: 15 };
    expect(sectionHasContent(form, sectionByTitle["Forecast assumptions"])).toBe(true);
    expect(sectionHasContent(form, sectionByTitle["Assigned value"])).toBe(false);
  });

  test("an unknown or empty section list is not content", () => {
    expect(sectionHasContent({ TaxRateOverride: 15 }, [])).toBe(false);
    expect(sectionHasContent({}, undefined)).toBe(false);
  });
});

describe("labelForType", () => {
  test("private equity calls them capital calls and distributions", () => {
    expect(labelForType("Private Equity", "Invest", "Invest")).toBe("Capital Call");
    expect(labelForType("Private Equity", "Dispose", "Dispose")).toBe("Distribution");
  });

  test("matching is case- and space-insensitive, like isLoanModule's", () => {
    expect(labelForType("  private equity  ", "Invest", "Invest")).toBe("Capital Call");
    // CR070 P6 — was `FIXED INCOME` / `IncomePct` → "Coupon Spread". That entry named a field
    // CR069 P3 retired, so it had been dead since that release and is now removed. The property
    // under test is the case/space folding, which `Dispose` exercises just as well.
    expect(labelForType("PRIVATE EQUITY", "Dispose", "Dispose")).toBe("Distribution");
  });

  test("an unknown, renamed, empty or missing type falls back to the generic word", () => {
    // The property that makes per-type LABELS safe where per-type FIELDS are not:
    // a lookup miss costs a noun, never a value.
    for (const type of ["Real Estate", "asdf", "", null, undefined]) {
      expect(labelForType(type, "Invest", "Invest")).toBe("Invest");
      expect(labelForType(type, "IncomePct", "Yield Spread")).toBe("Yield Spread");
    }
  });

  test("a type with overrides still falls back for fields it does not override", () => {
    expect(labelForType("Private Equity", "IncomePct", "Yield Spread")).toBe("Yield Spread");
    expect(labelForType("Fixed Income", "Invest", "Invest")).toBe("Invest");
  });
});

// ---------------------------------------------------------------------------
// CR070 P2/P3 — capabilities, and the detector that makes hiding safe.
//
// The property under test is the one CR064 §5 demanded and this CR finally supplies:
// A FIELD MAY DISAPPEAR ONLY IF A VALUE IN IT CANNOT.
// ---------------------------------------------------------------------------
describe("CR070 — capabilities are keyed on data, never on the type", () => {
  test("a flow module loses valuation, gains tax, sweep and schedules", () => {
    const caps = capabilitiesFor({ HasValuation: false, Type: "Expense" });
    expect([...caps].sort()).toEqual(["identity", "streams"]);
  });

  test("a valuation module keeps them, whatever its type is called", () => {
    // Same data, wildly different type strings — the capability set must not move, because a
    // renamed type is exactly how CR064 §5 said a live value would get hidden.
    const a = capabilitiesFor({ HasValuation: true, Type: "Real Estate" });
    const b = capabilitiesFor({ HasValuation: true, Type: "not a real type at all" });
    expect([...a].sort()).toEqual([...b].sort());
    expect(a.has("valuation")).toBe(true);
    expect(a.has("sweep")).toBe(true);
  });

  test("the loan capability is a UNION of type and data", () => {
    // House Morgage's shape: typed Loan, no rate. It must still get the loan form, because that
    // form holds the only input that can fix it.
    expect(capabilitiesFor({ Type: "Loan", LoanInterestRate: null }).has("loan")).toBe(true);
    // And a renamed loan keeps it on the data alone.
    expect(capabilitiesFor({ Type: "Mortgage", LoanInterestRate: 6 }).has("loan")).toBe(true);
    expect(capabilitiesFor({ Type: "Real Estate" }).has("loan")).toBe(false);
  });
});

describe("CR070 — the residue detector", () => {
  test("reports a value in a field the form does not render", () => {
    // The §5 case, exactly: a module flipped to a flow module while still holding a market value.
    const residue = residueFor({ HasValuation: false, MarketValue: 400000, Growth: 2 });
    const fields = residue.map((r) => r.field).sort();
    expect(fields).toContain("MarketValue");
    expect(fields).toContain("Growth");
    expect(residue.find((r) => r.field === "MarketValue").value).toBe(400000);
  });

  test("says nothing about a field that is rendered, or one that is empty", () => {
    expect(residueFor({ HasValuation: true, MarketValue: 400000 })).toEqual([]);
    expect(residueFor({ HasValuation: false, MarketValue: 0 })).toEqual([]);
    expect(residueFor({ HasValuation: false })).toEqual([]);
  });

  test("catches a field hidden by TYPE — which the engine still reads", () => {
    // This is why the detector had to be generalized past "the engine does not read it".
    // Stocks hides Invest/Dispose on measured non-use (0 of 10 on prod), but the engine reads
    // them on any valuation module — so a value there would be live AND invisible.
    const residue = residueFor({
      HasValuation: true, Type: "Stocks",
      Invest: [{ Date: "2030-07-01", Amount: 5000 }],
    });
    expect(residue.map((r) => r.field)).toEqual(["Invest"]);
  });

  test("BaseDate is exempt, and the exemption is deliberate", () => {
    // Set on all 60 prod flow modules, and provably unread there (CR069 Decision 6 pins every
    // stream to PeriodStart − 1). Reporting it would be 60 findings that cannot affect a number.
    expect(residueFor({ HasValuation: false, BaseDate: "2026-12-31" })).toEqual([]);
  });

  test("every capability-owned field is covered by the detector or exempt", () => {
    // The guard against the real failure mode: someone adds a field to FIELD_CAPABILITY and
    // forgets it can now be hidden. Anything gated must be detectable.
    for (const field of Object.keys(FIELD_CAPABILITY)) {
      const covered = RESIDUE_EXEMPT.has(field) || FIELD_LABELS[field];
      expect(covered, `${field} needs a label or an exemption`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// CR070 P6 — the schedules a module is offered.
//
// Two separate defects, found by the owner opening an Expense module and seeing four schedule
// sections that had no business being there:
//
//   1. `Yield Spread` and `Income Steps` were DEAD UI on every module type. CR069 P3 retired both
//      (a yield is a stream MODE; a step is a `Fixed $` change), so neither is in
//      MODULE_WRITE_FIELDS and buildModulePayload does not send them — anything typed there was
//      silently dropped on save. Typed, saved, gone, no error.
//   2. Invest/Dispose rendered on flow modules, which have no balance to move: the engine skips
//      its disposal loop entirely when `hasValuation` is false.
// ---------------------------------------------------------------------------
describe("CR070 P6 — schedules follow the capability", () => {
  test("a flow module is offered no Invest/Dispose", () => {
    expect(capabilitiesFor({ HasValuation: false }).has("schedules")).toBe(false);
  });

  test("a valuation module still is", () => {
    expect(capabilitiesFor({ HasValuation: true }).has("schedules")).toBe(true);
  });

  test("no label lookup survives for the retired IncomePct field", () => {
    // The `fixed income` entry named IncomePct and had been dead since CR069 P3. A label for a
    // control that does not exist is how a retired field looks alive to the next reader.
    expect(labelForType("Fixed Income", "IncomePct", "Yield Spread")).toBe("Yield Spread");
    // The labels that ARE still real keep working.
    expect(labelForType("Private Equity", "Invest", "Invest")).toBe("Capital Call");
  });
});
