/**
 * Forecast Routes
 *
 * Scenarios, modules, income/expense items, forecast generation,
 * and assumptions management.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const repo = require('../repositories').forecast;
const accountsRepo = require('../repositories').accounts;
const validate = require('../utils/validate');
const crud = require('../../services/forecast/crud');
const equity = require('../../services/forecast/equity'); // CR062 P2
const variants = require('../services/forecastVariants'); // CR050
const { baseYearFxRate } = require('../../services/forecast/fcbuilder-setup'); // CR051
const { generateForecast } = require('../../services/forecast');
const autoAdjust = require('../services/forecastAutoAdjust'); // CR053
const { PATHS } = require('../../services/forecast/constants');

// Fields PUT /scenarios/:id may set (mirrors updateScenario's own allow-list).
// The scenario editor sends only { cash_sweep_low, cash_sweep_high }; the rest
// are here because updateScenario accepts them. Unknown keys 400 instead of
// being silently dropped (CR043 N10). The richer module / income-expense write
// endpoints get the same treatment during the Phase 2.1 extraction, once each
// PascalCase form contract is enumerated against the frontend.
const SCENARIO_UPDATE_FIELDS = ['name', 'description', 'is_active', 'cash_sweep_low', 'cash_sweep_high'];

// CR043 N10 — the module / income-expense write contracts, enumerated at last.
//
// Both routes build their update object from an explicit PascalCase whitelist, so a key
// the caller sends but the route does not read is **silently dropped**: the user types a
// value, hits Save, gets a 200, and the field is empty when they come back. That is
// exactly how CR046's window dates and CR047's tax override were lost (v3.0.86) — and
// how three dead keys (`AccountNumber`, `Expense`, `Income`) went on being posted to a
// column that does not exist.
//
// These lists are a **superset of live traffic** (every key every caller actually sends,
// verified against the frontend), so nothing that works today can start 400ing. What they
// do catch is the next typo'd or newly-added-but-unwired field: it now fails loud instead
// of being accepted and ignored.
const MODULE_WRITE_FIELDS = [
  'Scenario', 'Account', 'Name', 'Type', 'Currency', 'Comment', 'Matched', 'SetupStatus',
  'BaseDate', 'BaseValue', 'MarketValue', 'BaseValueUSD', 'MarketValueUSD', 'Growth',
  'TaxRateOverride',
  'CashSweepPriority', 'CashSweepTarget',
  'Invest', 'Dispose',
  // CR069 P2 — the module's P&L streams, each with its own change schedule, plus the flag
  // that says whether the module has a balance sheet at all.
  'Streams', 'HasValuation',
  // CR069 P3 — the LEGACY per-direction fields are GONE from the contract. They were the
  // expand half of expand → migrate → contract while the editor still sent them; it now sends
  // `Streams`, so accepting them would be accepting a shape nothing produces and translating
  // it into rows nothing asked for. An old client sending them gets a 400 naming the field,
  // which is the point of this allow-list (CR043 N10) — silently dropping them is what it
  // exists to prevent.
  // CR062 — loan assumptions + the principal schedule
  'LoanPrincipal', 'LoanStartDate', 'LoanEndDate', 'LoanInterestRate', 'Amortization',
  'SecuredAssetModuleId',
];



/**
 * CR062 — is this write describing a LOAN? Keyed on the rate, never on `Type`:
 * module types are a user-editable free-text list in Forecast Settings and the
 * engine has never read that column, so a renamed type must not change what the
 * data means. `!= null` because 0% is a real rate.
 */
const isLoanBody = (body) => body?.LoanInterestRate != null;

/**
 * CR062 — a loan MUST post its interest somewhere. `cashChange` sums the expense
 * series unconditionally, but the expense only LANDS on a row if the category name
 * resolves in the categories frame. Probed on the real builder: a blank or unknown
 * expense category gives Bank Accounts −25,625 a year with the expense row all
 * zeros — cash leaves the plan every year and appears on no P&L line anywhere, in
 * Review or Compare, with nothing downstream able to detect it.
 *
 * Takes the EFFECTIVE value (body if present, else the stored row) so a partial
 * update stays legal.
 */
/**
 * CR070 P4 — who may be a cash-sweep source.
 *
 * Stated by what the sweep DOES, not by module type. At priority 1 the module is the DEPOSIT
 * target and excess cash is written into it unconditionally; on a shortfall, ranked modules are
 * drained against a balance series read from their own market-value entries. So a module may be
 * ranked iff it HAS a balance and that balance is an asset:
 *
 *   - `has_valuation = false`  ⇒ no balance series at all. It drains nothing and absorbs
 *     UNLIMITED deposits into a P&L account.
 *   - `market_value < 0`       ⇒ a debt. `availableFrom` clamps at zero, so it can never fund a
 *     shortfall, while still being listed as a source — which inverts what "ranked" means in
 *     CR045 §5: the engine reports a shortfall beside a source that cannot contribute.
 *
 * Keyed on ENGINE-visible columns, never on `module_type` — the type is a free-text list the
 * owner edits, and the loan guard above already keys on the rate for the same reason.
 *
 * Neither condition fires on today's data (ranks are held only by Stocks and Fixed Income), so
 * this closes a hazard rather than changing behaviour.
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

function assertLoanHasInterestLine(effectiveFcLineId) {
  if (effectiveFcLineId === undefined || effectiveFcLineId === null || effectiveFcLineId === '') {
    throw validate.badRequest('A loan needs an Interest Line — without one its interest would leave the bank balance without appearing on any P&L line.');
  }
}

/**
 * The same hazard as `assertLoanHasInterestLine`, on ANY stream — roadmap Known Issue #2.
 *
 * `Sarasota House` carried an expense of 45,000 with no FC line. The engine's stream loop does
 * `if (!line) continue` before posting to the P&L (`fcbuilder-module.js`), but the CASH path
 * further down takes every stream regardless — so the money left Bank Accounts and appeared on no
 * expense row. Measured on prod: **−1,203,432 across 21 years**, with Net Cash Flow and the
 * Expenses metric disagreeing by exactly that and no screen able to say why.
 *
 * CR062 closed this shape for loans and nothing guarded it anywhere else. Keyed on the amount
 * being non-zero, which is what makes a stream produce a flow at all: a 0-amount stream posts
 * nothing whichever mode it is in, so leaving its line unset is harmless and stays legal — 15
 * such rows exist on prod today and none of them are touched by this.
 *
 * Verified before shipping: **0 rows on prod are in the refused state**, so this closes a hazard
 * rather than blocking an existing edit.
 */
