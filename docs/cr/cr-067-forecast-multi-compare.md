# CR067 — Forecast Multi-Compare: one base against several of its variants, as trajectory lines — 📘 PLANNED (scoped, not built)

One base scenario and any of its variants overlaid on a single trajectory chart — the base bold, each
variant in its own hue. The chart [CR040](cr-040-forecast-scenario-compare.md) already draws, freed
from being two-scenario. No tables, no commentary, no engine change, no migration.
[Roadmap](../current/project-roadmap.md#cr067)

**Opened:** 2026-08-03 · **Track:** v3 · **Migration:** none
**Depends on:** [CR040](cr-040-forecast-scenario-compare.md) (the Compare page, its `buildScenarioMatrix`
and the trajectory chart this extends) · [CR050](cr-050-forecast-scenario-variants.md) (variant lineage,
which is what makes the selection natural)

**Phases.** Three separately shippable pieces — a refactor of a *released* page, a new page, and a new
endpoint. Bundling them would mean a Compare regression could only be reverted by also reverting the
feature that motivated it.

| | scope | gate |
|---|---|---|
| **P1** | Extract `FCTrajectoryChart` from `FCCompareCharts`; `/forecast-compare` renders it with **behaviour unchanged** — §5.1 | Render test written **before** the extraction and passing after (§8). Its own release tag. **One atomic commit** (§8). |
| **P2** | The Multi-Compare page, the loader, the palette — §5.2 | Parity against Compare's `A` series on all five metrics; the different-`PeriodStart` unit test. |
| **P3** | The last-generated badge + its endpoint — §5.3 | **Deferred, and may not be worth building** — the prod evidence is against it (§5.3). |

## 1. Problem

[CR040](cr-040-forecast-scenario-compare.md) answers *"how do these **two** scenarios differ?"* in
detail — KPI deltas, a full delta grid, deterministic commentary, AI narrative. It is two-scenario by
construction ([CR040 non-goal #1](cr-040-forecast-scenario-compare.md): *"No 3-way+ comparison"*).

The question it cannot answer is the shape-of-the-fan one: **"how do all my variants sit against the
base?"** Prod has exactly one base with four variants —

| scenario | lineage |
|---|---|
| `2026 Base` | root |
| `2026 Upside` · `2026 Downside` · `2026 SRQ House Purchase` · `2026 Buy Business` | variants of `2026 Base` |

— and seeing them together today means opening `/forecast-compare` four times and holding four charts
in your head. The trajectory chart on that page is already the right picture; it is only limited to
two lines.

## 2. Decisions (locked with the owner 2026-08-03; 8 and 9 added after technical review)

| # | Question | Decision |
|---|----------|----------|
| 1 | New page or extend Compare? | **New page.** Compare's KPI row, delta grid and commentary are pairwise *by construction* — a multi-select mode would switch all of them off, which is a different page wearing the same route. |
| 2 | Selection model | **Base dropdown + checkbox list of that base's variants.** The base is always the bold line, so the bold line never needs explaining. Cross-base overlay is a non-goal (§6). |
| 3 | Output | **The trajectory chart only** — the same five metrics as Compare (Net Assets · Total Assets · Net Cash Flow · Income · Expenses). No KPI cards, no delta grid, no commentary, no AI panel. |
| 4 | Line weight | Base `strokeWidth: 3`; each selected variant `1.75`, each in its own hue. |
| 5 | Architecture | **Frontend, reusing `buildScenarioMatrix` unchanged** — no engine change, no new diff util, no migration; one small read-only endpoint for §5.2. *Rejected:* a server-side `GET /forecast/series?scenarios=…`, which would have to duplicate the FCReview pivot that CR040 deliberately mirrors client-side — two implementations of the same pivot is the defect class CR040 §"As built" exists to avoid. |
| 6 | Staleness | **Badge, not a button** — *not* Compare's "Generate both" generalised to N. **Demoted to P3 at PM sign-off and may be dropped:** the drift that motivated it is a *dev* artifact; on prod all five scenarios were built within two hours of each other (§5.3). The one case that must not be silent — a selected scenario with **no entries at all**, which would otherwise just be an absent line — is handled in P2 and needs no endpoint. |
| 7 | Series cap | **6 variants + base.** Past that the chart stops being readable whatever the palette does. |
| 8 | Chart component | **Extract a shared `FCTrajectoryChart` and render it from BOTH pages.** The alternative — duplicating ~120 lines of chart shell — hand-keeps a second copy of the metric list, tooltip and axis config, which is the exact drift `FCStepNav` was rewritten to end (FCStepNav.jsx:5-13). **This means CR040's shipped page is modified**, so §8 carries a parity gate on it. |
| 9 | Data loading | **`useQueries` from `@tanstack/react-query`** (already a dependency, `frontend/package.json:24`, already used at `hooks/useReports.js:55`). *Rejected:* a hand-rolled single effect — it is what the Forecast module's older hooks do, but they all predate the TanStack adoption and none of them is N-dynamic. `useQueries` is the standard answer to "hooks cannot be called in a loop" and brings cancellation, per-scenario error isolation, dedupe and caching, which removes the three failure modes in §7 rather than requiring us to hand-code around them. |

## 3. Why this is small: the math already exists per scenario

[`buildScenarioMatrix`](../../frontend/src/features/Forecast/utils/fcCompareUtils.js) (fcCompareUtils.js:95)
is a **pure, single-scenario** function returning everything the five metrics need. `compareMatrices`
— the pairwise layer producing `{a, b, delta}` — sits on top of it and is exactly what this page does
not need. Calling the same function N times is the whole computation.

**Each metric has exactly one correct source, and one of them exists twice under similar names:**

| chart metric | source |
|---|---|
| Net Assets | `matrix.netAssets` |
| Total Assets | `matrix.totalAssets` |
| Net Cash Flow | `matrix.cash.get("Net Cash Flow")` — **not** `matrix.netCashFlow` |
| Income | `matrix.cash.get("Income")` |
| Expenses | `matrix.cash.get("Expense")` — already **net of Transfers** (fcCompareUtils.js:171-176) |

`netCashFlow` is returned both as a top-level array of plain numbers (fcCompareUtils.js:142-147,
never null) and as `cash.get("Net Cash Flow")` (fcCompareUtils.js:194-203, null in a year carrying no
Income/Expense/Transfers rows). Compare's chart plots the **second**, via
`totals.netCashFlow = makeRow("cash", "Net Cash Flow")` (fcCompareUtils.js:376-382). Reading the
top-level array instead draws `0` where Compare draws a gap — which passes the §8 parity check on
today's data and diverges later.

Reused as is: `buildScenarioMatrix`, `scenarioOptions` (lineage), `useTheme`, `formatKpiValue`.
**No `FCStepNav`** — it returns `null` on a route with no `step` (FCStepNav.jsx:24), and the
precedent this page follows, `FCEquity`, does not import it.

## 4. The one real correctness trap

`compareMatrices` performs the union-of-years alignment (fcCompareUtils.js:326) — and this page drops
`compareMatrices`. Each matrix independently trims its years to `>= its own PeriodStart`
(fcCompareUtils.js:108), so **plotting the arrays positionally would silently shift two scenarios with
different `PeriodStart` against each other**: same index, different year, no error, a wrong chart that
looks right.

Series must be keyed **by year, not by array position**, over the union of all selected scenarios'
years.

This is not hypothetical. All five scenarios share a `PeriodStart` **today**, but
[CR064 P2](cr-064-forecast-annual-close-and-assumptions.md) — the annual close, decided 2026-08-02 and
not yet built — is precisely about `PeriodStart` moving per scenario. A positional implementation
would pass every test written today and break the first time that ships.

**Interior gaps stay gaps (`connectNulls={false}`), deliberately.** Nothing else is lost by dropping
`compareMatrices`: `structural.onlyInA/onlyInB`, `hasData` and the Review row ordering are all
table concerns, and CR040's post-release zero-coalescing lives *only* inside the delta computation
(fcCompareUtils.js:340-344) — the `a`/`b` display arrays keep their nulls. So a year where the engine
wrote no rows for a scenario is a visible break in that line, exactly as on Compare. With two lines
that reads as data; with seven it may read as a rendering bug. Keeping `null` is what makes the §8
parity check meaningful, so it is kept — recorded here as a decision, not an inheritance.

## 5. Scope

### 5.1 P1 — extract the shared chart, `/forecast-compare` unchanged

Ships on its own, before any of this page exists. `FCTrajectoryChart({ years, series, metric, onMetric })`
takes the metric list, tooltip style, axis config and theme palette lookup out of
`FCCompareCharts.jsx` (210 lines, ~120 of them the trajectory half) and renders N `<Line>`s from a
`series` array. `FCCompareCharts` then passes exactly two series with its existing A/B colours and
weights and keeps its delta bar chart. **No visible change to `/forecast-compare`** — that is the
whole gate (§8).

### 5.2 P2 — the page

- **Route** — `/forecast-multi-compare`, `category: "Forecasting"`, lazy, after Forecast Compare.
  **Deliberately no `step`**: [`routes.jsx`](../../frontend/src/config/routes.jsx) records the CR042
  invariant (the Forecasting group is exactly the six steps `FCStepNav` numbers, in the same order)
  and the Sidebar prefixes `N. ` only when `step` is set. **No `wrapper: ForecastProvider`** either —
  same reason routes.jsx:304 gives for Equity: the page's `useScenarios` is self-contained.
- **Loader** — `useScenarioSeries(scenarioObjs, balanceAccountMap)` built on `useQueries`
  (Decision 9). **Objects, not names:** `buildScenarioMatrix` needs `PeriodStart`, which lives in the
  assumptions document and arrives via `useScenarios` → `/api/v2/forecast/assumptions`
  (forecast.js:246-247), not in any per-scenario fetch — so the effect must not run before
  `scenarios` resolves. Per scenario: `/scenarios/years/:name`, `/entries?scenario=`,
  `/base-year-values?scenario=`. The balance report is a **separate query keyed on `PeriodStart − 2`**,
  which gives the dedupe for free — all five scenarios share a `PeriodStart` today, so that is one
  fetch, not five. Ticking a sixth checkbox fetches only the sixth scenario; the five already-loaded
  lines do not blank. Cost is not a concern: ~1,600 entry rows per scenario, ~8,000 across all five.
- **Controls** — base `<select>` from `scenarioOptions` roots; below it a checkbox per variant of that
  base, each carrying its staleness badge (§5.2). Selection persists under its own key
  `forecast_multi_compare_selection` (`{base, variants[]}`) — **not** the existing
  `forecast_default_scenario`, which is a single name written by `FCScenarios.jsx:526` and read by
  three hooks. A persisted name that no longer exists is dropped silently on load; a persisted base
  that no longer exists falls back to the first root.
- **Chart** — the shared `FCTrajectoryChart` from P1, one `<Line>` per selected scenario, base bold per
  Decision 4. **Synthetic `dataKey`s (`s0…s6`) with the display name passed as `<Line name={…}>`.**
  recharts resolves a string `dataKey` as a **nested path**, so a scenario name containing `.` or `[`
  would silently resolve to `undefined` — a missing line with no error — and one named `year` would
  clobber the x-axis key. Compare gets away with `[nameA]:` keys (FCCompareCharts.jsx:70-78) at two
  lines; this page should not inherit that.
- **A selected scenario that has never been generated must say so.** Its line is otherwise simply
  absent — the reader sees four lines where they ticked five and has no way to tell whether that is
  the data or a bug. This needs **no endpoint**: `findYearsByScenario` derives years from
  `SELECT DISTINCT forecast_year FROM forecast_entries` (`repositories/forecast.js:847-856`), so no
  entries ⇒ empty years, which the page already has in hand. Label the checkbox "never generated" and
  omit it from the chart. This is the one part of the staleness idea that is load-bearing, and it is
  in P2.

### 5.3 P3 — the last-generated badge (deferred; may be dropped)

Compare has "Generate both" because diffing a fresh scenario against a stale one *looks like a
finding*. That reasoning does not generalise: five sequential engine builds under
`pg_advisory_xact_lock` is slow and mostly wasted. Showing each scenario's build age instead was the
plan — **but the evidence for it is weak on the machine that matters**, which is why it is P3 and not
part of the page:

- **The drift is a dev artifact.** On dev, `2026 Upside` last built 2026-07-14 against 2026-07-31 for
  the other four. On **prod**, all five were built within about two hours of each other
  (2026-08-02 23:34 → 2026-08-03 01:28) — the badge would render five near-identical dates.
- **It measures build *age*, not staleness.** A [CR050](cr-050-forecast-scenario-variants.md) variant
  sync rewrites a variant's modules and does **not** touch `forecast_entries`, so a scenario can be
  synced minutes ago and badge as three weeks old while carrying a build that no longer reflects its
  modules — and the reverse. A half-measure is a poor trade for a new route, a new repo query, the
  envelope constraint, the `/scenarios/:id` ordering hazard and a new dependency on Step 6c.

If it is built anyway, the design is settled and these are the constraints:

- **`max(forecast_entries.created_at)`, joined by `scenario_id`** — the table has no name column, so
  the map is name → id → max.
- **It depends on the engine's pre-rebuild `DELETE`.** `max(created_at)` tracks the latest build only
  because Step 6c clears the scenario's rows first (`server/src/services/forecast/index.js:454`); the
  insert is `ON CONFLICT … DO UPDATE SET amount, comment` (fcbuilder-common.js:67-70) and never touches
  `created_at`. Remove or reorder that `DELETE` and the badge silently freezes at the first-ever build.
- **Endpoint** — read-only `GET /api/v2/forecast/scenarios/generated-at` →
  **`{ data: { [name]: ISO|null } }`**. The envelope is not optional: `check-api-envelope.sh` counts
  bare `res.json(x)` responses and may only shrink, and `Rest.unwrap()` (rest.js:115-131) unwraps any
  single-key `data` object — so a bare map containing a scenario literally named `data` would return a
  timestamp string instead of a map. Query in `repositories/forecast.js` per CR043, not inline in the
  route; handler beside the other `/scenarios/*` ones, minding the "must be defined BEFORE
  `/scenarios/:id`" note at forecast.js:327.
- **Not on `/assumptions`** — it backs `useScenarios`, `useAssumptions` and `useFCExpAssumptions`, i.e.
  essentially every forecast page, and the aggregate is a seq scan (3.2 ms over 8,116 rows on prod
  today, growing with entries; `idx_fc_entries_scenario_year` does not help). *Also rejected:* a
  `generated_at` column written by the engine — O(1) and semantically exact, but a migration for a badge.
- **The better version of this idea, if it is ever wanted:** `max(forecast_entries.created_at)` against
  `max(forecast_modules.updated_at)` per scenario → "edited since last build", which is real drift for
  the same query cost. It needs its own thinking about which module edits matter, so it is not this CR.

### 5.4 Palette (P2)

Six categorical hues plus the base's, validated in **light and dark**. Two constraints make this a
design item rather than picking colours:

- The lines run inside the same value band (roughly 2× top to bottom over 36 years), so **colour
  carries all of the distinction** — there is no shape cue to fall back on.
- Hex resolves at runtime via `useTheme`, as `FCCompareCharts` already does: SVG presentation
  attributes cannot read CSS custom properties.

**The palette lives in `frontend/src/features/Forecast/utils/fcSeriesPalette.js` — a `.js` module, and
that is structural, not stylistic.** `check-inline-hex.sh` scans `frontend/src/**/*.jsx` only and fails
when a new file introduces naked hex; `FCCompareCharts.jsx` is already baselined at 12 for its 2-colour
palette, and a 7-hue × 2-theme palette is ~16 more, which would fail CI and force a re-baseline. As a
`.js` module it stays out of the ratchet, becomes unit-testable (length, uniqueness, both themes
present), and is available to `FCReview`'s `GRAPH_COLORS` (FCReview.jsx:51-58) later.

`GRAPH_COLORS` is the tempting reuse and should **not** be taken as is: it is light-only, and
[CR040](cr-040-forecast-scenario-compare.md) already recorded that the app's muted brand hues *"failed
the chroma-floor/lightness checks and were snapped to the nearest passing steps."* Its **count** (6) is
the right ceiling; its values need re-validating with a dark variant.

## 6. Non-goals

- **No cross-base overlay.** One base and its own variants (Decision 2). Two unrelated roots on one
  chart is a different question and makes the bold line ambiguous. **This non-goal has a shelf life,
  and it is roughly one year.** `copyScenario` inserts **without** `parent_scenario_id`
  (`repositories/forecast.js:236-241`) — which is exactly why dev's `Base_Buy Business` is a second
  root rather than a variant — and [CR064 P2](cr-064-forecast-annual-close-and-assumptions.md) decided
  on 2026-08-02 to **keep minting a copy each year**. Unless that yearly copy carries lineage, next
  January's `2027 Base` arrives as a root with zero variants and this page shows the owner one line.
  The fix belongs in CR064 P2 (carry `parent_scenario_id` on the copy), not here; noted in both.
- **No tables, KPI cards, commentary or AI panel** — that is `/forecast-compare`, whose *behaviour* is
  unchanged by this CR (its chart component moves; what it renders must not, per §8).
- **No generate/rebuild action** on the page (§5.2).
- **No engine, entries, or schema change.** Read-only; no migration.

## 7. Known hazards for the build

Recorded so they are designed for, not discovered:

1. **Query keys must be stable.** `useQueries` keyed on `["fc-series", scenarioName]` is stable by
   construction; an inline array of names as a dependency is not, and would refetch on every render.
2. **Per-scenario error isolation.** One failing `/entries` must not blank the other six lines —
   `useQueries` gives per-query error state; use it rather than a single page-level error.
3. **Badge and series can disagree.** Both are fetched on load; if the owner regenerates a scenario in
   another tab, the badge and the plotted line go out of step until a manual refresh. Acceptable for a
   read-only report — stated so it is not later filed as a defect.

## 8. Verification

### P1 — the parity gate, and why it needs a new test

**`FCCompareCharts.jsx` and `FCCompare.jsx` have no component tests at all.** The only Compare coverage
is `utils/__tests__/fcCompareUtils.test.js` — 15 tests on a pure util this CR does not modify. So
"Compare's existing tests must pass unmodified" would assert **nothing about the component being
moved**, and `deploy-to-production.sh` (`set -euo pipefail`, builds the image) catches a *broken*
import but not a silently different render.

- **Write a render test on the extracted `FCTrajectoryChart` BEFORE extracting it**, against the
  current `FCCompareCharts`: the five metric toggles present and switchable, two `<Line>`s with the
  expected `name` / `stroke` / `strokeWidth`, both themes, the delta bar chart still rendered. It must
  pass unchanged after the extraction. That test *is* the gate.
- **P1 lands as one atomic commit.** `deploy-to-production.sh` builds from the shared working tree,
  and another thread's deploy has shipped uncommitted work twice in five days (migration 044 on
  2026-08-01; migration 055 + CR064 P6 on 2026-08-02). Those were dormant by luck. A half-extracted
  `FCCompare.jsx` importing a component that does not exist yet is *not* dormant — it fails the vite
  build and aborts someone else's deploy mid-flight.
- P1 gets its own release tag, so a Compare regression reverts without taking P2 with it.

### P2

- **Unit** — the alignment helper: union-of-years across scenarios with **different `PeriodStart`**
  (the §4 trap, tested explicitly), a scenario with no entries, and the 6-series cap. Palette module:
  length, uniqueness, both themes present.
- **Parity against Compare** — the base's line for each of the five metrics equals the same scenario's
  `A` series on `/forecast-compare`. Same function, so this is a wiring check — and it is the one that
  catches both a misaligned year index (§4) and the wrong `netCashFlow` source (§3).
- **Manual on dev (`:3105`)** — dev's lineage differs from prod: `Base_Buy Business` (id 66) has
  `parent_scenario_id` NULL, so **dev has one base with three variants plus a second root**, and
  `2026 Buy Business` (id 67, parent 47) exists only on prod. Verify the three-variant case on dev in
  light **and** dark; confirm the base reads as the base without consulting the legend, that
  `2026 Upside`'s older build is visibly badged, and that the second root does **not** appear under
  `2026 Base`'s variants. The four-variant case is verified on prod after deploy.
- **Gates** — frontend suite green, lint clean (0 errors), production build clean, and all six
  ratchets non-increasing. Three are in play: **hex** (addressed by §5.3's `.js` module),
  **api-envelope** (addressed by §5.2's `{ data: … }`), and **buttons** —
  `check-button-css.sh` fails on any new `*-btn`/`*-button` class definition, so reuse
  `FCCompareCharts.css`'s element selectors under `.fc-compare-metric-toggle` rather than inventing
  `.fc-multi-*-btn`.
