/**
 * CR041 — FCModulesEdit field-section grouping
 *
 * The edit modal renders FIELD_SECTIONS as titled groups so expense and
 * income configuration no longer interleave on the same grid rows. These
 * tests lock the grouping contract (the render maps directly over it).
 */
import { describe, test, expect } from "vitest";
import { FIELD_SECTIONS } from "../fcModulesEditSections.js";

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
    ]);
  });

  test("income fields are all in the Income section", () => {
    expect(fieldsOf("Income")).toEqual(["IncomeFcLineId", "IncomeAmount"]);
  });

  test("no field appears in more than one section, and none were lost", () => {
    const allFields = FIELD_SECTIONS.flatMap(([, fields]) => fields.map(([, f]) => f));
    expect(new Set(allFields).size).toBe(allFields.length);
    // The full pre-CR041 flat list, redistributed
    expect([...allFields].sort()).toEqual([
      "Account", "BaseDate", "BaseValue", "BaseValueUSD", "Currency",
      "ExpenseAmount", "ExpenseFcLineId", "ExpenseGrowthMethod", "Growth",
      "IncomeAmount", "IncomeFcLineId", "MarketValue", "MarketValueUSD",
      "Matched", "Name", "TaxRateOverride", "Type",
    ]);
  });
});
