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

import { isLoanModule } from "../fcModulesEditSections.js";

/**
 * Fields coerced to a number; blank/absent ⇒ null (and 0 stays 0).
 *
 * `Expense` and `Income` used to be here alongside `ExpenseAmount`/`IncomeAmount`.
 * They were dead: not rendered by FIELD_SECTIONS, not read by the route, no column.
 * Dropped in the CR043 N10 pass, which makes the API reject unknown fields — sending
 * a phantom key would now 400 instead of being quietly ignored.
 */
const NUMERIC_FIELDS = [
  "ExpenseAmount",
  "IncomeAmount",
  "BaseValue",
  "MarketValue",
  "BaseValueUSD",
  "MarketValueUSD",
  "Growth",
  "TaxRateOverride",
  "IncomeTaxRateOverride",
  // CR062 — blank stays null, and null is what "not a loan" means to the engine.
  "LoanPrincipal",
  "LoanInterestRate",
  // CR064 P6 — blank stays null, and null is what "grow at inflation" means to the
  // engine. 0 is a real multiplier (flat in nominal terms), not "unset".
  "IncomeGrowth",
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
    // (AccountNumber removed with CR043 N10 — there is no such column, and the route
    //  never read it; the API now rejects unknown fields rather than dropping them.)
    Comment: (editForm.Comment ?? "").toString().trim(),
    SetupStatus: editForm.SetupStatus || "new",
    // CR046 window — the year picker stores YYYY-07-01; blank stays null.
    IncomeStartDate: editForm.IncomeStartDate || null,
    IncomeEndDate: editForm.IncomeEndDate || null,
    ExpenseStartDate: editForm.ExpenseStartDate || null,
    ExpenseEndDate: editForm.ExpenseEndDate || null,
    // CR062 loan assumptions — year pickers, stored YYYY-07-01 like CR046's window.
    LoanStartDate: editForm.LoanStartDate || null,
    LoanEndDate: editForm.LoanEndDate || null,
    // CR062 P2 — blank means unsecured, so "" must become null rather than 0.
    SecuredAssetModuleId:
      editForm.SecuredAssetModuleId === "" || editForm.SecuredAssetModuleId == null
        ? null
        : Number(editForm.SecuredAssetModuleId),
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
    // CR062 — a loan's principal schedule is derived, and the route REJECTS a
    // non-empty Invest/Dispose/IncomePct on one. Sending empty arrays is not a
    // no-op: it is how a module retyped Asset → Loan clears the rows it arrived
    // with, which is the only way those rows can ever be removed.
    const loan = isLoanModule(editForm);
    payload.Invest = loan ? [] : normalizeTransfers(editForm.Invest);
    payload.Dispose = loan ? [] : normalizeTransfers(editForm.Dispose);
    payload.IncomePct = loan ? [] : normalizeTransfers(editForm.IncomePct);
    // CR064 P6 — a loan has no income, so it cannot carry steps; the empty array is
    // how a module retyped Asset → Loan clears the ones it arrived with.
    payload.IncomeSteps = loan
      ? []
      : (Array.isArray(editForm.IncomeSteps) ? editForm.IncomeSteps : [])
          .filter((row) => row && row.Date)
          .map((row) => ({
            Date: row.Date,
            Amount: row.Amount === "" || row.Amount == null ? 0 : Number(row.Amount),
          }));
    if (loan) {
      payload.Amortization = (Array.isArray(editForm.Amortization) ? editForm.Amortization : [])
        .filter((row) => row && row.Date)
        .map((row) => ({
          Date: row.Date,
          Pct: row.Pct === "" || row.Pct == null ? 0 : Number(row.Pct),
        }));
    }
  }

  return payload;
}
