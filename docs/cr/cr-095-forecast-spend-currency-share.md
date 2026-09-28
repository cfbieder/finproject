# CR095 — Forecast spend that moves with the złoty

**Status:** DRAFT (2026-09-28) — not yet reviewed (pass 1 `cr-technical-reviewer`, pass 2 `cr-signoff-pm`) · **Track:** v3 · **Migration:** likely one (number claimed at build time, not now)
**Supersedes:** [CR052](cr-052-forecast-expense-fx-exposure.md), whose design targeted tables [CR069](cr-069-forecast-streams.md) deleted.
**Roadmap anchor:** [project-roadmap.md#cr095](../current/project-roadmap.md#cr095)

## 1. The problem, measured

The forecast prices every expense module in **USD**: on prod all 10 expense modules on 2026 Base
(`has_valuation = false`) carry `currency = 'USD'` in every scenario, and CR051's currency picker
has never been used. The spending itself is not in dollars. Over 2025-09 → 2026-08, grouping
actual spend on the matched FC lines by transaction currency:

| FC line | PLN share |
|---|---|
| Living Expenses | 71% |
| Car Expenses | 91% |
| Healthcare | 75% |
| Children | 68% |
| Travel | 17% (+6% EUR) |
| Purchases | 13% |

About **$203K of ~$409K** across those six lines is PLN. So the Downside scenario's FX override
(2027 PLN 4.5 / EUR 0.90 vs Base 3.9 / 0.86) revalues PLN **assets** but leaves PLN **costs**
flat in dollars. The stress is one-sided, and a weaker dollar — which raises the real cost of half
the household budget — cannot show up anywhere in the plan.

⚠️ *Measured by the currency of the paying account*, a proxy for where the money was spent (a USD
card used in Poland counts as USD). The true PLN share is likely higher, not lower.

## 2. What it should do

Let an expense stream say "**X % of this is paid in PLN (or EUR)**". The foreign part is fixed as a
native amount at the base year and converted at each forecast year's FX rate; the rest stays USD.
Per-year factor: `(1 − Σpct) + Σ pct · FX₀ / FXᵢ`, where FX is foreign-per-USD, so a weaker dollar
(lower PLN per USD) raises the cost. With no share set, or flat FX, the engine output must be
**byte-identical** to today — the same dormancy test CR052 specified, carried over because it still
holds.

## 3. Where it lives now (differs from CR052)

- Expense amounts are `forecast_streams` rows (`amount` / `amount_usd`, `growth_mult`,
  `start_date`/`end_date`) on a module whose `currency` is module-level. CR052's child table on
  `forecast_income_expense` has no home.
- Candidate shape: a small child table keyed to `forecast_streams.id` (`currency`, `pct`), so a
  stream can carry more than one foreign share, **or** a single `(foreign_currency, foreign_pct)`
  pair on the stream if one currency per stream is enough (every measured line is PLN-dominant with
  at most a small EUR tail). Decide in review.
- The evaluator is `server/src/services/forecast/fcbuilder-stream.js`; the FX series is the
  scenario's `forecast_assumptions` FX block (`PLN`, `EUR` — read as `PLN ?? USDPLN`, per CR064 P0).
- Variants ([CR050](cr-050-forecast-scenario-variants.md)) must inherit and override the share like
  any other stream field — CR050's history is that hand-enumerated copies silently drop columns
  (twice), so the sync's column list is part of the acceptance test.

## 4. Open questions for review

1. **Where the percentage comes from.** Hand-entered per stream, or prefilled from the measured
   actual-currency split above (and re-measurable on demand)? A prefill with a visible "measured
   from 12 months of actuals" label is the likely answer.
2. **One currency per stream, or several?** (§3.)
3. **Does anything besides expenses need it?** Income paid in PLN (rent on the Polish properties) has
   the same shape. Scope it in or out explicitly.
4. **Numbers move.** Adopting it changes every scenario whose FX path is not flat. Needs the usual
   per-scenario before/after measurement and an owner-read release note.

## 5. Non-goals

- Changing any FC line's actual categories or mapping (CR066's territory).
- FX knobs in the sensitivity tornado (CR085 cut them; revisit only after this lands).
