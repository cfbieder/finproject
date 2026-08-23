# CR085 — Which assumption is load-bearing: sensitivity as a tornado — ✅ **COMPLETE (P0 · P1 · P2)**

**Status:** **COMPLETE and LIVE** — P0 + P1 as **v3.32.0** (migration 073), P2 as **v3.33.0**.
**P1 and P2 were both built at owner instruction, over this CR's own sign-off defer (§15)**, with
all five scope cuts kept. Every review pass is recorded rather than absorbed — pass 1 *revise*, five
blocking (§14); pass 2 *GO on P0, DEFER P1*, five cuts (§15); a competitor review (§16); as-built
§17 and §18.

⚠️ **The lesson this CR paid for, four times: a knob that writes, builds and moves NOTHING.** It
draws a zero-length bar reading *"this assumption does not matter"* in a chart whose entire claim is
that the bars are ranked. An `exclude`d module (§17) · a valuation-gated field, **109 of 300 knobs**
(§18) · a negative-`width` bar label (§17) · and **this CR's own §4** filing `growth_rate` as a rate
when the engine reads it as a *multiplier of inflation*. Three were caught by reading the engine;
one only by rendering the page and looking at it.

**Still open and not built:** §15 cut 5's default knob set, so the picker opens empty. *(The **SRQ
financing experiment** — §15's precondition — was **declined by the owner on 2026-08-23**; see §15.)*
[Roadmap](../current/project-roadmap.md#cr085)
**Track:** v3 · **Migration:** 073 (`is_scratch`, additive and inert — **applied to dev 2026-08-19**)
**Opened:** 2026-08-19
**Origin:** [CR064 §13](cr-064-forecast-annual-close-and-assumptions.md) designed this and deferred
it ("reuse, not new machinery — but nothing is *wrong* without it, which is why it is last"). It is
worth building now for a reason that did not hold then: **the machinery it wanted someone to reuse
has since been built** — [CR084](cr-084-save-time-consequence-preview.md) extracted
`withScratchScenario` out of CR053's solver, and CR085 is that harness in a loop.

**Depends on:** [CR084](cr-084-save-time-consequence-preview.md) (`forecastScratch.js`) ·
[CR053](cr-053-forecast-auto-adjust-spend-to-fund.md) (the job/poll *pattern*, `totalShortfall`) ·
[CR067](cr-067-forecast-multi-compare.md) (`FCTrajectoryChart`, P2 only) ·
[CR079](cr-079-real-terms-view.md) (the real-terms deflator)

---

## 1. The question the app cannot answer

Prod carries five scenarios and roughly forty numbers the owner typed by hand: growth rates,
inflation, FX paths, tax rates, selling costs, sale years, expense levels. Every one is a judgement.
Nothing in the app says **which of them the plan actually rests on**.

The only way to find out today is to hand-build a variant per question and read it on
`/forecast-compare`. That answers "what does *this* change do", one change at a time, and it never
produces the ranking — the ranking cannot be assembled from pairwise comparisons, because it
requires them to share a baseline and to use comparable nudges.

### 1.1 ⚠️ The motivating figure this CR first cited was STALE, and its correction is the better argument

The first draft opened on `2026 SRQ House Purchase` at **−1,392,889** and the open question of
whether the purchase is viable at all. **That number was superseded nine days before this CR was
written.** [status.md](../current/status.md) records it moving to **−476,930** on 2026-08-10, when
`Sarasota House` growth went **0 → 1.0** — the only US property not at full CPI, *"an unset field
rather than a belief"*. Only SRQ moved; the other four scenarios were byte-identical.

Correcting it here rather than quietly is the point: this project's most-repeated failure is **a
restated figure asserted as current, found ten times**, and a CR whose whole pitch is "surface the
silently-wrong number" cannot open with one.

**The correction is a better case for this CR than the original claim was.** One unset field was
worth **916K** in a single scenario, and it was found by the owner, not by the app. That is the same
class as CR078's selling costs (**−603K to −796K per scenario**, a plan that had been keeping 100%
of every sale) and as the `disposal_cost_pct` copy defect (**~890K**, §6). A tornado is an
instrument for exactly that class: it makes a field nobody has questioned show up as a large bar.

**What it is NOT is an answer to the SRQ question.** status.md names *"financing is the untested
lever"*, and `House Morgage` is `setup_status = 'exclude'` in all five scenarios while carrying a
fully specified loan (500,000 at 6.0% to 2048-07-01). Testing that is **one field flip plus a
regenerate**, and CR084's save-time preview already shows the delta before it is committed. That
experiment is a precondition of this CR (§15), not a use for it — a breakeven question wants
solve-for, which the owner ranked third (§11).

## 2. Decisions (locked with the owner, 2026-08-19)

| # | Question | Decision |
|---|---|---|
| 1 | Which output leads? | **Tornado** — ranked low/high bars per knob. The trajectory-line sweep (§12 P2) falls out of the same API and does not lead. |
| 2 | What may be a knob? | **Module fields, stream fields, and scenario-level assumptions** (inflation, FX paths, tax rate, sweep band) — the whole scenario, not one module. |
| 3 | How is a perturbed run computed? | **CR084's scratch harness**, with a fidelity gate (§6). Not a transaction-rollback on the real scenario; not an in-memory engine. |
| 4 | What are bars ranked by? | **Nominal net assets at the anchor's final year.** Other metrics come from the same builds, so re-ranking costs no rebuild. |
| 5 | Who sets the ± ? | **Per-kind defaults, editable per knob** (§4). Every bar prints its own ±. |
| 6 | Are runs stored? | **No.** Ephemeral results in a job map; the *knob set* persists to `localStorage`. |
| 7 | Scratch scenarios in the pickers | **`is_scratch` column, migration 073.** Built and verified ahead of the rest — §9. |

**Numbering:** this was scoped as "CR080 / migration 065". Both were taken while it sat unwritten.
Recorded because the earlier scoping notes carry the wrong numbers.

## 3. What already exists — the reuse inventory

| need | already built | where |
|---|---|---|
| throwaway copy + guaranteed teardown | `withScratchScenario(scenarioId, fn)` | [forecastScratch.js:97](../../server/src/v2/services/forecastScratch.js) |
| a real engine build against the copy | `build()` on that harness, `writeAudit: false` | forecastScratch.js:100-107 |
| reading a built scenario's entries | `readEntries(scenarioId)` | forecastScratch.js:119 |
| assumptions-document teardown, race-free | `pruneAssumptionsForName` — filter inside the UPDATE | forecastScratch.js:53 |
| Σ unfunded shortfall as a scalar | `totalShortfall` | [forecastAutoAdjust.js:153](../../server/src/v2/services/forecastAutoAdjust.js) |
| the four scalar metrics | `buildScenarioMatrix`, `fcRealTerms` — **frontend, and they stay there** (§5.3) | `frontend/src/features/Forecast/utils/fcCompareUtils.js` |
| the trajectory chart (P2 only) | `FCTrajectoryChart` | [FCTrajectoryChart.jsx](../../frontend/src/features/Forecast/FCTrajectoryChart.jsx) |

**Two rows the first draft overstated, corrected at review:**

- **The job runner is a pattern, not an import.** `startSolveJob` (forecastAutoAdjust.js:445) is
  hard-wired to `solveSpendReduction`. It is ~30 lines to generalise; nobody should plan on a free
  import.
- **CR053 was never converted to CR084's harness.** It still carries its own inline copy, its own
  teardown and its own read-modify-write `pruneAssumptionsForName` (forecastAutoAdjust.js:162-180).
  P0 gave its scratch the `is_scratch` flag, which is the part that mattered; converting it to
  `withScratchScenario` is worth doing and is **not** in this CR's scope.

**Cost of a build: ~0.5 s** on dev — measured 314 ms and 662 ms on `2026 Base` (30 modules, ~1,600
entries), matching CR084 §6's own figure. Eight knobs is 17 builds ≈ **8 s**.

## 4. The knob model

A knob is `{ target, field, kind, low, high }`. **"± 10%" is wrong for most of these fields**, so the
kind decides the arithmetic:

| kind | fields | perturbation | why not relative % |
|---|---|---|---|
| **rate** | `growth_rate`, `loan_interest_rate`, `tax_rate_override`, `disposal_cost_pct` | ± percentage **points**, default ±1pp | 0.5% ± 25% is 0.375–0.625%, not a stress; 4% ± 1pp is |
| **level** | `base_value`/`market_value`, `forecast_streams.amount`, `loan_principal`, investment and disposal amounts | ± relative %, default ±10% | correct here, and the only kind where it is |
| **multiplier** | `forecast_streams.growth_mult` — a multiple *of inflation* ("Growth (x Inflation)") | ± absolute, default ±0.25× | dimensionless; percentage points are meaningless on it |
| **timing** | stream `start_date`/`end_date`, disposal date, `loan_end_date` | ± whole **years**, default ±2y | no percentage form exists, and these move a plan most |
| **assumption-list** ~~P1~~ | `inflation` (rate, ±1pp), `FX` (**relative %, ±10%** — a rate of 3.9 has no pp reading) | applied to **every year's** entry in the scenario's own rows | the value is a path, not a scalar. **CUT FROM P1 (§15 cut 1)** — these are the only knobs that write the shared assumptions document |
| **binary** ~~P1~~ | module `setup_status`, a disposal present/absent | two states, no band | not a continuous axis. **CUT FROM P1 (§15 cut 4)** — its two live instances deserve real variant scenarios |

### 4.1 What is deliberately NOT a knob, and why

- **`PeriodStart` / `PeriodEnd` are excluded from P1.** They are not perturbations; they change what
  the number means. The base year is `PeriodStart − 1` and **the base year IS the budget**
  ([CR075](cr-075-base-year-is-the-budget.md); `services/forecast/crud.js` `getBaseYearValues`), so
  shifting `PeriodStart` reads a `budget_year` that does not exist and silently collapses base-year
  income, the base-year income tax and the sweep's opening cash. Opening bank cash separately reads
  `PeriodStart − 2` from the ledger. And a `PeriodEnd` knob would measure its low bar at 2060 and its
  high bar at 2064 against a 2062 anchor — three different questions, drawn as one bar. If they are
  ever wanted, they need their own metric definition, not a row in this table.
- **`derived`-mode streams.** Computed from another figure; perturbing one either does nothing or
  double-counts.
- **`amount` on a `yield` or `pct_of_value` stream.** It is 0 by construction on those modes, so the
  knob is a guaranteed no-op — and a 0-impact bar reads as "this does not matter", which is the
  failure §4.3 rule 3 exists to prevent. **The whitelist is keyed on `(field, stream.mode)`, not on
  the field alone.**
- **`Spread %`, `Fixed $`, `One-Off $` and `Percent %` schedules.** These are *not columns*: they are
  `forecast_stream_changes` rows carried forward year to year (`fcbuilder-stream.js:92-113`, applied
  at :163-171). A column-oriented setter has nothing to write. They are real sensitivity targets and
  they are **deferred to P2**, where they take the same whole-list treatment as inflation.

### 4.2 Sign: low and high are defined on the METRIC, never on the field

