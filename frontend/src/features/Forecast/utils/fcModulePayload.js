/**
 * fcModulePayload.js — builds the PUT body for a forecast module save.
 *
 * Extracted from FCModuleManage so it can be tested, because the failure mode here is
 * silent and expensive: the payload is an explicit **whitelist**, so a field the editor
 * renders but this builder omits is simply dropped on save. The user types a value, hits
 * Save, gets no error — and the field is empty when they come back.
 *
 * That is exactly what happened to CR046's window dates and CR047's income tax override:
 * both were wired through the editor, the API, the engine and the copy path, and both were
 * discarded here. The accompanying test asserts every field in FIELD_SECTIONS reaches the
 * payload, so the next field cannot repeat it.
 */

/** Fields coerced to a number; blank/absent ⇒ null (and 0 stays 0). */
const NUMERIC_FIELDS = [
  "Expense",
  "ExpenseAmount",
  "IncomeAmount",
  "Income",
  "BaseValue",
  "MarketValue",
  "BaseValueUSD",
  "MarketValueUSD",
  "Growth",
  "TaxRateOverride",
  "IncomeTaxRateOverride",
];

export function buildModulePayload(editForm = {}, { normalizeTransfers } = {}) {
  const payload = {
    Account: editForm.Account ?? "",
    Name: editForm.Name ?? "",
    Type: editForm.Type ?? "",
    Currency: editForm.Currency ?? "",
    ExpenseFcLineId: editForm.ExpenseFcLineId || null,
    IncomeFcLineId: editForm.IncomeFcLineId || null,
    ExpenseGrowthMethod: editForm.ExpenseGrowthMethod || "inflation",
    Matched: Boolean(editForm.Matched),
    BaseDate: editForm.BaseDate ? new Date(editForm.BaseDate).toISOString() : null,
    AccountNumber: editForm.AccountNumber ?? "",
    Comment: (editForm.Comment ?? "").toString().trim(),
    SetupStatus: editForm.SetupStatus || "new",
    // CR046 window — the year picker stores YYYY-07-01; blank stays null.
    IncomeStartDate: editForm.IncomeStartDate || null,
    IncomeEndDate: editForm.IncomeEndDate || null,
    ExpenseStartDate: editForm.ExpenseStartDate || null,
    ExpenseEndDate: editForm.ExpenseEndDate || null,
    CashSweepPriority:
      editForm.CashSweepPriority === null ||
      editForm.CashSweepPriority === undefined ||
      editForm.CashSweepPriority === ""
        ? null
        : Math.max(1, parseInt(editForm.CashSweepPriority, 10) || 1),
  };

  for (const field of NUMERIC_FIELDS) {
    const raw = editForm[field];
    const parsed = raw === "" || raw === null || raw === undefined ? null : Number(raw);
    payload[field] = Number.isNaN(parsed) ? null : parsed;
  }

  if (normalizeTransfers) {
    payload.Invest = normalizeTransfers(editForm.Invest);
    payload.Dispose = normalizeTransfers(editForm.Dispose);
    payload.IncomePct = normalizeTransfers(editForm.IncomePct);
  }

  return payload;
}