function assertStreamsHaveLines(streams) {
  if (!Array.isArray(streams)) return;
  for (const st of streams) {
    const line = st.FcLineId ?? st.fc_line_id ?? null;
    if (line !== null && line !== undefined && line !== '') continue;
    const amount = Number(st.Amount ?? st.amount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const direction = st.Direction ?? st.direction ?? 'flow';
    throw validate.badRequest(
      `This ${direction} has an amount but no P&L line. Without one the money would still leave ` +
      `the bank balance while appearing on no expense or income row — Net Cash Flow and the ` +
      `P&L would disagree by exactly that amount, with nothing on screen to say why.`
    );
  }
}

/**
 * CR062 P2 — a secured-asset link must point at a real, sane target. Checked
 * against the DB rather than the body because every failure mode is relational:
 *
 *  - ANOTHER SCENARIO's module. The Equity report would then show that scenario's
 *    house against this scenario's mortgage — two real numbers, nothing wrong to
 *    look at, and no balance check able to see it. Migration 048's DO block
 *    asserts the same invariant so a regression fails at deploy, not in a report.
 *  - ITSELF, which would make equity meaningless.
 *  - Another LOAN. "Secured against a mortgage" is not a thing; it would also
 *    subtract debt from debt.
 */
async function assertSecuredAssetLink(assetModuleId, loanScenarioId, loanModuleId) {
  if (assetModuleId == null) return;
  if (loanModuleId != null && Number(assetModuleId) === Number(loanModuleId)) {
    throw validate.badRequest('A loan cannot be secured against itself.');
  }
  const asset = await repo.findModuleById(assetModuleId);
  if (!asset) throw validate.badRequest('The asset this loan is secured against no longer exists.');
  if (loanScenarioId != null && Number(asset.scenario_id) !== Number(loanScenarioId)) {
    throw validate.badRequest('A loan can only be secured against an asset in the SAME scenario — otherwise the equity report would read another scenario\'s asset.');
  }
  if (asset.loan_interest_rate != null) {
    throw validate.badRequest('A loan cannot be secured against another loan.');
  }
}

/** Shared shape check for a module write body (POST and PUT send the same contract). */
function assertModuleBody(body) {
  validate.assertPlainObject(body, 'module');
  validate.assertAllowedFields(body, MODULE_WRITE_FIELDS, 'module');
  for (const f of ['BaseValue', 'MarketValue', 'BaseValueUSD', 'MarketValueUSD', 'Growth',
    'ExpenseAmount', 'IncomeAmount', 'TaxRateOverride', 'IncomeTaxRateOverride',
    'IncomeGrowth', 'LoanPrincipal', 'LoanInterestRate']) {
    if (body[f] !== undefined && body[f] !== null) {
      validate.assertFiniteNumber(body[f], f, { optional: true });
    }
  }
  if (body.Matched !== undefined) validate.assertBoolean(body.Matched, 'Matched');
  for (const f of ['Invest', 'Dispose', 'IncomePct', 'Amortization', 'IncomeSteps']) {
    if (body[f] !== undefined && !Array.isArray(body[f])) {
      throw validate.badRequest(`${f} must be an array`);
    }
  }

  // CR064 P3 — a module must be identifiable by SOMETHING. Prod carries two rows with
  // no name and no account: they were written by pressing **Generate** on a brand-new
  // module form, which saves the draft first, and nothing here refused them. They then
  // sit in the Modules table as blank rows nobody can identify, and `AccountType`
  // resolves to '' so they silently take the asset branch in the engine.
  //
  // The rule is deliberately "one or the other", not "both": an account with no name
  // and a name with no account are each meaningful. Only the empty pair is refused —
  // and no module in prod has ever had a name without an account, so nothing real is
  // caught by this. Migration 052 deletes the two that exist. (CR064 §4.3)
  if (body.Account !== undefined || body.Name !== undefined) {
    const hasAccount = String(body.Account ?? '').trim() !== '';
    const hasName = String(body.Name ?? '').trim() !== '';
    if (!hasAccount && !hasName) {
      throw validate.badRequest('module: needs an Account or a Name — a blank module cannot be identified');
    }
  }

  if (!isLoanBody(body)) return;

  // ── The loan guards ───────────────────────────────────────────────────────
  //
  // The Interest-Line requirement is NOT here: it depends on the module's
  // persisted state, and a PUT that touches only the rate must not be refused
  // because the body happens not to repeat a line the row already has. It lives
  // in `assertLoanHasInterestLine`, called with the MERGED value.
  //
  // 1. A loan cannot be a cash-sweep source.
  //
  //    CR070 P0 — THIS COMMENT WAS WRONG and is corrected rather than deleted, because it was
  //    quoted as evidence in a later design and nearly shipped a rule built on it. It claimed
  //    cash-sweep.js reads the balance as an ABSOLUTE, so a −400,000 loan would present as
  //    400,000 of sellable assets. There is no `Math.abs` on any balance in that file, and
  //    `availableFrom` clamps with `Math.max(0, …)` — a negative balance yields zero capacity,
  //    so a ranked liability drains nothing.
  //
  //    The refusal is still right, on the real failure modes: at priority 1 the module is the
  //    DEPOSIT target, and excess cash is written into it unconditionally with no balance series
  //    to bound it; and a ranked, zero-capacity source inverts what "ranked" means in CR045 §5 —
  //    the engine reports a shortfall while listing a source that can never contribute.
  const ranked = body.CashSweepPriority != null && body.CashSweepPriority !== '' && Number(body.CashSweepPriority) > 0;
  if (ranked || body.CashSweepTarget === true) {
    throw validate.badRequest('A loan cannot be a cash-sweep source — it holds a debt, so it can absorb deposits it cannot repay and can never fund a shortfall.');
  }

  // 2. The derivation owns the principal movements, so stored schedules are
  //    refused. An EMPTY array is accepted deliberately: it is how a module
  //    retyped Asset → Loan clears the rows it arrived with (see the retype
  //    clear-out below), and rejecting it would make those rows unclearable.
  for (const f of ['Invest', 'Dispose', 'IncomePct']) {
    if (Array.isArray(body[f]) && body[f].length > 0) {
      throw validate.badRequest(`A loan's ${f} schedule is derived from its own assumptions — remove the ${f} rows.`);
    }
  }

  // CR064 P6 — a loan has no income at all, so an income step on one describes
  // nothing. Empty stays accepted, for the same reason as the three above: it is how
  // a module retyped Asset → Loan clears the rows it arrived with.
  if (Array.isArray(body.IncomeSteps) && body.IncomeSteps.length > 0) {
    throw validate.badRequest('A loan has no income, so it cannot carry income steps — remove them.');
  }

  // 3. The amortization schedule is percentages, and a negative one is a silent
  //    re-draw (the balance would grow with nothing to flag it). The DB CHECK
  //    backs this up; failing here gives the owner a sentence instead of a
  //    constraint violation.
  for (const row of body.Amortization || []) {
    if (row?.Pct !== undefined && row.Pct !== null) {
      validate.assertFiniteNumber(row.Pct, 'Amortization.Pct', { optional: true });
      if (Number(row.Pct) < 0) throw validate.badRequest('An amortization percentage cannot be negative — that would draw the loan down again.');
    }
  }
}

// ============================================================================
// Assumptions (PostgreSQL — scenarios table + forecast_assumptions document;
// CR039 retired the FCAssump.json file backing)
// ============================================================================

const assumpRepo = require('../repositories').forecastAssumptions;

// GET /api/v2/forecast/assumptions
router.get('/assumptions', async (req, res, next) => {
  try {
    // Get scenarios from PostgreSQL
    const scenarios = await repo.findAllScenarios({ activeOnly: false });

    // Other assumptions (inflation, FX, tax rates, category list) from the
    // forecast_assumptions document (formerly FCAssump.json)
    const docAssumptions = await assumpRepo.getDoc();

    // Merge PeriodStart/PeriodEnd from the document's scenarios into DB scenarios
    const docScenarioMap = {};
    for (const dsc of (docAssumptions.scenarios || [])) {
      if (dsc.Name) docScenarioMap[dsc.Name] = dsc;
    }

    const scenariosFormatted = scenarios.map((s) => ({
      Name: s.name,
      Description: s.description,
      IsActive: s.is_active,
      id: s.id,
      // CR050 lineage. Every scenario dropdown in the app reads THIS endpoint, so a variant could
      // not be told from a base anywhere but the Scenarios page (which fetches /scenarios directly).
      // Additive: consumers that ignore it see the payload they always saw.
      ParentId: s.parent_scenario_id ?? null,
      ...(docScenarioMap[s.name]?.PeriodStart != null && { PeriodStart: docScenarioMap[s.name].PeriodStart }),
      ...(docScenarioMap[s.name]?.PeriodEnd != null && { PeriodEnd: docScenarioMap[s.name].PeriodEnd }),
    }));

    res.json({
      ...docAssumptions,
      scenarios: scenariosFormatted,
    });
  } catch (error) {
    console.error('[forecast/assumptions] Failed to load assumptions:', error);
    next(error);
  }
});

// PUT /api/v2/forecast/assumptions
router.put('/assumptions', async (req, res, next) => {
  try {
    const body = req.body || {};

    // Sync scenarios to PostgreSQL
    if (Array.isArray(body.scenarios)) {
      for (const scenario of body.scenarios) {
        if (!scenario.Name) continue;

        const found = await repo.findScenarioByName(scenario.Name);
        if (found) {
          await repo.updateScenario(found.id, {
            description: scenario.Description,
            is_active: scenario.IsActive !== false,
          });
        } else {
          await repo.createScenario({
            name: scenario.Name,
            description: scenario.Description,
            is_active: scenario.IsActive !== false,
          });
        }
      }
    }

    // Upsert the document keys (partial merge — untouched keys keep their
    // rows, same semantics as the old {...existing, ...body} file merge).
    // The 'scenarios' key keeps PeriodStart/PeriodEnd, which the engine needs.
    await assumpRepo.putDoc(body);

    // CR050: the inflation/FX/tax tables write the whole document directly, bypassing the override
    // system. On a VARIANT that edit would otherwise be invisible in the panel AND erased by the
    // next sync (which rewrites the variant's assumptions from its base). Capture it as an override
    // now, while intent is unambiguous — the user just saved. Each variant touched by this write
    // is reconciled against its base.
    const allScenarios = await repo.findAllScenarios({ activeOnly: false });
    const editedNames = new Set((body.scenarios || []).map((s) => s && s.Name).filter(Boolean));
    for (const s of allScenarios) {
      if (s.parent_scenario_id && (editedNames.size === 0 || editedNames.has(s.name))) {
        await variants.reconcileAssumptionOverrides(s.id);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[forecast/assumptions PUT] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Scenarios
// ============================================================================

// GET /api/v2/forecast/scenarios
router.get('/scenarios', async (req, res, next) => {
  try {
    const { activeOnly = 'true' } = req.query;
    const scenarios = await repo.findAllScenarios({ activeOnly: activeOnly === 'true' });
    res.json({ data: scenarios });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/forecast/scenarios/years/:scenario
// NOTE: Must be defined BEFORE /scenarios/:id to avoid route conflict
router.get('/scenarios/years/:scenario', async (req, res, next) => {
  try {
    const scenarioName = req.params.scenario?.trim();
    if (!scenarioName) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    const scenario = await repo.findScenarioByName(scenarioName);
    if (!scenario) {
      return res.json({ years: [] });
    }

    const years = await repo.findYearsByScenario(scenario.id);
    res.json({ years });
  } catch (error) {
    console.error('[forecast/scenarios/years] Failed:', error);
    next(error);
  }
});

// DELETE /api/v2/forecast/scenarios/byname/:name
router.delete('/scenarios/byname/:name', async (req, res, next) => {
  try {
    const name = req.params.name?.trim();
    if (!name) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    const scenario = await repo.findScenarioByName(name);
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    // CR050: a base with variants is protected by an FK (ON DELETE RESTRICT), which would
    // otherwise surface as a bare 500. Say what to do about it instead.
    const children = await variants.variantsOf(scenario.id);
    if (children.length > 0) {
      return res.status(409).json({
        error: `"${scenario.name}" is the base for ${children.map((c) => `"${c.name}"`).join(', ')}. Detach or delete ${children.length > 1 ? 'those variants' : 'that variant'} first.`,
      });
    }

    await repo.deleteScenario(scenario.id);
    res.json({ success: true });
  } catch (error) {
    console.error('[forecast/scenarios/byname DELETE] Failed:', error);
    next(error);
  }
});

// POST /api/v2/forecast/scenarios/byname/:name/copy
// PUT /api/v2/forecast/scenarios/:id
router.put('/scenarios/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    // CR043 N10: fail loud on a typo'd/unknown field instead of silently
    // dropping it (updateScenario reads only its known keys, so a misspelled
    // one used to be accepted-and-ignored with a 200).
    validate.assertPlainObject(req.body, 'scenario');
    validate.assertAllowedFields(req.body, SCENARIO_UPDATE_FIELDS, 'scenario');
    validate.assertFiniteNumber(req.body.cash_sweep_low, 'cash_sweep_low', { optional: true });
    validate.assertFiniteNumber(req.body.cash_sweep_high, 'cash_sweep_high', { optional: true });
    if (req.body.is_active !== undefined) {
      validate.assertBoolean(req.body.is_active, 'is_active');
    }
    // CR064 P1 — a rename has to carry the scenario's assumptions (period, inflation
    // path, FX paths, tax rate) with it: they live in the forecast_assumptions
    // document keyed by NAME, and a row renamed without them runs at 0% inflation
    // two saves later. `renameScenario` does both in one transaction; the remaining
    // fields go through the ordinary update.
    const { name, ...rest } = req.body;
    let updated = null;
    if (name !== undefined) {
      validate.assertNonEmptyString(name, 'name');
      updated = await repo.renameScenario(Number(id), name);
      if (!updated) {
        return res.status(404).json({ error: 'Scenario not found' });
      }
    }
    if (Object.keys(rest).length > 0) {
      updated = (await repo.updateScenario(Number(id), rest)) || updated;
    }
    if (!updated) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    // CR050: the sweep band is written straight to the scenario row here, but on a variant sync
    // rewrites it from base ⊕ override — so an un-captured band edit is erased. If a band field
    // changed on a variant, reconcile it into an override now (the row already holds the new value,
    // so the diff picks it up). See reconcileAssumptionOverrides.
    if (updated.parent_scenario_id &&
        (req.body.cash_sweep_low !== undefined || req.body.cash_sweep_high !== undefined)) {
      await variants.reconcileAssumptionOverrides(updated.id);
    }

    res.json({ data: updated });
  } catch (error) {
    console.error('[forecast/scenarios/:id] PUT failed:', error);
    next(error);
  }
});

router.post('/scenarios/byname/:name/copy', async (req, res, next) => {
  try {
    const sourceName = req.params.name?.trim();
    const newName = (req.body.newScenarioName || '').trim();

    if (!sourceName) {
      return res.status(400).json({ error: 'Source scenario name is required' });
    }
    if (!newName) {
      return res.status(400).json({ error: 'New scenario name is required' });
    }

    const sourceScenario = await repo.findScenarioByName(sourceName);
    if (!sourceScenario) {
      return res.status(404).json({ error: 'Source scenario not found' });
    }

    const newScenario = await repo.copyScenario(sourceScenario.id, newName);

    // If refreshFromActuals is set, update module base values from latest actuals
    const baseYear = req.body.baseYear || null;
    if (baseYear) {
      const asOfDate = `${baseYear}-12-31`;
      const rowCount = await crud.refreshModulesFromActuals(newScenario.id, asOfDate);
      console.log(`[copy] Updated ${rowCount} modules with ${baseYear} actuals`);
    }

    res.status(201).json({ success: true, data: newScenario });
  } catch (error) {
    console.error('[forecast/scenarios/byname/copy] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Scenario variants (CR050) — inherit-unless-overridden
//
// A variant stores only its overrides; syncVariant() materializes base ⊕ overrides into real
// rows, so everything downstream keeps reading an ordinary scenario. These are also the forecast
// API's FIRST real scenario-create route — creating a scenario is otherwise a side-effect of
// PUT /assumptions.
// ============================================================================

// POST /api/v2/forecast/scenarios/:id/variant — create a variant of :id
router.post('/scenarios/:id/variant', async (req, res, next) => {
  try {
    const baseId = parseInt(req.params.id, 10);
    const name = (req.body?.name || '').trim();
    if (!baseId || isNaN(baseId)) return res.status(400).json({ error: 'Invalid base scenario id' });
    if (!name) return res.status(400).json({ error: 'Variant name is required' });

    const variant = await variants.createVariant(baseId, { name, description: req.body?.description });
    res.status(201).json({ data: variant });
  } catch (error) {
    if (/already exists|not supported|not found/i.test(error.message)) {
      return res.status(409).json({ error: error.message });
    }
    console.error('[forecast/scenarios/variant POST] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/scenarios/:id/overrides — what makes this variant a variant
router.get('/scenarios/:id/overrides', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid scenario id' });
    // Carries each base row's own values (schedules included) so the panel can show was → now.
    res.json({ data: await variants.listOverridesWithBase(id) });
  } catch (error) {
    console.error('[forecast/scenarios/overrides GET] Failed:', error);
    next(error);
  }
});

// PUT /api/v2/forecast/scenarios/:id/overrides/assumption/:key — period / inflation / FX / tax / band
router.put('/scenarios/:id/overrides/assumption/:key', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid scenario id' });
    if (!variants.ASSUMPTION_KEYS.includes(req.params.key)) {
      return res.status(400).json({ error: `Unknown assumption key '${req.params.key}'` });
    }
    if (!('value' in (req.body || {}))) return res.status(400).json({ error: 'Body must carry { value }' });

    res.json({ data: await variants.setAssumptionOverride(id, req.params.key, req.body.value) });
  } catch (error) {
    console.error('[forecast/scenarios/overrides assumption PUT] Failed:', error);
    next(error);
  }
});

// DELETE /api/v2/forecast/scenarios/:id/overrides/:entityType/:baseEntityId — revert to base
// ?field=growth_rate reverts a single field; without it, the whole entity.
router.delete('/scenarios/:id/overrides/:entityType/:baseEntityId', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const baseEntityId = parseInt(req.params.baseEntityId, 10);
    const { entityType } = req.params;
    if (!id || isNaN(id) || !baseEntityId || isNaN(baseEntityId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    if (!['module', 'incexp'].includes(entityType)) {
      return res.status(400).json({ error: `Unknown entity type '${entityType}'` });
    }

    const result = await variants.clearOverride(id, entityType, baseEntityId, req.query.field || null);
    res.json({ data: result });
  } catch (error) {
    console.error('[forecast/scenarios/overrides DELETE] Failed:', error);
    next(error);
  }
});

// POST /api/v2/forecast/scenarios/:id/sync — re-materialize (?dryRun reports staleness)
router.post('/scenarios/:id/sync', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid scenario id' });

    if (req.query.dryRun !== undefined) {
      return res.json({ data: { stale: await variants.needsSync(id) } });
    }
    res.json({ data: await variants.syncVariant(id, { force: true }) });
  } catch (error) {
    console.error('[forecast/scenarios/sync POST] Failed:', error);
    next(error);
  }
});

// POST /api/v2/forecast/scenarios/:id/adopt-variant — convert an existing COPY into a variant
// Body: { baseId }. ?dryRun returns the diff without adopting — read it before you commit to it.
router.post('/scenarios/:id/adopt-variant', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const baseId = parseInt(req.body?.baseId, 10);
    if (!id || isNaN(id) || !baseId || isNaN(baseId)) {
      return res.status(400).json({ error: 'Both the scenario id and body.baseId are required' });
    }

    const result = await variants.adoptVariant(id, baseId, { dryRun: req.query.dryRun !== undefined });
    res.json({ data: result });
  } catch (error) {
    if (/not supported|already a variant|itself|not found/i.test(error.message)) {
      return res.status(409).json({ error: error.message });
    }
    console.error('[forecast/scenarios/adopt-variant POST] Failed:', error);
    next(error);
  }
});

// POST /api/v2/forecast/scenarios/:id/detach — promote a variant to a standalone scenario
router.post('/scenarios/:id/detach', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid scenario id' });
    res.json({ data: await variants.detachVariant(id) });
  } catch (error) {
    console.error('[forecast/scenarios/detach POST] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Cash-health warning dismissals (CR074)
// ============================================================================

/**
 * The warnings themselves are derived CLIENT-side (`fcWarnings.js`) from what the Review page
 * already loads, so there is nothing to compute here — only which of them the owner has looked
 * at and accepted, per scenario.
 *
 * `fingerprint` is required on a dismissal and is checked by the CLIENT on render: a dismissal
 * suppresses a warning only while the fingerprint still matches, so accepting "Sweep source
 * fully drained 2061" does not silence the same rule when the plan makes it 2041. The server
 * stores it rather than interpreting it — the substance being hashed is the warning copy, which
 * only the client has.
 */
async function scenarioIdFromQuery(req, res) {
  const name = (req.query.scenario || req.body?.scenario || '').trim();
  if (!name) {
    res.status(400).json({ error: 'A scenario is required' });
    return null;
  }
  const scenario = await repo.findScenarioByName(name);
  if (!scenario) {
    res.status(404).json({ error: `Scenario "${name}" not found` });
    return null;
  }
  return scenario.id;
}

// GET /api/v2/forecast/warnings/dismissals?scenario=NAME
router.get('/warnings/dismissals', async (req, res, next) => {
  try {
    const scenarioId = await scenarioIdFromQuery(req, res);
    if (scenarioId == null) return undefined;
    return res.json({ data: await repo.findWarningDismissals(scenarioId) });
  } catch (error) {
    console.error('[forecast/warnings/dismissals GET] Failed:', error);
    return next(error);
  }
});

// POST /api/v2/forecast/warnings/dismissals
// Body: { scenario, items: [{ warningId, fingerprint }] } — one item or twenty, same route, so
// "Dismiss all" is one request rather than N racing writes against the same unique index.
router.post('/warnings/dismissals', async (req, res, next) => {
  try {
    const scenarioId = await scenarioIdFromQuery(req, res);
    if (scenarioId == null) return undefined;

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }
    // Both fields are required: a dismissal with no fingerprint could never expire, which is
    // the one behaviour this feature must not have.
    const bad = items.find((it) => !it?.warningId || !it?.fingerprint);
    if (bad) {
      return res.status(400).json({ error: 'Every item needs a warningId and a fingerprint' });
    }
    const count = await repo.dismissWarnings(scenarioId, items);
    return res.json({ data: { dismissed: count } });
  } catch (error) {
    console.error('[forecast/warnings/dismissals POST] Failed:', error);
    return next(error);
  }
});

// DELETE /api/v2/forecast/warnings/dismissals?scenario=NAME[&warningId=ID]
// Without warningId this restores EVERY dismissal in the scenario — the undo for "Dismiss all".
router.delete('/warnings/dismissals', async (req, res, next) => {
  try {
    const scenarioId = await scenarioIdFromQuery(req, res);
    if (scenarioId == null) return undefined;
    const warningId = (req.query.warningId || '').trim() || null;
    const count = await repo.restoreWarnings(scenarioId, warningId);
    return res.json({ data: { restored: count } });
  } catch (error) {
    console.error('[forecast/warnings/dismissals DELETE] Failed:', error);
    return next(error);
  }
});

// ============================================================================
// Modules
// ============================================================================

/**
 * The PascalCase fields GET /modules and GET /modules/:id BOTH project, in one place.
 *
 * They used to be two hand-kept lists of ~35 keys each, and they drifted three times in three
 * days — every time the same way round, with the DETAIL projection missing something the LIST
 * had, and every time surfacing as the module editor guessing at state it should have been told:
 *
 *   v3.14.2  `HasValuation`   — the form could not tell whether a module has a balance sheet
 *   v3.15.0  the sweep fields — `buildModulePayload` had to guess the sweep rank
 *   v3.16.0  `fc_line_name`   — the Actual field read "no line set" on every module that had one
 *                               (that half is fixed in `loadModuleStreams`, which now joins)
 *
 * Adding a column here reaches both endpoints at once, which is the point. `moduleProjectionAgrees`
 * in the route tests asserts the two responses still agree key-for-key on everything below.
 *
 * What is deliberately NOT here, because the two genuinely differ:
 *   - `Type` — the LIST capitalises it for display, the DETAIL sends it raw for the editor's
 *     select. Normalising that silently is a behaviour change, not a de-duplication.
 *   - LIST-only: `Scenario`, the retired per-direction expense/income columns, the CR071 disposal
 *     SCALARS, and `Inheritance`.
 *   - DETAIL-only: the `Invest`/`Dispose` ROWS and the `Growth` alias.
 */
function moduleCommonFields(m) {
  return {
    id: m.id,
    Name: m.name,
    Account: m.account_name,
    Currency: m.currency,
    TaxRateOverride: m.tax_rate_override != null ? parseFloat(m.tax_rate_override) : null,
    BaseDate: m.base_date,
    BaseValue: m.base_value,
    MarketValue: m.market_value,
    BaseValueUSD: m.base_value_usd,
    MarketValueUSD: m.market_value_usd,
    GrowthRate: m.growth_rate,
    Comment: m.comment,
    IsMatched: m.is_matched,
    Matched: m.is_matched,
    SetupStatus: m.setup_status || 'new',
    HasValuation: m.has_valuation !== false,
    CashSweepTarget: m.cash_sweep_target || false,
    CashSweepPriority: m.cash_sweep_priority ?? null,
    // CR062 — the loan assumptions and their schedule, so `fcWarnings` can derive the loan rules
    // client-side from what FCReview already loads.
    LoanPrincipal: m.loan_principal != null ? parseFloat(m.loan_principal) : null,
    LoanStartDate: m.loan_start_date,
    LoanEndDate: m.loan_end_date,
    LoanInterestRate: m.loan_interest_rate != null ? parseFloat(m.loan_interest_rate) : null,
    SecuredAssetModuleId: m.secured_asset_module_id ?? null,
    Amortization: (m.amortization || []).map((r) => ({
      Date: r.effective_date,
      Pct: parseFloat(r.pct) || 0,
    })),
  };
}

/** The keys both module endpoints must agree on — exported so a test can assert they do. */
const MODULE_COMMON_KEYS = Object.keys(moduleCommonFields({}));

// GET /api/v2/forecast/modules
router.get('/modules', async (req, res, next) => {
  try {
    const { scenario } = req.query;
    let modules = [];

    let inheritance = null;

    if (scenario) {
      const scenarioObj = await repo.findScenarioByName(scenario);
      if (scenarioObj) {
        // CR050: a variant materializes lazily. Sync on READ (and at build), never as a fan-out
        // from a base write — a variant whose resolved state is invalid must not be able to fail
        // an edit to its base.
        if (scenarioObj.parent_scenario_id) {
          await variants.syncIfStale(scenarioObj.id);
          inheritance = await variants.inheritanceMap(scenarioObj.id, 'module');
        }
        modules = await repo.findModulesByScenario(scenarioObj.id);
      }
    } else {
      modules = await crud.listAllModulesRaw();
    }

    // Transform to PascalCase for frontend
    const transformed = modules.map((m) => ({
      Streams: m.streams || [],
      HasValuation: m.has_valuation !== false,
      ...m,
      ...moduleCommonFields(m),
      Scenario: m.scenario_name || scenario,
      // Capitalised for DISPLAY. The DETAIL endpoint sends it raw because the editor's select
      // matches on the stored value — which is why `Type` is not in the shared projection.
      Type: m.module_type ? m.module_type.charAt(0).toUpperCase() + m.module_type.slice(1) : '',
      // The retired per-direction columns, still projected for callers that have not moved to
      // streams. CR069 P3 replaced the FORM; these stay until nothing reads them.
      ExpenseAmount: m.expense_amount,
      ExpenseFcLineId: m.expense_fc_line_id,
      IncomeFcLineId: m.income_fc_line_id,
      ExpenseGrowthMethod: m.expense_growth_method || 'inflation',
      IncomeTaxRateOverride: m.income_tax_rate_override != null ? parseFloat(m.income_tax_rate_override) : null,
      IncomeAmount: m.income_amount,
      IncomeStartDate: m.income_start_date,
      IncomeEndDate: m.income_end_date,
      ExpenseStartDate: m.expense_start_date,
      ExpenseEndDate: m.expense_end_date,
      // CR071 — disposal summary (counts + earliest year), not the schedule. See the repository
      // query for why the list carries scalars here and not the rows.
      DisposeCount: Number(m.dispose_count) || 0,
      DisposeFullCount: Number(m.dispose_full_count) || 0,
      DisposeFirstYear: m.dispose_first_year ?? null,
      // CR050 — Inherited · Overridden · Local, and which fields were overridden.
      Inheritance: variants.rowInheritance(inheritance, m),
    }));

    // {data} envelope (CR043 N8). This used to return a BARE array while its sibling
    // GET /modules/:id returned {data} — so a caller had to know which, and getting it
    // wrong fails silently (undefined.map never runs; the page just renders empty). That
    // is precisely how the Modify Transfer modal broke: it read transfers off the list
    // response, which does not carry them, and showed "no transfers" for two years.
    res.json({ data: transformed });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/forecast/modules/unmatched
// NOTE: Must be defined BEFORE /modules/:id to avoid route conflict
router.get('/modules/unmatched', async (req, res, next) => {
  try {
    const scenarioName = req.query.scenario?.trim();

    const tree = await accountsRepo.getNestedTree({ section: 'balance_sheet' });
    if (!tree || tree.length === 0) {
      return res.json({ data: [] });
    }

    const root = tree.find(n => n.name === 'Balance Sheet Accounts');
    const structure = root && root.children.length > 0 ? root.children : tree;

    // Get matched names for the scenario
    let matchedNames = new Set();
    if (scenarioName) {
      const scenario = await repo.findScenarioByName(scenarioName);
      if (scenario) {
        matchedNames = await repo.findMatchedModuleNames(scenario.id);
      }
    }

    // Extract leaf accounts, excluding children of matched parent accounts
    const allAccounts = [];
    const collectLeaves = (nodes, category, ancestorMatched) => {
      for (const node of nodes) {
        if (!node || !node.name) continue;
        const thisMatched = ancestorMatched || matchedNames.has(node.name);
        if (!node.children || node.children.length === 0) {
          const isBankAccount = typeof category === 'string' &&
            category.toLowerCase().includes('bank account');
          // Skip if this leaf or any ancestor is matched
          if (!thisMatched) {
            allAccounts.push({ name: node.name, category, isBankAccount });
          }
        } else {
          collectLeaves(node.children, node.name, thisMatched);
        }
      }
    };
    collectLeaves(structure, null, false);

    const unmatched = allAccounts.filter(account =>
      !account.isBankAccount
    );

    res.json({ data: unmatched });
  } catch (error) {
    console.error('[forecast/modules/unmatched] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/modules/:id
// Returns a single module with nested arrays (IncomePct, Invest, Dispose)
router.get('/modules/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const module = await repo.findModuleById(Number(id));
    if (!module) {
      return res.status(404).json({ error: 'Module not found' });
    }

    // Transform to PascalCase with nested arrays
    const m = module;
    res.json({
      data: {
        ...m,
        // CR069 P3 — streams, in their own shape. The legacy projection retired with the
        // columns it projected onto: the form renders stream cards now, so there is one shape
        // on the wire instead of a row-model translated into a column-model and back.
        Streams: await crud.loadModuleStreams(m.id),
        ...moduleCommonFields(m),
        // Raw, not capitalised: the editor's type select matches on the stored value. The LIST
        // capitalises for display, which is why `Type` is not in the shared projection.
        Type: m.module_type,
        Growth: m.growth_rate,
        // The schedule ROWS, which the list deliberately carries only as scalars.
        Invest: (m.investments || []).map(r => ({
          Date: r.investment_date,
          Amount: parseFloat(r.amount) || 0,
          Flag: r.flag || '',
          DateEnd: r.date_end || null,
        })),
        Dispose: (m.disposals || []).map(r => ({
          Date: r.disposal_date,
          Amount: parseFloat(r.amount) || 0,
          Flag: r.flag || '',
          DateEnd: r.date_end || null,
        })),
      },
    });
  } catch (error) {
    console.error('[forecast/modules/:id] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/equity?scenario=NAME
// CR062 P2 — asset value gross, less the debt secured against it, equals equity;
// plus what the asset earns net of what the debt costs. Read-only, and derived
// entirely from entries the engine already wrote.
router.get('/equity', async (req, res, next) => {
  try {
    const scenarioName = (req.query.scenario || '').trim();
    if (!scenarioName) return res.status(400).json({ error: 'scenario is required' });
    const scenario = await repo.findScenarioByName(scenarioName);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    res.json({ data: await equity.getEquityReport(scenario.id) });
  } catch (error) {
    next(error);
  }
});

// GET /api/v2/forecast/modules/:id/loan-retype-preview
// CR062 — what turning this module into a loan would DESTROY, without destroying
// it. The UI confirms with these counts on the first save that flips a module to
// Loan; a module already saved as a loan has nothing left to clear, so it never
// re-prompts. Shares its implementation with the write path, so the number shown
// and the number cleared cannot drift apart.
router.get('/modules/:id/loan-retype-preview', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const module = await repo.findModuleById(id);
    if (!module) return res.status(404).json({ error: 'Module not found' });
    res.json({ data: await crud.previewLoanRetype(id) });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/forecast/modules
// Accepts PascalCase fields with embedded arrays (Invest, Dispose, IncomePct)
router.post('/modules', async (req, res, next) => {
  try {
    const body = req.body || {};
    assertModuleBody(body);
    const scenarioName = (body.Scenario || '').trim();

    if (!scenarioName) {
      return res.status(400).json({ error: 'Scenario is required' });
    }

    const scenario = await repo.findScenarioByName(scenarioName);
    if (!scenario) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    const accountId = await crud.lookupAccountByName(body.Account);

    const moduleData = {
      scenario_id: scenario.id,
      account_id: accountId,
      name: body.Name || '',
      module_type: body.Type || null,
      currency: body.Currency || 'USD',
      // CR069 P2 — the retired income_/expense_ COLUMNS are not written on create either.
      // The per-direction fields in the body are routed to `crud.replaceModuleStreams` below;
      // writing both would give a variant save an override on a column nothing reads.
      has_valuation: body.HasValuation === undefined ? true : Boolean(body.HasValuation),
      // CR070 P0 (D7) — these four were in MODULE_WRITE_FIELDS and absent from this object, so a
      // create ACCEPTED them, validated them, and threw them away with no 400. That is the exact
      // CR046/CR047 silently-dropped-field class, on the route whose allow-list exists to prevent
      // it. `setup_status` in particular meant a module created as 'complete' came back 'new' —
      // configured, and excluded from every forecast, with nothing saying so.
      setup_status: body.SetupStatus || 'new',
      tax_rate_override: body.TaxRateOverride ?? null,
      cash_sweep_target: body.CashSweepTarget === true,
      cash_sweep_priority: body.CashSweepPriority === '' || body.CashSweepPriority == null
        ? null : Number(body.CashSweepPriority),
      base_date: body.BaseDate || null,
      base_value: body.BaseValue ?? 0,
      market_value: body.MarketValue ?? 0,
      base_value_usd: body.BaseValueUSD ?? 0,
      market_value_usd: body.MarketValueUSD ?? 0,
      growth_rate: isLoanBody(body) ? 0 : (body.Growth ?? 0),
      comment: body.Comment || null,
      is_matched: Boolean(body.Matched),
      // CR062 — ?? not ||, so a 0% rate stays a rate rather than becoming "not a loan".
      loan_principal: body.LoanPrincipal ?? null,
      loan_start_date: body.LoanStartDate || null,
      loan_end_date: body.LoanEndDate || null,
      loan_interest_rate: body.LoanInterestRate ?? null,
      secured_asset_module_id: body.SecuredAssetModuleId ?? null,
    };

    if (isLoanBody(body)) {
      assertLoanHasInterestLine(
        (body.Streams || []).find((st) => (st.Direction ?? st.direction) === 'expense')?.FcLineId ?? null
      );
    }
    assertStreamsHaveLines(body.Streams);
    await assertSecuredAssetLink(body.SecuredAssetModuleId ?? null, scenario.id, null);

    const module = await repo.createModule(moduleData);

    // CR062 — the loan's principal schedule (the other three arrays below are
    // rejected non-empty on a loan, so only one of these ever has rows).
    if (Array.isArray(body.Amortization)) {
      for (const row of body.Amortization) {
        if (row.Date) {
          await repo.setAmortization(module.id, {
            effective_date: row.Date,
            pct: row.Pct ?? row.Value ?? row.Amount ?? 0,
          });
        }
      }
    }

    // Handle embedded arrays
    if (Array.isArray(body.Invest)) {
      for (const inv of body.Invest) {
        if (inv.Date || inv.Amount !== undefined) {
          await repo.addInvestment(module.id, {
            investment_date: inv.Date,
            amount: inv.Amount,
            flag: inv.Flag || '',
            note: inv.Note || '',
            date_end: inv.DateEnd || null,
          });
        }
      }
    }

    if (Array.isArray(body.Dispose)) {
      for (const disp of body.Dispose) {
        if (disp.Date || disp.Amount !== undefined) {
          await repo.addDisposal(module.id, {
            disposal_date: disp.Date,
            amount: disp.Amount,
            flag: disp.Flag || '',
            note: disp.Note || '',
            date_end: disp.DateEnd || null,
          });
        }
      }
    }

    if (Array.isArray(body.IncomePct)) {
      for (const pct of body.IncomePct) {
        if (pct.Date) {
          await repo.setIncomePct(module.id, {
            effective_date: pct.Date,
            value: pct.Amount ?? pct.Value ?? 0,
          });
        }
      }
    }

    // CR064 P6 — permanent income step changes.
    if (Array.isArray(body.IncomeSteps)) {
      for (const step of body.IncomeSteps) {
        if (step.Date) {
          await repo.setIncomeStep(module.id, {
            effective_date: step.Date,
            amount: step.Amount ?? 0,
          });
        }
      }
    }

    // CR069 P2 — streams, from either shape (see the PUT handler).
    await crud.replaceModuleStreams(module.id, body);

    res.status(201).json({ data: module });
  } catch (error) {
    console.error('[forecast/modules POST] Failed:', error);
    next(error);
  }
});

// PUT /api/v2/forecast/modules/:id
// Accepts PascalCase fields with embedded arrays (Invest, Dispose, IncomePct)
router.put('/modules/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const body = req.body || {};
    assertModuleBody(body);

    // CR062 — the relational guards run BEFORE the write, against the state the
    // write WOULD produce.
    //
    // An earlier revision checked them afterwards, on the row as saved. It
    // returned the right 400 and left the bad value in the database — a loan
    // secured against itself, or stripped of the interest line the guard exists
    // to require. The caller sees a rejection and the row is corrupted anyway,
    // which is strictly worse than no guard at all. Two of this CR's own tests
    // caught it.
    const before = await repo.findModuleById(id);
    if (!before) return res.status(404).json({ error: 'Module not found' });

    const willBeLoan = body.LoanInterestRate !== undefined
      ? body.LoanInterestRate != null
      : before.loan_interest_rate != null;
    if (willBeLoan) {
      // CR069 P3 — a loan's interest line is the FC line on its expense stream. The effective
      // value is the body's if it sends streams at all, else the stream as stored, so a PUT
      // that touches only the rate is still legal.
      const bodyLine = Array.isArray(body.Streams)
        ? (body.Streams.find((st) => (st.Direction ?? st.direction) === 'expense')?.FcLineId ?? null)
        : undefined;
      const storedLine = (await crud.loadModuleStreams(id))
        .find((st) => st.direction === 'expense')?.fc_line_id ?? null;
      assertLoanHasInterestLine(bodyLine !== undefined ? bodyLine : storedLine);
    }
    // Only what the body actually sends: a PUT that never mentions streams leaves them alone, so
    // refusing it on the strength of a stored row would block edits to unrelated fields.
    assertStreamsHaveLines(body.Streams);
    if (body.SecuredAssetModuleId !== undefined) {
      await assertSecuredAssetLink(body.SecuredAssetModuleId || null, before.scenario_id, id);
    }

    // Build update data from PascalCase fields
    const updateData = {};

    if (body.Account !== undefined) {
      updateData.account_id = await crud.lookupAccountByName(body.Account);
    }
    if (body.Name !== undefined) updateData.name = body.Name;
    if (body.Type !== undefined) updateData.module_type = body.Type;
    if (body.Currency !== undefined) updateData.currency = body.Currency;
    if (body.TaxRateOverride !== undefined) updateData.tax_rate_override = body.TaxRateOverride;
    if (body.SetupStatus !== undefined) updateData.setup_status = body.SetupStatus;
    // CR069 P2 — `has_valuation` is a real, writable property: FALSE makes the module a pure
    // P&L container (what an Expenditure item became). Without this mapping there was no API
    // path that could create one — a new expense item saved with has_valuation TRUE, zero
    // values, and CR041's ownership gate then zeroed its stream: accepted, stored, and
    // silently absent from the forecast.
    if (body.HasValuation !== undefined) updateData.has_valuation = Boolean(body.HasValuation);
    // The retired income_/expense_ COLUMNS are deliberately NOT written here any more. They
    // are still ACCEPTED (the editor sends them until P3) but they are routed only to
    // `crud.replaceModuleStreams`. Writing them too would let a variant save turn one into an
    // override on a column the engine no longer reads — migration 058's post-condition
    // re-broken by the running app, which is this CR's own §6 argument arriving through the
    // write path.
    if (body.BaseDate !== undefined) updateData.base_date = body.BaseDate;
    if (body.BaseValue !== undefined) updateData.base_value = body.BaseValue;
    if (body.MarketValue !== undefined) updateData.market_value = body.MarketValue;
    if (body.BaseValueUSD !== undefined) updateData.base_value_usd = body.BaseValueUSD;
    if (body.MarketValueUSD !== undefined) updateData.market_value_usd = body.MarketValueUSD;
    // CR062 — Growth is COERCED to 0 on a loan, never rejected. buildModulePayload
    // always emits Growth from editForm, so a module retyped Asset (Growth 1.0) →
    // Loan would 400 on every save with no visible field to fix. Growth on a
    // liability capitalizes interest into the balance, double-counting the
    // interest line.
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
    // CR017: cash sweep is now a priority-ordered set (cash_sweep_priority); the legacy
    // cash_sweep_target boolean is kept in sync as "priority == 1" for back-compat.
    if (body.CashSweepPriority !== undefined) {
      const raw = body.CashSweepPriority;
      const pri = (raw === null || raw === '' || !(Number(raw) > 0)) ? null : parseInt(raw, 10);
      // Judged on the state the row will HAVE after this write, not the one it has now: a save
      // that ranks a module and flips it to a flow module in the same body must be refused.
      if (pri != null) {
        assertSweepEligible(
          { has_valuation: updateData.has_valuation ?? before?.has_valuation,
            market_value: updateData.market_value ?? before?.market_value },
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

    // Keep priorities unique within a scenario: REJECT a rank already held by another
    // module (no silent eviction) and keep the legacy single-target flag unique to priority 1.
    if (updateData.cash_sweep_priority != null) {
      const existing = await repo.findModuleById(id);
      if (existing) {
        // CR050: on a VARIANT the same "no silent eviction" rule holds for the owner's own
        // explicit choices — but a merely INHERITED rank yields to them (sync displaces it), and
        // clearOtherCashSweepTargets would write sibling rows the next sync erases.
        const inherited = await variants.inheritedRow('module', id);
        if (inherited) {
          const clash = await variants.explicitPriorityClash(
            inherited.scenario_id, inherited.origin_base_id, updateData.cash_sweep_priority
          );
          if (clash) {
            return res.status(409).json({
              error: `Cash sweep priority ${updateData.cash_sweep_priority} is already overridden onto "${clash.name}" in this variant. Pick a different rank, or revert that module's priority first.`,
            });
          }
        } else {
          const clash = await crud.findCashSweepPriorityClash(existing.scenario_id, id, updateData.cash_sweep_priority);
          if (clash) {
            return res.status(409).json({
              error: `Cash sweep priority ${updateData.cash_sweep_priority} is already used by "${clash.name}". Pick a different rank, or clear that module's priority first.`,
            });
          }
          if (updateData.cash_sweep_priority === 1) {
            // Legacy flag stays unique to the primary (no DB-level eviction of a real priority)
            await crud.clearOtherCashSweepTargets(existing.scenario_id, id);
          }
        }
      }
    }

    // Update module fields if any provided
    let module = null;
    if (Object.keys(updateData).length > 0) {
      module = await repo.updateModule(id, updateData);
      if (!module) {
        return res.status(404).json({ error: 'Module not found' });
      }
    } else {
      module = await repo.findModuleById(id);
      if (!module) {
        return res.status(404).json({ error: 'Module not found' });
      }
    }

    // CR062 — snapshot what the retype will destroy BEFORE anything is written.
    // The editor sends empty Invest/Dispose/IncomePct arrays on a loan (that is how
    // stale rows get cleared at all), so those rows are already gone by the time the
    // clear-out below runs — and the echoed count would read 1 where the preview the
    // owner confirmed said 4. Same number, taken at the same moment.
    const clearedSnapshot = isLoanBody(body) ? await crud.previewLoanRetype(id) : null;

    // Handle embedded arrays — replace all if provided. One transaction for
    // the whole replace: a failure mid-reinsert must not leave the module's
    // schedule wiped by the leading DELETEs (CR037 P5).
    if (Array.isArray(body.Invest) || Array.isArray(body.Dispose) ||
        Array.isArray(body.IncomePct) || Array.isArray(body.Amortization) ||
        Array.isArray(body.IncomeSteps)) {
      await crud.replaceModuleSchedules(id, body);
    }

    // CR069 P2 — the module's P&L streams. Handles the new `Streams` array AND the legacy
    // per-direction fields the Modules editor still sends until P3 replaces that form, so a
    // save keeps working across the two deploys.
    await crud.replaceModuleStreams(id, body);

    // CR062 — becoming a loan CLEARS what a loan cannot carry: the CR046 expense
    // window (applyWindow runs after the interest branch and would halve and
    // truncate it — measured, an expense window of 2030–2032 turns a flat
    // 25,625…32,002 into 0 0 0 13,797.66 28,285.21 14,496.17 0 0 0 0) and any
    // Invest/Dispose/IncomePct rows the module arrived with, since the derivation
    // owns those. A leftover Flag:'Full' disposal would zero the balance outright.
    //
    // This is the only data-destroying operation in the feature, so it is
    // reported before it happens: `GET /modules/:id/loan-retype-preview` returns
    // the counts, the UI confirms with them, and the response echoes what was
    // cleared. Nothing is destroyed without the caller having been able to see it
    // first (the CR028 dry-run / CR033 confirm precedent).
    let cleared = null;
    if (isLoanBody(body)) {
      await crud.clearForLoanRetype(id);
      cleared = clearedSnapshot;
    }

    const updated = await repo.findModuleById(id);
    res.json({ data: updated, ...(cleared ? { cleared } : {}) });
  } catch (error) {
    console.error('[forecast/modules PUT] Failed:', error);
    next(error);
  }
});

// DELETE /api/v2/forecast/modules/:id
router.delete('/modules/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }

    const deleted = await repo.deleteModule(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Module not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[forecast/modules DELETE] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Seed from Actuals / Budget
// ============================================================================

// POST /api/v2/forecast/modules/add-from-actuals
// Returns BS account tree with year-end balances for creating new modules.
// Excludes Bank Accounts subtree and accounts already used as modules in the scenario.
router.post('/modules/add-from-actuals', async (req, res, next) => {
  try {
    const { scenario, baseYear } = req.query;
    if (!scenario || !baseYear) {
      return res.status(400).json({ error: 'Missing required query params: scenario, baseYear' });
    }

    const scenarioRow = await repo.findScenarioByName(scenario);
    if (!scenarioRow) {
      return res.status(404).json({ error: `Scenario "${scenario}" not found` });
    }

    const payload = await crud.buildAddFromActualsTree(scenarioRow.id, baseYear);
    res.json(payload);
  } catch (error) {
    console.error('[forecast/modules/add-from-actuals] Failed:', error);
    next(error);
  }
});

// CR070 P0 — `PATCH /modules/bulk-update` DELETED.
//
// It wrote base_value, base_value_usd, market_value, market_value_usd and base_date with no
// `assertAllowedFields`, no numeric validation, and **no caller anywhere in `frontend/src`** —
// an unauthenticated, unvalidated write path into exactly the columns the engine reads for a
// valuation. Dead API surface is not inert: it is a way for a value to arrive in a field that
// nothing on screen would then explain (the CR062 `isLoanModule` hazard, generalised).
//
// If a bulk valuation update is ever wanted, it goes through `assertModuleBody` like every
// other write.

// ============================================================================
// Income/Expense Items
// ============================================================================

// GET /api/v2/forecast/incomeexpense
// ============================================================================
// Income/expense items — RETIRED by CR069 P2, tables dropped in P3.
//
// An Expenditure item is now a module with `has_valuation = FALSE` and one stream, managed
// through /modules like everything else. These four routes are answered with 410 Gone rather
// than deleted outright, and that is still deliberate in P3: a browser holding an old bundle
// can outlive several deploys, and a 410 that NAMES the replacement is a better answer than
// the 404 a deleted route would give — the client learns the resource is gone rather than
// mistyped. The tables they wrote to are dropped by migration 060.
// ============================================================================
const INCEXP_GONE = {
  error: 'Income/expense items are now modules. Use /api/v2/forecast/modules — an item is a '
       + 'module with has_valuation=false and a single stream (CR069 P2).',
};
for (const [method, path] of [
  ['get', '/incomeexpense'], ['post', '/incomeexpense'],
  ['put', '/incomeexpense/:id'], ['delete', '/incomeexpense/:id'],
]) {
  router[method](path, (_req, res) => res.status(410).json(INCEXP_GONE));
}

router.get('/entries', async (req, res, next) => {
  try {
    const scenarioName = req.query.scenario?.trim();
    const entries = await repo.findAllEntries(scenarioName);
    res.json({ entries });
  } catch (error) {
    console.error('[forecast/entries] Failed:', error);
    next(error);
  }
});

// POST /api/v2/forecast/generate/:scenario
// GET /api/v2/forecast/base-year-values
// Returns base year P&L values from completed modules and expenses, grouped by FC Line name
router.get('/base-year-values', async (req, res, next) => {
  try {
    const scenarioName = req.query.scenario?.trim();
    if (!scenarioName) return res.status(400).json({ error: 'scenario is required' });

    const scenario = await repo.findScenarioByName(scenarioName);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    // The base year is PeriodStart - 1, and PeriodStart lives in the assumptions doc, not
    // on the scenarios table. It is needed so a stream whose CR046 window has not opened
    // yet is left out of the base-year column (rent starting in 2028 is not 2026 income).
    let baseYear = null;
    try {
      const doc = await assumpRepo.getDoc();
      const entry = (doc?.scenarios || []).find((sc) => sc.Name === scenarioName);
      const periodStart = Number(entry?.PeriodStart);
      if (Number.isFinite(periodStart)) baseYear = periodStart - 1;
    } catch {
      // Fall back to no window filter rather than failing the whole request.
    }

    const values = await crud.getBaseYearValues(scenario.id, baseYear);
    res.json({ data: values });
  } catch (error) {
    console.error('[forecast/base-year-values] Failed:', error);
    next(error);
  }
});

router.post('/generate/:scenario', async (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();
    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    const result = await generateForecast(scenario);

    if (result.success) {
      res.json({
        message: 'Forecast generation completed',
        scenario: result.scenario,
        deletedCount: result.deletedCount,
        modulesProcessed: result.modulesProcessed,
        entriesCreated: result.entriesCreated,
        durationMs: result.durationMs,
      });
    } else {
      res.status(500).json({
        error: 'Forecast generation failed',
        details: result.error,
        scenario: result.scenario,
        durationMs: result.durationMs,
      });
    }
  } catch (error) {
    console.error('[forecast/generate] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Auto-Adjust (CR053) — solve the least uniform spend cut that funds the plan
// ============================================================================

// GET /api/v2/forecast/auto-adjust/lines/:scenario — candidate expense lines to cut
router.get('/auto-adjust/lines/:scenario', async (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();
    if (!scenario) return res.status(400).json({ error: 'Scenario name is required' });
    const lines = await autoAdjust.listExpenseLines(scenario);
    if (lines === null) return res.status(404).json({ error: 'Scenario not found' });
    res.json({ scenario, lines });
  } catch (error) {
    console.error('[forecast/auto-adjust/lines] Failed:', error);
    next(error);
  }
});

// POST /api/v2/forecast/auto-adjust/solve — start a solve job (async; poll the returned jobId)
// body: { scenarioName, lines:[{type,id}], minRetain?, tolerance? }
router.post('/auto-adjust/solve', async (req, res, next) => {
  try {
    const { scenarioName, lines, minRetain, tolerance } = req.body || {};
    if (!scenarioName) return res.status(400).json({ error: 'scenarioName is required' });
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'at least one expense line is required' });
    }
    const jobId = autoAdjust.startSolveJob({ scenarioName, lines, minRetain, tolerance });
    res.status(202).json({ jobId, status: 'running' });
  } catch (error) {
    console.error('[forecast/auto-adjust/solve] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/auto-adjust/solve/:jobId — poll a solve job
router.get('/auto-adjust/solve/:jobId', (req, res, next) => {
  try {
    const job = autoAdjust.getSolveJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found or expired' });
    res.json({
      status: job.status,
      ...(job.status === 'done' ? { result: job.result } : {}),
      ...(job.status === 'error' ? { error: job.error } : {}),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v2/forecast/auto-adjust/apply — persist the cut as a variant override + verify
// body: { scenarioName, lines:[{type,id}], retain, variantName? }
router.post('/auto-adjust/apply', async (req, res, next) => {
  try {
    const { scenarioName, lines, retain, variantName } = req.body || {};
    if (!scenarioName) return res.status(400).json({ error: 'scenarioName is required' });
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'at least one expense line is required' });
    }
    if (!(retain > 0 && retain <= 1)) return res.status(400).json({ error: 'retain must be in (0, 1]' });
    const result = await autoAdjust.applySpendReduction({ scenarioName, lines, retain, variantName });
    res.json(result);
  } catch (error) {
    console.error('[forecast/auto-adjust/apply] Failed:', error);
    next(error);
  }
});

// ============================================================================
// Audit Trail (file-based)
// ============================================================================

// GET /api/v2/forecast/audittrail/:scenario/cash-sweep
// Returns the cash sweep audit trail CSV for a scenario
// NOTE: Must be before /:scenario/:module to avoid wildcard match
router.get('/audittrail/:scenario/cash-sweep', (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();

    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    const safeScenario = (scenario || '').replace(/[^a-z0-9]/gi, '_');
    const auditDir = PATHS.AUDIT_TRAIL_DIR;
    const filePath = path.join(auditDir, `${safeScenario}_cash_sweep.csv`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'No cash sweep audit trail found. Generate the forecast with a cash target and sweep module first.' });
    }

    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length === 0) {
      return res.json({ headers: [], rows: [], lastModified: stat.mtime });
    }
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => line.split(',').map(v => v.trim()));

    res.json({ headers, rows, lastModified: stat.mtime, scenario });
  } catch (error) {
    console.error('[forecast/audittrail/cash-sweep] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/audittrail/:scenario/:module
router.get('/audittrail/:scenario/:module', (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();
    const moduleName = req.params.module?.trim();

    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }
    if (!moduleName) {
      return res.status(400).json({ error: 'Module name is required' });
    }

    // Must match the writers exactly (fcbuilder-module/-incexp): non-alphanumerics
    // → '_', case preserved, repeats NOT collapsed. The old `normalize` here
    // lowercased and collapsed '_+', so it could never match a real file — and it
    // read from a `dataPaths.fcAuditTrail`/`.baseDir` that does not exist, so
    // path.join(undefined) threw "The 'path' argument must be of type string".
    const sanitize = (v) => (v || '').replace(/[^a-z0-9]/gi, '_');

    const safeScenario = sanitize(scenario);
    const safeModule = sanitize(moduleName);

    // `_cash_sweep` is a SYNTHETIC module: the engine attributes swept cash to it, so it
    // shows up as a clickable module in the Review breakdown — but its trail is written
    // by the sweep, to `<scenario>_cash_sweep.csv`, not `<scenario>_<module>_entries.csv`.
    // Clicking it therefore 404'd. Serve the sweep's file here (in this route's row-object
    // shape, which is what the audit-trail modal renders) rather than leaving the one
    // module in the breakdown that cannot be opened.
    const isCashSweep = /^_?cash_sweep$/i.test(safeModule);
    const fileName = isCashSweep
      ? `${safeScenario}_cash_sweep.csv`
      : `${safeScenario}_${safeModule}_entries.csv`;
    const auditDir = PATHS.AUDIT_TRAIL_DIR;
    const filePath = path.join(auditDir, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audit trail not found' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return res.json({ headers: [], rows: [] });
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const values = line.split(',');
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i]?.trim() || ''; });
      return row;
    });

    res.json({ headers, rows });
  } catch (error) {
    console.error('[forecast/audittrail] Failed:', error);
    next(error);
  }
});

// GET /api/v2/forecast/audittrail/:scenario/:module/detail
// Returns LC, USD, and entries audit trail CSVs for a BS module
router.get('/audittrail/:scenario/:module/detail', (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();
    const moduleName = req.params.module?.trim();

    if (!scenario || !moduleName) {
      return res.status(400).json({ error: 'Scenario and module name are required' });
    }

    const sanitize = (v) => (v || '').replace(/[^a-z0-9]/gi, '_');
    const safeScenario = sanitize(scenario);
    const safeModule = sanitize(moduleName);
    const auditDir = PATHS.AUDIT_TRAIL_DIR;

    const parseCsv = (filePath) => {
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length === 0) return { headers: [], rows: [], lastModified: stat.mtime };
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1).map(line => line.split(',').map(v => v.trim()));
      return { headers, rows, lastModified: stat.mtime };
    };

    const lc = parseCsv(path.join(auditDir, `${safeScenario}_${safeModule}_LC.csv`));
    const usd = parseCsv(path.join(auditDir, `${safeScenario}_${safeModule}_USD.csv`));
    const entries = parseCsv(path.join(auditDir, `${safeScenario}_${safeModule}_entries.csv`));

    if (!lc && !usd && !entries) {
      return res.status(404).json({ error: 'No audit trail found. Generate the forecast first.' });
    }

    res.json({ lc, usd, entries, scenario, module: moduleName });
  } catch (error) {
    console.error('[forecast/audittrail/detail] Failed:', error);
    next(error);
  }
});

// DELETE /api/v2/forecast/audittrail/:scenario
router.delete('/audittrail/:scenario', (req, res, next) => {
  try {
    const scenario = req.params.scenario?.trim();

    if (!scenario) {
      return res.status(400).json({ error: 'Scenario name is required' });
    }

    // Same writer-consistent sanitize as the GET routes (see note above); the old
    // `normalize` + `dataPaths.baseDir` here had the identical two bugs.
    const sanitize = (v) => (v || '').replace(/[^a-z0-9]/gi, '_');

    const prefix = (sanitize(scenario) + '_').toLowerCase();
    const auditDir = PATHS.AUDIT_TRAIL_DIR;

    if (!fs.existsSync(auditDir)) {
      return res.json({ success: true, deletedCount: 0 });
    }

    const files = fs.readdirSync(auditDir);
    let deletedCount = 0;

    for (const file of files) {
      if (file.toLowerCase().startsWith(prefix)) {
        fs.unlinkSync(path.join(auditDir, file));
        deletedCount++;
      }
    }

    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error('[forecast/audittrail DELETE] Failed:', error);
    next(error);
  }
});

module.exports = router;
// The shared module projection, exported so `forecast.projection-parity.test.js` can assert the
// LIST and DETAIL responses still agree on every key in it.
module.exports.MODULE_COMMON_KEYS = MODULE_COMMON_KEYS;
