# CR064 — Forecast: the annual close, the assumptions key, and the module form — IN-PROGRESS

Three findings and four improvements that came out of one question — *"we customised the module
form for Loan; should the other types get the same treatment?"* The answer to that question is
**no** (§5), but looking for the answer turned up a silent wrong number in the editor, two orphan
rows in prod, and the fact that **every module in every scenario is still anchored to
2025-12-31** with no supported way to move them forward.
[Roadmap](../current/project-roadmap.md#cr064)

**Opened:** 2026-08-02 · **Track:** v3 · **Migration:** 052 (P1)
**Depends on:** CR039 (assumptions moved into `forecast_assumptions`) · CR041 (ownership gate,
field sections) · CR048 (per-scenario assumptions on copy) · CR050 (variants, override sync) ·
CR051 (base-year FX, the zero-rate guard) · CR053 (the auto-adjust scratch harness) ·
CR062 (the Loan form this CR declines to generalise)

**Phases.**

| | scope | gate |
|---|---|---|
| **P0** | §1 — the editor's FX key mismatch, **alone**. Patch release. | Ships first. It is a silent wrong number on a path the owner can reach today (an unmatched EUR/PLN module), the fix is two lines, and shipped by itself the before/after is unambiguous. |
| **P1** | §2 — atomic rename, orphan pruning, the invariant made explicit. Migration 052. | After P0. P2 has to write `PeriodStart`, and writing into a document whose entries can be orphaned is how CR048 lost a whole assumptions slice. Fix the key before building on it. |
| **P2** | §3 — the annual close: roll the base year forward across a scenario and its variants. | After P1. |
| **P3** | §4, §5 — the module form: collapse-when-empty, per-type labels, the blank-row question. | Independent of P0–P2; ships whenever. |
| **P4** | §6 — plan vs actual for the live year. | **Designed here, not built.** Needs P2 (a stale anchor makes every variance meaningless). |
| **P5** | §7 — sensitivity runs on the CR053 harness. | **Designed here, not built.** Lowest priority; nothing is wrong without it. |

---

## 1. P0 — the editor computes foreign-currency USD at FX = 1

`FCModulesEdit.resolveFxRate` reads the wrong keys:

```js
// frontend/src/features/Forecast/FCModulesEdit.jsx:338-350
if (currency === "PLN" && row?.Rates?.USDPLN) { rate = row.Rates.USDPLN; }
else if (currency === "EUR" && row?.Rates?.USDEUR) { rate = row.Rates.USDEUR; }
```

Prod stores `Rates: {"EUR":0.86,"PLN":3.9}`. There is no `USDPLN` and no `USDEUR`, so `rate`
stays `null`, the fallback loop misses for the same reason, and the function returns **1**.

Everything else in the codebase already reads both spellings:

| reader | expression |
|---|---|
| engine | `entry.Rates.PLN ?? entry.Rates.USDPLN ?? 0` — [fcbuilder-setup.js:89-90](../../server/src/services/forecast/fcbuilder-setup.js) |
| expenses UI | `Number(rates.PLN ?? rates.USDPLN)` — [FCExpSetup.jsx:122](../../frontend/src/pages/FCExpSetup.jsx) |
| **module editor** | `row.Rates.USDPLN` only — **the one place that doesn't** |

### 1.1 Why it is not cosmetic

`computedMarketValueUSD = marketValueNumber * fxRate` feeds a `useEffect` that **overwrites**
`MarketValueUSD` whenever it differs from the computed figure — so a correct hand-typed USD value
is stomped back to `MarketValue × 1` on the next render.

The stored column is not display-only. The engine seeds the USD series from it and derives the
module's own FX rate from the ratio:

```js
baseValuesUSD[0]   = module.BaseValueUSD   ?? 0;   // fcbuilder-module.js:623
marketValuesUSD[0] = module.MarketValueUSD ?? 0;   // fcbuilder-module.js:624
modFx[0] = (mod.BaseValueUSD ?? 0) !== 0 ? (mod.BaseValue ?? 0) / (mod.BaseValueUSD ?? 1) : 1;
                                                    // index.js:833
```

A €390,000 property entered unmatched posts **$390,000** to the balance sheet instead of
~$453,000, and reports an implied FX rate of 1.0 into the FX-effect attribution.

### 1.2 Why it has not bitten yet

All ten live non-USD modules are `is_matched = true`, and the matched branch uses
`accountValueRatio` (the ledger's own USD/local ratio) instead of `resolveFxRate`. The bug is one
unmatched foreign-currency module away — and the module the owner had open when this CR started
was an unmatched **EUR** module.

### 1.3 Fix

Read both spellings, in the engine's order (`PLN ?? USDPLN`), and drop the truthiness test that
would also reject a legitimately-zero rate in favour of an explicit `Number.isFinite` check. A
rate of 0 is not "absent" — CR051's F1 guard exists precisely because a zero rate must fail loud
rather than silently divide by 1.

**Test:** an assumptions document in the live shape (`Rates: {PLN, EUR}`) must produce
`MarketValueUSD = MarketValue / 3.9` for an unmatched PLN module, and the `USDPLN` spelling must
keep working.

---

## 2. P1 — assumptions are keyed by scenario *name*, and the names have rotted

`forecast_assumptions` is four JSON documents in a key/value table. Three of them
(`inflation`, `FX`, `Tax Rate`) identify a scenario by its **name string**, and the
fourth (`scenarios`, which carries `PeriodStart`/`PeriodEnd`) by `Name`.

### 2.1 What is in prod today

Five scenarios exist. The `inflation` document carries **ten** entries and `FX` **eleven**,
including five names that no longer exist anywhere:

```
Test · ZZ Test Sandbox · 2026 with House Purchase · 2026 Base - Market Returns · Base_Buy Business
```

`Base_Buy Business` is also still in the `scenarios` document — with no `id`, because there is no
DB row to merge one from.

### 2.2 The failure a rename produces

`PUT /scenarios/:id` accepts `name` ([SCENARIO_UPDATE_FIELDS](../../server/src/v2/routes/forecast.js))
and renames the row. Nothing updates the assumptions documents. Then:

1. The next `generate` **fails loud** — `loadScenarioConfig` looks the scenario up in the
   `scenarios` document by name and throws.
2. The owner opens Forecast Settings and saves, which PUTs a `scenarios` array built from the
   **DB** names. The `scenarios` document now carries the new name; `inflation`, `FX` and
   `Tax Rate` still carry the old one.
3. `generate` now **succeeds**. `inflation` filters to an empty array, `buildRates` seeds
   `currentRate = entries[0]?.Rate ?? 0`, and the scenario runs at **0% inflation for 36 years**.

Foreign-currency modules would trip CR051's zero-FX guard on the way, so the fully silent case is
a USD-only scenario — but that is the shape of the bug, not a limit on it. This is the same class
as CR045 §1 (`cash_sweep_priority` dropped on copy) and CR048 (the whole assumptions slice
dropped on copy): *a scenario that silently computes something else.*

### 2.3 The design I did **not** build: stamping a `ScenarioId` on every entry

The obvious fix is to add `"ScenarioId": <id>` to each entry, have readers prefer it and fall
back to the name. It was drafted, and then abandoned on inspection, because the id has to be
rewritten in more places than the name does and one of them is silent:

- `syncAssumptions`'s `rekey` clones a base entry and rewrites `Scenario` to the variant's name.
  A stamped id would ride along **unchanged**, so every entry the variant owns would carry the
  *base's* id — and an id-preferring reader would then find **no** inflation rows for the
  variant. That is the same 0%-inflation failure this section is fixing, reintroduced by the fix.
- `baseAssumptionValue` and `computeAssumptionOverrides` diff base against variant after
  stripping `{Scenario, id}`. An unstripped `ScenarioId` differs by construction, so **every
  variant would report a phantom `inflation` and `FX` override** — CR050 v3.0.110–112 was three
  releases of exactly that class of bug.

Two rewrite sites that must not be missed, in service of a key that only one code path can
break, is a bad trade. **Simplicity first: fix the path that breaks it.**

### 2.4 Design — rename becomes atomic, orphans are pruned (migration 052)

- **The name stays the key.** No document-shape change, so byte-parity is not at risk and no
  reader, differ or sync path changes.
- **`PUT /scenarios/:id` renames the row and the four documents in one transaction.**
  `renameScenario` rewrites `scenarios[].Name`, and `inflation[].Scenario`, `FX[].Scenario`,
  `Tax Rate[].Scenario`, for the entries matching the old name. The rename is the *only* path
  that can desynchronise them, and it is a single funnel.
- **Migration 052 prunes** every entry in the four documents whose scenario name matches no row
  in `forecast_scenarios` — the five dead names above — reporting each one it drops via
  `RAISE NOTICE` so the deploy log names what went. It also deletes the two blank modules of
  §4.3, guarded on their being genuinely empty rather than assumed to be.
- **A post-condition makes the invariant explicit**, in the migration and again as a test: every
  scenario named by an assumption entry exists, and every scenario has an `inflation`, an `FX`
  and a `Tax Rate` entry. A future path that renames without rewriting fails the test rather
  than producing a scenario that quietly runs at 0% inflation.
- **`value` stays `json`, not `jsonb`** (CR039: jsonb reorders keys and broke byte-parity), so
  the migration rebuilds each array with `json_build_object` in the existing key order and
  `json_agg` with `WITH ORDINALITY` — never a jsonb round-trip.

**Verification:** all five scenarios regenerate **byte-identical** across the migration, and a
rename followed by a `generate` keeps the scenario's inflation path (falsified first against the
unpatched route, which loses it).

---

## 3. P2 — the annual close

### 3.1 What was measured, and what already exists

**Measured.** Every module in all five scenarios is anchored at `base_date = 2025-12-31`, except
the three the owner added recently (`Sarasota House`, `New Business`, `Business Loan`) at
`2026-12-31`. Every scenario runs `PeriodStart = 2027`, so each one carries **two base years at
once** — the scenario's own (`PeriodStart − 1` = 2026, which is what the sweep, the income/expense
seed and the Review's base-year column use) and the modules' (2025, which is where each module's
value series starts and grows from). The module anchor is **a year behind the scenario's**, and
nothing anywhere reports it.

**What already exists — and the first draft of this section missed it.**
`crud.refreshModulesFromActuals(scenarioId, asOfDate)` re-bases every module in a scenario from
the ledger in one set-based UPDATE: `base_value`, `base_value_usd`, `base_date`, plus
`market_value` **for loans only** (a broker's market value cannot be derived from a cash ledger;
a mortgage's outstanding balance is exactly the ledger balance). It is reachable today from the
**copy-scenario modal** — "update module base values from year-end actuals" — which is how each
year's scenario has been minted, and is the likeliest source of the five dead scenario names §2.1
found in the assumptions documents.

So the annual close is not missing. What it does not do is:

| | |
|---|---|
| **`PeriodStart` never moves** | The copy re-bases modules to 2025 year-end and leaves `PeriodStart` at 2027, which is how a scenario ends up anchored a year behind its own base year. |
| **Market value is left alone for non-loans** | Correct as a default, wrong as an *only* option: for the four Fidelity accounts the ledger balance **is** market value (CR024's read-override, CR058's anchors), which is why `PY → Market Value` exists per module. Rolling a year still means opening each brokerage module by hand. |
| **It is blind** | Returns a row count. No preview, no per-module before/after, and a module whose account has no balance at that date is silently left on its old anchor. |
| **In-place is unavailable** | It refuses on a variant (correct — re-basing is the base's job) and is only wired to *copy*, so rolling the year means minting a new scenario every time, and the four variants must then be re-created or re-synced. |
| **Nothing reports staleness** | Neither the 19-month-old anchor nor the two-base-years-in-one-scenario state is surfaced anywhere. |

### 3.2 Decision (owner, 2026-08-02): **keep copying, close the gaps** — not yet built

The first draft proposed rolling a scenario **in place**. The owner chose the other answer, and
it is the right one for this model: minting a copy each year keeps *what I thought in 2026* as a
readable record, which an in-place roll destroys. The cost is scenario sprawl — accepted, and §2
has just removed the mechanism by which sprawl silently rots the assumptions documents.

So the copy stays the annual close. P2 closes what it misses:

1. **`PeriodStart` moves with the anchor.** The single defect behind "every scenario is anchored
   a year behind its own base year". The copy already takes `asOfDate`; the scenario's assumptions
   entry must move to `year + 1` in the same transaction.
2. **A preview before the copy commits** — one row per module: current anchor, current cost basis
   and market value, the ledger value at the new date, the delta, and an **explicit reason** when
   a module cannot be rolled (no account, no balance at that date). Today
   `refreshModulesFromActuals` returns a row count and a module it could not touch is silently
   left on its old anchor.
3. **Market value, opt-in per row.** Leaving MV alone is right for property and wrong for the four
   Fidelity accounts, where the ledger balance *is* market value (CR024's read-override, CR058's
   anchors) — which is why `PY → Market Value` exists per module. The preview offers the tick;
   the default stays cost-basis-only, so today's behavior is what you get by pressing enter.
4. **The variants come across.** A copy of a base is a plain scenario, so the four variants of
   `2026 Base` do not follow it. Either re-create them against the new base or say plainly that
   they were not carried — the current silence is the worst of the three.

Not in P2: rolling in place, and archiving. Both were considered and set aside above.

### 3.3 Staleness, surfaced (independent of the choice above)

A badge on Forecast Review and on the Scenarios row: *"modules anchored 2025-12-31 — a year
behind this scenario's base year (2026)"*, plus a warning when one scenario carries **more than
one** module base year, which is true of all five today. This part does not depend on the decision
and is worth shipping either way.

---

## 4. P3 — the module form

### 4.1 Collapse-when-empty, not per-type field sets

§5 is the argument for why per-type field sets are the wrong shape. What the owner actually wants
— a form that shows what this module uses — is available without touching type at all:

**A section renders collapsed to a `+ Add income` affordance when every field in it is blank or
zero, and expanded whenever anything is set.** By construction it cannot hide a live value, so it
needs no confirm dialog, no preview endpoint and no delete path — the three things the Loan
carve-out needed. It fixes all nine types at once, and the tenth the owner invents next.

Live effect, per module (Tax is 0-for-103 across the whole database):

| type | sections still open |
|---|---|
| Real Estate | General · Valuation · Expenses |
| Business | General · Valuation · Income |
| Stocks / Fixed Income / Private Equity | General · Valuation · Income |
| Liability / Asset | General · Valuation |
| Loan | unchanged (its own sections) |

### 4.2 Per-type labels

Cosmetic only, via a lookup that falls back to today's wording for an unknown or renamed type —
so a mistyped type costs a generic word, never a value:

| type | field | label |
|---|---|---|
| Private Equity | Invest / Dispose | **Capital Call** / **Distribution** (10/10 modules use both) |
| Fixed Income | Yield Spread | **Coupon Spread** |
| Fixed Income, Liability | Growth (× Inflation) | hidden by §4.1 — 0 on all of them |

### 4.3 The blank-row question — and it is not Cancel

Two nameless EUR modules with market value 0 exist in prod right now, one in `2026 Upside` and
one in `2026 Downside`. [status.md](../current/status.md) carries them as an open design
question: *creating a module opens its editor, but the module already exists by then, so Cancel
leaves a blank, nameless row behind. Should Cancel delete it?*

**The premise is out of date, and the rows are evidence of something else.** CR042 closed the
draft-create item on **2026-07-13** (`11fc3b5`): "New module" now builds a client-side draft with
`id: null` and writes nothing until Save, so cancelling a draft has left nothing behind for a
year. Both blank rows were created on **2026-07-14** — the day *after*.

What made them is the **Generate** button. It sits in the modal footer and calls `onSave()`
before it builds, so pressing it on a brand-new empty form POSTs the blank draft — and nothing
refused it: `POST /modules` stores `name: body.Name || ''` and a null `account_id` without
comment. The rows then sit in the Modules table as blanks nobody can identify, and because
`account_id` is null their `AccountType` resolves to `''`, which silently takes the **asset**
branch in the engine (the two rows CR062 §1.1 flagged as "no `account_id` at all" are these).

**Decision: refuse the write rather than clean up after it.** `assertModuleBody` rejects a module
with neither an account nor a name, so every write path — Create, Save, Generate, and any future
caller — is covered by one guard; the editor checks the same condition first so the owner gets a
sentence instead of a 400. The rule is "one or the other", never "both": an account with no name
and a name with no account are each meaningful, and no module in the database has ever had a name
without an account, so nothing real is caught by it. Migration 052 deletes the two that exist.

**Cancel needs no change at all** — which is the answer to the open question, and one less
destructive path than the CR originally proposed to add.

### 4.4 Setup status — withdrawn, it already exists

Drafted as "eight modules per scenario carry `setup_status != 'complete'` and nothing in the UI
shows it". Checked before building: `FCModulesTable` renders it as a colour-coded column with an
inline per-row `select`, and a Status filter sits beside the Type filter. Nothing to build.

---

## 5. Why the other types do **not** get the Loan treatment

The Loan carve-out was earned by semantics: it writes different columns
(`loan_principal`, `loan_start_date`, `loan_end_date`, `loan_interest_rate`), the engine branches
on `loan_interest_rate`, its principal schedule is derived rather than stored, and the route
**rejects** a non-empty `Invest`/`Dispose`/`IncomePct` on one. Hiding those fields was mandatory.

For the other eight types the model is identical; the only difference is which fields the owner
leaves blank. Gating the form on type would cost three things:

1. **Hidden is not cleared.** [fcModulePayload.js](../../frontend/src/features/Forecast/utils/fcModulePayload.js)
   sends every whitelisted field on every save regardless of what was rendered. Hide Expense on a
   Business module and a stale `expense_amount` keeps charging the P&L invisibly — the CR062 P0
   defect class. Doing it safely means a `loan-retype-preview` equivalent, and a confirmed delete
   path, **per type**.
2. **The gate is free text the owner edits.** Prod already carries both `Asset` and `asset`.
   `isLoanModule` survives that only because it has a data fallback (`LoanInterestRate != null`).
   There is no equivalent signal for "Real Estate".
3. It lands in the file already named the highest-risk surface in Forecast — ~1,500 lines of
   per-field special-casing ([roadmap §2](../current/project-roadmap.md)).

Empirical support, 103 modules across 5 scenarios, counting **non-zero** values:

| type | n | growth | expense | income | invest/dispose | yield spread | tax |
|---|--:|--:|--:|--:|--:|--:|--:|
| Real Estate | 40 | 20 | 30 | **0** | 40 | 0 | 0 |
| Business | 18 | 18 | **0** | 18 | 18 | 15 | 0 |
| Liability | 10 | 0 | 0 | 0 | 0 | 0 | 0 |
| Private Equity | 10 | 10 | 0 | 5 | 10 | 5 | 0 |
| Stocks | 10 | 10 | 0 | 10 | **0** | 5 | 0 |
| Fixed Income | 5 | **0** | 0 | 5 | 5 | 5 | 0 |
| Asset / asset | 7 | 0 | 0 | 0 | 0 | 0 | 0 |

The noise is real. §4.1 removes it without keying on type.

---

## 6. P4 — plan vs actual (designed, not built)

`FCReviewTable` already overlays a `(Budget)` and an `(Actual)` column for the base and
last-actual years, so the plumbing for "actuals next to the plan" exists. What does not exist is
the question the owner would ask in August: **is this year tracking to plan?**

Design sketch: for the current year, join the scenario's `forecast_entries` against the ledger at
the same COA nodes and report plan / actual / variance / variance %, run-rated to year end. It is
a join, not a model change. It is also the instrument that would have caught §3 — a stale anchor
shows up first as an implausible variance.

Gated on P2 because a variance computed against a 19-month-old anchor measures the anchor, not the
plan.

## 7. P5 — sensitivity runs (designed, not built)

CR048 ratified "test equity growth in a scenario copy" and "FX stress folds into Downside" — i.e.
hand-copy a scenario per question. CR053 already built the expensive machinery: a standalone
deep-copy scratch scenario, a full-engine evaluation per iteration, an async job + poll, and a
clean teardown. Pointing it at an assumption instead of an expense cut yields a tornado over
inflation ±1%, FX ±10%, equity growth ±, tax ± → Δ first shortfall year, Δ terminal net assets.

Reuse, not new machinery — but nothing is *wrong* without it, which is why it is last.

---

## 8. Out of scope

- **Monte Carlo / stochastic returns.** Converts a model the owner can explain line by line into
  one nobody can. CR044 settled that this stays a personal tool.
- **Per-type field sets** — §5.
- **Retiring the `forecast_assumptions` key/value document** in favour of real columns. P1 fixes
  the key that rots; restructuring four documents that the engine, the copy path, the variant sync
  and three UI pages all read is a separate CR and buys nothing this one needs.

## 9. Status

- **P0** — pending.
- **P1** — pending (migration 052).
- **P2** — pending.
- **P3** — pending.
- **P4 / P5** — designed here, not scheduled.
