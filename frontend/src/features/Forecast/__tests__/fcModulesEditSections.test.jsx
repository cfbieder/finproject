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
  directionForSchedule,
  labelForType,
  groupTypeOptions,
  resolvePeriodStart,
  sectionStartsCollapsed,
  residueFor,
  initialOpenSections,
  fieldSectionsFor as sectionsFor,
} from "../fcModulesEditSections.js";


describe("CR041 — FCModulesEdit field sections", () => {
  // CR069 P3 — the Expenses and Income SECTIONS are gone; a module's flows are stream CARDS
  // (`FCModulesStreams`), one row each. These three tests asserted which column lived in which
  // section, and the columns they named no longer exist. What replaced them is the assertion
  // below: the form carries identity + valuation + the gains rate, and NOTHING per-direction —
  // because a per-direction field on this form is exactly the "hidden is not cleared" hazard
  // CR064 §5 refused to accept.
  // CR072 §2 — the owner's structure. "Valuation" and "Tax" are gone as such: the base date sits
  // with the Reference value it is observed AT, the four figures are the Assigned value, and
  // growth + the gains rate are Forecast assumptions — the only block an unmatched module keeps.
  test("sections are General / Reference / Assigned / Assumptions, in order", () => {
    expect(FIELD_SECTIONS.map(([title]) => title))
      .toEqual(["General", "Reference value", "Assigned value", "Forecast assumptions"]);
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


describe("CR070 P6 — a schedule card's left edge", () => {
  // The edge is the one part of the stream-card idiom that carries meaning rather than polish,
  // so it is asserted against what the ENGINE does, not against what the word suggests.
  test("Invest is cash OUT, Dispose is cash IN", () => {
    // fcbuilder-module.js:534 — `transferValues = -dispose - invest`.
    expect(directionForSchedule("Invest")).toBe("expense");
    expect(directionForSchedule("Dispose")).toBe("income");
  });

  test("an Amortization row is a repayment, so cash OUT", () => {
    // fcbuilder-loan.js:18 — a schedule row takes the balance down and the cash with it.
    expect(directionForSchedule("Amortization")).toBe("expense");
  });

  test("direction is keyed on the field, so a per-type RELABEL cannot flip it", () => {
    // A private-equity module renames these; a capital call is still cash out.
    expect(labelForType("private equity", "Invest", "Invest")).toBe("Capital Call");
    expect(labelForType("private equity", "Dispose", "Dispose")).toBe("Distribution");
    expect(directionForSchedule("Invest")).toBe("expense");
    expect(directionForSchedule("Dispose")).toBe("income");
  });

  test("an unknown schedule gets NO accent rather than a guessed one", () => {
    // Renders without the data-direction attribute, falling through to the plain border.
    expect(directionForSchedule("IncomePct")).toBeUndefined();
    expect(directionForSchedule("")).toBeUndefined();
  });
});


describe("the type filter's grouping", () => {
  // Prod's nine types and their real per-scenario counts.
  const TYPES = ["Business", "Expense", "Fixed Income", "Income", "Liability",
                 "Loan", "Private Equity", "Real Estate", "Stocks"];
  const COUNTS = { Business: 4, Expense: 10, "Fixed Income": 1, Income: 2, Liability: 3,
                   Loan: 2, "Private Equity": 2, "Real Estate": 8, Stocks: 2 };

  test("groups by what the module is, biggest first inside each group", () => {
    expect(groupTypeOptions(TYPES, COUNTS)).toEqual([
      ["Assets", [
        { type: "Real Estate", count: 8 },
        { type: "Business", count: 4 },
        { type: "Private Equity", count: 2 },
        { type: "Stocks", count: 2 },
        { type: "Fixed Income", count: 1 },
      ]],
      ["Debt", [
        { type: "Liability", count: 3 },
        { type: "Loan", count: 2 },
      ]],
      ["Flows", [
        { type: "Expense", count: 10 },
        { type: "Income", count: 2 },
      ]],
    ]);
  });

  // THE ONE THAT MATTERS. Types are free text derived from the scenario's own modules, so
  // this map will miss one day. A filter that silently drops an option HIDES MODULES.
  test("an unrecognised type is never lost — it lands under Other", () => {
    const grouped = groupTypeOptions(["Real Estate", "Crypto", "Farmland"],
                                     { "Real Estate": 8, Crypto: 3, Farmland: 1 });
    expect(grouped).toEqual([
      ["Assets", [{ type: "Real Estate", count: 8 }]],
      ["Other", [{ type: "Crypto", count: 3 }, { type: "Farmland", count: 1 }]],
    ]);
    // Stated as an invariant, not just as the example above.
    const seen = grouped.flatMap(([, rows]) => rows.map((r) => r.type));
    expect(seen.sort()).toEqual(["Crypto", "Farmland", "Real Estate"]);
  });

  test("every input type survives grouping, whatever the map says", () => {
    const odd = ["Real Estate", "loan", "  STOCKS  ", "Zzz", "Expense"];
    const seen = groupTypeOptions(odd, {}).flatMap(([, r]) => r.map((x) => x.type));
    expect(seen.sort()).toEqual([...odd].sort());
  });

  test("case and stray whitespace still find their group", () => {
    // The vocabulary is owner-editable free text; "loan" and "Loan" are the same thing.
    const grouped = groupTypeOptions(["  LOAN ", "expense"], {});
    expect(grouped.map(([label]) => label)).toEqual(["Debt", "Flows"]);
  });

  test("an empty group is omitted rather than rendered empty", () => {
    expect(groupTypeOptions(["Expense"], { Expense: 10 }))
      .toEqual([["Flows", [{ type: "Expense", count: 10 }]]]);
  });

  test("a type with no count shows zero rather than undefined", () => {
    expect(groupTypeOptions(["Stocks"], {})).toEqual([["Assets", [{ type: "Stocks", count: 0 }]]]);
  });

  test("no input at all is not an error", () => {
    expect(groupTypeOptions(undefined, undefined)).toEqual([]);
    expect(groupTypeOptions([], {})).toEqual([]);
  });
});


describe("CR072 \u00a76/\u00a710 \u2014 PeriodStart resolves or returns null, never a guess", () => {
  const A = { scenarios: [{ Name: "2026 Base", PeriodStart: 2027, PeriodEnd: 2062 }] };

  test("resolves from the matching scenario", () => {
    expect(resolvePeriodStart(A, "2026 Base")).toBe(2027);
  });

  // THE ONE THAT MATTERS. The component's own periodStartNum falls back to the CURRENT YEAR on a
  // name miss, which is fine for a picker range and wrong for a label or a fetch year: it renders
  // "from 2026, the first forecast year" on a forecast starting 2027, and fetches 2024/2025
  // actuals. Prod has paid for this class once already (CR064 P1, five dead scenario names).
  test("a scenario-name MISS returns null rather than the current year", () => {
    expect(resolvePeriodStart(A, "2026 Downside")).toBeNull();
    expect(resolvePeriodStart(A, "")).toBeNull();
    expect(resolvePeriodStart(A, undefined)).toBeNull();
  });

  test("no assumptions at all is null, not a crash", () => {
    expect(resolvePeriodStart(null, "2026 Base")).toBeNull();
    expect(resolvePeriodStart({}, "2026 Base")).toBeNull();
    expect(resolvePeriodStart({ scenarios: [] }, "2026 Base")).toBeNull();
  });

  test("a top-level PeriodStart is the fallback, and junk is rejected", () => {
    expect(resolvePeriodStart({ PeriodStart: 2027 }, "anything")).toBe(2027);
    expect(resolvePeriodStart({ PeriodStart: "not a year" }, "x")).toBeNull();
    expect(resolvePeriodStart({ PeriodStart: 12 }, "x")).toBeNull();
  });
});


describe("CR072 §7 — an UNMATCHED balance-sheet module collapses, and never hides", () => {
  const UNMATCHED = { HasValuation: true, Matched: false, Type: "Business" };
  const MATCHED   = { HasValuation: true, Matched: true,  Type: "Business" };
  const FLOW      = { HasValuation: false, Matched: false, Type: "Expense" };

  test("the two value blocks start collapsed when unmatched, open when matched", () => {
    expect(sectionStartsCollapsed(UNMATCHED, "Reference value")).toBe(true);
    expect(sectionStartsCollapsed(UNMATCHED, "Assigned value")).toBe(true);
    expect(sectionStartsCollapsed(MATCHED, "Reference value")).toBe(false);
    expect(sectionStartsCollapsed(MATCHED, "Assigned value")).toBe(false);
  });

  test("the assumptions block is NEVER collapsed — it is the half an unmatched module needs", () => {
    expect(sectionStartsCollapsed(UNMATCHED, "Forecast assumptions")).toBe(false);
    expect(initialOpenSections(UNMATCHED, sectionsFor(UNMATCHED))).toContain("Forecast assumptions");
  });

  // THE ONE THAT MATTERS. Collapse was chosen over hide precisely because `is_matched` is not an
  // engine branch: the engine books market_value off has_valuation alone, so a hidden-and-reported
  // field would have the residue panel assert "the forecast ignores this" (false) and offer a
  // Clear button that zeroes a live figure. A COLLAPSED field is still rendered, so it is still
  // reachable, and residueFor must stay silent about it.
  test("collapsing reports NO residue — the value is one click away, not concealed", () => {
    const withValue = { ...UNMATCHED, MarketValue: 500000, BaseValue: 400000 };
    const fields = residueFor(withValue).map((r) => r.field);
    expect(fields).not.toContain("MarketValue");
    expect(fields).not.toContain("BaseValue");
  });

  test("a flow module is unaffected — CR070's shipped behaviour is byte-identical", () => {
    expect(sectionStartsCollapsed(FLOW, "Reference value")).toBe(false);
    expect(sectionStartsCollapsed(FLOW, "Assigned value")).toBe(false);
    // ...and it still renders none of them, by capability rather than by collapse.
    expect(sectionsFor(FLOW).map(([t]) => t)).toEqual(["General"]);
  });

  // Pass 1 B1: the BaseDate exemption was justified for FLOW modules only.
  test("a hidden BaseDate is reported on a VALUATION module and exempt on a flow one", () => {
    expect(residueFor({ HasValuation: false, BaseDate: "2026-12-31" }).map((r) => r.field))
      .not.toContain("BaseDate");
  });
});
