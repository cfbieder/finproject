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
  ["Expenses", [
    ["Expense Line", "ExpenseFcLineId", "fc-line-expense"],
    ["Expense Amount (Base Yr)", "ExpenseAmount", "number"],
    ["Expense Growth", "ExpenseGrowthMethod", "growth-method"],
  ]],
  ["Income", [
    ["Income Line", "IncomeFcLineId", "fc-line-income"],
    ["Income Amount (Base Yr)", "IncomeAmount", "number"],
  ]],
  ["Tax", [
    ["Tax Rate Override (%)", "TaxRateOverride", "number"],
  ]],
];