**Liabilities are stored negative** — `moduleWrite.js` treats `market_value < 0` as debt, and the
engine's own worked example is `PLN Credit Cards` at −24,542.66 (fcbuilder-module.js:161-165). So
"+10% on `market_value`" makes a house worth more and a mortgage worth *more negative*. A tornado
that labels both ends by the field's arithmetic sign is confidently backwards for every loan and
credit-card module in the plan.

Therefore: a knob's two runs are computed, and the bar is labelled by **which direction the metric
moved**, with the perturbation printed beside it. Never by the sign of the arithmetic. A unit test
covers a module with a negative `market_value`.

### 4.3 Four rules that are not negotiable

1. **A level knob moves BOTH currency columns by the same factor.** The engine reads `BaseValue`
   *and* `BaseValueUSD`, derives the implied acquisition FX rate from their ratio
   ([fcbuilder-module.js:324](../../server/src/services/forecast/fcbuilder-module.js)), and — for a
   module marked USD — **throws** if the two disagree by more than a cent (fcbuilder-module.js:166-177).
   Scaling one alone either re-rates the module's currency or aborts the build outright.
2. **Assumption knobs are lists, and their setter is one scoped UPDATE.** `inflation` and `FX` are
   `{Year, …}` arrays inside four `forecast_assumptions` rows that **every scenario shares**. The
   column is `json`, not `jsonb`, deliberately (CR039 byte-parity), so a whole-array round-trip
   through JS rewrites other scenarios' entries as a side effect. The setter touches only elements
   whose `Scenario` equals the scratch's name, in a single statement — the shape
   `forecastScratch.js:53-70` already uses for teardown.
3. **Targets resolve by NAME on the scratch, never by id.** `copyScenario` re-keys every id, so a
   real module id means nothing on the copy — CR084 hit this and resolves by name with an ambiguity
   guard ([forecastPreview.js:100-112](../../server/src/v2/services/forecastPreview.js)). A stream
   resolves within its module by `(direction, fc_line_id)`, but note `idx_fc_streams_unique_line` is
   **partial** (`WHERE fc_line_id IS NOT NULL`) with a second index for the NULL branch, and live
   modules carry NULL `fc_line_id` — so the key is `(direction, fc_line_id)` **with NULL as a
   distinct value**, matching the two indexes. **A target resolving to zero rows or to more than one
   aborts the run**, naming the count. A knob silently skipped is a knob that reads as harmless.
4. **The settable field list is a closed server-side whitelist**, and every entry declares its **NULL
   semantics**. Field names never reach SQL as identifiers. NULL is load-bearing in more places than
   is obvious: `tax_rate_override` NULL = fall back to the scenario rate (never 0); `growth_mult`
   NULL ≡ 1 ≡ plain inflation; `disposal_cost_pct` NULL = "not modelled" while 0 = "considered, and
   free"; `end_date` NULL = open-ended, which a ±2y shift must not materialise into a date;
   `amount_usd` is nullable by design. The setter test iterates the whitelist with a NULL fixture per
   field.

## 5. The run

### 5.1 The loop

```
withScratchScenario(scenarioId, async ({ id, build }) => {
  assertCopyFidelity(sourceId, id)          // §6 layer 1 — before any number
  feasibilityPass(id, knobs)                // §5.2 — every band applied and reverted, 0 builds
  await build();  zero = readEntries(id);  fingerprint = inputFingerprint(id)
  for (const knob of knobs)
    for (const side of ['low', 'high']) {
      const restore = await apply(id, knob, side)   // captures the PRIOR VALUE
      await build();  record(knob, side, readEntries(id))
      await restore()
      assertFingerprint(id, fingerprint)            // §5.2 — or abort loudly
    }
})                                                  // teardown in `finally`, always
```

- **The anchor is the zero-point build on the scratch, never the source's stored entries.** CR084's
  central finding, inherited verbatim: *"`forecast_entries` is the result of the last build, and
  stale entries beside fresh inputs is the NORMAL state of this system"*. Diffing against stored
  entries attributes every un-regenerated edit since the last build to the knob being measured.
- **Revert, don't re-copy.** Re-copying per point would cost ~0.3 s each and touch the shared
  assumptions document 2N more times.
- **Caps: ≤ 8 knobs** ⇒ at most 17 builds. (A build cap is stated in P2, where a sweep can exceed
  this; in P1 the knob cap binds first and a second cap would be dead text.)

### 5.2 Two guards the first draft did not have

**A feasibility pass, before any build.** Perturbations hit CHECK constraints:
`disposal_cost_pct` is `CHECK (>= 0 AND < 100)`, so ±1pp on a 0.5% cost violates it;
`forecast_streams.amount`/`amount_usd` are `CHECK (>= 0)` magnitudes. Discovering that on build 11 of
17 wastes eight seconds and returns nothing. Every knob is applied and immediately reverted at both
ends first — zero builds — and an infeasible band is refused up front with the field named.

**A drift detector on the revert.** This is the loop's only silent failure mode: if one restore is
lossy, every later point measures its knob *plus* a residue — fifteen wrong bars, no exception. Two
rules close it:

- **`restore` replays a captured prior value; it never computes an inverse.** `× 1/1.1` after `× 1.1`
  does not return a `NUMERIC(15,2)` to where it started.
- **A fingerprint of the scratch's inputs** — modules, streams, stream changes and its own
  assumptions rows — is taken after the zero-point build and re-checked after **every** restore.
  Milliseconds against a 0.5 s build, and it converts a silent cumulative error into a loud abort.

### 5.3 Where the metrics are computed — the server returns entries, not numbers

Net assets is `buildScenarioMatrix` and real terms is `fcRealTerms`; **both are frontend code**, and
CR084 explicitly refused to port them: *"porting them would create a second implementation of numbers
the Review and Compare pages already render"* (forecastPreview.js). A server-side net-assets sum that
disagreed with Compare on any rule — sign conventions, which accounts roll into assets — would
produce a **different ranking with no error anywhere**.

So the API returns **raw entries per point** and the client computes the metrics with the code
Compare uses. 17 points × ~1,700 rows ≈ 3 MB, on a LAN, for an owner-initiated action. The one
exception is **Σ unfunded shortfall**, which stays server-side because `totalShortfall` is already
server code reading `Cash Shortfall` rows directly.

**P1 ships exactly TWO metrics, and the switcher is cut (§15 cut 2):** nominal net assets at the
anchor's final year, and Σ unfunded shortfall. Enumerated deliberately — the first draft said "the
four metrics" and never listed them, while `fcTrajectoryMetrics.js` defines **five**, and an
un-enumerated count becomes five in the build.

**Real terms cannot reorder a bar, so it is not a metric worth a control.** `fcRealTerms` deflates by
`(scenario name, year)`, and every point in one run shares both — so the deflator is one identical
scalar across all 17 points and a real-terms ranking is *arithmetically identical* to the nominal
one. It relabels the axis. The single exception is an inflation knob, which cut 1 removes from P1.

### 5.4 Non-linearity is real and must not be smoothed over

The cash sweep and forced liquidation make the model path-dependent: a downward nudge can trigger a
sale that changes everything after it. Every point is a real engine build, so each number is true —
but the tornado's *shape* implies independence and near-linearity, and that implication is false.

- **Never display a sum of impacts**, and never offer an "all knobs at low" bar. That case is a
  scenario, and the app already has scenarios.
- **Flag a knob whose low and high impacts are asymmetric beyond a threshold as a regime change**,
  naming the sweep as the likely cause. The threshold is §13.2, still open.

## 6. The fidelity gate

