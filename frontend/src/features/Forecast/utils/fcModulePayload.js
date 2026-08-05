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
  "BaseValue",
  "MarketValue",
  "BaseValueUSD",
  "MarketValueUSD",
  "Growth",
  "TaxRateOverride",
  // CR062 — blank stays null, and null is what "not a loan" means to the engine.
  "LoanPrincipal",
  "LoanInterestRate",
  // CR064 P6 — blank stays null, and null is what "grow at inflation" means to the
  // engine. 0 is a real multiplier (flat in nominal terms), not "unset".
];

export function buildModulePayload(editForm = {}, { normalizeTransfers } = {}) {
  const payload = {
    Account: editForm.Account ?? "",
    Name: editForm.Name ?? "",
    Type: editForm.Type ?? "",
    Currency: editForm.Currency ?? "",
    Matched: Boolean(editForm.Matched),
    // CR069 P2 added `has_valuation`; P3 shipped the stream cards and left this unreachable, so
    // no UI path could create a flow module — every module made here became a balance-sheet one
    // whatever the type said.
    //
    // ABSENT MUST MEAN TRUE, and the direction is the whole risk. `editForm.HasValuation` is
    // undefined on the create path (the draft seeds it, but GET /modules/:id did not project it
    // until this change), so a `Boolean(...)` here would create every new Real Estate, Business
    // and Stocks module as a FLOW module — the engine zeroes its base value, market value and
    // growth, and CR041's gate zeroes its streams. A new property would book nothing, forever,
    // with no error. This mirrors the route's own default (forecast.js: `=== undefined ? true`).
    HasValuation: editForm.HasValuation === undefined ? true : Boolean(editForm.HasValuation),
    BaseDate: editForm.BaseDate ? new Date(editForm.BaseDate).toISOString() : null,
    // (AccountNumber removed with CR043 N10 — there is no such column, and the route
    //  never read it; the API now rejects unknown fields rather than dropping them.)
    Comment: (editForm.Comment ?? "").toString().trim(),
    SetupStatus: editForm.SetupStatus || "new",
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

  // CR069 P3 — the module's streams, sent as ROWS. Replaces the whole Expense*/Income*
  // family plus IncomePct and IncomeSteps: a stream carries its own line, mode, amount,
  // growth, window, tax and change schedule, and a direction the module has no stream for is
  // simply ABSENT from the array rather than present-and-zero. That is what makes "remove
  // the card" mean "delete the row" instead of "leave a stale value nothing renders".
  payload.Streams = (Array.isArray(editForm.Streams) ? editForm.Streams : []).map((st) => ({
    Direction: st.direction,
    Mode: st.mode || "amount",
    FcLineId: st.fc_line_id ?? null,
    Amount: st.amount === "" || st.amount == null ? 0 : Math.abs(Number(st.amount)),
    GrowthMult: st.growth_mult === "" || st.growth_mult == null ? null : Number(st.growth_mult),
    StartDate: st.start_date || null,
    EndDate: st.end_date || null,
    TaxRateOverride:
      st.tax_rate_override === "" || st.tax_rate_override == null
        ? null
        : Number(st.tax_rate_override),
    Changes: (Array.isArray(st.changes) ? st.changes : [])
      .filter((c) => c && c.change_date)
      .map((c) => ({
        Date: c.change_date,
        Amount: c.amount === "" || c.amount == null ? 0 : Number(c.amount),
        Flag: c.flag,
      })),
  }));

  if (normalizeTransfers) {
    // CR062 — a loan's principal schedule is derived, and the route REJECTS a
    // non-empty Invest/Dispose/IncomePct on one. Sending empty arrays is not a
    // no-op: it is how a module retyped Asset → Loan clears the rows it arrived
    // with, which is the only way those rows can ever be removed.
    const loan = isLoanModule(editForm);
    payload.Invest = loan ? [] : normalizeTransfers(editForm.Invest);
    payload.Dispose = loan ? [] : normalizeTransfers(editForm.Dispose);

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
