# CR-053 — Forecast Auto-Adjust: solve spend-down to fund the plan

**Status:** SHIPPED v3.3.0 (2026-07-16) · **Track:** v3 ·
**Depends on:** CR045 (cash warnings / forced liquidation), CR050 (scenario variants /
overrides), CR049 (final-year sweep tax).

> Revised after a senior engineering review (2026-07-16) that found the first draft's scratch
> mechanism impossible and its objective mis-located. Corrections are inline; the
> "Why the obvious shortcuts don't work" section records what was rejected and why.

## Implementation status (2026-07-16)

Phases 1–4 built and verified end-to-end against the **dev DB** (both solve paths, both apply
paths, HTTP job+poll), non-destructive with clean scratch teardown; owner clicked it through on
dev. **Shipped v3.3.0** (2026-07-16); no migration.

- **Backend service** [`server/src/v2/services/forecastAutoAdjust.js`](../../server/src/v2/services/forecastAutoAdjust.js):
  `solveSpendReduction` (deep-copy scratch → threshold-search → teardown), `applySpendReduction`
  (variant override via `interceptWrite`/`mergeEntityOverride` + verification rebuild),
  `listExpenseLines`, and an in-memory `startSolveJob`/`getSolveJob` registry.
- **`generateForecast(name, { writeAudit })`** — audit-CSV writes skipped for scratch builds.
- **Routes** (`server/src/v2/routes/forecast.js`): `GET /auto-adjust/lines/:scenario`,
  `POST /auto-adjust/solve` (202 + jobId), `GET /auto-adjust/solve/:jobId`, `POST /auto-adjust/apply`.
- **Frontend**: `FCAutoAdjustModal.jsx` (+ CSS), a button in `FCReviewWarnings` shown on a blocking
  issue, wired into `FCReview` (fresh-mount modal; `useScenarios` gains `reload` so a created
  variant appears in the selector).
- **Tests**: `forecastAutoAdjust.test.js` (9, pure logic + validation + job registry); 117 forecast/
  variant suites still green; frontend lint 0 errors / 0 new warnings; build passes.
- **Proof on dev:** "2026 Downside (variant)" ($451K single-year final-year shortfall) solves to a
  **~2% uniform cut** (curve $451K→$182K→$47K→$0 over 0→2%, monotone), applied as a variant leaving
  the base untouched and verified funded.

