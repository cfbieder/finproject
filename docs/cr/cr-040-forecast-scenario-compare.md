# CR040 — Forecast Scenario Compare page

**Status:** ✅ RELEASED v3.0.60 (2026-07-10) + fix v3.0.61 (2026-07-11, one-scenario-only accounts were hidden — see "Post-release fix" below) — P1–P3 built, verified on dev (incl. live local-LLM round-trip + follow-up), migration 035 applied to dev **and prod**, deployed.
**Track:** v3
**Anchor in FC_NEXT_STEPS.md:** [cr040](../current/project-roadmap.md#cr040)

## Problem

The forecast workflow supports multiple scenarios (`forecast_scenarios`, copy/edit via `/forecast-scenarios`), but the only way to compare two of them is to open `/forecast-review` twice and eyeball. There is no side-by-side or delta view, and no narrative of *where* two scenarios diverge (e.g. "2026 with House Purchase" vs baseline). Scenario comparison is the main reason scenarios exist.

## Decisions (locked 2026-07-10)

| # | Question | Decision |
|---|----------|----------|
| 1 | Compare scope | **Full Review-page mirror**: KPI deltas + multi-year P&L-by-FC-Line + balance sheet, every cell a delta with A/B drill-in |
| 2 | Commentary source | **Hybrid**: deterministic instant summary always shown; AI narrative generated on demand via the local LLM gateway |
| 3 | Visuals | **recharts** (already a dependency) — overlaid A-vs-B lines + diverging delta bars; not the bespoke SVG of `FCReviewTableGraphModal` |
| 4 | Architecture | **Frontend diff** (two `GET /entries` fetches, client-side pivot reusing FCReview utils); backend change limited to the aiReview extension. No migration for the diff itself. |
| 5 | AI interaction | **Inline report + follow-ups** on the page (existing async review infra + `sendMessage`); not the full `FCAIReviewDrawer`, no apply-actions |

Delta convention: user picks **Baseline (A)** and **Comparison (B)**; every delta is **B − A**. A swap button flips them.

## Scope

### P1 — Page, diff engine, tables, deterministic commentary
- **Route/nav:** `frontend/src/config/routes.jsx` — lazy `FCCompare`, route `/forecast-compare`, `category: "Forecasting"`, placed after Forecast Review (auto-appears in sidebar/⌘K/breadcrumbs). Add to `FCStepNav` if it lists Review-adjacent steps.
- **Page:** `frontend/src/pages/FCCompare.jsx` — two scenario pickers (`useScenarios`; B defaults to a different scenario than A), two `useForecastData` loads, shared year-range control (union of both scenarios' years; missing years render as A-only/B-only).
- **Diff util:** `frontend/src/features/Forecast/utils/fcCompareUtils.js` — align the flat `/entries` rows on `(Year, Account, EntryType)`, roll up to FC Lines with the same grouping `FCReview` uses, emit `{a, b, delta}` per cell. Lines present in only one scenario are flagged (structural difference, not just magnitude). Unit-tested.
- **KPI delta cards:** the four Review KPIs (total assets, net cash flow, income, expenses) as B − A with sign coloring and per-year sparkline of the delta.
- **Tables:** P&L-by-FC-Line and balance-sheet grids where each cell shows Δ (heat-shaded); a display toggle Δ / A / B / "A → B" stacked; row click expands the underlying A and B values per year.
- **Deterministic commentary panel:** computed client-side from the diff — top-N diverging FC Lines by cumulative |Δ|, first year the scenarios diverge materially, balance-crossover years (A over/under B), structural differences (modules/lines present in one only). Instant, no LLM.

### P2 — Visual comparison (recharts)
- Overlaid line charts, A vs B over years: total assets and net cash flow (the two trajectory KPIs); toggle to show the Δ line instead.
- Diverging horizontal bar chart: cumulative Δ by FC Line over the selected range (the "top movers" picture).
- Follow the dataviz conventions (dark-mode tokens per CR026; no raw hex).

### P3 — AI commentary (backend + inline panel)
- **Service:** extend `server/src/v2/services/aiReview.js` — `buildForecastContext` gains an optional `compareScenarioName`; when present, the context carries both scenarios' assumptions/modules/aggregated entries plus a precomputed top-divergence table, and a compare-specific system prompt ("explain where and why these scenarios differ; do not propose apply-actions").
- **Route:** `POST /api/v2/ai-review` accepts `{ scenarioName, compareWith }`. Review rows persist in the existing `fc_ai_reviews` keyed to scenario A; `compareWith` recorded in the stored context/metadata. **No migration** unless a metadata column proves necessary — reuse the existing context JSON first.
- **Frontend:** inline `FCCompareAIPanel` — "Generate AI commentary" button → create review → poll `/status` (same pattern as `FCAIReviewDrawer`), render the narrative inline, small follow-up input wired to `POST /:reviewId/message`. Action blocks are not rendered/parsed in compare mode.

## Non-goals
- No 3-way+ comparison (two scenarios only; the diff util shouldn't preclude it later).
- No new server-side compare endpoint (Decision 4) — revisit only if mobile wants a compare surface.
- No apply-actions from compare commentary (mutating scenario inputs stays on the Review page's AI drawer).
- No changes to the forecast engine or `forecast_entries` — read-only feature.

## Verification
- Unit tests for `fcCompareUtils` (alignment, missing-line/missing-year cases, B − A signs, FC-Line rollup parity with FCReview totals).
- Manual e2e on dev (`:3105`): compare "2026 with House Purchase" vs its base scenario; deltas must reconcile against the two Review pages' numbers; AI commentary round-trip against the local gateway.
- Sanity: same scenario vs itself → all-zero deltas, empty deterministic commentary.

## As built (P1 + P2, 2026-07-10)

**Files:** `frontend/src/features/Forecast/utils/fcCompareUtils.js` (+13 unit tests), `FCCompareTable.jsx`, `FCCompareCharts.jsx`, `FCCompareCommentary.jsx`, `pages/FCCompare.jsx/.css`; route `/forecast-compare` in `config/routes.jsx` (Forecasting, after Review); `FCStepNav` gains step 6 "Compare".

**Key implementation decisions beyond the plan:**
- `buildScenarioMatrix` is a pure transcription of FCReview's pivot (entry aggregation, Expense-net-of-Transfers, Cash Flow/Net rows, Bank Accounts running balance, level-2 Assets/Liabilities totals) so A/B columns reconcile with Review. It runs once per scenario; `compareMatrices` aligns on the year union.
- **Base-year filter (found via live-data e2e):** `GET /scenarios/years` includes the BaseYear (PeriodStart − 1), whose P&L Review sources from budget, not engine entries — naïvely including it double-counted base-year transfers in the bank running balance ($32K drift on dev data). Compare therefore covers years ≥ PeriodStart only; base-year data enters solely via the bank seed (LAY actual balance + BaseYear budget NCF), fetched per scenario (`useBaseYearBalanceSheet` ×2 + `base-year-values` ×2) so scenarios with different PeriodStarts stay correct.
- **Validated palettes (dataviz six-checks, light + dark):** A/B categorical — A green `#3E8A3E`/`#45A045`, B blue `#4A72B0`/`#3987E5`; delta diverging — blue `#4A72B0`/`#3987E5` (B higher) ↔ red `#C0504D`/`#E05252` (B lower). The app's muted brand hues failed the chroma-floor/lightness checks and were snapped to the nearest passing steps. Blue consistently means "B / B ahead". Chart hex is picked at runtime via `useTheme` (SVG attrs can't resolve CSS vars); table cells use `--fc-cmp-pos/neg` CSS vars with dark overrides.
- Deterministic commentary ranks P&L movers by **net** cumulative Δ (same metric as the bar chart) — ranking by absolute churn surfaced "+$0" FX-noise lines.
- Table: Δ/A/B display modes, hide-unchanged toggle (default on), click-to-expand A/B/Δ sub-rows; reuses `trans-budget-table` styling.

**Verified:** 116 frontend tests green; production build clean; live pipeline e2e on dev against a purpose-made divergent copy ("CR040 Test B" = "2026 Base" + $20K/yr salary): self-compare all-zero, headline "+$1.8M net assets by 2062", movers correctly show the cash-sweep chain (Transfers −$1.8M → Fidelity Fixed Income +$1.8M, Interest Income +$1.6M, Taxes −$591K). The "CR040 Test B" scenario is left on dev for browser testing; delete via Forecast Scenarios when done.

## As built (P3, 2026-07-10)

**Migration 035** — `fc_ai_reviews.compare_scenario_id` (nullable FK → `forecast_scenarios`, ON DELETE CASCADE, indexed). Needed because follow-up messages rebuild the context from the review row, so the pair must persist; NULL = plain single-scenario review, preserving existing behavior. Applied to dev. **Dev-DB drift found & fixed while testing:** dev's `fc_ai_reviews` was missing migration 020's `status`/`error_message` columns (prod had them); re-applied idempotent 020 to dev.

**Backend** (`services/aiReview.js`, `routes/aiReview.js`):
- `buildCompareContext(A, B)` — precomputed top-15 cumulative B − A divergence table (sweep tags excluded, same filter as the single context) followed by both scenarios' full contexts.
- `COMPARE_SYSTEM_PROMPT` — Summary / Key Differences / Trajectory / Risks & Trade-offs; explicitly **no** ```action blocks. The `ai_review_prompt` app-data override applies to single-scenario reviews only.
- `processReview(reviewId)` now derives scenario + compare names from the review row (was passed-in), so follow-ups on compare conversations rebuild the pair context automatically.
- `createReview(scenario, compareWith)` validates both names, rejects self-compare, titles `Compare: A vs B`.
- `GET /scenario/:name` excludes compare reviews (keeps them out of the Review drawer's list) unless `?compareWith=<B>`, which lists exactly that pair (Compare page restore-on-revisit).

**Frontend** — `FCCompareAIPanel.jsx` inline on `/forecast-compare` below the deterministic commentary: restores the latest conversation for the pair on load, "Generate AI commentary" → 202 + 4s status polling, assistant text rendered pre-wrap (no action parsing), follow-up input via `POST /:id/message`, Regenerate starts a fresh conversation.

**Verified:** 5 new jest tests in `services/__tests__/aiReviewCompare.test.js` (DB-backed, gateway stubbed via `global.fetch`): divergence table content + sweep exclusion, unknown-scenario/self-compare rejection, compare persistence + worker completion + compare-prompt payload, single-review regression. Full backend suite 252 green. Listing filters verified live on dev (drawer list excludes the compare review; pair list returns it). Live gateway round-trip on dev: see status header.

**Deploy note:** apply migration 035 to prod **before** deploying this code (MIGRATIONS.md discipline). *(Done 2026-07-10; deployed v3.0.60.)*

## Post-release fix (v3.0.61, 2026-07-11)

First real prod compare exposed a diff-engine defect: accounts with engine entries in **only one** scenario (e.g. SP - Properties, disposed immediately in the house-purchase scenario but held through 2039 in base) yielded all-null deltas → hidden by the hide-unchanged filter regardless of the toggle, and visible rows didn't reconcile to the Assets total. Fixed: missing values inside a scenario's forecast range coalesce to 0 for the delta (null only outside the range; "-" display kept). BS-movers commentary now ranks by peak-year |Δ| (was final-year, which missed diverge-then-converge assets) and tags "converged by the end". +1 regression test; verified against the prod pair.