**The failure this guards against has already happened, in production, through this exact code
path.** `copyScenario` dropped `disposal_cost_pct`, so every copied scenario reported the full sale
proceeds with no selling costs — *"it surfaced only because a scratch copy of `2026 SRQ House
Purchase` measured ~890K better than the original for no modelled reason"*
([copyScenario.columns.test.js](../../server/src/v2/repositories/__tests__/copyScenario.columns.test.js)).
A sensitivity run is that same copy, in a loop, presented as a ranking.

Because the anchor and every perturbed run come from the **same** copy, a dropped column cancels out
of the **Δ arithmetic**. It does not cancel out of the **anchor** the page prints, nor out of the
**regime** — a plan built without selling costs sits in a different place relative to the cash sweep,
so a knob's measured impact, and therefore the ranking, can differ.

**Resolved after pass 1 — three layers, and the middle one is now the owner's choice:**

- **Layer 1 — structural, mandatory, free.** After the copy, compare source and scratch row counts
  and per-column checksums across `forecast_modules` and every child table. Read-only; no build; no
  write to the source. **Its exclusion list is the repository's own derived column list, exported and
  consumed** — the copy deliberately omits `id`, `scenario_id`, `created_at`, `updated_at`,
  `origin_base_id` and repoints `secured_asset_module_id` in a second pass, so a hand-kept second
  exclusion list would both false-positive on every run and re-create the drift §9 exists to kill.
- **Layer 2 — a staleness *banner*, free, non-blocking.** Compare the zero-point metrics against the
  source's **stored** entries — one read, no build, no write — and say *"the stored forecast differs
  from a fresh build by X; regenerate to see this on Review."* This delivers the divergence signal
  that motivated the original decision, and it never blocks a ranking on it.
- **Layer 3 — ~~"strict verify", a labelled toggle~~ — CUT (§15 cut 3).** Layers 1 and 2 are both free and mandatory; this was a UI control plus a write path the owner did not ask for. Build it only if layer 1 ever fires ambiguously. Retained here as the design, should that happen: Regenerates the source and requires
  the zero-point build to match it. Strictly stronger than layer 1; its cost is a write the owner did
  not ask for (the advisory lock plus ~1,600 rewritten entry rows), so the control says *"also
  regenerates «scenario»"* and the write is a choice rather than a side effect.

**Recorded so the reasoning is not read as inconsistent:** the "layer 2 writes to owner data"
objection is weaker than it first looked, because §7 hazard 1 already mandates a write to the source
— syncing the variant materialises rows into it. The difference is one of degree.

## 7. Hazards carried into the build

1. **Sensitising a variant needs a sync first, and on live data the target usually IS a variant.**
   The scratch is parentless — deliberately, so a direct write to it survives (forecastScratch.js:10-13)
   — so `generateForecast`'s Step 0 variant sync never fires on it (index.js:255-260, gated on
   `parent_scenario_id`). **Four of five scenarios are variants**, `2026 SRQ House Purchase` among
   them. Copy an unsynced variant and the entire run measures a stale materialisation. Use
   `syncIfStale`, not a forced sync: same guarantee, no write when the variant is already fresh.
2. **Two scratch prefixes exist** — `__scratch_` (CR084) and `__autoadjust_` (CR053). §9's
   `is_scratch` column supersedes both as the thing to filter and sweep on; CR053's solver now sets
   it, though it still has its own inline harness (§3).
3. **Assumption knobs write the shared document, and this CR widens that exposure.** The first draft
   claimed it did not. It does: an inflation/FX/tax knob's setter and its restore each write
   `forecast_assumptions` — 4 writes per knob, on four rows every scenario's inflation lives in, for
   exactly the knobs Decision 2 promotes. §4.3 rule 2's single scoped UPDATE is what keeps each of
   those writes atomic. `copyScenario` remains a read-modify-write ([CR084 §9.1](cr-084-save-time-consequence-preview.md)),
   unchanged here.
4. **`tax_rate_override` and four other fields are NULL-load-bearing** — §4.3 rule 4.
5. **Concurrency.** Two runs, or a run and a CR084 preview, each hold their own scratch and their own
   advisory lock, so they neither deadlock nor contend on the engine — but they do contend on the
   assumptions document (hazard 3). **The job map must refuse a second run while one is in flight**;
   it has no such guard today (`startSolveJob` keys nothing on scenario).
6. **17 sequential builds block the single Node event loop for ~8 s.** The job map makes the
   *request* async; the *work* still runs in-process, so the API, the feed cron and the owner's other
   tabs stall. CR053 set the precedent at ~12 builds; this is not a new class of problem but it is
   larger. Stated as a known degradation, with `setImmediate` between builds so the loop drains, and
   the measured number published in the release note.

## 8. API and UI

| route | purpose |
|---|---|
| `POST /api/v2/forecast/sensitivity` | body `{ scenario, knobs[] }` → `{ data: { jobId } }` |
| `GET /api/v2/forecast/sensitivity/:jobId` | `{ data: { status, result?, error? } }` — `result` carries raw entries per point (§5.3) |

Envelope is `{ data: … }` — `check-api-envelope.sh` counts bare `res.json(x)` and may only shrink.

**UI** — a new page `/forecast-sensitivity`, `category: "Forecasting"`, lazy, **no `step`** and no
`ForecastProvider`, following `FCMultiCompare` and `FCEquity`. (routes.jsx records a CR042 invariant
about the Forecasting group being exactly the steps `FCStepNav` numbers — **five** since CR069 P2,
not six; the repo's own comments still say six in two places and that is where the first draft of
this CR picked it up.) Compare's KPI row and delta grid are pairwise *by construction*, the same
reason [CR067 decision 1](cr-067-forecast-multi-compare.md) gave for not extending that page.

- Scenario picker → grouped knob picker (scenario-level knobs first, then one group per module).
- Each knob shows its kind, its default band and an editable low/high; infeasible bands are refused
  by the feasibility pass (§5.2) before anything runs.
- Run → spinner with a build counter (CR084 §8: **the wait has to look like a wait**).
- Result: horizontal bars sorted by |impact|, **each labelled with its own ±**, an anchor line at the
  zero-point value, direction taken from the metric (§4.2), a regime-change flag, the staleness
  banner (§6 layer 2), and a metric switcher that re-ranks with no rebuild.
- **No new `*-btn` / `*-button` class definitions** — `check-button-css.sh` is a ratchet.

## 9. P0 — BUILT AND VERIFIED (2026-08-19)

Two pre-existing defects, both independently useful, neither needing the rest of CR085. Built first
so this CR's own risk stays confined to the knob layer.

**Migration 073 — `forecast_scenarios.is_scratch BOOLEAN NOT NULL DEFAULT FALSE`** plus a partial
index on `created_at WHERE is_scratch`, back-filling the flag onto anything already named
`__scratch_%` or `__autoadjust_%` (0 rows on dev). Additive and inert: every existing row is FALSE,
which is exactly today's behaviour. It closes
[CR084 §9.2](cr-084-save-time-consequence-preview.md) — CR053's solver and CR084's preview both build
their scratch through `copyScenario`, which inserts `is_active = TRUE`, and `findAllScenarios`
filtered on nothing else, so a scratch was visible in **all seven scenario pickers** while it existed
and permanently if the process died before teardown.

- `findAllScenarios` excludes it from **both** branches — `activeOnly: false` is exactly where a
  leaked scratch would resurface.
- **`copyScenario` takes `{ isScratch }` so the flag lands in the SAME transaction as the copy.** A
  second statement afterwards would leave a crash window in which the row leaks *unflagged*, and an
  unflagged leak is invisible to the sweep — the flag would reintroduce the leak it closes.
- `sweepStaleScratch()` runs at boot and deletes flagged scenarios **older than an hour**. Keyed on
  age, because a live run's scratch is indistinguishable from a leaked one except by age, and
  deleting a live one fails the owner's build mid-flight.
- *Rejected:* a name-prefix test (two prefixes already exist, and CR050 §3 rejected name-keying for
  this exact reason) and reusing `is_active` (owner-facing — in `SCENARIO_UPDATE_FIELDS`, exposed as
  `IsActive`, so the owner could flip a scratch back into every picker).
- Post-conditions assert the column, the index, and that **no non-scratch scenario was flagged** —
  the one that protects owner data, since a too-broad back-fill would hide a live scenario and then
  let the sweep delete it. Schema-qualified via `current_schema()` per the 070/071 lesson. Idempotent,
  proved by applying it twice.

**`copyScenario`'s child-table column lists are now derived.** `forecast_modules` already read its
columns from `information_schema`; its five child inserts did not, and `copyScenario.columns.test.js`
guarded three of the five — `forecast_streams` and `forecast_stream_changes` were both unguarded
**and** hand-enumerated, in the part of the schema CR069–CR073 have been actively changing. All five
are derived now, once per copy rather than once per module, and the test covers all five.

**Verified:** the whole backend suite against a from-scratch CI-shaped database
(`Scripts/test-fresh-db.sh`) — 1,003 passing before, and the two new files 8/8 after. The first run
of the new test **failed there and passed on dev**, because it reached for an ambient `fc_lines` row
that a fresh database does not have; it now seeds its own, with an explicit `line_type` because a
fresh DB enforces 007's CHECK that dev has auto-baselined away (Known Issue #18). That is the failure
`test-fresh-db.sh` exists to catch, caught before the push rather than in CI.

## 10. Verification

- **Unit — the setters.** One per kind: a rate knob moves percentage points; a level knob moves
  **both** currency columns and leaves the implied acquisition FX unchanged; a multiplier moves
  absolutely; a timing knob moves whole years; **a module with a negative `market_value` produces a
  bar whose direction follows the metric, not the arithmetic** (§4.2). Property-style over the
  whitelist so a new kind cannot skip it, with a **NULL fixture per field** (§4.3 rule 4).
- **Unit — restore is a replay, not an inverse**, and the fingerprint check fails a deliberately
  lossy restore (§5.2).
- **Integration — the anchor.** A **zero-knob** run equals a direct build of the source, on a
  scenario whose stored entries were deliberately staled first. Asserts both that the anchor is the
  scratch's own build and that stored entries are not consulted.
- **Integration — the variant trap (§7 hazard 1).** Edit the base, do **not** sync, run a zero-knob
  sensitivity on the variant, assert the anchor equals a fresh build of the *synced* variant. Without
  this the whole run measures a stale materialisation and nothing fails.
- **Integration — the source is byte-identical before and after a run**: its `forecast_modules`,
  `forecast_streams`, `forecast_stream_changes` and its four assumptions-document rows. Every hazard
  that can damage owner data surfaces as one diff here.
- **Integration — the gate's comparator**, tested directly: copy, null a column on the scratch,
  assert `assertCopyFidelity` throws. (Testing it *through* `copyScenario` would need `copyScenario`
  edited to be wrong, which is not a test.)
- **Integration — refusals:** a target matching zero or two rows; a `derived`-mode stream; `amount`
  on a yield stream; an infeasible band caught by the feasibility pass with zero builds spent; a
  second concurrent run; 9 knobs refused with the count rather than truncated.
- **Gates** — server + frontend suites green **on `Scripts/test-fresh-db.sh`, not only against dev**,
  lint 0 errors, production build clean, all six ratchets non-increasing.

## 11. Non-goals

- **Monte Carlo / stochastic returns** — [CR064 §14](cr-064-forecast-annual-close-and-assumptions.md):
  *"converts a model the owner can explain line by line into one nobody can."* Still right, and the
  competitor review of 2026-08-19 (§16) strengthened it twice. **Measured on dev:** valuation modules
  total **$12,587,446**, of which marketable securities (Fidelity Stocks + Fixed Income) are **$2.61M
  = 21%**. A Monte Carlo over equity vol would randomise that fifth while holding constant the things
  that actually decide the answer — the United Beverages exit price (**$4,175,595 = 33% of the sheet**,
  realised in one `Full` disposal on 2036-07-01), the sale years, and the PLN/EUR paths. **And the
  incumbent's own documentation admits the failure mode:** Boldin publishes a help article explaining
  why its Monte Carlo page disagrees with its Overview *and* with its Chance of Success report —
  three surfaces, three numbers, one plan. The tornado is the honest form of the question here: not
  *"82%"*, but *"a 1pp inflation miss costs X"*.
- **Two-knob grids / heat maps.** N×M builds for a picture needing a third dimension to read.
- **Solve-for / goal-seek.** Ranked third of three by the owner; CR053's bisection is the base for it.
- **Stored run history** — Decision 6.
- **Converting CR053's solver to `withScratchScenario`** — worth doing, not here (§3).
- **No engine change.** Every number comes from `generateForecast`, unmodified.

## 12. Phases

| | scope | state |
|---|---|---|
| **P0** | §9 — migration 073, `is_scratch` filtering and sweep, `copyScenario` child lists derived + tests | ✅ **LIVE v3.32.0.** GO at sign-off; shipped standalone as §15 required |
| **P1** | The knob layer (module + stream knobs only), the two routes, the tornado page, two metrics | ✅ **LIVE v3.32.0** — §17. *Deferred at sign-off (§15), then built at owner instruction with all five cuts kept* |
| **P2** | The trajectory behind a bar (`FCTrajectoryChart` in a modal) · knobs grouped by type | ✅ **LIVE v3.33.0** — §18; affordance fix v3.33.1 |
| **P3** | Every change at once as a real build · what the ± lands on | ✅ **LIVE v3.34.0** — §19; picker-selection fix v3.34.1 |
| **Not built** | The `forecast_stream_changes` (`Spread %`) list knobs (§4.1) · the assumption-list and binary knobs cut from P1 (§15 cuts 1 and 4) · §15 cut 5's default knob set, so the picker opens empty · §6 layer 3 (§15 cut 3) | open |

*⚠️ This table said "prod pending" and "DEFERRED" for three releases after those phases shipped —
the class [documentation-standard](../documentation-standard.md) exists to prevent, and the reason
a phases table is worth keeping in exactly one place.*

## 13. Open

1. ~~**§6 layer 3**~~ — **CLOSED. The cut is CONFIRMED by the owner, 2026-08-23.** The original
   decision was "abort unless the zero-point matches a fresh build of the source"; §15 cut 3 dropped
   it on the grounds that layers 1 and 2 already deliver the protection and the divergence signal.
   Asked directly, the owner confirmed the cut rather than reinstating it — **layer 2 SHOWS the
   divergence, and the drift a hard abort would fire on is routine** (a saved forecast being out of
   date is normal), so it would refuse runs that are fine. This no longer overrides anything.
2. **The regime-change threshold** (§5.4). A number picked without evidence will cry wolf on every
   knob or never fire. Proposal: derive it from the first real run rather than guessing now.
3. **Whether ±1pp inflation and ±10% spend are comparable enough to share one sort.** They are not,
   strictly, and no normalisation fixes it — elasticity is undefined for the timing and binary knobs
   that move this plan most. **Resolution taken:** one global sort, every bar labelled with its own ±
   (Decision 5), and a caption stating the bars answer *"how much does a plausible move in this knob
   move the plan"*, not *"which knob is most sensitive per unit"*. Grouping by kind would fragment
   the single output this CR exists to produce.

## 14. Review — pass 1 (technical), 2026-08-19

**Verdict: revise.** The reuse story and the harness held up; five blocking items did not. All are
resolved above, and the corrections are recorded rather than silently absorbed:

| finding | resolution |
|---|---|
| **B1** `PeriodStart`/`PeriodEnd` change what the number means (base year IS the budget; a `PeriodEnd` knob measures three different years) | Removed from the knob set — §4.1 |
| **B2** liabilities are stored negative, so "+10%" inverts for every loan | Low/high defined on the metric, never the field — §4.2, with a negative-value test |
| **B3** `Spread %` and friends are `forecast_stream_changes` **rows**, not columns; `amount` is 0 by construction on yield/pct_of_value streams | Whitelist keyed on `(field, mode)`; those excluded or deferred to P2 — §4.1 |
| **B4** the four metrics are frontend code CR084 refused to port | Server returns raw entries; client computes — §5.3 |
| **B5** a lossy restore corrupts every later point, silently | Restore replays a captured value; input fingerprint re-checked after each one — §5.2 |
| **S1** perturbations hit CHECK constraints mid-run | Feasibility pass before any build — §5.2 |
| **S2** NULL-load-bearing is broader than one field | Every whitelist entry declares NULL semantics — §4.3 rule 4 |
| **S3** assumption knobs *do* widen the shared-document exposure | Stated honestly, single scoped UPDATE, `json` not `jsonb` — §4.3 rule 2, §7 hazard 3 |
| **S4** FX had no kind | Added as relative %, with the deliberate gain/loss noted — §4 |
| **S5** the gate's exclusions would false-positive | Consumes the repository's derived list — §6 layer 1 |
| **S6** the tests missed the two likeliest failures | Variant-sync test, source-byte-identical test, comparator test — §10 |
| **S7** 17 builds block the event loop; no one-run guard | §7 hazards 5 and 6 |
| **S8** the flag must be set inside the copy transaction; the sweep needs an age floor | **Already built that way** — §9 |
| **S9** migration under-specified vs the 070–072 house pattern | Post-conditions, schema-qualified, idempotency proved — §9 |
| **S10** four citations off, "six steps" is five | Corrected throughout; the stale "six" traced to two repo comments — §8 |
| **N1–N5** dead cap, missing index row, job runner overstated, CR053 unconverted, prefer `syncIfStale` | §5.1, index row added, §3, §11, §7 hazard 1 |

## 15. Review — pass 2 (PM sign-off), 2026-08-19

**Verdict: GO on P0 only. P1 and P2 DEFERRED.**

**P0 ships standalone, now.** It fixes two pre-existing defects, one of them the same class that
produced the ~890K `disposal_cost_pct` error, and that justification stands without CR085 existing at
all. Verified against prod at review time: prod is at migration 072 and holds **0 rows** matching
`__%`, so 073's back-fill flags nothing and the boot sweep is a no-op on first restart.

⚠️ **The deploy order is load-bearing, not conventional.** `repositories/forecast.js`
(`findAllScenarios`, `copyScenario`) references `is_scratch` with **no** error handling, so
code-before-migration breaks every scenario picker and every save-time preview on prod.
`deploy-to-production.sh` Step 2b already sequences this; it must not be hand-run out of order. And
**between the migration and the server restart, assert `SELECT count(*) FROM forecast_scenarios
WHERE is_scratch` = 0** — `sweepStaleScratch()` *deletes* what the back-fill flagged and swallows its
own errors, so a too-broad flag would destroy owner data silently. Assert it at deploy time, not from
a review taken earlier.

**Why P1 is deferred — and it is not the design.** The design cleared pass 1. Two things sank the
*case*:

1. **The motivating figure was stale and the live question is not a ranking question.** Both are
   corrected in §1.1. SRQ is a **breakeven** question; the matching instrument is solve-for, which
   the owner ranked third. The tornado cannot resolve it.
2. **Sequencing.** The roadmap's own board order ends *"CR066 P0, CR064 P2 and CR060 stay behind all
   of it"* and does not mention CR085. CR083 P1 carries an unfinished correctness hazard on a page
   the owner reads weekly; two CR059 items are date-bound; CR060 has had Bank Pekao unhealthy and
   invisible since 2026-07-24. Opening an eleventh in-progress front — on `config/routes.jsx`, one of
   only two files CR083's worktree contends, with Known Issue #23 live — is the delivery cost.

**Unblocks on:** (a) the **SRQ financing experiment** — flip `House Morgage` off `exclude` in the SRQ
scenario and regenerate; ten minutes, and it tests this CR's premise as well as answering the open
question. If it settles SRQ, P1's motivation shrinks to the general class; if it surfaces *"what else
is unset the way that growth rate was"*, P1 is validated on evidence rather than on argument. And
(b) **CR083 P1, or its explicit closure.** Revisit in weeks, not quarters.

> ### ⚠️ Both unblocking conditions are spent — recorded, not deleted (2026-08-23)
>
> P1, P2 and P3 were all built **at owner instruction, over this defer**, with the five scope cuts
> kept. The **SRQ financing experiment was then DECLINED by the owner (2026-08-23)** as not needed.
>
> That is a reasonable close rather than a loose end: the experiment was a precondition for
> deciding **whether to build P1**, and that decision was taken and executed. What it would have
> tested — whether a tornado answers the SRQ question — is moot for a page that now exists and is
> in use. The finding it was meant to protect against still stands on its own: SRQ is a
> **breakeven** question and a tornado cannot answer one, which is why solve-for stays in §11.
>
> Kept here because a precondition that simply disappears reads as an oversight to the next reader.
> `House Morgage` is still `setup_status='exclude'` in all five scenarios carrying a fully specified
> **500,000 @ 6.0% to 2048**, so the experiment remains one field flip plus a regenerate if it is
> ever wanted.

### The five cuts, ADOPTED — they bind the P1 build and override the body where they differ

| # | cut | why |
|---|---|---|
| 1 | **Assumption-list knobs (inflation, FX, tax) out of P1** — §4 | They are the *only* knobs that write the shared `forecast_assumptions` document (4 writes per knob per side, on rows every scenario's inflation lives in), and the sole reason §4.3 rule 2, the `json`-not-`jsonb` care and the scoped-UPDATE setter exist. Removes the CR's largest blast radius and ~⅓ of the setter surface. Inflation sensitivity is already reachable via a variant. |
| 2 | **Two metrics, no switcher** — §5.3 | Real-terms deflation is one identical scalar across every point in a run, so it **cannot reorder a bar**. The switcher was a control that provably changes nothing. |
| 3 | **§6 layer 3 "strict verify" not built** — §6, §13.1 | Layers 1 and 2 are free and mandatory; this was a UI control plus an unrequested write path. Closes the CR's only open owner decision by cutting rather than asking — **and therefore needs the owner's confirmation, since it overrides Decision 3's original phrasing.** |
| 4 | **`binary` kind out of P1** — §4 | Needs a chart special case, and its two live instances (`House Morgage`, `Business Loan`, both `exclude`) deserve real variant scenarios — which is the unblocking experiment anyway. |
| 5 | **Say that runs compose** — §5.1 | Prod carries 34 modules and 28 streams: ~250 candidate knobs against a cap of 8. Unlike the pairwise problem §1 rejects, tornado bars from separate runs **on an unchanged source share an anchor and are comparable**, so the cap is a batch size, not a limit on the question. Ship a default knob set (top-N modules by magnitude) so the first run does not open empty. |

### Smaller notes carried forward

- **Sweep at the start of a run too**, not only at boot — one line. A scratch leaked by a killed
  process otherwise survives (hidden, so harmless) until the next restart.
- **Read [CR064 P2](cr-064-forecast-annual-close-and-assumptions.md) before building P1.** It changes
  the base-year anchoring that §4.1 reasons about when it excludes `PeriodStart`; if P2 ships after
  P1, the whitelist needs re-checking.
- **Two deferred items are tracked on the roadmap, not only here:** P2's `forecast_stream_changes`
  knobs, and converting CR053's solver to `withScratchScenario` (§3, §11).

## 16. Competitor review, 2026-08-19 — what this CR already covers

Owner-requested review of three commercial products (**Boldin** ex-NewRetirement · **Odyssey Money**
· **Monarch Money**), asking whether they carry features or formatting Fin should adopt. Recorded
here because the answer for the planning half is largely *"CR085, already designed"* — and because
one product ships this CR's exact output, which is corroboration the design did not have at sign-off.

**Odyssey Money's entire projection surface is a tornado in chip form.** Its "adjustments that could
make a meaningful difference" is a row of discrete labelled levers — `+$200/month`, `Delay SS to 70`,
`+2 years`, `Market crash (−30%)`, `SS −23%` — each carrying its own delta. Four of this CR's
decisions match it, arrived at independently:

| Odyssey / Boldin pattern | Already decided here |
|---|---|
| Magnitude baked into the lever's own label | Decision 5 — one global sort, **every bar labelled with its own ±** |
| Upside and adverse stress-tests in one row | §4.2 — low/high defined **on the metric, never the field** |
| Never opens empty | §15 cut 5 — ship a default knob set (top-N modules by magnitude). ⚠️ **NOT BUILT in P1** — the picker still opens with nothing selected (§17) |
| Non-linear response | §5.4 — regime-change detection (threshold still open, §13.2) |

*Not adopted from them:* Odyssey's **0–100 readiness score** and Boldin's **Chance of Success %** —
composites that hide which scenario and which assumption produced them, which is the restatement
class [CR076](cr-076-forecast-model-review.md) exists to remove. Fin already reports the stronger
statement: *the year cash runs out and by how much* (`fcWarnings.js`). Boldin's **Roth Conversion
Explorer**, **RMDs** and **SS claiming optimiser** fail on measured data rather than on principle —
tax-deferred is **$292,069 = 2.3%** of assets, and `Fidelity IRA` is a *child* of `Fidelity Stock`,
so it is not even separated from taxable. Caveat on the third product: Odyssey's whole public surface
is 11 pages with **no independent coverage found**, so everything about it is vendor-stated.

### Deliberately NOT folded into this CR — drafted after CR085 is implemented (owner, 2026-08-19)

The review produced two forecast outputs worth building. **Neither belongs here**: they share no
machinery with the tornado (no scratch copies, no knobs, no job/poll), and P1 was at the time
deferred on *delivery cost*, not design (§15) — adding scope would have made its unblock harder and
needed a third review pass. Tracked as a roadmap bullet. **(P1 has since been BUILT — §17 — so the
"deferred" half of this reasoning is spent; the "shares no machinery" half is not, and it is the
half that matters.)**

1. **Lifetime tax per scenario.** Boldin's moat is that lifetime federal tax and lifetime IRMAA are
   comparable scenario metrics. **Fin computes lifetime tax and discards it** — `2026 Base` carries
   **183 `Taxes` rows summing −$4,120,870** nominal, on no surface anywhere. A row on
   `/forecast-compare`, nominal and in today's money, per scenario (a cross-scenario total is
   meaningless). SQL sum + UI row: no schema, no engine. It also makes a future tax knob legible.
2. **Concentration and liquidity on the Equity report.** The largest risk in this plan is one none of
   the three products would detect: **33% of the sheet is one PLN business** realised in a single
   2036 disposal, while the assets the sweep can actually sell are **21%**. `equity.js` already
   computes value − secured debt per asset per year; two derived columns plus a `>25% in one module`
   rule in `fcWarnings.js`. Argue it as a warning, not a chart — the warnings panel is where the
   owner already looks.

*Also out, and stated so it is not re-proposed:* **extending CR053's solver** to bisect on a disposal
year or loan size — §11 already lists solve-for **and** the solver conversion as non-goals, and §15
found SRQ to be a breakeven question the tornado cannot resolve. **Recurring-transaction detection**
belongs to [CR083](cr-083-budget-latest-estimate.md) as an LE worksheet pre-fill, if the LE proves
annoying to fill — measure that before building. The formatting findings (delta percentages, a
balance-sheet Δ column, `AttentionStrip` on mobile, one negative-money convention on Home) are
cross-page UI with no forecast content and want a patch release, not a CR.

## 17. As built — P1 (2026-08-19)

Built at the owner's instruction, overriding §15's defer. The five scope cuts were kept.

**Server** — `services/sensitivityKnobs.js` (the closed catalogue, the four kinds, apply/restore),
`services/forecastSensitivity.js` (the loop, the fidelity gate, the fingerprint, the feasibility
pass, the job map), `repositories/forecast.js` (`copyChildColumns` extracted and exported so the
gate consumes the copy's own list), three routes on the `{ data }` envelope.
**Frontend** — `utils/fcSensitivityUtils.js` (ranking, regime flag, band labels),
`FCTornadoChart.jsx`, `pages/FCSensitivity.jsx` + `.css`, `hooks/useSensitivityRun.js`,
`utils/fcSeriesPalette.js` (+ the diverging pair), `config/routes.jsx`.

### ⚠️ The units were read out of the engine, and one of them was wrong in this CR's own §4

The first draft of §4 filed **`forecast_modules.growth_rate` under `rate`, ±1 percentage point.**
It is not a rate. `growthPctForYear` returns `growthPct * inflationSeries[i]`
(fcbuilder-common.js:104-118), so it is a **multiplier of inflation**: `1.0` is full CPI and prod
carries `-30` on `OCME` as a deliberate write-off. A ±1pp band on a `1.0` would have swung it to
0.0/2.0 — **zeroing or doubling an asset's growth while calling it a small stress**, and drawing
the resulting enormous bar as if it were comparable to a ±1pp move in a tax rate. Corrected before
any code was written, and pinned by a test that states the engine's expression.

The rates that *are* percentage points were confirmed the same way — the engine divides them by
100 (`-rate / 100` at fcbuilder-module.js:629/635, `gross * (pct / 100)` at :500) — and the live
ranges agree: `loan_interest_rate` 6–7, `tax_rate_override` 0–23, `growth_mult` 0–1.1.

### Two defects the build found, both of the class this CR is about

1. **A knob under an `exclude`d module drew a silent zero bar.** The first live run put a ±2y shift
   on `New Business`'s 2040 disposal and got `rowsChanged=0, Δ=0`. The engine skips an excluded
   module entirely, so the write succeeded, the build succeeded, and **nothing moved** — a
   zero-length bar in a ranked chart, reading *"this assumption does not matter"* when the truth
   was *"this module is not in the plan"*. The guard existed but tested `entity === 'module'`, so
   both child entities walked through it. It now covers every entity, and the run refuses the knob
   with that sentence rather than ranking it at zero. Regression test in
   `forecastSensitivity.test.js`.
2. **Negative bars labelled themselves on the inside.** For a bar left of the axis recharts returns
   a **negative `width`**, so `x` is the anchor end, not the outer end — every negative value
   rendered as dark ink on a dark red fill. Found by rendering the page and looking at it, which is
   the only gate that could have found it.

Also fixed on the way through: an ambiguous `amount` in the gate's join across
`forecast_stream_changes`/`forecast_streams`; `scenarioOptions` returns `{name, label}` and the
page had assumed `{value}`, so the picker silently offered nothing.

### The chart

The diverging pair is CR040's `pos`/`neg`, re-validated for this use with the dataviz six-checks
against Fin's own surfaces — light CVD ΔE 15.2 / normal 22.6, dark CVD ΔE 22.1 / normal 30.6,
contrast ≥ 3:1 in both, **all checks pass**. Colour encodes *favourable*, never the sign of the
number: liabilities are stored negative and on the shortfall metric down is good, so a sign-keyed
palette would paint the best outcome as the alarming one. The midpoint tick reads **`anchor`** —
recharts' own "nice" ticks omitted zero and labelled the centre `$1.7K`, which on a chart whose
every bar is a distance from the anchor is the one tick that must be right.

### Verified

- **Server, on a from-scratch database:** 28 tests across the knob arithmetic (kinds, NULL
  semantics, the liability sign, the closed whitelist, local-midnight date shifts) and the run
  internals (name resolution and its ambiguity aborts, exact restore including NULL, the drift
  fingerprint, the fidelity gate firing on a mutated copy, the caps).
- **Frontend:** 17 new tests — the ranking (sorted by the larger side, deltas against the anchor,
  an unmeasurable knob SURFACED rather than dropped), the regime-change rule, the band labels, and
  the tornado's colour semantics in both themes.
- **Against real data on dev:** a 4-knob run over `2026 Base` — 9 builds, 3.5 s, gate passed,
  fingerprint held across all 8 restores, **0 scratch scenarios left behind**. All four kinds move
  the plan and in the right direction: growth ±0.25× → −169,104 / +183,712 (mildly asymmetric, as
  compounding implies), tax ±1pp → +3,482 / −3,482 (inverted, correctly), market value ±10% →
  ∓170K, disposal date ±2y → 154 and 144 rows changed.
- **In the browser, both themes, zero console errors**, through the whole flow: pick knobs → run →
  ranked bars, values outside the bars, the table, the anchor line.
- **Gates:** frontend suite and backend suite green, lint 0 errors, production build clean, all six
  ratchets at baseline.

**Not built, and still true to §15:** the assumption-list knobs, the binary kind, the metric
switcher beyond the two metrics, and layer 3. P2 is untouched.

⚠️ **One adopted cut did NOT ship in full.** §15 cut 5 has two halves: *say that runs compose* and
*ship a default knob set (top-N modules by magnitude) so the first run does not open empty*. The
first is in the UI copy; **the second is not built — the picker opens with nothing selected.** It
stays open rather than being quietly dropped, because §16's competitor review lists "never opens
empty" as a pattern all three products share and this CR claimed to match.

## 18. As built — P2 (2026-08-21)

Owner-requested after seeing P1 on prod: *"for the output report I prefer [the trajectory chart] to
supplement [the tornado]. Maybe we should make this a pop up modal to give more space?"* — and
separately, *"knobs should be grouped by type (asset, liability, income, expense)"*.

**The trajectory modal.** Clicking a bar, or the assumption name in the table, opens a
1200px-wide `<Modal>` carrying **`FCTrajectoryChart` reused unchanged** — the same component
`/forecast-multi-compare` draws, so the two pages cannot drift on tooltip, axis or palette. Three
lines only: base, the knob's down run, its up run. Cross-knob comparison is what the tornado is
*for*; overlaying every run would be the spaghetti CR067 capped that chart at seven to avoid.

**Why it earns its place: the bar cannot say WHEN.** The tornado ranks on net assets at the final
year. A knob that costs 70K by 2062 and one that runs the plan dry in 2041 draw the same bar.

**And a second view, because the first one hides most knobs.** A ±0.25× growth knob moves ~180K
against a $12M plan, so in absolute terms all three lines overlap and the reader learns nothing
about where they separate — visible immediately on the first render. **Difference from base**
subtracts the anchor, so the base becomes a flat zero (and is dropped as a series rather than drawn
on the axis) and the two runs fan out at their own scale. On `Barkeria · Growth ±0.25×` that view
shows a clear kink at 2040–41 where both runs jog — the disposal, and the sweep responding to it —
which the absolute view renders as three touching lines. Absolute stays the default, as asked.

### ⚠️ A third silent-zero-bar defect, found while working out how to group the knobs

Deciding asset-vs-flow meant asking what the engine branches on, and the answer exposed the same
class again: **`fcbuilder-module.js` forces `baseValues`, `marketValues` and `growthPct` to ZERO
when `has_valuation` is false** (:142, :143, :288). **Twelve of the thirty live modules on
`2026 Base` are flow modules**, so `growth_rate`, `market_value` and `base_value` were being offered
on every one of them — roughly **36 knobs that would write, build, and move nothing**, each drawing
a zero-length bar reading *"this assumption does not matter"*. Disposal knobs got the same gate
(disposing of a module valued at zero moves nothing), and the three loan fields are now gated on the
module actually carrying a loan. **The catalogue fell from 300 knobs to 191.**

*Module-level `tax_rate_override` is deliberately NOT gated:* besides capital gains it is the
fallback for a stream's income tax (`stream.tax_rate_override ?? module.tax_rate_override ??
scenarioRate`), so it is live on a flow module whose streams carry no override of their own.

### Grouping is derived from the engine, never from `module_type`

Assets · Liabilities · Income · Expenses, computed **server-side** and sent with each knob. A
liability is a module the engine treats as debt — it carries a loan, or its value is negative
(`PLN Credit Cards` at −24,542.66). A stream takes its own `direction`; a flow module takes the
direction of its streams. **`module_type` is not consulted**: it is free text the owner edits, prod
carries both `Asset` and `Business`, and CR070 records the same rule for module capabilities. A test
asserts a module whose `module_type` says `Expense` but whose value is positive still groups as an
asset. Live split on `2026 Base`: **Assets 108 · Expenses 40 · Income 25 · Liabilities 18**, nothing
unclassified.

### Two fixes from the owner's screenshot

- **The negative bar's value label collided with the Y-axis category text** — `($69.1K)` printed
  through `CVC Fund VIII · Growth (× inflation)`. The domain stopped at the longest bar, so that
  bar's own outer label was drawn past the plot edge. The domain now carries 12% headroom.
- **Disposal knobs now name their disposal** (`Selling cost (2040-07-01)`). A module with three
  disposals otherwise offered "Disposal amount / Selling cost / Disposal date" three times over with
  nothing to tell them apart, and picking the wrong one is invisible until the bar is wrong.

### Also

`Modal` gained a **`chart` size (1200px)**, additive — a 36-year trajectory at the existing 720px
`wide` puts the year ticks on top of each other. The table's assumption name is a **button**, so the
trajectory is reachable by keyboard; a 13px SVG bar is not.

**Verified:** 26 knob tests + 14 trajectory/ranking tests; both themes in a real browser through
pick → run → open → switch view, zero console errors; all six ratchets at baseline.

### ⚠️ P2 shipped invisible — the affordance was the feature

The owner's first response to the deployed page was **"I do not see the new graph asked for?"**

Nothing was broken. Driven against the running prod build: two open-controls present, clicking one
opens the dialog with three lines, zero console errors. The chart was there, one click away, and
**invisible as a feature** — the only way in was the assumption name in the table, styled as a
button with a `--border`-coloured underline, plus one sentence in the table's caption explaining it.

That is a design failure, not a discovery problem, and it is worth naming because it is the UI
cousin of this CR's other four defects: *something that is present, produces no visible effect, and
therefore reads as absent.* A zero-length bar says "this assumption does not matter"; an
undiscoverable control says "this feature was not built".

Fixed with a **named control on every row — "See the path →"** — in its own column, plus the
assumption name restyled as an accent-coloured link rather than plain text. Three tests guard it:
the control exists and calls back with its row, the row label still works for anyone who reaches
for it, and neither renders when there is nothing to open.

## 19. As built — P3: every change at once, and what the ± lands on (2026-08-22)

Two owner asks after using P2 on prod: *"can we also allow for a click to see the graph with all
changes applied (3 in this case)"* and *"how can we better see what values the ± actually
represent? can we show the actual value not just the ±%?"*

### The combined run — and why it does not contradict §5.4

§5.4 says **never display a sum of impacts**. That rule stands, and it is *why* this is worth
building. The model is path-dependent: the cash sweep sells different assets when several things
move at once than when each moves alone, so **adding the bars gives a number the engine never
produces**. Building the combination gives a **measured** one, and the difference between the two
is the interaction — the only honest answer to *"do these risks compound or cancel?"*, which is a
question a tornado structurally cannot ask. **The sum now appears in exactly one place: as the
thing the measurement is compared against.**

Measured on live dev data with four knobs: the bars sum to **−$623.8K**, the combination measures
**−$646.9K**. They **compound by $23.1K**, and nothing in the ranking could have said so.

`POST /sensitivity/combined` takes an **explicit `side` per knob**, because "all adverse" is a
statement about the *metric* and the metric is computed on the client (§5.3) — for an expense knob,
*down* is the good direction, so an all-adverse set is a **mix** of low and high sides, not "all
knobs at low". It **rebuilds its own anchor** rather than borrowing the ranking run's: a different
scratch copy is a different scenario, and comparing across them would fold any copy-to-copy
difference into the interaction figure. Knobs are applied in one pass; a duplicate knob inside one
combination is **refused** (the second would overwrite the first's captured value and make the
restore lossy); restores unwind in **reverse**.

### The band alone was unreadable

"±0.25×" does not tell a reader that a growth of 0.8 lands at **0.55 and 1.05**, and "±50%" on a
market value says nothing at all without the value. Every point now reports what the knob was moved
**to** and **from**, and the table carries a **Now** column plus the resolved value under each
impact.

### ⚠️ The FIFTH zero bar, and it was visible in the shipped table

`Car Expenses · Tax rate (gains)` ranked at **$0 down and $0 up**. A module's `tax_rate_override` is
read in exactly two places — the capital-gains rate on a **disposal**, and the fallback for an
**income** stream's tax (fcbuilder-module.js:632-634). An expense-only flow module has neither,
because `fc_stream_tax_is_income_only` guarantees its expense streams carry no tax. §18 had
explicitly reasoned that this field was safe to leave ungated; that reasoning was right about *why*
it is not valuation-gated and wrong about the conclusion. Now gated on there being something to
tax. **191 knobs → 179.**

### ⚠️ Base and "all favourable" were both blue

The base line took slot 0 of the categorical set — which is blue — and the **favourable** pole of
the diverging pair is also blue. Two blue lines, one of them the reference the other two are
measured against. Caught by rendering it, not by any gate.

Validating a neutral gray as a *third categorical hue* then **failed on its own terms**: chroma
floor, and blue↔gray at **ΔE 8.7** normal-vision in light, under the 15 floor. The resolution is
that **a reference is not a category** — it takes a neutral *and a dash*, which is secondary
encoding, so the two data hues keep the separation they were validated for and the baseline reads
as the axis it effectively is. `FCTrajectoryChart` gained an optional per-series `dash`, undefined
for every existing caller, so Compare and Multi-Compare render byte-identically.

**Verified:** 291 backend / 550 frontend tests green on a from-scratch database — the interaction
arithmetic in **both** directions, the adverse side keyed on the metric, an all-adverse set that is
a *mix* of sides, the taxability gate, and the value formatting per kind. Lint 0 errors, build
clean, all six ratchets at baseline, both themes driven through run → combine with zero console
errors.

### The picker could not say what was selected (2026-08-22)

*"It is hard to reset as I can not see which three knobs are selected."*

The count said **3/8** and nothing said **which three**. The picker is a long scrolled list of
collapsed groups, so a selection three modules down was invisible — and because the selection
persists to `localStorage`, a reload restored ticked boxes *inside closed groups*, leaving no trace
at all on open. The only way to reset was to remember what you had picked.

Four changes, all in the picker:

- A **sticky "Selected" panel** at its top, listing each chosen knob by module and field with its
  band, each removable with an ×. Sticky because a summary that scrolls out of view answers the
  question only while you are already at the top.
- **Clear all**, which is the reset that did not exist.
- Each **type group** shows how many of its knobs are picked (`Expenses · 2 picked · 30`).
- Each **module** shows a count badge, and a module holding a selection **opens itself** — `open`
  is derived from the selection rather than written by an effect, so a restored selection is
  visible on load instead of hidden.

This is the same family as the six defects above — state that exists, produces no visible sign, and
therefore reads as absent — but it is the first one where what was invisible was **the reader's own
input** rather than the engine's output.

## 20. A four-lens UI review, and the three wrong numbers it found (2026-08-23)

Owner-requested: *"can you get a team of UI experts to see if we can improve the look and feel of
this page and develop a plan?"* Four reviewers ran in parallel — visual design/dataviz, information
architecture, interaction/state, accessibility — each reading the code **and the rendered
screenshots** in both themes.

**Every claim below was verified against the running app before being acted on**, and two were
wrong: the sticky Selected panel *is* holding (measured 13px from the picker top at scrollTop 0,
300, 900 and 2000 — the reviewer was reading captures that predate it), and `band = 0` is already
refused server-side by `bandsOf`.

### ⚠️ Tier 0 — the page was reporting three wrong things, and all three were mine

**A. Two currencies in one row, unlabelled.** A knob moves the module's OWN-currency column, so
`United Beverages · Market value` printed **15,000,000 — PLN** beside a **USD** impact. The reader
computes "±50% of 15,000,000 moved the plan $4.1M", about 27%; the truth is $4.1M against
**$4,175,595**, nearly all of it. **Wrong by 3.6×**, on the ratio the whole page exists to support.
The same class as CR054. Fixed by carrying `currency` and the USD twin through the run and printing
USD first with the typed native beneath — `$4,175,595 / PLN 15,000,000`, and `at $3,758,036 · PLN
13,500,000`.

**B. The tornado and the trajectory used OPPOSITE colour rules.** §4.2 says colour follows the
metric, never the side. The bars obeyed it; `knobTrajectory` did not (`side === "low" ? adverse :
favourable`). `Car Expenses · Amount` down is **+$256.5K** and drew **blue** in the bar — cutting an
expense helps — and **red** one click later in its own trajectory. On the shortfall metric, where
down is the good direction, every knob inverted.

**C. A result outlived the scenario that produced it.** Changing scenario cleared the selection but
not the result, while `shared` (period start, base-year values, opening balance sheet) rebuilt for
the *new* scenario — so the old run's entries were re-ranked against the new scenario's base year,
and the drift banner **named the new scenario while quoting the old run's variance** and telling the
owner to regenerate it. A number belonging to no scenario in the plan, asserted about a named one.
The page now refuses to rank across a scenario change and says which run the bars are from; a
changed *selection* keeps the bars (they are still true of the run that made them) behind a notice.

### Tier 1 — dead or misleading

- **Clicking a bar did nothing.** recharts passes the datum first and the index *second*; reading
  `d.index` gave `rows[-1]`. Verified dead in a browser, then fixed and verified alive.
- **The combined modal showed "could not be rebuilt" for the whole of its normal 3-build wait**,
  directly beneath its own progress counter — the happy path telling the owner it had failed.
- **A knob that moved nothing is no longer ranked.** It drew an empty 46px lane and a `$0 / $0`
  table row; it now goes to **Not ranked** with the reason. That is the CR's defining defect
  reaching the page for the seventh time, and `Not ranked` has existed for it since §17.

### Still open, and recorded rather than done

Tier 2 (accessibility: no visible focus ring app-wide at **1.18:1**, the band input invisible in
dark, toggles without `aria-pressed` at a 1.06:1 active state, three light-mode contrast failures
including the `⚠ not symmetric` flag at **2.79:1**), and Tier 3 — the IA recommendation that this
page has **two modes it renders simultaneously at half width each**: *compose* wants width and a
search over 179 knobs, *read* wants the full width for the table and the trajectory.

**Multi-band knobs (owner-chosen: nested bars) have their server half built** — a knob carries a
list of bands, the cap moved from knobs to **builds** (`MAX_BUILDS = 50`), and the first real run
found `Barkeria · Market value` moving **−201,268 / −409,228 / −1,324,512** at ±10/20/50%: the
downside is **6.58× the ±10% impact for a 5× band**, non-linear, and invisible at a single band. The
nested-bar chart is deliberately held until Tier 3 settles the layout.

### Tier 2 — accessibility (2026-08-23)

- **A token focus ring, app-wide** (`index.css`) — `outline: 2px solid var(--primary-strong)`, at
  **5.26:1** light / **5.87:1** dark, replacing a `--shadow-focus` that composites to **1.18:1** /
  1.65:1. ⚠️ **The review's framing of this was partly wrong and it is worth recording:** the shadow
  really is invisible, but Chromium still draws *its own* ring on buttons, so the rendered focus
  state was never absent — verified by keyboard-focusing a control and looking at it. The new rule
  demonstrably applies to `select`, `summary` and inputs (measured `2px solid #537453`); on buttons
  the UA ring wins and is legible. An improvement in consistency, not the barrier described.
