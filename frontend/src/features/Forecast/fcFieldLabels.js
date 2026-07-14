/**
 * CR050 — DB column → the label the owner already sees on the edit form.
 *
 * The overrides panel used to print raw column names (`growth_rate`, `income_pct`), which asks the
 * reader to translate a schema into the form they actually filled in. Labels here are kept
 * WORD-FOR-WORD identical to `fcModulesEditSections.js` / the income-expense modal — if the field
 * is called "Growth (x Inflation)" where you type it, it is called that where it is reported.
 */

const MODULE_LABELS = {
  account_id: "Account",
  name: "Name",
  module_type: "Type",
  currency: "Currency",
  is_matched: "Matched",
  setup_status: "Status",
  comment: "Comment",
  base_date: "Base Date",

  base_value: "Cost Basis",
  base_value_usd: "Cost Basis (USD)",
  market_value: "Market Value",
  market_value_usd: "Market Value (USD)",
  growth_rate: "Growth (x Inflation)",

  expense_fc_line_id: "Expense Line",
  expense_amount: "Expense Amount (Base Yr)",
  expense_growth_method: "Expense Growth",
  expense_start_date: "Expense Start Year",
  expense_end_date: "Expense End Year",

  income_fc_line_id: "Income Line",
  income_amount: "Income Amount (Base Yr)",
  income_start_date: "Income Start Year",
  income_end_date: "Income End Year",

  tax_rate_override: "Full Tax Override",
  income_tax_rate_override: "Recurring Income Tax Override",

  cash_sweep_priority: "Cash Sweep Priority",
  cash_sweep_target: "Cash Sweep Target",

  // Schedules — whole lists, not scalars.
  income_pct: "Yield Spread schedule",
  investments: "Investments schedule",
  disposals: "Disposals schedule",
};

const INCEXP_LABELS = {
  account_id: "Account",
  name: "Name",
  item_type: "Type",
  currency: "Currency",
  is_matched: "Matched",
  setup_status: "Status",
  comment: "Comment",
  base_date: "Base Date",
  base_value: "Base Value",
  base_value_usd: "Base Value (USD)",
  growth_rate: "Growth",
  fc_line_id: "FC Line",
  budget_source_year: "Budget Source Year",
  changes: "Changes schedule",
};

const ASSUMPTION_LABELS = {
  inflation: "Inflation path",
  FX: "FX rates",
  "Tax Rate": "Tax Rate (%)",
  PeriodStart: "Period Start",
  PeriodEnd: "Period End",
  cash_sweep_low: "Cash Sweep Low",
  cash_sweep_high: "Cash Sweep High",
};

/** The human label for a field, falling back to a de-underscored column name. */
export function fieldLabel(entityType, field) {
  const table =
    entityType === "module" ? MODULE_LABELS
    : entityType === "incexp" ? INCEXP_LABELS
    : ASSUMPTION_LABELS;
  return table[field] || field.replace(/_/g, " ");
}

/** True for the patch keys that carry a whole child list rather than a scalar. */
export function isScheduleField(field) {
  return ["income_pct", "investments", "disposals", "changes", "inflation", "FX"].includes(field);
}

/**
 * Render a schedule (a whole child list) as the values it actually holds.
 *
 * "1 entry → 1 entry" is not a report, it is a shrug — it hides the very number that was edited.
 * A yield-spread override has to read "2027: -0.5% → 2027: 1%", because that IS the change.
 */
export function formatSchedule(field, list) {
  if (!Array.isArray(list) || list.length === 0) return "—";

  const suffix = field === "income_pct" ? "%" : "";
  const parts = list.map((row) => {
    const date = row.effective_date || row.investment_date || row.disposal_date || row.change_date;
    const value = row.value ?? row.amount;
    const year = date ? String(date).slice(0, 4) : null;
    const shown = `${formatFieldValue(value)}${suffix}`;
    return year ? `${year}: ${shown}` : shown;
  });

  // Long schedules would swamp the row; show the shape and let the module's own editor carry detail.
  return parts.length <= 3 ? parts.join(", ") : `${parts.slice(0, 3).join(", ")} +${parts.length - 3} more`;
}

/**
 * Render a stored value for display. Dates print as the calendar day they denote — the form sends
 * them as full ISO timestamps, and "2025-12-31T00:00:00.000Z" in a summary panel is noise.
 */
export function formatFieldValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "entry" : "entries"}`;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)) return value.slice(0, 10);

  const n = Number(value);
  if (!Number.isNaN(n) && value !== true) {
    return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(4)));
  }
  return String(value);
}
