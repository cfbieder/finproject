# CR041 — Module Ownership-Gated Expenses/Income + Edit-Form Regrouping

**Status:** ✅ RELEASED v3.0.62 (2026-07-11) — engine + form, verified live on dev pre-release. No open items.
**Track:** v3 — no DB migration, no flags. Backend engine + frontend modal.
**Anchor in FC_NEXT_STEPS.md:** [cr041](../FC_NEXT_STEPS.md#cr041)

## Problem

1. **Running costs of a future-purchase asset start at base year.** A balance-sheet module modelling an asset bought mid-plan (Market Value = 0 at Base Date + an Invest `OneTime` transfer in a future year, e.g. a house bought 2027) generates its `Expense Amount (Base Yr)` / `Income Amount (Base Yr)` streams from the module's Base Date onward (`fcbuilder-module.js` — the expense loop runs `startyear..endyear` with no awareness of when ownership begins). Property costs for a 2027 house hit the P&L from 2025. The `pct_of_value` expense-growth mode has the same bug via a different path: with base MV = 0 the derived percentage is 0 and the code falls back to inflation-compounding from base year.
   The only ownership-aware logic today is on the exit side: a **Full disposal** halves expense/income in the sale year and zeroes them after — there is no mirror on the acquisition side.
2. **Edit-form fields interleave income and expense.** `FCModulesEdit.jsx` renders one flat `fields` array into a 3-column grid, so rows mix topics (e.g. *Expense Amount | Expense Growth | Income Line*). Expense fields and income fields should each be grouped.

## Owner decisions (settled 2026-07-11)

1. **Auto-derive the start — no new field, no migration.** Expenses/income begin in the first year the module has value; **50% of the computed expense/income in the acquisition year** (mirroring the Full-disposal 50% treatment). Rejected alternatives: explicit start-year column (opt-in but requires a migration and can silently disagree with the actual purchase year); auto + override (field most modules would never use).
2. **Form layout: titled sections** (General / Valuation / Expenses / Income / Tax), not a flat reorder.

## Design — engine (P1)

**Ownership start.** After the invest/dispose application loop has produced `marketValues[]`:

- If the module's base Market Value > 0 → owned from module start (`ownershipStartIdx = 0`, **no proration** — current behavior, unchanged).
- Else `ownershipStartIdx` = first index where `marketValues[i] !== 0` (i.e. the first effective Invest year). This year is the **acquisition year** and gets the 50% proration.
- If MV is 0 for the whole plan (no invest ever) → no expense/income generated at all (today they generate forever; also covered by the gate).

**Gating rule** (applies identically to assets and liabilities):

- `expenseValues[i] = 0` and amount-based `incomeValues[i] = 0` for `i < ownershipStartIdx`.
- At `i === ownershipStartIdx` (when acquired mid-plan via transfer): 50% of the computed value.
- After: unchanged.

**Which streams are gated:**

| Stream | Gated? | Why |
|---|---|---|
| Expense, `inflation` mode (absolute `expense_amount` compounded) | **Yes** | The core bug. |
| Expense, `pct_of_value` zero-base-MV inflation fallback | **Yes** | Same bug, second path. |
| Expense, `pct_of_value` with base MV > 0 | No gate needed | Owned from start; MV-scaled by construction. |
| Income, absolute `income_amount` mode | **Yes** | Symmetric with expenses. |
| Income, yield-spread (`IncomePct`) mode | **No change** | Driven by avg MV: pre-purchase avg MV = 0 → 0 income; acquisition year avg = (0 + MV)/2 → naturally half. Adding the gate would double-halve. |

**Amount semantics unchanged:** `Expense Amount (Base Yr)` stays denominated in scenario-base-year dollars and is inflation-compounded to each year (`periodNum` relative to `periodStart`); the gate only zeroes/halves the output years. So a 10k/yr (today's dollars) house cost entered on a 2027 purchase shows as ~½ × 10k-inflated-to-2027 in 2027 and the full inflated amount from 2028.

**Tax interaction:** the deferred-tax loop reads `incomeValues[]`/`realizedGainValues[]`, so it follows the gated streams automatically. One explicit fix: the special block that defers tax on base-year `income_amount` to Period 1 fires whenever `absIncomeAmount > 0` — it must be **skipped when `ownershipStartIdx > 0`** (no base-year income existed).

**Disposal interplay:** the Full-disposal 50%/zero adjustment runs after gating, unchanged. Buy-and-Full-dispose in the *same* year compounds both halvings (25% of a year's costs) — accepted edge case, documented, not special-cased.

**Known behavior change (intended):** existing scenarios containing future-purchase modules lose their pre-purchase expense/income years on the next forecast build — that is precisely the correction. Modules with base MV > 0 must produce **byte-identical** output (regression-tested).

**Out of scope:**

- **Ownership gaps** (deplete to zero mid-plan, re-invest later): only the *initial* pre-ownership window is gated; expenses through a mid-plan zero-MV gap behave as today.
- Pre-purchase committed costs: model directly on the FC line as a dated Fixed $ change in the Income & Expenses step.
- The `marketValuesUSD[0]` base-year override quirk (asset shows $0 in the purchase year if Base Date is set to the purchase year) — unrelated path, users should keep Base Date = scenario base year; noted here for the record.

## Design — edit-form regrouping (P2)

Restructure the flat `fields` array in `FCModulesEdit.jsx` into titled sections, each starting its own grid (reuse the existing `fc-modules-modal__section` header styling):

- **General** — Account, Name, Matched, Base Date, Type, Currency
- **Valuation** — Cost Basis, Cost Basis (USD), Market Value, Market Value (USD), Growth (x Inflation)
- **Expenses** — Expense Line, Expense Amount (Base Yr), Expense Growth
- **Income** — Income Line, Income Amount (Base Yr)
- **Tax** — Tax Rate Override (%)

The existing sub-panels (Invest Transfers, Dispose Transfers, Yield Spread) stay below; *optionally* move the Yield Spread panel to sit directly under the Income section since it is income configuration. Layout only — no field behavior changes.

## Tests

Backend (`server/src/services/forecast/__tests__/fcbuilder-module.test.js`):
1. MV = 0 + Invest OneTime year N: expense = 0 pre-N, 50% of inflated amount at N, full from N+1; same for `income_amount`; no Period-1 base-income tax, deferred tax starts N+1.
2. Regression: module with base MV > 0 → output byte-identical to pre-CR values (incl. expense/income/tax arrays).
3. `pct_of_value` with base MV = 0 + future invest: fallback stream gated.
4. Yield-spread income with future purchase: unchanged by the gate (already 0 pre-purchase, half-avg in year N).
5. Future purchase year N + Full disposal year M > N: costs run N (half) → M (half), zero outside.
6. No invest ever + MV 0: no expense/income at all.

Frontend (Vitest): section-grouping render test — each field label appears under its section heading.

## As-built (2026-07-11)

**P1 — engine** (`fcbuilder-module.js`, three edits):
- `acquisitionIdx` computed after the invest/dispose value loop and **before** the Full-disposal block (so a same-year buy+dispose still registers its acquisition year): `0` when base MV ≠ 0 or the first Invest lands in the module's base year (owned from start — no gating, no proration, byte-identical output); otherwise the first index where `marketValues[] ≠ 0`; `-1` if never owned.
- Gating block after the income calculation, before the Full-disposal expense/income adjustments: when `acquisitionIdx !== 0`, amount-based streams (`expense_amount` when > 0 — inflation mode and the pct_of_value zero-MV fallback alike, since base MV is necessarily 0 here; `income_amount` when > 0 and no `IncomePct` schedule) are zeroed before the acquisition year and halved in it. MV-driven streams (yield-spread income, legacy `expense_pct`) untouched, as designed.
- The Period-1 tax block on base-year `income_amount` now requires `acquisitionIdx === 0`.

**P2 — form regrouping:** the flat `fields` array became `FIELD_SECTIONS` in a new [`fcModulesEditSections.js`](../../frontend/src/features/Forecast/fcModulesEditSections.js) (own module — exporting it from the component file trips `react-refresh/only-export-components`). `FCModulesEdit.jsx` maps sections → `.fc-modules-modal__field-group` with an uppercase `.fc-modules-modal__group-title` rule (theme tokens + the file's existing rgba-green border idiom); the per-field renderer is unchanged. Invest/Dispose/Yield-Spread sub-panels stay below (the optional Yield-Spread move was skipped — layout-only diff kept minimal).

**Tests:** 7 new Jest cases (C1–C7: gating, 50% proration, income+tax deferral start, yield-not-double-halved, purchase→Full-disposal window, never-owned, base-year-invest no-proration) — forecast suites 50/50, backend 259 total. Pre-existing test T5.6 (pct_of_value zero-MV fallback) now seeds ownership with a base-year Invest, per the new contract. 4 new Vitest cases lock the `FIELD_SECTIONS` grouping (order, membership, no field lost/duplicated) — frontend 121 green; `vite build` green; the file's 7 lint problems all pre-date the change (verified against HEAD).

**Live verification (dev, 2026-07-11):** disposable module on scenario "CR040 Test B" (MV 0, expense 12,000 on Property Costs, Invest OneTime 500,000 @ 2030), full generate run: Property Costs absent 2026–2029, **2030 = −6,622.88** (exactly half the inflation-grown amount), 2031+ full; purchase year reconciles (asset +500,000, Transfer −500,000, bank −506,622.88). Test module deleted and the scenario regenerated back to its prior 1,442 entries. Neither dev nor prod has any existing module in the affected shapes (MV 0 + expense/income), so **no live scenario's numbers change** on deploy until such a module is created.

## Deploy

v3 — backend engine + frontend rebuild together; no migration, no flags. Commit scope `feat(cr041)`.