*Open Phase-0 decision still deferred:* whether the picker excludes expense items carrying dated
`Changes` (a single `base_value` factor won't scale those steps) or scales them too.

## Problem

When a scenario's cash sweep runs out of ranked assets to sell, the Cash Health panel
reports a shortfall ("Cash shortfall the forecast could not fund", "Bank balance goes below
zero") but the owner has no tool to answer the obvious next question: *how much would I have
to cut spending to make this plan fundable?* Today that is manual trial-and-error — edit an
expense line, regenerate, read the warnings, repeat.

## The ask (owner, 2026-07-16)

> If a scenario/variant runs out of cash, let the user click, select an expense account, and
> the system reduces that spend (same % across all years) so the cash balance ends on the
> minimum at the end of the plan.

## Objective (corrected)

**Least uniform % cut to a chosen *set* of expense lines such that no year breaches the low
band.** Two corrections to the owner's phrasing:

1. **Tightest year, not the final year.** The sweep already pins cash *to* the low band every
   year until its ranked assets drain; "ending cash" is not the failure mode — the sweep
   running dry **mid-horizon** is. Windowed expense lines (CR046), one-off `Changes`, an
   income window ending, or a ranked source draining (Fidelity Fixed Income drains by 2034)
   can make an **interior** year the binding constraint. Solving for the final year alone
   under-cuts and leaves an interior breach.
2. **A set of lines, one shared factor** (not a single line). Nearly free to implement (the
   knob scales a selected set of rows by the same `p`) and it removes the "even zeroing one
   account isn't enough" dead-end. Matches the real intent: "cut discretionary spending
   proportionally."

**The metric is the engine's own output, computed server-side — never the client util.**
The sweep already persists the signal: a `Cash Shortfall` entry per unfunded year
(`cash-sweep.js:368,411`). Define

```
f(p) = Σ over years of unfunded shortfall, read from forecast_entries on the scratch scenario
```

Re-porting `frontend/.../fcWarnings.js` server-side is forbidden — a second copy of
load-bearing logic that silently diverges is exactly the CR045 / CR049 hand-copied-query bug
class. Read the persisted `Cash Shortfall` rows; that is the single source of truth.

## Why it must be a numerical solve, and it's a threshold search

Expense-cut % → shortfall is **monotone** (cut more ⇒ more cash ⇒ less shortfall) but not
closed-form: sweep bands, **capital-gains tax on forced sales** (less spend ⇒ fewer forced
sales ⇒ less tax ⇒ more cash — a second-order feedback, CR049), FX, and windowed lines all
bend it. The tax feedback alone rules out a spreadsheet formula.

`f(p)` **decreases while underfunded, then sits flat at zero** for every `p ≥ p*`. So this is
a **threshold search — the smallest `p` with `f(p) ≤ ε` — not a sign-change root-find** (there
is no sign change to bracket). Bisect for that threshold on `p ∈ [0, 1]`.

- **Tolerance** = ~1% of the band (e.g. $2K), **not** $1: each build carries its own
  ≤10-iteration sweep-convergence residual, so chasing the cent wastes iterations or never
  terminates. With a $ tolerance the real eval count is **~7–10 builds**, plus a hard cap.
- **Monotonicity is assumed, not proven.** Guard it: (a) assert the search invariant each
  step (a larger `p` must not increase `f`), bailing to a report if violated; (b) the result
  is only trusted after the **post-Apply verification rebuild** (below).
- **Infeasibility is first-class.** If `f(1.0) > 0` (zeroing the whole set still leaves a
  shortfall), return `feasible = false` with the residual and disable Apply.
- Guardrails: clamp `p ∈ [0, 1]` (no negative spend); optional **floor** ("never cut below
  $Y" on a line) narrows the interval.

## Build strategy — Path A (slow solver, decided 2026-07-16)

`generateForecast(scenarioName)` is **not** a pure function: it opens its own `db.transaction`,
takes a per-scenario `pg_advisory_xact_lock`, does `DELETE`+`INSERT` into `forecast_entries`,
and runs the sweep/income-convergence loop (≤10 iterations of per-module × per-year `UPDATE`s).
One run is DB-heavy; builds of the same scenario serialize.

**The scratch working set is a standalone deep-copy — NOT a throwaway variant.** See "Why the
obvious shortcuts don't work." The solver:

1. **Deep-copy** the target once (`POST /scenarios/byname/:name/copy`) → a *parentless*
   scratch scenario `__autoadjust_<target>_<n>`. Parentless ⇒ the nested-variant trigger
   doesn't apply and the build's Step-0 force-sync doesn't run, so a direct row `UPDATE`
   survives the rebuild.
2. Per bisection step: `UPDATE forecast_modules SET expense_amount = base×p` (and/or the
   incexp `base_value`) on the scratch's selected lines → `generateForecast(scratch)` →
   `SELECT Σ Cash Shortfall FROM forecast_entries WHERE scenario_id = scratch`.
3. Converge to `p*`; **delete the scratch** (and on failure/crash — orphan sweeper by name
   prefix).
4. Return `{ factor: p*, bindingYear, feasible, beforeSeries, afterSeries }`.

**Disable audit-CSV writes for solve builds** — ~10 probes × N modules of `writeAuditTrail`
CSVs is I/O waste and pollutes the audit trail, which must reflect only *real* builds.

**Run it as a job with a poll endpoint, not a blocking POST** — ~10 sequential builds is
20–90s and a synchronous request will hit nginx/proxy timeouts. (Alternatively a hard
iteration cap proven under the timeout; the job is cleaner.)

**Deferred (Path B, only if latency annoys):** extract a pure in-memory
`projectScenario(config, {lineFactors}) → {series, shortfall}` (the per-module `computeModule`
functions are already pure; what's DB-bound is the sweep/convergence using `forecast_entries`
as scratch). That removes the deep-copy and makes the solver near-instant, and it also
accelerates Compare. Not built speculatively.

## Where the knob plugs in — and how Apply persists

- The knob multiplies the selected lines' base value — `forecast_modules.expense_amount` or
  `forecast_income_expense.base_value`. Each year is that base grown by inflation/growth, so
  one factor scales **all years uniformly** — the owner's "same % across all years" falls out.
  This holds in **both** expense modes: `inflation` (scales the level directly) and
  `pct_of_value` (scales the derived rate `expense_amount/market_value`). Well-defined either
  way.
- During the solve the factor is a direct `UPDATE` on the **scratch** scenario (see above);
  nothing on the target is touched until Apply.
- **Apply persists as a CR050 override on a variant**, `expense_amount = round(effective × p*)`
  per line (overrides store absolute values, not multipliers — `forecastVariants.js` merges
  raw fields). "effective" = the line's **current effective amount on the target** (post any
  existing override), so a prior deliberate override is scaled, not silently discarded.
  - **Target is a variant** → write the overrides on it. Shows in `FCVariantPanel` as
    "was $X → now $Y" and re-syncs into the engine as ordinary rows.
  - **Target is a base scenario** (no override layer) → Apply first **creates/reuses a variant**
    `<name> — reduced spend` and writes the overrides there. The base is never mutated — but,
    per the owner's ask, a base target *is* supported; it just produces a variant.
- **Verification is mandatory:** after Apply, **rebuild the real (variant) scenario and re-run
  the warnings**; confirm zero blocking issues. Do not trust the scratch build's number — the
  scratch and the variant are different scenarios and could differ subtly. Surface any residual.

**Caveat — dated Changes.** If a selected expense is a standalone incexp item carrying dated
`forecast_incexp_changes` (Flag P/F/O), a factor on `base_value` won't scale those steps, so
the cut would be non-uniform. v1 either excludes lines-with-changes from the picker or scales
the changes proportionally too — **decide in Phase 0.**

## Why the obvious shortcuts don't work (rejected during review)

- **Throwaway variant as scratch — rejected.** (a) A variant of a variant is rejected by the
  DB trigger `trg_fc_reject_nested_variant` (039:35–37), so it can't scratch a *variant*
  target — which the owner explicitly wants. (b) `generateForecast` force-syncs a variant from
  base⊕overrides at Step 0 (`index.js:277`), so any factor written into a variant's row is
  **overwritten** before the sweep runs. → standalone deep-copy instead.
- **A transient `factor`/`noPersist` param on `generateForecast` — rejected for v1.** The
  sweep uses `forecast_entries` as its working store, so "don't persist" *is* the Path-B
  in-memory refactor, not a small param. Deferred with Path B.
- **Reusing `fcWarnings.js` server-side — rejected.** Client util; porting it server-side
  duplicates load-bearing logic (the CR045/CR049 drift class). Read the engine's persisted
  `Cash Shortfall` entries instead.
- **Solving for final-year cash — rejected.** The binding year is often interior; see
  Objective §1.

## Scope discipline

Build the solver **generic over "one scalar `p` × a selected set of lines + the shortfall
objective,"** wire the **expense-lines knob first**, stop. The same framework later drives
"auto-schedule a disposal of $Y" — not now. Uniform-% is the v1 policy; flat-dollar or
cut-only-after-the-shortfall-year are future variants.

## Phases

| Phase | What | Reuses |
|---|---|---|
| 0 | Lock objective (least % over a set so no year breaches; tightest-year); base-target ⇒ variant rule; dated-`Changes` rule | — |
| 1 | Scratch harness: deep-copy → row `UPDATE` → `generateForecast` → read `Σ Cash Shortfall`; audit-CSV off; delete + orphan sweep | copy route, engine, entries |
| 2 | Threshold search on `p ∈ [0,1]` (≤10 evals, ~1%-band tol, monotonicity guard) → `{factor, bindingYear, feasible, before/after}`; async job + poll | engine per eval, persisted shortfall |
| 3 | Apply → CR050 override `expense_amount = effective × p*` (create/reuse variant if base target) → **verification rebuild + warnings recheck** | `forecastVariants.js`, `FCVariantPanel` |
| 4 | UX: button in the Cash Health panel → multi-select lines (+ optional floor) → progress → before/after → Apply/Cancel | `fcWarnings.js`, `FCReviewWarnings.jsx` |

## Success criteria

- On a fundable-by-cutting shortfall, the solver returns a factor where every year's shortfall
  is 0 and the tightest year sits on the band (±tolerance).
- On an unfundable-by-the-selected-set case, it returns `feasible = false` with the residual,
  and Apply is disabled.
- **After Apply, a fresh rebuild of the resulting variant shows zero Cash Health blocking
  issues** (verified, not asserted), and the cut is visible in `FCVariantPanel` as per-line
  overrides that re-sync.
- The base scenario is never mutated; every scratch scenario is deleted (none orphaned).

## Key files

Engine `server/src/services/forecast/index.js` (`generateForecast`, Step-0 variant sync :277) ·
builders `fcbuilder-module.js`, `fcbuilder-incexp.js` · sweep `cash-sweep.js`
(`Cash Shortfall` :368,411) · variants `server/src/v2/services/forecastVariants.js`,
nested-variant trigger `db/migrations/039_scenario_variants.sql:29-50` · copy route
`server/src/v2/routes/forecast.js` (`byname/:name/copy`) · warnings
`frontend/src/features/Forecast/utils/fcWarnings.js` · UI `FCReviewWarnings.jsx`,
`FCVariantPanel.jsx`.
