# CR050 — Forecast Scenario Variants (inherit-unless-overridden)

**Status:** IN-PROGRESS (shipped v3.0.108, fix v3.0.110, 2026-07-14; awaiting owner acceptance + the adopt decision on "2026 Downside" / "2026 Upside") · **Track:** v3 · **Opened:** 2026-07-14
**Depends on:** nothing. **Touches:** `forecast_scenarios`, `forecast_modules`,
`forecast_income_expense`, `forecast_assumptions`, the forecast routes, and the three
Forecast setup pages. **Does not touch the engine.**

---

## 1. The problem

A scenario is a flat island. `POST /scenarios/byname/:name/copy` deep-copies every row and
then severs the link forever: 20 modules, 10 income/expense items, their schedules, and the
scenario's slice of the assumptions document. From that moment "2026 Upside" and "2026 Base"
have nothing in common but a shared ancestry no code can see.

Two consequences, and the owner has now hit both:

- **A downside case cannot be expressed as a downside.** "Everything as Base, but this one
  module grows at 1% instead of 4%" is not sayable. You copy 30 entities to change one field,
  and nothing records *which* field made it a downside.
- **The copies rot.** Fix a mis-typed cost basis in Base and the copies keep the wrong one.
  Every model improvement has to be hand-applied N times, and the copies silently diverge in
  ways nobody can enumerate. (The current "2026 Upside" *is* a name-preserving copy of Base —
  all 20 module names and all 10 item names line up 1:1 — but nothing asserts that, and the
  only way to find out what differs is to diff it by hand.)

The deep-copy path also has a bad track record precisely because it re-enumerates columns by
hand: **CR045 §1** — the copy silently dropped `cash_sweep_priority`, so every copied scenario
ran with no sweep module and left −$3.35M of shortfall unfunded. **CR048** — the copy never
carried the assumptions at all, so a copied scenario ran at 0% inflation and no period. The
copy comments in [`repositories/forecast.js`](../../server/src/v2/repositories/forecast.js)
document both. A scenario derived by hand-enumerated snapshot is a scenario that quietly
computes something else.

## 2. What we want

> A variant inherits **every** item from its base unless that item is explicitly overridden.
> Change the base, and the change flows into every variant except where it was overridden.

Concretely: `2026 Downside` = `2026 Base`, except `Fidelity Stocks.growth_rate = 1.0` and
`Living Expenses.base_value = 180000`. Add a module to Base and Downside gets it. Fix a basis
in Base and Downside gets it. Downside's own two overrides stay pinned. The override set *is*
the scenario's definition, and it is queryable: "what makes Downside downside" stops being a
memory.

## 3. Approach — deltas are the truth, rows are materialized

Three designs were weighed:

| | How | Why not |
|---|---|---|
| **1. Read-time overlay** | Variant stores only deltas; every reader merges base + deltas at query time. | Reads are **not funneled**. The engine has its own loaders ([`services/forecast/index.js`](../../server/src/services/forecast/index.js)), the repository has its own finders, `crud.getBaseYearValues` has a third. A reader that forgets the resolver sees a near-empty scenario and returns a confidently wrong number — **this is the CR049 failure mode re-armed** (a hand-copied query that drifted and zeroed every non-liability expense). |
| **3. Copy + dirty flag + Sync button** | Keep the deep copy; flag each row `inherited`; a manual "Sync from Base" refreshes the un-dirtied rows. | "What is overridden" becomes an assertion, not a fact. An accidental edit is indistinguishable from a deliberate override, and carry-through is manual. It decays. |
| **2. Deltas + materialize** ✅ | Overrides are stored as deltas; a **sync step expands base ⊕ overrides into real rows** on the variant, before every build. | Chosen. |

**Option 2 is chosen** because the variant ends up holding ordinary, fully-populated rows: the
engine, the Review page, Compare, AI review, the audit CSVs and every export keep working
**unchanged**, on a forecast module that has produced ten silent-wrong-number bugs in the last
month and does not need an eleventh. The failure mode of option 2 is a *stale* materialization,
which a rebuild fixes and which the build-time sync makes near-impossible; the failure mode of
option 1 is a wrong number nobody sees.

### Overrides are a JSONB patch, keyed to the base row's **id**