- **The band input was invisible in dark** — `--surface-elevated` on an already-elevated panel with
  a `--border` at 1.06:1, so the field that decides the ± was a bare floating number that did not
  look editable. Now recessed (`--bg` + `--border-strong`).
- **Three light-mode contrast failures fixed**: the `⚠ not symmetric` flag at **2.79:1** →
  `--warning-strong` (it is how a reader learns the sweep fired, and it was the faintest text in the
  table); `See the path` / `See all N together` at **3.68:1** → `--accent-strong`; the module badge
  at 3.68:1 → `--primary-strong`.
- **`aria-pressed` on both toggles.** The two metrics have OPPOSITE favourable directions, so
  reading the chart against the wrong one inverts every bar — the selected state cannot rest on a
  1.06:1 tint and a font weight, and it must be announced.
- **The chart is `aria-hidden`**, because recharts exposes every tick and label as a bare text node
  and the results table is a genuine equivalent — the two were being read as duplicates.
- **Favourable/adverse is no longer colour-alone**: an `sr-only` `(favourable)`/`(adverse)` rides in
  each Down/Up cell. On the shortfall metric the sign of the delta does *not* track the colour a
  sighted reader sees, so the one dimension colour uniquely carried was the one the text omitted.
- **`role="status"` on the build counter and `role="alert"` on both errors** — a run takes seconds
  and every signal for it lived inside a button label a screen reader never revisits.
