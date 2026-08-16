'use strict';
/**
 * moduleWrite — the editor's wire payload, translated into database columns.
 *
 * Extracted from `PUT /modules/:id` (CR084) because a SECOND caller now needs the identical
 * translation: the save-time consequence preview builds a throwaway copy and applies the pending
 * edit to it, and a preview that applies a *different* transformation from the save previews
 * something the save will not do.
 *
 * ⚠️ That is not a tidiness argument. The preview was first written against `repo.updateModule`
 * directly, with the editor's PascalCase body — which the repository does not understand — and
 * returned 400 on the first browser check. Had the shapes happened to overlap instead, it would
 * have previewed a partial edit silently: "no change" shown to an owner who had just changed an
 * amount. Two hand-maintained copies of a 24-branch mapping is the drift this codebase keeps
 * paying for (CR042's parallel lists, CR050's dropped column, CR078's dropped child column).
 *
 * What is deliberately NOT here: the cash-sweep priority CLASH checks and the loan-retype snapshot.
 * Those query other rows and belong to the route's request handling, not to the mapping. The sweep
 * priority MAPPING is here, because it changes what the engine reads.
 */

const validate = require('../utils/validate');
const crud = require('../../services/forecast/crud');

/** A body describes a loan when it carries an interest rate. Keyed on the rate, never on the
 *  free-text `module_type` the owner edits. */
const isLoanBody = (body) => body?.LoanInterestRate != null;

/**
 * A cash-sweep source must have a balance sheet and must not be a debt.
 *
 * Keyed on ENGINE-visible columns, never on `module_type`. Judged against the state the row will
 * HAVE after the write, so a save that ranks a module and flips it to a flow module in one body is
 * refused.
 */
function assertSweepEligible(row, name = 'This module') {
  if (row?.has_valuation === false) {
    throw validate.badRequest(
      `${name} has no balance sheet, so it cannot be a cash-sweep source — it would absorb ` +
      `unlimited deposits into a P&L account and could never fund a shortfall.`
    );
  }
  const mv = row?.market_value == null ? null : Number(row.market_value);
  if (mv != null && mv < 0) {
    throw validate.badRequest(
      `${name} carries a debt, so it cannot be a cash-sweep source — it can absorb deposits it ` +
      `cannot repay, and the sweep can never draw from a negative balance.`
    );
  }
}

/**
 * Translate an editor body into `forecast_modules` columns.
 *
 * Only what the body actually SENDS is mapped: a PUT that never mentions a field leaves it alone,
 * which is what lets the editor save one card without clearing the others.
 *
 * @param {object} body    the PascalCase editor payload
 * @param {object} before  the module as currently stored (for after-the-write judgements)
 * @returns {Promise<object>} column → value
 */
async function moduleBodyToColumns(body, before) {
  const updateData = {};

  if (body.Account !== undefined) {
    updateData.account_id = await crud.lookupAccountByName(body.Account);
  }
  if (body.Name !== undefined) updateData.name = body.Name;
  if (body.Type !== undefined) updateData.module_type = body.Type;
  if (body.Currency !== undefined) updateData.currency = body.Currency;
  if (body.TaxRateOverride !== undefined) updateData.tax_rate_override = body.TaxRateOverride;
  if (body.SetupStatus !== undefined) updateData.setup_status = body.SetupStatus;
  // CR069 P2 — `has_valuation` is a real, writable property: FALSE makes the module a pure P&L
  // container. Without this mapping there was no API path that could create one.
  if (body.HasValuation !== undefined) updateData.has_valuation = Boolean(body.HasValuation);
  if (body.BaseDate !== undefined) updateData.base_date = body.BaseDate;
  if (body.BaseValue !== undefined) updateData.base_value = body.BaseValue;
  if (body.MarketValue !== undefined) updateData.market_value = body.MarketValue;
  if (body.BaseValueUSD !== undefined) updateData.base_value_usd = body.BaseValueUSD;
  if (body.MarketValueUSD !== undefined) updateData.market_value_usd = body.MarketValueUSD;
  if (body.Growth !== undefined) updateData.growth_rate = isLoanBody(body) ? 0 : body.Growth;
  if (body.LoanPrincipal !== undefined) updateData.loan_principal = body.LoanPrincipal ?? null;
  if (body.LoanStartDate !== undefined) updateData.loan_start_date = body.LoanStartDate || null;
  if (body.LoanEndDate !== undefined) updateData.loan_end_date = body.LoanEndDate || null;
  if (body.LoanInterestRate !== undefined) updateData.loan_interest_rate = body.LoanInterestRate ?? null;
  if (body.SecuredAssetModuleId !== undefined) {
    updateData.secured_asset_module_id = body.SecuredAssetModuleId || null;
  }
  if (body.Comment !== undefined) updateData.comment = body.Comment;
  if (body.Matched !== undefined) updateData.is_matched = Boolean(body.Matched);

  // CR017: cash sweep is a priority-ordered set; the legacy `cash_sweep_target` boolean is kept in
  // sync as "priority == 1" for back-compat.
  if (body.CashSweepPriority !== undefined) {
    const raw = body.CashSweepPriority;
    const pri = (raw === null || raw === '' || !(Number(raw) > 0)) ? null : parseInt(raw, 10);
    if (pri != null) {
      assertSweepEligible(
        {
          has_valuation: updateData.has_valuation ?? before?.has_valuation,
          market_value: updateData.market_value ?? before?.market_value,
        },
        before?.name ? `"${before.name}"` : 'This module'
      );
    }
    updateData.cash_sweep_priority = pri;
    updateData.cash_sweep_target = pri === 1;
  } else if (body.CashSweepTarget !== undefined) {
    // Bare target toggle (older callers) maps onto the priority model: on → 1, off → null
    const on = Boolean(body.CashSweepTarget);
    updateData.cash_sweep_target = on;
    updateData.cash_sweep_priority = on ? 1 : null;
  }

  return updateData;
}

module.exports = { moduleBodyToColumns, assertSweepEligible, isLoanBody };
