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

const sectionByTitle = Object.fromEntries(FIELD_SECTIONS);
const fieldsOf = (title) => (sectionByTitle[title] || []).map(([, field]) => field);

describe("CR041 — FCModulesEdit field sections", () => {
  test("sections are General / Valuation / Expenses / Income / Tax, in order", () => {
    expect(FIELD_SECTIONS.map(([title]) => title)).toEqual([
      "General", "Valuation", "Expenses", "Income", "Tax",
    ]);
  });

  test("expense fields are all in the Expenses section", () => {
    expect(fieldsOf("Expenses")).toEqual([
      "ExpenseFcLineId", "ExpenseAmount", "ExpenseGrowthMethod",
      // CR046 window — bounds when the stream runs, not how much
      "ExpenseStartDate", "ExpenseEndDate",
    ]);
  });

  test("income fields are all in the Income section", () => {
    expect(fieldsOf("Income")).toEqual([
      "IncomeFcLineId", "IncomeAmount",
      // CR064 P6 — a multiplier of inflation for the amount above. Before it, income
      // grew at exactly inflation and nothing could say otherwise, so a business could
      // only be modelled through the Yield Spread — which discards the amount entirely.
      "IncomeGrowth",
      "IncomeStartDate", "IncomeEndDate", // CR046 window
    ]);
  });

  test("no field appears in more than one section, and none were lost", () => {
    const allFields = FIELD_SECTIONS.flatMap(([, fields]) => fields.map(([, f]) => f));
    expect(new Set(allFields).size).toBe(allFields.length);
    // The full pre-CR041 flat list, redistributed, plus the CR046 window fields
    expect([...allFields].sort()).toEqual([
      "Account", "BaseDate", "BaseValue", "BaseValueUSD", "Currency",
      "ExpenseAmount", "ExpenseEndDate", "ExpenseFcLineId", "ExpenseGrowthMethod",
      "ExpenseStartDate", "Growth",
      "IncomeAmount", "IncomeEndDate", "IncomeFcLineId", "IncomeGrowth", "IncomeStartDate",
      "IncomeTaxRateOverride", "MarketValue", "MarketValueUSD",
      "Matched", "Name", "TaxRateOverride", "Type",
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
    expect(fieldSectionsFor({ Type: "Loan" })).toBe(LOAN_FIELD_SECTIONS);
    expect(fieldSectionsFor({ Type: "Real Estate" })).toBe(FIELD_SECTIONS);
  });

  test("the Loan form drops the fields a loan cannot use, and adds the five assumptions", () => {
    const loanFields = LOAN_FIELD_SECTIONS.flatMap(([, f]) => f.map(([, field]) => field));

    // The five assumptions, plus where the interest posts and what is owed today.
    for (const field of [
      "LoanPrincipal", "LoanStartDate", "LoanInterestRate", "LoanEndDate",
      "ExpenseFcLineId", "MarketValue", "MarketValueUSD",
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