```
forecast_scenarios.parent_scenario_id  →  forecast_scenarios(id)  ON DELETE RESTRICT

forecast_scenario_overrides(
  id, scenario_id → the VARIANT,
  entity_type   'module' | 'incexp' | 'assumption' | 'scenario',
  base_entity_id  forecast_modules.id / forecast_income_expense.id IN THE BASE (NULL for assumption/scenario),
  entity_key      'inflation' | 'FX' | 'Tax Rate' | 'PeriodStart' | 'cash_sweep_low' | …
  patch jsonb     {"growth_rate": 1.0, "expense_amount": 42000}
  is_deleted bool tombstone — removed in this variant
  note text)
```

**Field-level, not row-level.** The patch carries only the keys it overrides, so overriding
*Fidelity Stocks' growth rate* still lets a later change to *Fidelity Stocks' income yield* in
Base flow through. This is exactly the semantics asked for, and it also sidesteps a schema
trap: `NULL` is already load-bearing in these columns (NULL `tax_rate_override` = fall back to
the scenario rate; NULL `cash_sweep_priority` = never liquidate; NULL window = unbounded), so
"NULL means inherit" is **not** available to us. A patch has no such ambiguity.

**Keyed by id, not name.** Names are unique per scenario and would *seem* to work — but
`PUT /modules/:id` allows renames, one live module already has an **empty name** (ids 251/271),
and name-keying is exactly what makes the assumptions document fragile today (it still carries
orphan entries for "2026 Downside", a scenario that no longer exists). Base ids are stable.

**Schedules are lists, so they patch as whole lists.** `forecast_module_investments` and
`forecast_module_disposals` have **no unique constraint** and exact-duplicate rows are legal, so
element-wise merging has no key to merge on. A patch key of `investments` / `disposals` /
`income_pct` replaces that schedule entirely; absent, the base's schedule is inherited whole.

### The sync

`syncVariant(variantId)` — one transaction, advisory lock on the variant. It is **lazy, not
fanned out**: a write to the base does **not** push into its variants. (An earlier draft did fan
out, which meant a variant whose resolved state was invalid — a sweep-priority patch that now
collides, say — would make the *base's* write fail. Editing Base must never be blocked by a
problem in Downside.) Instead sync runs when the variant is **read** (its Modules / Expenses
pages) and unconditionally at the **top of its build**, gated on a staleness stamp:
`max(updated_at)` across the base's rows and the variant's overrides, versus `variant.synced_at`.
A bad override then surfaces on the variant, where it belongs. At 20 modules and 10 items a sync
is ~40 upserts — the cost is noise.

1. Load the base's modules and items (**all** of them, `setup_status` included — the engine
   filters at build time, sync does not).
2. For each base row `B`: apply the override patch (if any) over `B`'s columns and **UPSERT**
   into the variant on a new `origin_base_id` column (`UNIQUE(scenario_id, origin_base_id)`).
   Upserting on the base id — rather than delete-and-reinsert — keeps the variant's surrogate
   ids stable across syncs.
3. `is_deleted` ⇒ remove the variant's row. `origin_base_id IS NULL` ⇒ a **variant-local**
   addition; sync never touches it.
4. Schedules: patched list, else the base's list, replaced wholesale.
5. Assumptions (period / inflation / FX / tax) and the sweep band: resolve base ⊕ overrides and
   write them under the variant's name in the existing document. **Nothing downstream changes.**
6. **Resolve the scenario-unique sweep flags.** `cash_sweep_target` and `cash_sweep_priority`
   are unique *per scenario* (partial unique indexes), so an override of them is **not
   independent**: overriding "Fidelity is the primary" in Downside necessarily implies
   *un-priming the base's primary within the variant* — a second override the owner never typed.
   Sync **derives** that: a patched priority/target displaces the inherited holder of that rank,
   and the displaced module falls back to unranked. Materialization then validates the indexes
   and fails loudly rather than tripping them mid-build.
7. Order the writes so `UNIQUE(scenario_id, name)` cannot collide transiently — two base modules
   swapping names in one edit must not deadlock the upsert (deletes and renames land before
   inserts).

**The column list is derived from `information_schema`, not hand-enumerated.** This is the
direct fix for the CR045/CR048 bug class: a new column added by a future migration cannot be
silently dropped on the way into a variant. A test asserts every non-excluded column round-trips.

