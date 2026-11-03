# CR099 — A per-year return path on a forecast module (market crash and recovery) — COMPLETED

**Status:** COMPLETED — live v3.80.0 (2026-11-03, §10); migration **086**. Pass 1 `cr-technical-reviewer` revise → rev 2; pass 2 `cr-signoff-pm` **GO** on rev 3 (§9). Next is use, not code: enter the crash path on `2026 Market Crash` (§6.2).
**Depends on:** CR050 (variants), CR062 (amortization child-table pattern), CR076 D1 (`growthPctForYear`), CR085 P0 (derived copy lists)
**Roadmap anchor:** [project-roadmap.md#cr099](../current/project-roadmap.md#cr099)

## 1. The problem

The owner wants to model a one-year equity crash of −50% followed by a recovery that is slower
than the fall. The engine cannot express that shape.

A valuation module's market value grows each year by `growth_rate × that year's inflation`
([`growthPctForYear`](../../server/src/services/forecast/fcbuilder-common.js), lines 99–117). `growth_rate`
is one number for the whole horizon. The only per-year input is the scenario's inflation series,
so a module can grow faster or slower than trend but cannot fall in 2027 and recover over
2028–2032.

The three workarounds that run today each model something else:

| Workaround | What it actually models |
|---|---|
| A crash path in the scenario's **inflation** | A deflation. Inflation also indexes every expense, every income stream and every yield (`yield = inflation + spread`), so the whole plan shrinks with the stock market. |
| A **Disposal** of 50% | A sale. It books a realized gain/loss, capital-gains tax, and cash proceeds into the cash sweep. |
| A variant with `market_value` cut 50% at the base date | A permanent loss from day one with no catch-up. It is a usable stress floor but not a crash-then-recovery path. |

**Stopgap until this ships:** the halved-`market_value` floor is a pessimistic bound (Fidelity Stocks 2032: about $862K below Base, against about $314K for the §3 path). If wanted, build it in a **separate throwaway variant** (e.g. `2026 Crash floor`), deleted when CR099 ships. **Never on `2026 Market Crash` (id 113):** a leftover `market_value` override there would stack with the path into an unwarned −75%.

## 2. Measured on prod (2026-11-03)

- **Scenarios:** `2026 Base` (id 47, PeriodStart 2027) and **`2026 Market Crash` (id 113), a
  variant of Base** (`parent_scenario_id` 47) created by the owner on 2026-11-03 with **no
  overrides yet**. It is the scenario this CR's return paths go into. It replaced a first
  attempt, a standalone copy (`2026 Equity Crash`, id 112) that had no inflation assumption and so
  could not be built; that copy is deleted.
- **Equity-like valuation modules on Base** (the modules this CR is for):

  | id | Module | Type | Ccy | `growth_rate` | MV USD | Sweep |
  |---|---|---|---|---|---|---|
  | 93 | Fidelity Stocks | Stocks | USD | 1.0 | 1,369,072 | priority 2 |
  | 80 | CVC Fund VIII | Private Equity | EUR | 1.5 | 665,357 | — |
  | 81 | CVC Fund IX | Private Equity | EUR | 1.5 | 183,637 | — |
  | 92 | Misc Investments | Stocks | USD | 1.0 | 1,412 | — |

  Fixed Income (id 94, $1.24M) is the sweep target and stays outside a crash.
- **Each of the three material modules carries a `yield` income stream** (Fidelity Stocks on FC
  line 22, the two CVC funds on line 32). A yield is applied to the **average market value across
  the year** (`fcbuilder-stream.js`, around line 164), so a crash lowers that income in the crash
  year and the year after. No stream change is needed.
- ⚠️ **Base grows Fidelity Stocks at inflation, i.e. a 0% real price return** (`growth_rate` 1.0).
  Stored Base MV: 2026 **1,403,298.74**, 2032 **1,725,012.45**, exactly 3.5% a year from 2026.
  "Recovery back to trend" in this CR means back to *that* trend. Whether 1.0 is the right base
  multiplier is out of scope.

## 3. What it should do

A valuation module (not a loan, not a flow module) can carry an optional **return path**: a list
of `(year, return %)` rows.

- **For a year with a row**, the module's price return for that year is the row's percentage,
  **nominal and absolute**. A row of −50 means the market value falls by half. It does **not**
  multiply inflation and is **not** added to the module's normal growth.
- **For a year with no row**, the module grows as it does today (`growth_rate × inflation`). A
  module with no rows behaves exactly as before, byte-identical.
- **The return is unrealized.** It moves `unrealizedGainValues` and the market value only. No tax,
  no cash, no sweep entry. Cost basis is unchanged.
- **Local currency.** The return is the asset's own return in its currency. The CVC funds' EUR
  value moves on the path; USD = LC / fx as today.
- **Valid years:** `year(base_date) < year ≤ PeriodEnd` for the module's resolved scenario. The
  budget year before PeriodStart (2026 on Base) **is** valid: the engine grows it (the `idx < 0`
  branch, `fcbuilder-common.js:113-115`). The base year itself is not, because it is observed, not
  projected (`fcbuilder-module.js:291`).
- **`pct > −100`.** The real reason is the cash sweep: it divides balances by the growth factor
  (`cash-sweep.js:105-115`), so the factor must stay above zero. Also `pct ≤ 1000`, to catch a
  fraction typed as a percent the other way round from the R10 multiplier lesson.

### What a crash does to sales — existing conventions, stated, not changed

The crash makes three existing conventions material. None is changed by this CR:

1. **A cash-sweep draw on a crashed module realizes zero, never a loss.** `cash-sweep.js:218-224`
   caps the basis ratio at 1 (`Math.min(1, basis / mv)`) and returns 0 when gain ≤ 0. Fidelity
   Stocks' basis (≈1.02M) is above its crashed value (≈0.70M), so a draw consumes basis 1:1 with
   no tax. Fin carries no capital loss forward anywhere (`fcbuilder-module.js:726` taxes only
   gains > 0), so a loss realized here would have nowhere to go.
2. **A Full disposal in the crash year books half the year's move** (`fcbuilder-module.js:442-443`,
   `(MV[idx] − prevMV) / 2`), i.e. −25% on a −50% row: a mid-year sale.
3. **A partial disposal releases basis against the previous year-end MV**
   (`fcbuilder-module.js:400-407`). A $100K sale in the crash year therefore realizes roughly
   $27K of gain on Fidelity Stocks even though the market is down. The sweep, by contrast, prices
   at the crashed balance.

After a Full disposal, later growth is zeroed (`fcbuilder-module.js:452-459`), so path rows after
it are inert and get the §4.5 warning.

### Worked example (Fidelity Stocks on `2026 Market Crash`, inflation 3.5% after 2026)

| | 2026 (stored) | 2027 | 2028–2032 | 2032 MV |
|---|---|---|---|---|
| Path rows | 1,403,298.74 | −50 | +15 each year | 1,403,298.74 × 0.5 × 1.15⁵ ≈ **1,411,268** |
| Base (no rows) | 1,403,298.74 | +3.5% | +3.5% each year | **1,725,012.45** (stored) |

A 50% fall needs +100% to get back to the starting value. +15% a year takes five years to get
there and still ends about **$314K** below Base. Test 2 asserts these figures to the cent, built
without investments, disposals or sweep draws on the module.

## 4. Design

### 4.1 Storage — a child table, like loan amortization

```sql
CREATE TABLE forecast_module_returns (
  id         SERIAL PRIMARY KEY,
  module_id  INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
  year       INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2200),
  pct        NUMERIC(8,4) NOT NULL CHECK (pct > -100 AND pct <= 1000),
  UNIQUE (module_id, year)
);
```

Mirrors `forecast_module_amortization` (CR062). An integer year rather than a date, because the
engine is annual. `UNIQUE (module_id, year)` doubles as the module index.

**Storage decision — child table, not a JSONB column on `forecast_modules`** (pass 2 asked for it
to be recorded). A column would ride along free in scenario copy and variant sync, both of which
derive module columns from `information_schema`, and would drop most of §4.2 (copy, every
`copyScenario` caller, `SCHEDULE_TABLES`, the variant intercept, schedule replace/read, the
preview schedule guard). It is rejected on a **checked** defect: variant sync prunes a patch key
when `valuesEqual` (`forecastVariants.js:1288-1300`) says it matches the base, and for two arrays
that function falls through to `String(a) === String(b)`, i.e. `"[object Object],…"` on both
sides. **Any path with as many rows as the base's would compare equal and be pruned from the
variant without any error** — the very defect class this CR guards against. No `forecast_modules`
column is JSON today, so no existing code has been tested against one. Fixing `valuesEqual` for
structured values is possible but touches every variant column comparison. The child table reuses
the proven CR062 path, keeps per-row DB CHECKs, and the §4.2 catalog test closes the hand-list
drift class for every future child table too.

**Wire contract:** body field `Returns: [{ Year, Pct }]` on module POST/PUT, the same shape on
GET, always **sorted by year** on both sides so a variant's schedule compares equal to its base
regardless of entry order (`scheduleEqualsBase` compares positionally, `forecastVariants.js:707-712`).

### 4.2 Every place that lists a module's child tables

The hand-kept child-table lists fail silently when one is missed: a copy without the path builds
and reports a better plan (the CR078/CR085 `disposal_cost_pct` class). All of these gain
`forecast_module_returns`:

| Site | File |
|---|---|
| Engine loader (attach `mod.Returns` next to `Invest` / `Dispose`) | `services/forecast/index.js:82-88`, `:138-154` |
| Scenario copy | `v2/repositories/forecast.js:227-233` (`copyChildColumns`), `:388-399` |
| …and so every `copyScenario` caller | annual close (`annualClose.js:271`), sensitivity, auto-adjust (`forecastAutoAdjust.js:222`), preview scratch |
| Sensitivity fidelity gate and fingerprint | `forecastSensitivity.js:97-102`, `:148-175` |
| Variant schedule tables | `forecastVariants.js:37`, `SCHEDULE_TABLES` from `:40` |
| Variant intercept (`body.Returns` → `patch.returns`) | `forecastVariants.js:954-994` |
| Module write allow-list, array check, schedule-trigger guards | `routes/forecast.js:55-68`, `:189`, `:1114`, `:1322-1325` |
| Schedule replace and module read | `crud.js:115-125`, `repositories/forecast.js:526-536` |
| GET serializer | `routes/forecast.js:835` |
| Preview change guard | `forecastPreview.js:127-131` |
| Asset → Loan retype clear-out | `routes/forecast.js` around 1335 |

**Guard against the class, not this instance:** one catalog-driven test. For every table with a
foreign key to `forecast_modules`, assert it appears in `copyChildColumns`, `SCHEDULE_TABLES`, the
sensitivity fidelity digest and the engine loader. Today's drift tests enumerate tables by hand
(`copyScenario.columns.test.js:41-47`, `variantSchedules.test.js:26`) and would not notice.

### 4.3 Engine — one series function, no optional argument

The year's growth percent has **three consumers**:

1. the module builder (`fcbuilder-module.js:294`), which writes MV;
2. the convergence loop (`index.js:784-852`), which rebuilds MV **in memory** for sweep-ranked
   modules with a yield stream and rewrites their income, tax and bank entries;
3. the cash sweep's growth factor, which reads the builder's `GrowthPct` audit column into
   `growthByYear` (`index.js:617-630`, `cash-sweep.js:100-117`) and so inherits the path.

CR076 D1 is what happens when 1 and 2 disagree (−39,715 on Base). An optional path argument to
`growthPctForYear` would let a call site omit it and still pass every existing test. So rev 2
adds a shared **`moduleGrowthSeries(mod, startYear, yearsCount, scenario, inflationSeries)`**
that both 1 and 2 call. It applies the path only when the module has a valuation and is not a
loan (`hasValuation && LoanRate == null`), and otherwise falls back to `growthPctForYear`. The
structural guard (`growth-formula-parity.test.js:51-68`) is extended to require both files to
call it.

### 4.4 Refusals

- The API rejects `Returns` with any rows on a loan (`isLoanBody`) or a flow module
  (`HasValuation === false`). On a loan a −50 row would halve the **debt**; on a flow module it is
  inert.
- Year-range validation needs the module's `base_date` and the resolved PeriodEnd, which
  `validateModuleBody` does not have. It is a DB-aware check run before `interceptSchedules`, so a
  variant save is validated too. Out-of-range and `pct` violations return 400, not a DB error.

### 4.5 Rows that go out of range after they are written

A variant can override PeriodEnd, the module's `base_date` can move, a Full disposal can end the
module, and the annual close shifts `base_date` and PeriodStart by +1. **At build time, out-of-range
and post-disposal rows are ignored and raise an engine warning** naming module, year and reason
(the `loanWarnings` pattern, `index.js:178`). An inert row with no warning is the project's
recurring defect class.

**Across the annual close, a row is pinned to its calendar year** (owner decision 2026-11-03,
§6.1). `returns` joins the close preview's `VALUE_PIN_KEYS` (`annualClose.js`
`planVariants`, around line 199) so the preview shows it carries as-is.

### 4.6 UI and every surface that describes growth

- **Module editor** (`FCModulesEdit.jsx`): a **Return path** section for valuation, non-loan
  modules, built like the amortization editor (year / % table, add, remove, always sorted).
- **Modules list:** a "path" marker beside Growth when the module has rows (a returns count in
  `listModules`, as `dispose_count` does), so Growth 1.0 does not read as the whole story.
- **Variant overrides panel** (`fcFieldLabels.js`): `returns` in `isScheduleField` (`:86-88`), a
  label in `MODULE_LABELS` (`:24-47`), and `formatSchedule` (`:96-110`) printing `2027 −50%,
  2028 +15%…`. Without it the override reads "— → 3 entries" under the raw key. `amortization`
  has the same gap today; fix it in the same change.
- **Disposal warning** (`fcWarnings.js:584-610`): base the gain/loss wording on the module's
  actual path, not `GrowthRate` alone. **In scope:** pass 2 made it conditional on a disposal
  sitting on a pathed module, and one does — CVC Fund VIII has disposals dated 2030–2033 in both
  Base and 113 (prod, 2026-11-03).
- **Sensitivity `growth_rate` knob label** (`sensitivityKnobs.js:57`): on a module with a path,
  say the knob moves only the years without a row.
- **Ride-along, own commit:** `amortization` gets the same `fcFieldLabels.js` label and
  formatter fix — the same three lines, the same display-half defect, named here so it is not
  hidden inside CR099.
- **Deferred to roadmap bullets:** the AI Review prompt printing the path (`aiReview.js:205-211`,
  matters only if AI Review is run on 113); a "copy path to…" button (only if asked).

**Acceptance:** rendered in both themes with a path entered on `2026 Market Crash` — the editor,
the modules list marker, the overrides panel and the dip on the forecast page and the CR040
Compare page.

## 5. Tests (gate)

1. No rows → every module's MV series byte-identical to today on a Base fixture.
2. The §3 worked example, to the cent.
3. **Convergence-loop parity, behaviourally:** a sweep-ranked module **with a yield stream** and a
   path. Assert the stored crash-year dividend equals (inflation + spread) × the average of the
   stored MV[y−1] and MV[y]. Without the yield stream the loop never runs (`index.js:766-767`).
   Falsify it: it must fail when one site bypasses `moduleGrowthSeries`.
4. The sweep's `growthByYear` for that module carries the path's value in the crash year.
5. A sweep draw in the crash year: zero gain, no tax, basis consumed equals the amount (§3
   convention 1).
6. A yield stream on a module with a path falls in the crash year.
7. A variant with `patch.returns` gets the path and its parent does not. `patch.returns = []`
   clears it. The same path entered out of order is **not** an override.
8. A scenario copy, the annual close, sensitivity and preview each carry the rows (plus the §4.2
   catalog test).
9. API 400s: `pct = −100`, `pct = 1001`, a year ≤ `year(base_date)`, a year > PeriodEnd, any rows on
   a loan, any rows on a flow module.
10. A row beyond a variant's overridden PeriodEnd, and a row after a Full disposal, each produce
    the §4.5 warning.

## 6. Open questions

1. ~~Across the annual close, is a return row pinned to its calendar year, or shifted +1?~~
   **Decided 2026-11-03: pinned to its calendar year.** A "2027 crash" means 2027. Once that year
   passes, the row falls out of range and gets the §4.5 warning.
2. **Per-module paths mean typing the same −50/+15… path three times** (93, 80, 81). The owner
   chose module-level paths (2026-11-03), which keeps a different path for private equity
   possible. A "copy path to…" button is not in scope unless asked.
3. **Intra-year shape is not modelled.** The engine is annual. How a sale inside the crash year is
   priced is set by the existing conventions in §3, not by this CR.

## 7. Non-goals

- A scenario-level market path or an asset-class tag on modules.
- Sensitivity knobs for the path (the existing knob's label change is in §4.6).
- Changing any module's `growth_rate`, including the 1.0 on Fidelity Stocks noted in §2.
- Capital-loss realization or carry-forward, and changing the §3 sale conventions. Loss
  carry-forward is already a backlog item from [CR076](cr-076-forecast-model-review.md); the crash
  makes it material (a sweep draw realizes zero, a partial sale in the crash year books ~$27K gain).
- Monte Carlo or randomized return sequences.

## 8. Phasing, window and deploy

One phase, built in its own worktree: migration, engine, every §4.2 site, the API refusals, the UI
in §4.6, and the §5 gate. The parts are not useful apart (a path the copy drops, or one the UI
cannot show, is the defect class this CR guards against).

**Window.** After CR098 P3b, which has the hard dates (code freeze 2026-12-03, first 2027 publish
by 2026-12-10); CR098 keeps priority on the shared test rig (dev Postgres `:5434`, one stack at a
time). **Deploy to prod by 2026-11-30**; if that slips, hold until after the first 2027 publish,
and in any case ship **before the January 2027 CR064 annual close**. Not built alongside CR095.

**Deploy and verify.**
1. Claim the migration number when the file is written (085 is the highest on `main` today) and
   add its row to `docs/current/migrations.md`.
2. Ship with `Scripts/deploy-to-production.sh` (backs up prod, applies migrations at Step 2b
   before the code goes live).
3. **Prove "no rows → byte-identical" on a prod dump: old engine vs new engine on the same
   inputs, every scenario.** Not against stored output — `2026 Base`'s stored forecast predates
   the 2027 rates set 2026-11-01, so a regenerate moves for reasons this CR did not cause.
4. After deploy, enter the paths on 113 and regenerate **only 113**. Base stays on its own
   schedule.
5. **Annual-close acceptance:** on a prod dump with 113 carrying rows, run the close preview.
   `returns` must show as carried as-is under `VALUE_PIN_KEYS`, and the copied variant must still
   hold the 2027 row.
6. **Read-out:** Base grows Fidelity Stocks at inflation (0% real), so "$314K below Base" is
   below an inflation-only trend, not a market trend.
7. **Reversible:** deleting the rows returns 113 to Base behaviour; the migration's down step
   drops the table.

**Related, owner's call:** the held "2026 Downside (being redone)" item. A crash variant may be
what Downside becomes; not started unasked.

## 9. Review log

- **Pass 1, `cr-technical-reviewer`, 2026-11-03: revise.** Facts it corrected, each checked
  against code or prod before rev 2 adopted it:
  - the worked example skipped 2026's growth (stored MV checked: 1,403,298.74 / 1,725,012.45);
  - the sweep realizes zero on a crashed module, not a loss (`cash-sweep.js:218-224` read);
  - a Full disposal books half the year's move, and a partial disposal prices basis on the previous
    year-end (`fcbuilder-module.js:400-407`, `:438-459` read);
  - the convergence loop rebuilds MV in memory and writes income/tax/bank, not MV, and the sweep's
    growth factor is a third consumer.

  Rev 2 adds the full touch-point list (§4.2) with a catalog guard, a required shared series
  function (§4.3), the valid year range and stale-row warning (§3, §4.5), loan and flow-module
  refusals (§4.4), and the display surfaces (§4.6).
- **Owner decision, 2026-11-03:** return rows stay pinned to their calendar year across the annual close.
- **Pass 2, `cr-signoff-pm`, 2026-11-03: GO on five edits, applied in rev 3** — storage decision
  recorded (§4.1; child table kept on the checked `valuesEqual` defect, against pass 2's lean to a
  column), deploy and verification (§8), build window (§8), scope cuts (§4.6), status PLANNED.
  Pass 2's disposal-wording deferral was conditional on no disposal on a pathed module; CVC Fund
  VIII has four, so it stays in scope.

## 10. As built (2026-11-03)

**Code.** Migration **086** (`forecast_module_returns`, §4.1). `moduleGrowthSeries` in
`fcbuilder-common.js` applies the path; the builder and the convergence loop both call it, and the
structural guard now fails if either calls `growthPctForYear` itself. The loader attaches
`mod.Returns` and returns `returnWarnings` (logged) for rows it cannot apply. Every §4.2 site carries
the table: copy, the sensitivity digest and fingerprint, variant schedules (read `ORDER BY year`),
the variant intercept, `crud`, the routes, the preview guard, and the close's `VALUE_PIN_KEYS`.
Validation lives in `v2/utils/forecastReturns.js`, shared by POST, PUT and the save-time preview.
UI: `FCReturnPath.jsx` on the module editor, a **PATH** marker on the modules list, the variant panel
prints the path, `fcWarnings` names rows that do nothing, the disposal wording claims no direction
on a pathed module, the Growth sensitivity knob reads *· years off its return path*. Ride-along, own
commit: the variant panel names and prints an `amortization` override.

**Departures from §4, found while building or at code review.**
- **A row sent back unchanged is not re-judged** against the year bounds, the loan or the valuation.
  Without this, a row the annual close made stale (base date +1) made the module unsaveable: the
  editor sends the whole path on every save. The engine ignores such a row and the Review warns.
- **The Review's warning covers what the write path cannot refuse:** rows after the first Full
  disposal at or after the base year, rows past the plan's end, and every row on a loan or flow
  module. The list carries `DisposeFullFirstYear` for it.
- **A blank percent is refused (400), never stored as 0%,** and the editor sends a blank as null
  rather than dropping the row. "Add a year" starts blank, on the year after the last row.
- **The preview payload carries `Returns`** (it is built without `normalizeTransfers`, where a path
  edit would have previewed as no change), and the preview validates before building its copy.
- **Found by rendering:** the editor's years read "20251" — the base year arrives as a string.

**Verified.**
- Backend: 1,580 passed on dev (127 suites); the fresh-database run, before the code-review fixes,
  was 127 suites green. New: `returnPath.test.js` (engine, 7), `forecast.returns.test.js` (API, 20),
  `moduleChildCatalog.test.js` (5), copy and parity tests extended.
- **Falsified:** the convergence loop without the path pays the crash-year dividend on the uncrashed
  value (36,858.94 against 27,168.75); the catalog guard fails when the sensitivity digest drops the
  table; the order test fails without `ORDER BY year`; both stale-row tests fail without the
  exemption.
- Frontend 750 passed; six ratchets at baseline.
- **Rendered on dev, both themes:** editor and PATH marker; a row added in the UI went through the
  save-time preview (which priced it) and was stored; a regenerate gave Fidelity Stocks 2027 =
  1,403,299 × 0.5 and the recovery years as typed. Dev was restored afterwards.

**§8 step 3, the prod-copy check (2026-11-03, before the deploy):** a fresh prod dump restored twice
into throwaway databases; v3.79.0's engine built every scenario on one, this code (with 086 applied)
on the other. Both scenarios built, and all **3,212 forecast entries are byte-identical** (rounded
to the cent): with no rows, nothing moves. The dump and both databases were destroyed after.

**Not verified:** §5.4 (the sweep's `growthByYear` carries the path) and §5.5 (a crash-year sweep
draw realizes zero) are inherited behaviour, untested here; the dip on the Compare page was not
rendered.
