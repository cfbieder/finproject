# CR040 — Forecast Scenario Compare page

**Status:** PLANNED (scoped 2026-07-10 via /question session; decisions locked below)
**Track:** v3
**Anchor in FC_NEXT_STEPS.md:** [cr040](../FC_NEXT_STEPS.md#cr040)

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