- **Checkbox names carry the module** (`United Beverages — Market value, currently …`); the module
  lived only in an ancestor `<summary>`, so a forms list read "Amount 31,694" dozens of times.
- **At the 8-knob cap the unchecked boxes are `disabled`** rather than silently ignoring the click,
  and the band input has a `min` — the server already refuses a zero band, but the input should not
  offer one.
- **The feasibility refusal renders as written** (`white-space: pre-line`) instead of collapsing its
  bulleted list into one run-on sentence.

### Tier 3 — two modes, a search, and the nested bands (2026-08-23)

**The page had two modes and rendered both at half width, permanently.** *Compose* — which
assumptions? — wants width: four type groups side by side and a search over 179 knobs. *Read* —
what did they do? — wants it for a seven-column table and a wide trajectory. A fixed 300px column
served neither, and before the first run roughly three quarters of the page was blank.

Now derived, not stored: `composing || !result || wrongScenario`. Composing gives the picker the
**full width** (1552px measured, against 320px) with the whole catalogue on one screen; running
collapses the composition to a one-line strip and hands the results the same full width. **Change
assumptions** goes back.

⚠️ **CSS multi-column was the wrong primitive and the browser said so.** `columns: 4` balances by
equalising column *height*, and a group of fifteen modules cannot be split (`break-inside: avoid`),
so a 1552px container packed all four groups into two columns and left half the page empty — the
exact problem the layout exists to solve. A grid track per group places them side by side whatever
their heights. Caught by rendering it, not by reading it.