**Sync runs:** on a **read** of the variant's setup pages, on an override write, and
**unconditionally at the top of `generateForecast`** when the scenario has a parent — never as a
fan-out from a base write. The build-time sync is the safety net: even if every other call point
were missed, a rebuild is still correct.

### Assumption overrides

`inflation` and `FX` are **lists** of `{Year, …}` inside the document, not scalars, so they take
the same **whole-list replace** rule as schedules. Only `Tax Rate`, `PeriodStart`, `PeriodEnd`,
`cash_sweep_low` and `cash_sweep_high` are scalar. `entity_key` is closed to exactly those seven.

Note the design leans on the document's **name-keying**: sync writes the variant's resolved
assumptions under the variant's *name*. Renaming a scenario already orphans its entries today
(the doc still carries "2026 Downside", a scenario that no longer exists); this CR makes that
latent bug load-bearing, so **scenario rename must rewrite the document** — folded in here.

## 4. API

The forecast API has **no scenario-create route today** — creation is a side-effect of
`PUT /assumptions`, "Make Default" is `localStorage` only, and "Commit Changes" just fires
`PUT /assumptions` + `PUT /scenarios/:id`. A variant needs a genuine create, so this CR adds the
first real one:

| Route | Purpose |
|---|---|
| `POST /scenarios/:id/variant` | Create a variant of `:id`. Zero overrides ⇒ an exact twin of the base. |
| `GET /scenarios/:id/overrides` | The diff list — "what makes Downside downside". |
| `DELETE /scenarios/:id/overrides/:entityType/:baseEntityId` (`?field=`) | Revert a row, or a single field, to base. |
| `POST /scenarios/:id/sync` (`?dryRun`) | Re-materialize; dry-run reports drift. Also the repair tool. |
| `POST /scenarios/:id/adopt-variant` | Convert an existing **copy** into a variant: diff it against a chosen base and generate the override set. This is how **"2026 Upside" migrates** with no loss. |
| `POST /scenarios/:id/detach` | Promote a variant to a standalone scenario — keep the rows, drop the parent link and the overrides. |

### Writes on a variant — and the paths that bypass the repository

The obvious interception point is `repo.updateModule` / `updateIncExp`:

- `PUT /modules/:id` on an **inherited** row ⇒ diff against the base row, merge the changed
  fields into the override patch, re-sync that row. The user sees the row update; it is now
  badged *Overridden (3 fields)*. Schedules ride along for free: Invest / Dispose / IncomePct
  arrive **embedded in the module body** and `crud.replaceSchedules` already replaces them
  wholesale, which is exactly the whole-list patch semantics above.
- `DELETE` on an inherited row ⇒ **tombstone**, not a row delete.
- `POST` a new module on a variant ⇒ a plain row, `origin_base_id = NULL`, variant-local.

**But the repository is not the only write path, and an unguarded one is silent data loss** —
a write that lands in a variant's rows and is then overwritten by the next sync, with no error.
Four paths bypass `updateModule` and each gets an explicit policy:

