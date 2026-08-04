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
    expect([...open({})].sort()).toEqual(["General", "Valuation"]);
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
    expect([...ALWAYS_OPEN_SECTIONS].sort()).toEqual(["General", "Loan", "Valuation"]);
    expect(LOAN_FIELD_SECTIONS.map(([t]) => t)).toContain("Loan");
  });

  test("a section carrying a real value is open; an empty one collapses", () => {
    expect([...open({ TaxRateOverride: 15 })].sort())
      .toEqual(["General", "Tax", "Valuation"]);
    expect([...open({})].sort()).toEqual(["General", "Valuation"]);
  });
});

describe("sectionHasContent", () => {
  test("reads only the fields of the section it was handed", () => {
    // CR069 P3 — was Income vs Expenses; those sections are stream cards now. The property is
    // the same and is what keeps the rule composable: a section is judged by ITS OWN fields,
    // so adding or removing a section cannot change how another one collapses.
    const form = { TaxRateOverride: 15 };
    expect(sectionHasContent(form, sectionByTitle.Tax)).toBe(true);
    expect(sectionHasContent(form, sectionByTitle.Valuation)).toBe(false);
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
    expect(labelForType("FIXED INCOME", "IncomePct", "Yield Spread")).toBe("Coupon Spread");
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
