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
  ["Tax", [
    ["Tax Rate Override (%)", "TaxRateOverride", "number"],
  ]],
];
