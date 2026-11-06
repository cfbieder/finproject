# CR102 — Budget builder: Compare Forecast (a build against a forecast scenario's year, in the forecast's P&L) — COMPLETED

**Status:** COMPLETED 2026-11-06 — **live v3.87.0** (§9). Built the same day it was approved; no migration.

Rev 3 (2026-11-06):
- Pass 1 `cr-technical-reviewer`: REVISE on rev 1, addressed in rev 2.
- Pass 2 `cr-signoff-pm`: **GO** on rev 2, on three conditions, applied in rev 3 (§7, §8).
- Owner decisions D1–D5 taken 2026-11-06 (§3).
- Build now: target 2026-11-20, hard stop 2026-11-26.

**Depends on:** CR098, CR100 and CR101 (the builder, its lines, inactive lines); CR069 (forecast lines and
stored forecast entries); CR083 (the LE); CR064 (the annual-close context).
**Roadmap anchor:** [project-roadmap.md#cr102](../current/project-roadmap.md#cr102)
**Deadline context:** the builder code freeze is **2026-12-03**, and the first 2027 publish is due **2026-12-10**
(§7).

## 1. The ask

A **Compare Forecast** button on the budget builder opens a modal. It sets the selected build against a chosen
forecast scenario or variant for the build's year, for example *2027 v6 (V3)* against *2026 Base, 2027*. It
uses the same P&L layout as Forecast Review.

The question it answers: **does my draft budget match what the plan assumed for that year, and where does it
differ?**

## 2. What exists (read from the code and prod, 2026-11-06)

- **Forecast lines.** `fc_lines` are the forecast's P&L rows. Forecast Review groups them through
  `/fc-lines/review-structure` (`v2/routes/fcLines.js:209-230`):
  - `forecast_income` and `bs_module_income` lines go to **Income**;
  - `forecast_expense` and `bs_module_expense` lines go to **Expense**;
  - within each, the order is `display_order, name`.

  `useFCLineStructure` always adds a **Taxes** row, because the engine writes to a hard-coded `Taxes`
  account. Review's *Transfers* row (`Transfer - Bank`) feeds Net Cash Flow, not the P&L.
- **Category mapping.** `fc_line_categories` maps categories to forecast lines, with `UNIQUE(category_id)`, and
  assign-time overlap refusal (`findMappingOverlaps`, 409). `FC_LINE_LEAVES_CTE` resolves the mapping to leaves,
  deduplicated per line but **not across lines**: a leaf under two lines would count on both, in the engine's
  base year too. Prod has 0 such leaves today. **Most engine (module) lines are mapped too:** Property Costs to
  35 categories, Interest, Dividend, UB and Barkeria Income to 1 each. Module entries also land on
  `forecast_*` lines (Taxes, CVC Dividend). So the line type says nothing about whether a line can be budgeted.
- **Stored forecasts.** `forecast_entries` are stored per scenario **and per variant**, in USD, and replaced on
  every regenerate, so `created_at` is the generation time.
  - `2026 Base` for 2027 has 58 rows on 31 `account` values. Only **21 rows are on 15 forecast lines**; the rest
    are balance rows keyed by module or asset name, `Bank Accounts` cash legs, and `Transfer - Bank`.
  - The P&L filter is `account = fc_lines.name`, which is how Review maps them.
  - `entry_type` is NULL on every row.
- **Signs:** income is positive and expense negative, in both the forecast and the builder.
- **The builder's figures.** `getBuild` gives each line (category × currency) `leFy` (local currency),
  `annual`, and `annualUsd` at the build's rates, with **null where a rate or the inflation is missing**. A
  total stays null once any line is null. An inactive line (CR101) reads 0.
- **The LE's own USD** (`budget_le_lines.base_amount`, used by `getBaseYearLeValues`) is at **2026** rates.
  Measured on LE-11-26, PLN converts at an implied 3.687 against the build's 3.94, about $33.5k on the PLN lines
  with no change in spending.

## 3. Decisions (owner, 2026-11-06)

| # | Question | Decision |
|---|---|---|
| D1 | Format | **A modal in the forecast's P&L format**, opened from a *Compare Forecast* button on the builder. |
| D2 | Columns | **Budget · Forecast · Δ (budget − forecast) · Δ% · LE**, where LE is the build's own source LE. |
| D3 | Drill-down | **A forecast line expands to its budget categories and currencies**, each with budget and LE. The forecast side stays one number per line. |
| D4 | LE basis | **Restated at the build's rates**: Σ `leFy` / the build's rate. Budget − LE shows only changes in spending, and equals the builder grid's own *vs estimate*, in USD. |
| D5 | Year | **Fixed to the build's target year.** The only like-for-like comparison. The scenario or variant is still chosen. |

## 4. Design

### 4.1 The service and endpoint

The logic goes in a **new module, `services/budgetCompareForecast.js`**. It calls `budgetBuilder.getBuild` and
does not edit it. The route is `GET /budget-builder/:id/compare-forecast?scenario=<name>`, using the existing
`handle()` and `{data}` envelope:
- `scenario` is a base scenario or one of its variants, and defaults to the build's rates scenario;
- an unknown scenario returns 404 with the name.

**Rows** come from `review-structure`'s repo call, reused rather than reimplemented. That gives the Income and
Expense buckets in its order. **Taxes** is included as the hook does, and **`Transfer - Bank` is excluded**.
The net is therefore the **P&L net**, and it will differ from Review's Net Cash Flow by the transfers; the
modal says so.

**Per forecast line:**
- **Budget:** Σ `annualUsd` of the build's lines whose category resolves to the line through
  `FC_LINE_LEAVES_CTE`.
- **LE (D4):** Σ over the same build lines of `leFy / rates.fx[currency].rate`. It comes from the same rows, so it
  is consistent by construction and per-category for free.
- **Forecast:** `SUM(amount)` of the scenario's entries for `forecast_year = targetYear` and
  `account = line name`.
  - *—* if the scenario has **no entries for the year at all**. It is then not generated for that year, and the
    response says so.
  - Otherwise 0 where the line simply has none.
- **Display, from the data and not from the line type:** Budget and LE show *—* only where the line has **no
  mapped leaf**, so nothing can be budgeted there. Where the forecast figure exists but no build line
  contributes, Budget shows 0.
- **Null propagates:** a build line with null `annualUsd` (or no rate for its currency) makes its forecast
  line's Budget/LE null. Section and net totals stay null once any part is null, as `getBuild` does. A total
  missing one line is not a smaller total.
- **`notInForecast`:** the build lines whose category resolves to no line. That includes a parent-category line,
  labelled *parent category* (it is also a publish blocker), and is separate from `offForecast`'s
  walk-up definition.
- **Reconciliation, at runtime:**
  - `residual = budgetTotal − (Σ lines + notInForecast)` is returned, and the same for LE.
  - Non-zero means a leaf sits on two lines. The modal then shows a warning naming the residual, rather than
    trusting the mapping invariant.
- **Rates:** the response carries the build's rates and `scenarioRates(scenario, targetYear)`. If they differ,
  for example a variant with its own FX, the header notes it, so Δ reads as "at rates X versus Y".
- **`generatedAt`:** `MAX(created_at)` of the scenario's entries.
- **Read-only:** no writes, no locks, and no part in the publish token. **`budgetBuilder.js` gains no changes
  beyond an export, if one is needed.**

### 4.2 The modal

- **A new component, `features/Budgets/CompareForecastModal.jsx`.** It uses the shared `Modal` (chart size) and
  tokens only. It is opened by a *Compare Forecast* button beside *Compare builds* on `BudgetBuilder.jsx`. That
  button and the mount are the only page changes.
- **Header:**
  - a scenario or variant picker: **the build's scenario and its variants**. Other base scenarios are left out:
    prod has none, and another base has its own base year, which undercuts D5;
  - *Budget {year}: {build label} · Forecast: {scenario}, generated {date} · LE: {name}*;
  - the rates note, when the rates differ;
  - the residual warning, if any.
- **Body:** the Income lines then the Expense lines, each section with a subtotal, then the **P&L net** (*excludes
  transfers*).
- **Columns:** Budget · Forecast · Δ · Δ% · LE.
  - **Δ% = Δ / |forecast|**, so an expense over plan reads negative in both columns.
  - It is blank where the forecast is 0 or *—*.
  - Colour shows sign only.
- **Rows:**
  - A line expands to its categories and currencies (D3), with inactive ones marked.
  - *Not in the forecast* is the last row, and expandable.
- **Mobile:** none. The builder is desktop-only.

## 5. Verification

**Server (`budgetCompareForecast.test.js`, seeded, dev DB):**
1. Per line: Budget = Σ mapped `annualUsd`; LE = Σ `leFy / rate`, which equals the builder's `vsLe` in USD;
   Forecast = Σ entries.
2. Δ% sign on an expense line; Taxes included; `Transfer - Bank` excluded.
3. Null: one unconvertible build line makes its line and the totals null.
4. A line with no mapped leaf gives Budget/LE *—*. A scenario with no entries for the year gives Forecast *—*
   with the reason. A line with no entry in a generated year gives 0.
5. `notInForecast` names an unmapped category and a parent-category line. The residual is 0, and **non-zero when
   a leaf is planted under two lines**.
6. A variant reads its own entries and rates. Rates that differ are reported.
7. An unknown scenario returns 404.

**Frontend (Vitest):** grouping order, subtotals and the net; Δ% sign; a null subtotal shown as *—*.

**Page:** first refresh dev with `Scripts/sync-db-prod-to-dev.sh`, taking a turn on the shared dev DB. Dev has no
build and no `2026 Market Crash` today. Then walk the modal in both themes against `2026 Base` and
`2026 Market Crash`. One line's Budget
and LE are checked by hand against the builder grid. A line expands.

**Freeze gate:** the 2027 drafts' preview hash and USD totals are identical before and after the deploy.

## 6. Non-goals

- Any write, or pulling forecast figures into the budget.
- Several forecast years, and a year picker (D5).
- 2026 actual.
- The balance sheet.
- A category split of the forecast side.

## 7. Phasing and timing

One phase. It is read-only, and kept in a new service and a new component. It ships **before the 2026-12-03
freeze, targeting 2026-11-20, with a hard stop on 2026-11-26** (as for CR100 and CR101). Otherwise it waits
until after the publish.

**Fix window (pass 2, condition 1):**
- Before 11-26, fixes stay inside CR102's own files, and each deploy re-runs the freeze gate.
- **No CR102 deploy from 11-26 until the publish.** A defect found then waits; the modal writes nothing and can
  be ignored.
- It ships as a minor release; there is no migration.
- **If it runs late, cut first:** making *Not in the forecast* expandable. The row and its total stay. The
  residual warning, the rates note and null propagation are never cut.

**A note for the owner:**
- **The payoff.** Before you publish, it shows how far the long-range forecast's 2027 will move when this draft
  becomes `2027 Base`'s base year at January's annual close (CR064). Otherwise that change would appear silently
  at the close.
- **`2026 Base`'s 2027 is projected from the *2026* budget.** So the comparison shows how the draft departs from
  the plan's assumption. Against `2027 Base`, after the close, it will mostly match by design; its lasting use is
  against variants.
- **On engine-computed lines** (Taxes, Property Costs, Interest, Dividend, CVC Dividend), the forecast figure is
  the engine's own calculation. A difference there is a modelling difference, not overspending.
- **A variant can be older than its base.** On 2026-11-06, `2026 Market Crash` was generated 11-03 and
  `2026 Base` 11-06. The header's *generated* date says which.

## 9. As built (2026-11-06, v3.87.0)

**Files:**
- `services/budgetCompareForecast.js`, new; it reads `getBuild` and does not edit it;
- `GET /budget-builder/:id/compare-forecast?scenario=`;
- `features/Budgets/CompareForecastModal.jsx` and `.css`, new;
- `features/Budgets/compareForecast.js`, the Δ and Δ% arithmetic;
- a *Compare forecast* button on `BudgetBuilder.jsx`.

The only changes to existing modules are two exports, `FC_LINE_LEAVES_CTE` from `forecast/crud.js` and
`scenarioRates` from `budgetBuilder.js`, and the route.

**Rows** come from `fcLinesRepo.findAll` (Forecast Review's order), bucketed as `review-structure` does. A
synthetic Taxes row is added only if no forecast line is named Taxes; prod has one.

**Verification:**
- `budgetCompareForecast.test.js`, 6 seeded tests:
  - per-line budget, LE and forecast, with a forecast line summing two entries;
  - an unmapped engine line reads *—*;
  - not-in-forecast, residual 0, and net = the build's `usdTotal`, with the transfer leg excluded;
  - a variant's own entries and rates (`differ`);
  - a leaf under two lines gives a residual of 50;
  - a scenario with no year's entries gives null, not 0; an unknown scenario is a 404.
- `compareForecast.test.js`: 3 Vitest cases, including Δ% over |forecast|.
- Vitest: 762 tests pass; the ratchets are at baseline.

**Dev walk, after a prod-to-dev sync, in both themes, on the owner's real draft 2027 v6 (V3) against `2026 Base`
2027:**
- residual 0; net budget −101,138 = the build's USD total, against a forecast of −85,237;
- Dividend Income's 41,460 matched the builder grid by hand;
- Travel expands into its categories;
- the three unmapped engine lines read *computed by the engine*;
- `2026 Market Crash` shows *(variant), generated 2026-11-03*;
- no page errors.

**Freeze gate:** V3's preview hash and USD total were identical before and after the prod deploy.

## 8. Review log

**Pass 1 — `cr-technical-reviewer`, rev 1 (2026-11-06): REVISE.** All findings are addressed in rev 2:

- **Blocking:**
  1. LE basis (a measured ~6% FX gap on the PLN lines): owner **D4**, restated at the build's rates from the
     build's own rows.
  2. `engineComputed` flagged the wrong rows: replaced by data-derived display (§4.1).
  3. Null handling unstated: null propagates, with a test.
- **Should-fix:**
  4. Overlap not guaranteed: a runtime residual with a warning, and a test.
  5. The entry counts corrected; the P&L-only join and its exclusions stated.
  6. Grouping: reuse `review-structure`, add Taxes, exclude Transfers.
  7. Rates shown when they differ.
  8. Δ% over |forecast|.
  9. Year picker dropped (owner **D5**).
  10. A new service module and component, with `budgetBuilder.js` untouched.
- **Nits:**
  11. Parent-category lines labelled in notInForecast.
  12. `generatedAt` confirmed: it resets on regenerate. Prod's entries were regenerated on 2026-11-06.
  13. Parameter validation.
  14. Test files named; Modal primitive and tokens.

**Pass 2 — `cr-signoff-pm`, rev 2 (2026-11-06): GO.** Ship before the freeze: most of the value is before the
publish, and the risk is low (read-only, isolated, gated). Conditions applied in rev 3:
1. The fix window, with no deploy from 11-26 until the publish.
2. The dev sync step, so the page walk can run.
3. The index and roadmap updated.

Recommendations applied:
- the owner note leads with the payoff, and covers engine lines and variant age;
- the other-base option is cut from the picker;
- the first cut if the build runs late is named;
- it ships as a minor release.
