# CR102 — Budget builder: Compare Forecast (a build against a forecast scenario's year, in the forecast's P&L) — DRAFT

**Status:** DRAFT (2026-11-06), not yet reviewed. Owner decisions D1–D3 taken 2026-11-06 (§3).
**Depends on:**
- CR098, CR100 and CR101: the builder, its lines, and inactive lines.
- CR069: forecast lines and stored forecast entries.
- CR083: the LE.
- CR064, for the annual-close context.

**Roadmap anchor:** [project-roadmap.md#cr102](../current/project-roadmap.md#cr102)
**Deadline context:** the builder code freeze is **2026-12-03**, and the first 2027 publish is due **2026-12-10**. It is
read-only, but it is builder-page code (§7).

## 1. The ask

A **Compare Forecast** button on the budget builder opens a modal. It sets the selected build against a chosen
forecast scenario or variant for a chosen year, for example *2027 v6 (V3)* against *2026 Base, 2027*. It uses
the same P&L layout as Forecast Review: forecast lines grouped into income and expense, with subtotals and a
net.

The question it answers: **does my draft budget for 2027 match what the plan assumed for 2027, and where does
it differ?**

## 2. What exists (read from the code and prod, 2026-11-06)

- **Forecast lines.** `fc_lines` (`id, name, line_type, display_order`) are the forecast's P&L rows. They have
  four types:
  - `forecast_income` and `forecast_expense`, which are fed from mapped categories;
  - `bs_module_income` and `bs_module_expense`, which are computed by the engine from modules, such as interest,
    UB income and property costs.
- **Category mapping.** `fc_line_categories` maps categories to lines. `FC_LINE_LEAVES_CTE` (in
  `services/forecast/crud.js`) resolves it to leaf categories, each counted once per line. It is used by
  `getBudgetTotals` and by `getBaseYearLeValues(le)`, which already maps an **LE** onto forecast lines. That is
  the base-year reference column on Forecast Review.
- **Stored forecasts.** `forecast_entries` (`scenario_id, forecast_year, account, amount, module, entry_type`)
  are stored per scenario **and per variant**, keyed by **line name** (`account`). On prod, `2026 Base` and
  `2026 Market Crash` each hold 58 entries across 31 lines for 2027. Values are in USD.
- **Signs agree:** income is positive and expense negative in both the forecast and the builder. For example,
  2027 *Living Expenses* is −131,830 in `2026 Base`.
- **The builder's figures.** `getBuild` gives each line (category × currency) its `annualUsd`, at the build's
  rates. An inactive line (CR101) reads 0. `previewPublish` already lists the lines on no forecast line
  (`offForecast`).
- **Grouping.** Forecast Review's P&L grouping lives in `FCReviewTable.jsx` and its hooks.

## 3. Decisions (owner, 2026-11-06)

| # | Question | Decision |
|---|---|---|
| D1 | Format | **A modal, in the forecast's P&L format** (forecast lines grouped as on Forecast Review), opened from a *Compare Forecast* button on the builder. |
| D2 | Columns | **Budget · Forecast · Δ (budget − forecast) · Δ% · LE.** The LE is the **build's own source LE** (V3: LE-11-26), mapped onto the same lines, so all three columns share a basis. |
| D3 | Drill-down | **A forecast line expands to its budget categories and currencies**, each showing budget and LE. The forecast side stays one number per line, because the engine has no category split. |

## 4. Design

### 4.1 Endpoint

`GET /budget-builder/:id/compare-forecast?scenario=<name>&year=<yyyy>`. `scenario` is a base scenario or one of
its variants, and the default is the build's rates scenario. `year` defaults to the build's target year. It
returns:

```
{ build: {id, label, targetYear}, scenario: {name, isVariant, generatedAt}, year, le: {id, name},
  lines: [{ fcLineId, name, lineType, displayOrder, budget, forecast, le, engineComputed,
            categories: [{ categoryId, name, currency, budget, le, inactive }] }],
  notInForecast: [{ categoryId, name, currency, budget, le }],
  totals: { budget, forecast, le } }   // net, USD
```

- **Budget per line:** the build's `annualUsd` summed over its categories that resolve to the line through
  `FC_LINE_LEAVES_CTE`. One query feeds both this and the LE, so the same leaf is never counted twice. Each
  build line's category maps to at most one forecast line; a check confirms this. Inactive lines count 0 and
  are listed as *inactive*.
- **Forecast per line:** `SUM(amount)` from `forecast_entries` for the scenario's id, `forecast_year = year`, and
  `account = fc_lines.name`.
- **LE per line:** `getBaseYearLeValues(sourceLe)`, reused as is, with the same exclusions.
- **`engineComputed`:** `line_type LIKE 'bs_module_%'` with no category mapping. Its budget and LE show *—*
  ("computed by the engine"), never 0.
- **`notInForecast`:** build lines whose category resolves to no forecast line. They have their own row, so that
  **budget total = Σ lines + not-in-forecast**, which a test asserts.
- **`generatedAt`:** `MAX(created_at)` of that scenario's entries. If the scenario has none for the year, the
  response says so and shows no figures. Nothing is shown as 0.
- **Read-only:** no writes, no locks, and no part in the publish token.

### 4.2 The modal

- **Placement:** a *Compare Forecast* button beside *Compare builds*. A chart-size `Modal`.
- **Header pickers:**
  - scenario or variant: the build's scenario and its variants, plus the other base scenarios;
  - year: from the scenario's years.
- **Under the header:** a line naming the forecast's generation date — *2026 Base, generated 2026-11-03* — and
  the LE.
- **Body:** the forecast's P&L — income lines, then expense lines, each section with a subtotal, then net. The
  grouping and order are Forecast Review's: `line_type`, then `display_order`, shared with or copied from its
  hook rather than reinvented.
- **Columns:** Budget · Forecast · Δ · Δ% · LE. Δ% is blank where the forecast is 0. Colour shows sign only.
- **Rows:**
  - A line expands to its categories (D3).
  - An *engine-computed* line is marked so.
  - *Not in the forecast* is its own row, last, and expandable.
- **Mobile:** none. The builder is desktop-only.

## 5. Verification

**Server:**
- Seeded forecast lines, a mapping, a build, an LE and forecast entries for a scenario and a variant. Per line:
  budget = Σ mapped build lines; forecast = Σ entries; LE = `getBaseYearLeValues`.
- An inactive line counts 0.
- An engine-computed line gives a null budget and LE.
- `notInForecast` names an unmapped category.
- **Budget total = Σ lines + not-in-forecast.**
- A variant reads its own entries.
- A scenario with no entries for the year gives an empty result with a reason.

**Page:**
- The modal is walked on dev in both themes against `2026 Base` 2027 and `2026 Market Crash` 2027.
- One line's budget is checked by hand against the builder grid.
- Expanding a line lists its categories.

## 6. Non-goals

- Any write: no "pull the forecast into the budget", and no edits in the modal.
- Several forecast years at once.
- 2026 actual. Owner D2 chose the LE only.
- The balance sheet. The budget is P&L.
- A category split of engine-computed lines.

## 7. Phasing and timing

One phase. It is read-only builder-page code, so it ships **before the 2026-12-03 freeze, targeting 2026-11-20**,
with a **hard stop on 2026-11-26** (as for CR100 and CR101). Otherwise it waits until after the publish.

Freeze gate: the 2027 drafts' preview hash and USD totals are identical before and after the deploy.

**A note for the owner:** `2026 Base`'s 2027 is projected from the *2026* budget, so this comparison shows how
the draft departs from the plan's assumption. After January's annual close (CR064), `2027 Base` is built from
the published 2027 budget, so against it the comparison will mostly match by design. Its lasting use is against
variants.

## 8. Review log

*(pass 1 `cr-technical-reviewer`, pass 2 `cr-signoff-pm`: pending)*