**Search over the catalogue.** The tree has one axis — `group → module → field` — and the natural
questions are field-shaped (*are all my growth-vs-inflation assumptions load-bearing?*). A page
whose claim is that it finds the assumption you did not know was load-bearing should not require
you to know which module holds it. Typing `growth` narrows 179 knobs to 42.

**Multi-band knobs, as nested bars.** A knob carries a set of bands chosen from presets per kind
(level ±10/20/50%, rate ±0.5/1/2pp, multiplier ±0.25/0.5/1×, timing ±1/2/5y) — presets rather than
a free number, because comparing bands across knobs only means anything when they are the same.
⚠️ **SUPERSEDED by [§21](#21-bands-the-owner-types-2026-08-23) (2026-08-23), at owner request:** any
band can now be typed. The comparability argument was real but it is not an argument for *refusing*
the question — it is an argument for **saying when it applies**, which `bandMismatch` now does.

⚠️ **The ranking runs on ONE named band — the smallest each knob carries** — because a knob probed
at ±50% would otherwise outrank one probed at ±10% purely for having been pushed harder. That is
§4's "±1pp vs ±10%" comparability problem amplified, and the caption says which band the sort used.

The bars are a **custom shape**: one rectangle per band, all anchored at zero, inner bands scaled
off the outer one against the same x-scale and drawn progressively more solid. **The spacing between
them is the finding** — if ±50% is not five times ±10%, the plan does not respond linearly. A
per-band row under each knob carries the same numbers as text, because the rectangles show the
shape and the numbers are where a reader checks it.

⚠️ **A row with no band detail used to draw NOTHING** — an older result, or any caller that never
asked for bands, would have rendered an empty chart. The shape now falls back to its own plotted
value, with a test for it. That is this CR's defining failure wearing yet another hat, caught by an
existing test rather than in production.

### ⚠️ The EIGHTH zero-impact knob, found by the owner on the first dev run

The first thing the owner did on dev was tick `Fidelity Fixed Income · Growth (× inflation)`, run
it, and get a near-empty page: *"I do not see any output?"*

The run was correct — the knob genuinely moved nothing, and the Tier-0 fix routed it to **Not
ranked**. But the reason it moved nothing is the same defect again: **`growth_mult` is only read on
an `amount` stream.** It feeds exactly one expression, `pct[i] = inflationSeries[idx] * mult`
(fcbuilder-stream.js:69-80); the `yield` branch computes `eff = inflation + spread` and never
touches `pct`, and `pct_of_value` derives from the market value instead. `Fidelity Fixed Income` is
a yield stream, so the knob wrote, built, and did nothing. Now gated on the mode that reads it —
**179 knobs → 175.**

Two display faults the same screenshot exposed:

- **"Not ranked" printed the raw column name** — `Fidelity Fixed Income · growth_mult` — which is
  neither what the picker offered nor what the owner ticked. It uses the label now.
- **Every knob unrankable is not the same as no result.** The page showed a heading, one grey line,
  and 700px of nothing after an eight-second wait. It now says what happened and what to do.

And one ambiguity that fell out of investigating it: **eight modules offered two identical
`Growth (× inflation)` rows** — the module's own `growth_rate` and a stream's `growth_mult`, which
do entirely different things (one grows the asset's value, the other grows a stream). Streams are
now named by the FC line they post to: `Growth (× inflation) · UB Income`. Zero duplicate
module+label pairs remain. Same fix, and same reason, as the disposal dates.

---

## 21. Bands the owner types (2026-08-23)

> *"here we only allow for 3 prefixed values as variants, what about making the options editable by
> the user?"*

**The presets never were a contract.** `bandsOf` (`forecastSensitivity.js:66`) accepts any finite
band `> 0`, dedupes and sorts, and the route validates none of them. So `BAND_PRESETS` was a UI
convenience I invented, and a typed band needs **no API change, no migration, no server change at
all**. This is entirely `frontend/`.

Decision: **per-knob**, not editable global defaults. The question that prompts a custom band is
local — *what does ±35% do to UB Income* — and a global preset edit is the wrong shape for it.

### What the three fixed chips were incidentally providing

Removing them removes three guards nobody wrote down, so `validateBand` writes them down:

| Kind | Refused | Why |
|---|---|---|
| `level` | `≥ 100` | `perturb` is `base × (1 + sign × band/100)` with **no clamp** — ±100% makes the low side exactly 0, ±150% makes an asset **negative**, and the engine builds it without complaint. |
| `timing` | non-integer | goes to `shiftYears(current, sign × band)`; half a year is not a thing there. |
| `multiplier` | `> 10` | a multiplier band is **absolute** (`base + sign × band`), so ±150× on a growth of 0.8 is −149.2× inflation. Found by typing it into a live browser and getting it back with nothing raised anywhere. |
| `rate` | `> 100` | over 100 percentage points is not a nudge. |
| all | `≤ 0`, non-numeric | a ±0 band is two builds of the same plan drawn as a bar. |

⚠️ **A rate driven negative is NOT refused** — a −2% return is a real scenario, the applied-value
row already prints what the ± lands on, and refusing it would be refusing the question. Likewise a
negative *multiplier*: the **±1× preset already** takes a 0.8 growth to −0.2×, so that line was
crossed long before anyone typed anything.

⚠️ `Number("")` is `0`, not `NaN`. An empty box was told *"must be above zero"* — an answer to a
question nobody asked. Caught by a test, fixed in the validator.

### The build cap became reachable, so it became visible

Three fixed chips capped the page at **8 knobs × 3 bands + 1 anchor = 49 builds against a cap of
50** — the UI could not reach it. A fourth band on any one knob can. A `SensitivityError` arriving
as a 409 *after* the composition is finished is the wrong moment to learn the run is too big, so:

- `plannedBuilds(selected)` renders beside the Run button as `N bands · B builds ≈ Ts`, in the
  server's own units and its own ~0.5s-a-build figure;
- `addBand` and `toggleBand` both refuse to cross the cap rather than letting the server do it;
- ⚠️ **and `canRun` checks it too** — the two guards only cover input, and a selection restored from
  `localStorage` (written by an earlier build of this page, or a later one with a different cap)
  arrives already over the cap having been through neither.

### ⚠️ The ranking assumption a free band makes easy to break

Bars are **ranked on the smallest band each knob carries**, so two knobs of the same kind probed at
different smallest bands are sorted against each other while answering different questions. This was
always possible — untick ±10% and a knob ranks at ±20% — but three chips made it a deliberate act,
whereas a typed band makes it the *default outcome* of asking about one module. `bandMismatch`
detects it and the page says so, in compose mode, before the run. Kinds are **not** compared against
each other: a rate's percentage points and a level's percent are different units, and every bar
prints its own band.

### Two more instances of this CR's defining defect, both in the marker

A typed chip and an offered chip are not the same object — **only one of them disappears when you
untick it** — so the difference has to be visible or the disappearance reads as a bug.

1. A dashed border marks a custom chip. ⚠️ **On a selected chip the dashes were invisible**, because
   `.is-active` paints the border the same colour as the fill — and a typed band is *always*
   selected the moment it is added, so that was the only state it was ever seen in. Verified in a
   4× browser screenshot in **both** themes, not by reading the CSS. Fixed with `--on-accent`.
2. The dashed edge is sighted-only, so custom chips carry an `aria-label` naming them as such.

### And a layout regression the fourth chip caused

Three chips fitted beside the knob's label; a fourth broke **"Market value" across two lines** — so
adding a band silently damaged the row that says which knob it belongs to. The band group now wraps
to its own line instead of squeezing the only text that identifies the knob.

### Verification

`validateBand`, `bandChoices`, `plannedBuilds`, `buildSeconds` and `bandMismatch` are pure and live
in `fcSensitivityUtils.js` with **11 new cases** (563 frontend tests, up from 553). Driven in a real
browser on dev: chip added and marked custom, `150` refused with the level message, an empty box
refused with the number message, the cost meter tracking, the mismatch note firing on two level
knobs at ±35% and ±10%, and the whole thing surviving a reload via the existing localStorage
selection. Zero console errors. Both themes screenshotted.

---

## 22. The sweep — the gate that never existed (2026-08-23)

Ten defects of one shape reached this page, and **nine were found by a person looking at the
output**. The catalogue had been checked against the engine *one field at a time, as failures
surfaced*, and never in one pass. This is that pass.

**It does not reason about the engine — it measures it.** `Scripts/sweep-sensitivity-knobs.js`
applies every knob the picker offers, down and up, against a throwaway copy, rebuilds for real, and
hashes the generated entries. Both sides identical to the untouched build ⇒ the knob moved
**nothing**. 175 knobs, 351 builds, about four minutes.

### What one run found

| | before | after |
|---|---|---|
| knobs offered | 175 | **141** |
| moved nothing either side | 15 | **9** |
| **refused before building — killed the whole run** | **28** | **0** |
| moved the plan | 129 | **129** — every one kept |

⚠️ **The 28 refusals were worse than the dead bars, and nobody had noticed them.** A knob that
cannot be *applied* throws inside `feasibilityPass`, which runs before the first build and aborts
the **entire run** — so one bad knob among eight threw away the other seven, and did it with
`violates check constraint "fc_disposal_cost_pct_range"` for a message. Two causes:

- **11 × `disposal_cost_pct` on its schema floor.** `CHECK (>= 0 AND < 100)`, and eleven of the
  twenty disposals on `2026 Base` carry **NULL**, which the spec reads as 0 — so the low side of any
  band is negative. Now refused in the picker (`min: 0`), plus a readable refusal in `perturb` for a
  band wide enough to cross a floor the value itself clears (±5pp on a 4% cost).
- **18 × a `level` knob on a zero.** `perturb` always refused these — `base × (1 ± band/100)` is 0
  whatever the band — but it refused at *apply* time. Same statement, one stage earlier. Most are
  disposals whose amount of 0 is the **"Full disposal" sentinel**: a real disposal with no magnitude
  to scale.

### Three dead knobs closed by reading the engine, once the sweep pointed at them

- **`base_value` is read for exactly one thing — the capital gain when the module is sold.**
  Measured by diffing which rows move: lowering `Fidelity Fixed Income`'s basis changed **217 rows,
  every one downstream of `Taxes`**. There are two ways to be sold — an explicit disposal, or the
  **cash sweep** draining you — and Fidelity is the sweep *primary*, which is why it moves while
  `Misc Investments`, `OCME` and `USD Credit Cards` do not. Now `requiresSalePath`.
- **An income stream that earns nothing is not income to tax.** `requiresTaxable` counted any
  `direction = 'income'` stream, so `Misc Investments`' idle one kept its module tax rate on offer.

### ⚠️ And the sweep caught MY fix being wrong, which is the point of it

The first version of the stream gate read *"`amount` is 0 ⇒ `growth_mult` and `tax_rate_override`
are inert"*. That is false: **`forecast_stream_changes` rows supply per-year figures for a stream
whose `amount` column is 0** — `Social Security`, `One-Off Items` and `Retirement Home` all sit at 0
and all move the plan through theirs. The gate hid **five working knobs**, and the sweep said so:
the `ok` count fell from 129 to 124 and the diff named them. The rule is now *no amount **and** no
change rows*, and **the re-sweep confirms all 129 originally-working knobs are still offered.**

That check — *did I hide anything that worked?* — is the half a precondition list can never do for
itself, and it is why this is a script rather than a one-off audit.

### The 9 that remain dead are DYNAMIC, and are deliberately not gated

They depend on scenario data, not on schema or engine shape, so a static predicate would be a guess:

- `SP - Panorama Mar 4` / `SP - Sea Senses` streams — the module is **disposed on 2026-07-01**, the
  first day of the period, so its streams never run.
- `Tax` streams — ⚠️ **the module produces no `forecast_entries` at all** despite carrying a 55,103
  expense stream. That is a finding about the *plan*, not the page, and belongs on the roadmap.
- `Tax Liabilities · Tax rate (gains)` — market value equals cost basis, so the gain is exactly 0
  and no rate changes it.
- `US - Nokomis · Cost basis` — the module carries `tax_rate_override = 0`, so no gain is ever taxed.
- `Car Purchase Chris · Growth (× inflation)` — its four change rows are absolute amounts, which the
  multiplier does not scale.

**The three one-sided knobs are correct, not defects:** `base_value` moves only DOWN on
`Fidelity Fixed Income` because a higher basis makes the sale a **loss**, and the model gives no
loss relief. ⚠️ The sweep reported all three backwards at first — the ternary picked the side that
did *not* move — which is worth recording as its own small lesson: a diagnostic that names the wrong
half is worse than none.

### Standing use

Run it after any change to `sensitivityKnobs.js`, to `fcbuilder-*.js`, or to a scenario's shape:

```
node Scripts/sweep-sensitivity-knobs.js "2026 Base"
```

A DEAD result is a **candidate, not a verdict** — it says the field is inert *on this scenario*.
Confirm each against the engine, and gate on the engine's precondition, never on "it was zero that
time".

---

## 23. The `forecast_stream_changes` schedules — §4.1's deferred item, built (2026-08-23)

The last thing §4.1 deferred to P2 and P2 never built. These are the only knobs that are **not a
column**: a stream carries N dated rows of one flag, and the knob moves the **whole list** together.
One row at a time would be a knob per year — a different question (*when* does this change?) drawn
in a chart that ranks *how much*.

### The flag/mode matrix, decided from the engine BEFORE writing the picker

`expandChanges` (fcbuilder-stream.js:67-116) builds four series and `computeStreamSeries` spends
them in exactly two branches. This CR has paid four times for a knob offered on a branch that never
reads it, so this table was read out of the engine first rather than discovered by a zero bar:

| flag | series | consumed by | mode | kind |
|---|---|---|---|---|
| `Percent %` | `pct` | `level[i] = prev × (1 + pct[i]/100) + fixed[i]` | **amount** | rate (±pp) |
| `Fixed $` | `fixed` | same line — additive, permanent through the recursion | **amount** | level (±%) |
| `One-Off $` | `oneOff` | `out[i] = level[i] + oneOff[i]`, that year only | **amount** | level (±%) |
| `Spread %` | `spread` | `eff = inflation + spread[i]` | **yield** | rate (±pp) |

The `flag` column's own CHECK carries exactly these four values, so the catalogue is closed by the
schema as well as by the code. **All 14 knobs it adds measured `ok` in the sweep on the first run.**

### ⚠️ The most load-bearing assumption in the plan was unreachable

`Fidelity Fixed Income · Spread % · Interest Income` at **±1pp** moves the plan **−$1.5M / +$1.6M**.

That is the stream the owner clicked FIRST on dev, where `growth_mult` came back *"moved the plan by
nothing measurable"* (§21's eighth dead knob). The knob that was offered there did nothing; the knob
that mattered did not exist. Both halves of that are now closed.

### What the list knob had to get right

- **The restore replays CAPTURED values, positionally** — never `value / factor`. Same discipline as
  the single-row path and the same reason: an inverse reintroduces float drift on every point, and a
  restore landing a cent away leaves the next knob measuring itself plus a residue. Rows are read
  `ORDER BY change_date, id` so two rows sharing a date come back in the order they went out.
- **A negative `Fixed $` step scales to a bigger step down.** −30,000 at +10% is −33,000, which is
  the same statement about the same assumption.
- ⚠️ **The change branch is written as a SKIP of the column-oriented guards, not an early
  `return`.** Returning is the precise mistake this file already records — the first version of the
  excluded-module guard tested `spec.entity === 'module'` and let both child entities through. A
  test asserts a schedule under an excluded module is still refused.
- ⚠️ **A seven-row schedule first rendered as `-3.0000, -3.0000, -2.0000, …`**, truncated mid-number
  by the results column. `describeSchedule` gives one cell — `-3 to -5 (7 rows)` — **first-to-last,
  not min-to-max**, because the rows are ordered by date and what the owner wants is where the
  schedule starts and where it ends. The picker and the applied-value display share the helper, or
  the same schedule would be described two ways on one page.

### Two fixes that fell out

- **`knobId` now keys on the FC line as well as the direction.** The partial unique indexes on
  `forecast_streams` key on `(direction, fc_line_id)`, so two income streams on one module are
  legal, and two knobs sharing an id would have the run's points overwrite each other. No live
  module does it today — the kind of luck this CR has stopped relying on.
- **`growth_mult`'s gate refined a second time, and the sweep forced both refinements.** §22 changed
  it from *"amount is 0"* to *"no amount and no change rows"*. That was still wrong: `pct`
  multiplies the **level** and nothing else, so a schedule of pure `One-Off $` rows leaves the level
  at 0 in every year while the stream emits real money. `Car Purchase Chris` carries four one-offs
  and measured DEAD. The test is now *no amount and no `Fixed $` rows* — while
  `tax_rate_override` keeps the **weaker** test, because tax hits the output and one-offs are part
  of it. **That closes one of §22's nine dynamic dead knobs statically.**

### Where the catalogue stands

| | after §22 | now |
|---|---|---|
| knobs offered | 141 | **154** |
| moved the plan | 129 | **143** |
| moved nothing | 9 | **8** |
| could not be applied | 0 | **0** |

Verified by re-sweep, comparing on `(entity, module, field)`: **nothing that worked was lost**, and
the fourteen new knobs are all live.

---

## 24. §15 cut 5's other half — the picker stops opening empty (2026-08-23)

Cut 5 had two halves. *Say that runs compose* shipped with P1; **ship a default knob set** did not,
so for five releases the page opened with 154 unticked checkboxes and no obvious first move.

### ⚠️ A STARTING SET MUST NOT READ AS AN ANSWER

This page exists because you **cannot** tell in advance which assumption the plan rests on. Five
pre-ticked knobs with no caption would be this page's answer to its own question, asserted before a
single build. So the rule is deliberately dumb, and the UI says so in as many words:

> The biggest numbers in the plan, so the page opens on something rather than nothing. That is a
> fact about the balance sheet, **not** a ranking — turning one into the other is what the run is for.

**And the very first cold run proved the caption honest.** One click, no edits:

| rank | knob | its size | what it moved |
|---|---|---|---|
| **1** | `Living Expenses · Amount` | **$127,372** | **−$1.1M** |
| 2 | `United Beverages · Market value` | **$4,175,595** | −$677.0K |
| 3 | `Fidelity Stocks · Market value` | $1,369,072 | −$521.2K |
| 4 | `Fidelity Fixed Income · Market value` | $1,241,052 | −$322.6K |
| 5 | `United Beverages · Amount · UB Income` | $128,205 | −$246.5K |

**The smallest number in the set is the biggest lever, and the largest is second** — a 33× size gap
inverted. Size and sensitivity are different things, the page exists to tell them apart, and the
starting set must not pretend otherwise.

### The rule

Candidates are **LEVEL knobs with a USD twin** — a magnitude is the only thing comparable across
knobs, and rates, multipliers and dates have none. ⚠️ **USD, always**: a knob moves the module's
own-currency column, so `United Beverages` at 15,000,000 **PLN** would otherwise outrank every
dollar in the plan by sorting on a number that is not money (the CR054 class, and the same 3.6×
the results table already had to fix). `base_value` is excluded — §22 established it only moves
anything when the module is sold, so it is a poor opening question however large.

**Breadth first, then size:** one knob per group before a second from any, so a plan whose biggest
numbers are all assets does not open with four ways of asking one question.

⚠️ **But breadth has a floor, or it reproduces this CR's own pathology.** The largest *liability* on
`2026 Base` is `USD Credit Cards` at **$27,187** against `United Beverages` at **$4,175,595** — 150×
smaller. Included for balance it draws a few pixels beside a bar that fills the chart, and a bar
that renders as nothing reads as *"this assumption does not matter"*. Anything under **1%** of the
largest candidate is left out.

⚠️ **And the floor first guarded only the breadth pass** — so with few candidates a knob could still
get in by SIZE, same few-pixel bar, admitted through the other door. Caught by its own unit test.
**A short starting set is better than a padded one.**

### `null` and `[]` are different statements, and this needs both

- `null` — *has not chosen yet* — is what lets the picker open on the starting set.
- `[]` — *chose nothing*, what **Clear all** leaves — must STAY empty, or the page re-ticks five
  knobs the reader just removed and reads as broken. Verified across a reload.
- Changing scenario returns to `null`, not `[]`: a different plan has different biggest numbers, and
  a blank picker for a plan they have never looked at is the exact thing this cut exists to stop.
- Storage writes `knobs: null` while untouched, so a reload re-derives from the **current**
  catalogue rather than pinning yesterday's five knobs.

⚠️ **Derived, never written by an effect** — `react-hooks/set-state-in-effect` is a ratchet that may
only shrink, and v3.34.1's picker fix records the same reasoning.

**Eleven builds, about six seconds.** With this, CR085 has no unbuilt scope left.