| Path | Policy on a variant |
|---|---|
| `crud.refreshModulesFromActuals` — a **set-based `UPDATE … WHERE scenario_id = $1`** across every module ("Reload Defaults" / copy's `refreshFromActuals`) | **Refused.** Re-basing from ledger actuals is a *base* concern; a variant inherits the result. The UI hides the button on a variant. |
| `crud.clearOtherCashSweepTargets` — a **sibling side-effect** UPDATE on other modules in the scenario | Superseded by the sweep-flag resolution in sync (§3, step 6). Not called on a variant. |
| `PATCH /modules/bulk-update` | Routed through the same diff-into-patch interception, per row. |
| `POST /modules/add-from-actuals` | Creates **variant-local** rows (`origin_base_id = NULL`), like any other add. |

## 5. UI

- **Scenarios page** — "Create Variant of…" beside Copy; the scenario list shows lineage
  (`↳ variant of 2026 Base`); an **Overrides panel** listing the diff, each line revertible.
- **Modules / Expenses on a variant** — every row badged **Inherited · Overridden · Local**. The
  edit modal shows the base value beside each overridden field with a per-field *revert*. Deleting
  an inherited row reads as "hide in this variant".
- **Review / Compare** — unchanged. They read `forecast_entries`, which a variant populates like
  any other scenario. (Compare gets better for free: the override set is the story it's trying
  to tell.)

## 6. Edge cases and the policy for each

| Case | Policy |
|---|---|
| Base **renames** a module the variant overrides | Overrides key on the base id ⇒ survives. Sync renames the variant's row too, unless the name is itself overridden. |
| Base **deletes** a module the variant overrides | The override cascades away; the variant's row becomes **variant-local** (`origin_base_id` → NULL) rather than vanishing. The base-delete route warns, listing affected variants. |
| Delete the **base scenario** | `ON DELETE RESTRICT` — detach or delete the variants first. `DELETE /scenarios/byname/:name` must say so; today an FK violation there would surface as a bare 500. |
| **Copy** a variant | A **detached snapshot** — the copy materializes the variant's resolved rows and has no parent. Stated so nobody assumes lineage survives a copy. |
| **Variant of a variant** | Rejected. One level only until there is a reason otherwise. `adopt-variant` is the one route that can set a parent after creation, so it also guards against a **cycle** (adopting A under B when B is already a variant of A). |
| Sweep-priority / sweep-target **collision** after a patch | Resolved in sync (§3 step 6 — a patched rank displaces the inherited holder), then validated. Fails loudly, never mid-build. |
| Empty-name module (live: ids 251/271) | Id-keying handles it. Name-keying would not — this is why. |
| `forecast_entries` | Never synced. Outputs are regenerated per scenario, as today. |

## 7. Tests

- **Parity:** a variant with zero overrides builds `forecast_entries` **byte-identical** to a
  deep copy of the base. (Also the cheapest proof that sync didn't drop a column.)
- **Carry-through:** override field A on module M; change field B on M *in the base*; B carries,
  A stays pinned.
- **Idempotence:** `sync(sync(x)) == sync(x)`, and surrogate ids are unchanged across syncs.
- **Column coverage:** every non-excluded column of `forecast_modules` /
  `forecast_income_expense` appears in the synced row — derived from `information_schema`, so a
  future migration cannot silently regress it.
- Tombstone, variant-local add, sweep-priority collision, base-delete cascade.
- **No silent overwrite:** every bypass write path (§4) either intercepts or refuses on a
  variant — a test per path asserts the edit survives the next sync, or was rejected outright.

## 8. Migration

**039** — `forecast_scenarios.parent_scenario_id`; `origin_base_id` on `forecast_modules` and
`forecast_income_expense` (+ `UNIQUE(scenario_id, origin_base_id)`); the
`forecast_scenario_overrides` table. All nullable/empty ⇒ **existing scenarios are unaffected**;
a scenario with no parent behaves exactly as it does today.

"2026 Upside" is converted with `adopt-variant` once the diff is reviewed.

---

## 9. Post-release fixes

**v3.0.110 — one change showed as three (a `DATE` compared as an instant).** The owner changed a
single field on a variant (Growth 1.0 → 2.0) and the panel reported **three** overrides:
`base_date` and `income_pct` as well, both **byte-identical to the base**.

The module edit form sends `BaseDate` as `new Date(x).toISOString()` — **UTC** midnight — while
node-postgres parses a `DATE` column into a JS `Date` at **LOCAL** midnight. Same calendar day,
different epoch, so the equality check called it a change: every save on a variant wrote a phantom
`base_date` override, and a phantom `income_pct` one through its `effective_date`.

*An override that means nothing is worse than no override* — it claims the owner pinned a value they
never touched, and the override set is supposed to **be** the variant's definition. Two changes:

1. These columns are **calendar days** — no time, no zone — so they are compared as days, reading a
   `Date`'s **local** components (the zone node-postgres built it in).
2. Sync now **prunes** patch keys that no longer differ from the base. That self-heals the phantoms
   already written (prod's "2026 Upside" carried two), and it also catches the case where the *base*
   later changes to match an override — which no write path would otherwise notice.

Panel, per owner feedback: the revert control is an **X** (the circular arrow read as "refresh"), and
each override renders as a table — **Field | \<base name\> | This variant** — labelled with the name
from the edit form ("Growth (x Inflation)"), not the column (`growth_rate`).

Tests: a **no-op save writes NO override**, and sync prunes a key equal to base.
