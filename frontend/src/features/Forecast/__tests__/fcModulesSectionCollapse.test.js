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
    // 'inflation' is what the form starts with; it must not hold Expenses open.
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

  test("a section holding ANY value is open — this is what makes hiding safe", () => {
    // The failure mode a type-gated form would have: a stale expense on a module whose
    // type says it has none. Here the value itself keeps the section open.
    expect(open({ ExpenseAmount: 45000 }).has("Expenses")).toBe(true);
    expect(open({ IncomeFcLineId: 12 }).has("Income")).toBe(true);
    expect(open({ TaxRateOverride: 3 }).has("Tax")).toBe(true);
    // 0 is not a value: a 0% override and no override are the same to the engine here.
    expect(open({ ExpenseAmount: 0 }).has("Expenses")).toBe(false);
  });

  test("the rule never reads module_type — the whole point of §5", () => {
    const realEstate = { Type: "Real Estate", ExpenseAmount: 30000 };
    const business = { Type: "Business", ExpenseAmount: 30000 };
    const nonsense = { Type: "asdf", ExpenseAmount: 30000 };
    const noType = { ExpenseAmount: 30000 };
    for (const form of [realEstate, business, nonsense, noType]) {
      expect(open(form).has("Expenses")).toBe(true);
    }
  });

  test("prod's shapes collapse to what each type actually uses", () => {
    // Real Estate: expenses, never income (0 of 40 modules carry one).
    const realEstate = { Type: "Real Estate", BaseValue: 919581, ExpenseAmount: 30000 };
    expect([...open(realEstate)].sort()).toEqual(["Expenses", "General", "Valuation"]);

    // Business: income, never expenses (0 of 18).
    const business = { Type: "Business", BaseValue: 15000000, IncomeAmount: 500000 };
    expect([...open(business)].sort()).toEqual(["General", "Income", "Valuation"]);

    // Liability / Asset: the two valuation fields and nothing else.
    const liability = { Type: "Liability", MarketValue: -24542.66 };
    expect([...open(liability)].sort()).toEqual(["General", "Valuation"]);
  });

  test("a Loan's own sections all stay open", () => {
    const loan = { Type: "Loan", LoanInterestRate: 7 };
    const sections = initialOpenSections(loan, LOAN_FIELD_SECTIONS);
    expect(sections.has("General")).toBe(true);
    expect(sections.has("Loan")).toBe(true);
  });

  test("every always-open title is a real section title", () => {
    const known = new Set([
      ...FIELD_SECTIONS.map(([t]) => t),
      ...LOAN_FIELD_SECTIONS.map(([t]) => t),
    ]);
    for (const title of ALWAYS_OPEN_SECTIONS) expect(known.has(title)).toBe(true);
  });
});

describe("sectionHasContent", () => {
  test("reads only the fields of the section it was handed", () => {
    const form = { IncomeAmount: 500 };
    expect(sectionHasContent(form, sectionByTitle.Income)).toBe(true);
    expect(sectionHasContent(form, sectionByTitle.Expenses)).toBe(false);
  });

  test("an unknown or empty section list is not content", () => {
    expect(sectionHasContent({ IncomeAmount: 500 }, [])).toBe(false);
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
