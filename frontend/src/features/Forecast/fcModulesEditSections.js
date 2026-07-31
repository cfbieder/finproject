// CR041: FCModulesEdit fields grouped into titled sections so expense and
// income configuration no longer interleave on the same grid rows.
// Tuples are [label, field, type] as consumed by the modal's field renderer.
export const FIELD_SECTIONS = [
  ["General", [
    ["Account", "Account", "select"],
    ["Name", "Name", "text"],
    ["Matched", "Matched", "checkbox"],
    ["Base Date", "BaseDate", "date"],
    ["Type", "Type", "text"],
    ["Currency", "Currency", "text"],
  ]],
  ["Valuation", [
    ["Cost Basis", "BaseValue", "number"],
    ["Cost Basis (USD)", "BaseValueUSD", "number"],
    ["Market Value", "MarketValue", "number"],
    ["Market Value (USD)", "MarketValueUSD", "number"],
    ["Growth (x Inflation)", "Growth", "number"],
  ]],
  // CR046: the Start/End YEARS bound WHEN a stream runs, never how much — the amount
  // stays a base-year figure compounded at inflation. Blank = unbounded (the old
  // behavior). Stored as July 1, so the first and last year each carry 50% of the amount,
  // the same half-year convention the engine already uses for an acquisition year and a
  // Full disposal. Ownership still wins: an asset bought in 2035 pays nothing before then,
  // whatever the start year says.
  ["Expenses", [
    ["Expense Line", "ExpenseFcLineId", "fc-line-expense"],
    ["Expense Amount (Base Yr)", "ExpenseAmount", "number"],
    ["Expense Growth", "ExpenseGrowthMethod", "growth-method"],
    ["Expense Start Year (blank = base yr)", "ExpenseStartDate", "year"],
    ["Expense End Year (blank = horizon)", "ExpenseEndDate", "year"],
  ]],
  ["Income", [
    ["Income Line", "IncomeFcLineId", "fc-line-income"],
    ["Income Amount (Base Yr)", "IncomeAmount", "number"],
    ["Income Start Year (blank = base yr)", "IncomeStartDate", "year"],
    ["Income End Year (blank = horizon)", "IncomeEndDate", "year"],
  ]],
  // CR047: two taxes, two rates.
  //  - "Full" (TaxRateOverride, migration 010) overrides EVERYTHING on the module: the gain
  //    on disposal AND the recurring income. Blank ⇒ the scenario rate.
  //  - "Recurring Income" (IncomeTaxRateOverride) overrides the recurring income ONLY —
  //    dividends, rent, yield — and never the gain on a disposal. It wins over Full when
  //    both are set. For income that arrives already taxed elsewhere: United Beverages'
  //    dividend is net of Polish tax, so the incremental US tax on it is ~3%, while a sale
  //    of the business is still an ordinary capital gain at the full rate.
  // Blank on either = fall back (no change). 0 is a real rate, not "unset".
  ["Tax", [
    ["Full Tax Override (%) — gains + income", "TaxRateOverride", "number"],
    ["Recurring Income Tax Override (%) — income only", "IncomeTaxRateOverride", "number"],
  ]],
];

// CR062 — a LOAN is configured from five assumptions, not from the valuation and
// expense fields an asset uses. Its interest is derived from the rate and the
// running balance, so an Expense Amount would be meaningless next to it, and its
// income fields have nothing to describe.
//
// The engine keys on `loan_interest_rate`, never on this Type. Type only decides
// which fields are shown — see `isLoanModule` below for why that split matters.
export const LOAN_FIELD_SECTIONS = [
  ["General", [
    ["Account", "Account", "select"],
    ["Name", "Name", "text"],
    ["Matched", "Matched", "checkbox"],
    ["Base Date", "BaseDate", "date"],
    ["Type", "Type", "text"],
    ["Currency", "Currency", "text"],
  ]],
  ["Loan", [
    ["Original Loan Amount", "LoanPrincipal", "number"],
    ["Year Taken (July 1)", "LoanStartDate", "year"],
    ["Interest Rate (%)", "LoanInterestRate", "number"],
    ["End Year — repays the remainder", "LoanEndDate", "year"],
    ["Interest Line", "ExpenseFcLineId", "fc-line-expense"],
    ["Outstanding Today (negative)", "MarketValue", "number"],
    ["Outstanding Today (USD)", "MarketValueUSD", "number"],
  ]],
  ["Tax", [
    ["Full Tax Override (%) — gains + income", "TaxRateOverride", "number"],
    ["Recurring Income Tax Override (%) — income only", "IncomeTaxRateOverride", "number"],
  ]],
];

/**
 * CR062 — does this form describe a loan?
 *
 * Matched case-insensitively AND with a fallback to the rate itself, because
 * `Type` is free text backed by a list the owner edits in Forecast Settings (prod
 * already carries a lowercase "asset"). If the type were the only signal, renaming
 * or mistyping it would hide the Loan section while the engine — which keys on
 * `loan_interest_rate` alone — went on charging interest, leaving live assumptions
 * that could not be edited or even seen.
 */
export const isLoanModule = (form) =>
  String(form?.Type || "").trim().toLowerCase() === "loan" ||
  form?.LoanInterestRate != null;

export const fieldSectionsFor = (form) =>
  (isLoanModule(form) ? LOAN_FIELD_SECTIONS : FIELD_SECTIONS);
