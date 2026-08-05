/**
 * CR041 — FCModulesEdit field-section grouping
 *
 * The edit modal renders FIELD_SECTIONS as titled groups so expense and
 * income configuration no longer interleave on the same grid rows. These
 * tests lock the grouping contract (the render maps directly over it).
 */
import { describe, test, expect } from "vitest";
import {
  FIELD_SECTIONS,
  LOAN_FIELD_SECTIONS,
  fieldSectionsFor,
  isLoanModule,
} from "../fcModulesEditSections.js";


describe("CR041 — FCModulesEdit field sections", () => {
  // CR069 P3 — the Expenses and Income SECTIONS are gone; a module's flows are stream CARDS
  // (`FCModulesStreams`), one row each. These three tests asserted which column lived in which
  // section, and the columns they named no longer exist. What replaced them is the assertion
  // below: the form carries identity + valuation + the gains rate, and NOTHING per-direction —
  // because a per-direction field on this form is exactly the "hidden is not cleared" hazard
  // CR064 §5 refused to accept.
  test("sections are General / Valuation / Tax, in order", () => {
    expect(FIELD_SECTIONS.map(([title]) => title)).toEqual(["General", "Valuation", "Tax"]);
  });

  test("no per-direction field survives on the form — those are stream properties now", () => {
    const all = FIELD_SECTIONS.flatMap(([, fields]) => fields.map(([, f]) => f));
    for (const gone of [
      "ExpenseAmount", "ExpenseFcLineId", "ExpenseGrowthMethod", "ExpenseStartDate",
      "ExpenseEndDate", "IncomeAmount", "IncomeFcLineId", "IncomeGrowth", "IncomeStartDate",
      "IncomeEndDate", "IncomeTaxRateOverride", "IncomePct", "IncomeSteps",
    ]) {
      expect(all).not.toContain(gone);
    }
    // ...and the gains rate STAYS, because a capital gain belongs to the valuation.
    expect(all).toContain("TaxRateOverride");
  });

  test("no field appears in more than one section, and none were lost", () => {
    const allFields = FIELD_SECTIONS.flatMap(([, fields]) => fields.map(([, f]) => f));
    expect(new Set(allFields).size).toBe(allFields.length);
    // CR069 P3 — what a module IS, once its flows are rows: identity, valuation, gains rate.
    expect([...allFields].sort()).toEqual([
      "Account", "BaseDate", "BaseValue", "BaseValueUSD", "Currency", "Growth",
      "MarketValue", "MarketValueUSD", "Matched", "Name", "TaxRateOverride", "Type",
    ]);
  });
});

/**
 * CR062 — the Loan form.
 *
 * `Type` decides what is SHOWN; `loan_interest_rate` decides what the engine DOES.
 * The split matters because module types are a free-text list the owner edits in
 * Forecast Settings — prod already carries a lowercase "asset" from a since-fixed
 * code path. If the type were the only signal, renaming or mistyping it would hide
 * the Loan section while the engine went on charging interest, leaving live
 * assumptions that could not be edited or even seen.
 */
describe("CR062 — the Loan section", () => {
  test("a loan is recognised whatever the case, and by its rate alone", () => {
    expect(isLoanModule({ Type: "Loan" })).toBe(true);
    expect(isLoanModule({ Type: "loan" })).toBe(true);
    expect(isLoanModule({ Type: "  LOAN " })).toBe(true);
    // The fallback: the type was renamed away but the data still says loan.
    expect(isLoanModule({ Type: "Mortgage", LoanInterestRate: 4.5 })).toBe(true);
    // 0% is a real rate, not "unset".
    expect(isLoanModule({ Type: "Asset", LoanInterestRate: 0 })).toBe(true);

    expect(isLoanModule({ Type: "Asset" })).toBe(false);
    expect(isLoanModule({ Type: "Liability" })).toBe(false);
    expect(isLoanModule({})).toBe(false);
    expect(isLoanModule(null)).toBe(false);
  });

  test("a loan gets the Loan sections, everything else the standard ones", () => {
    // CR070 P3 — compared by VALUE, not identity. `fieldSectionsFor` now filters each section by
    // the module's capabilities, so it builds a fresh array rather than returning the constant.
    // The identity was incidental to what this test is actually about: which SET a loan gets.
    // (A valuation module keeps every field, so the filtered result still equals the constant.)
    expect(fieldSectionsFor({ Type: "Loan", HasValuation: true }))
      .toStrictEqual(LOAN_FIELD_SECTIONS);
    expect(fieldSectionsFor({ Type: "Real Estate", HasValuation: true }))
      .toStrictEqual(FIELD_SECTIONS);
  });

  test("CR070 P3 — a flow module's form drops what it cannot use", () => {
    const titles = fieldSectionsFor({ Type: "Expense", HasValuation: false }).map(([t]) => t);
    // Valuation and Tax are gone entirely; General survives because identity is unconditional.
    expect(titles).toEqual(["General"]);
  });

  test("the Loan form drops the fields a loan cannot use, and adds the five assumptions", () => {
    const loanFields = LOAN_FIELD_SECTIONS.flatMap(([, f]) => f.map(([, field]) => field));

    // The five assumptions, plus where the interest posts and what is owed today.
    for (const field of [
      "LoanPrincipal", "LoanStartDate", "LoanInterestRate", "LoanEndDate",
      // CR069 P3 — the Interest Line moved off this form onto the loan's DERIVED expense
      // stream, which the stream card renders read-only. It is still required (the route
      // refuses a loan without one) — just not a column here any more.
      "MarketValue", "MarketValueUSD",
    ]) {
      expect(loanFields).toContain(field);
    }

    // Interest is derived from the rate and the running balance, so an expense
    // AMOUNT next to it would be meaningless — and Growth on a liability
    // capitalizes interest into the balance, double-counting the interest line.
    for (const field of ["ExpenseAmount", "ExpenseGrowthMethod", "Growth", "IncomeAmount", "IncomeFcLineId"]) {
      expect(loanFields).not.toContain(field);
    }

    // A stale CR046 window would halve and truncate the interest, so the form
    // cannot set one at all (the save clears any it inherited).
    for (const field of ["ExpenseStartDate", "ExpenseEndDate", "IncomeStartDate", "IncomeEndDate"]) {
      expect(loanFields).not.toContain(field);
    }
  });

  test("no loan field appears twice", () => {
    const all = LOAN_FIELD_SECTIONS.flatMap(([, f]) => f.map(([, field]) => field));
    expect(new Set(all).size).toBe(all.length);
  });
});
