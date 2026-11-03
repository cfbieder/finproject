# CR098 — Budget builder: next year's budget from this year's Latest Estimate — IN-PROGRESS (P0–P2 live)

**Status:** IN-PROGRESS — P0 + P1 + P2 **LIVE v3.77.0** (2026-10-30, §9). **Rev 3 (§10, budget variants): P3a (V1–V4, V7, V8; migration 085) is **LIVE v3.78.0** (2026-11-02, §10.9); P3b (V5, the comparison) is **LIVE v3.79.0** (2026-11-03, §10.10); P3c (V6) is not built.** The CR closes when the first real 2027 publish is done **and** V1–V5 have shipped, with anything cut listed on the roadmap (§10.7). Take a manual prod backup the day of that publish (§6). Planned 2026-10-15, two-pass reviewed: pass 1 *revise* → rev 2; pass 2 **GO** with four conditions, all written in (§8). ⚠️ Do not build [CR095](cr-095-forecast-spend-currency-share.md) (same FX area) at the same time.
**Track:** v3 · **Migrations:** 084 (`084_budget_builder.sql`, six tables) · 085 (`085_budget_build_variants.sql`, rev 3)
**Depends on:** [CR083](cr-083-budget-latest-estimate.md) (the Latest Estimate, and its §11.4 list of
what a seed must solve first) · [CR075](cr-075-base-year-is-the-budget.md) (the base year IS the
budget) · [CR064](cr-064-forecast-annual-close-and-assumptions.md) P2 (the annual close, live v3.76.0)
**Supersedes:** CR083 P2 "seed next year's budget from an LE" (moved to the backlog 2026-09-28 as
"not yet specified enough to schedule"). This CR is that specification.

**⏰ Needed by mid-December 2026.** At the January 2027 close, `2026 Base` becomes `2027 Base`
with `PeriodStart` 2028, and by CR075 its base year — the year that seeds the sweep's opening cash
for all 36 forecast years — is the **2027 budget**. Today 2027 holds 12 rows.

---

## 1. The ask, and the decisions already taken

Owner, 2026-10-15: *"a tool to help build next year's budget based upon current full year forecast
as base — first in total for year, then help split by month."* "Current full year forecast" is the
Latest Estimate (CR083): it is per category, which is the grain a budget is set at; the forecast
works in coarser FC lines.

Ten design questions were put to the owner one at a time before any drafting (2026-10-15):

| # | question | decision |
|---|---|---|
| 1 | What the builder starts from | The latest **finalised** LE's **full-year figure** per category (not its actual / estimate halves) |
| 2 | This year's one-offs | A **per-category flag**, remembered between years: **Recurring** (carried and inflated) · **One-off** (starts at 0) · **Fixed** (typed annual amount) |
| 3 | Inflation for Recurring | The base forecast scenario's rate for the budget year, with a **per-category override** |
| 4 | Currency | Lines stay in their **local currency** and are inflated there; USD at the **base scenario's FX assumption** for the budget year |
| 5 | Month split | The pattern of the **last 12 completed actual months**, re-scaled; a category with ≥ ~80% of its spend in one month is an annual payment placed in that month; overridable (even, or a chosen month) |
| 6 | Write path | The builder's **own draft**, then **Publish**: preview, one transaction, **un-publish** restores what was there |
| 7 | Rows already in the target year | **Replaced** — the preview lists every row that will be deleted |
| 8 | Grain | **Category × account**, as the current budget is |
| 9 | Income | The **same flags** as expenses |
| 10 | Account split (the LE has none — §2) | The **last 12 completed months' actuals** per category × account, the same source as the month split; fallback the current year's budget split |

## 2. Measured (prod, 2026-10-15)

- **The LE has no account dimension.** All 806 lines of LE-09-26 have `account_id` NULL. Hence
  decision 10.
- **The LE's unit is category × currency.** 41 of its 94 categories carry more than one currency
  (`budget_le_lines.currency`); the 2026 budget has 11 such categories. Decision 4 keeps them apart.
- **The 2026 budget is 793 rows over 85 categories and 131 category × account pairs**; 761 carry an
  account, 32 do not; 26 categories sit on more than one account.
- **Versions are not a safe separator.** 2026 holds 662 rows in version 2 and 131 with
  `version_id` NULL. CR083 §7 recorded the readers as version-blind; ten server files read
  `budget_entries` (`services/budget.js`, `reports.js`, `budgetLe.js`, `forecast/crud.js`,
  repositories `budget.js`, `budgetLe.js`, `budgetFxRates.js`, `fcLines.js`, routes `budget.js`,
  `util/fx.js`). A second version for 2027 would be summed with the first.
- **`budget_entries` has no unique key on its grain** — only the primary key and four single-column
  indexes. A re-run that inserts instead of replacing duplicates silently (CR083 §11.4.2).
- **`fcLines.findAll` is year-blind** (`repositories/fcLines.js:44-45`: `AND ($1::int IS NULL OR
  be.budget_year = $1)`) — CR083 §11.4 records it as reachable with `budgetYear` absent. With 12
  rows in 2027 it is noise; with ~800 it is a wrong number.
- **The target year today:** 2027 holds 12 rows, one item — a −300/month instalment on
  `Purchases - Chris`, entered 2026-01-29 into version 3 (`2027 / Original`).
- **The forecast's own rates:** `2026 Base` carries one inflation entry (2026: 2.5%) and one FX
  entry (2026: EUR 0.86, PLN 3.9 per USD); the engine carries the last entry forward
  (`fcbuilder-setup.js`, which reads `Rates.PLN ?? Rates.USDPLN`). LE-09-26's lines are
  604 `ACTUAL`, 135 `CARRY`, 67 `MANUAL`.
- **All 67 `MANUAL` LE lines are typed in USD**, including for categories spent in PLN
  (`Utilities - Gas`: PLN actuals plus a USD manual line) — so one category's year can sit on two
  currency lines, and 8 of LE-09-26's 145 (category, currency) lines (−4,050 USD) have neither window
  actuals nor 2026 budget rows. §3.3 gives them an even split.
- **The budget has its own FX table.** `budget_fx_rates` holds a rate per currency per month (2026
  PLN 3.55–3.79) and has **no 2027 rows**. `repositories/budget.js` `create()` prices every new
  non-USD row from it, and *Recalculate* (`routes/budget.js:147` → `budgetFxRates.js`) rewrites
  `base_amount` from it — so §3.4 must write the target year's rates, or one later edit puts the
  base year on two FX rates.
- **Readers, completed:** the view `v_budget_vs_actual` also reads `budget_entries`, and
  `compareToActual` filters by version (CR083 §7); every other reader sums all versions.

## 3. Design

### 3.1 The unit: one line per (category, currency) of the chosen LE

A build names a **target year** (the LE's year + 1), a **source LE** (the latest finalised LE for
the current year; a draft is never offered) and a **scenario** (whose inflation and FX it uses —
default: the base scenario whose base year is the LE's year, i.e. `2026 Base`). Each build line is
one (category, currency) of the LE with its full-year local amount `le_fy = Σ amount` over the
LE's twelve months. The LE's own `excluded_category_ids` are honoured (transfers, unrealised G/L —
CR083 §2); a category the LE lacks is not invented. A line keyed on a **non-leaf** category
(LE-09-26: `Car Expense`, `Children - Anna`) cannot be published as it is — the base year's leaves CTE
(`crud.js`) cannot see it, so it would be budget the forecast silently leaves out. The preview marks
it **"not in the base year"** and Publish is refused until the owner moves it to a leaf or drops it.

### 3.2 The annual figure — layers, each shown

| column | rule |
|---|---|
| LE FY | from 3.1 |
| Policy | the category's remembered flag (§3.5); new categories default to **Recurring** |
| Inflation % | Recurring only: the scenario's rate for the target year via the engine's own `rateAtYear` (`fcbuilder-setup.js`, exported for this — `loadScenarioConfig`'s `[0]` is the target year only when `PeriodStart` equals it), so a carried-forward rate is the engine's; or the category's override |
| **Annual** | Recurring: `le_fy × (1 + r)` · One-off: `0` · Fixed: the typed amount |
| vs LE · vs this year's budget | deltas, for reading only |

Totals by currency and in USD at the scenario's FX for the target year, resolved the same way.
**Each rate shows where it came from** — e.g. *"2.5% · carried forward from 2026"*, *"PLN 3.90 ·
carried forward from 2026"* (`2026 Base` holds only 2026 entries; the budget's own 2026 PLN rates ran
3.55–3.79, so 3.9 reads PLN spend ~5% smaller in USD) — with a prompt to set the target year's
assumptions on Forecast Scenarios before building. Decision 4 stands; this only makes it visible. The
engine knows PLN and EUR only; a line in any other currency is **refused by name**, never valued 1:1.
A Fixed category gets **one typed amount per currency line** (the policy is per category, the amount
per line).

### 3.3 Splitting the annual figure — accounts, then months, from one source

**Window:** the twelve months ending at the source LE's `actual_through` (for LE-09-26:
Sep 2025 – Aug 2026). That date is the LE's own declaration of what is actual; the builder does not
re-derive "closed" (CR083 §1.2 explains why it cannot).

For each line, take actual transactions in that window with **`category_id` = the line's category**
(not its leaves — the LE keys on the transaction's own category, `budgetLe.js`) and **`t.currency` =
the line's currency** (the LE's definition; it equals the account currency on prod today), grouped
by account × month:

1. **Accounts:** each account's share of the window total. A line with no window actuals, or an
   account share whose sign opposes the line's, falls back to the **current year's budget** split for
   that (category, currency); with neither, one row with no account (as 32 of 2026's rows already
   are).
2. **Months:** the window's monthly pattern per account, re-scaled to that account's share of the
   annual. **Even twelfths** instead when the line has no window actuals (the 8 lines in §2), or when
   any of its months carries the opposite sign to the line (13 of 308 account-level lines on
   LE-09-26 — re-scaling one of them amplified a month more than 3×). **Lump rule:** if one month
   holds ≥ 80% of the line's **absolute** monthly amounts, the whole line goes in that month (an
   annual payment), keeping its account split within that month. Measured on net totals instead, the
   rule lumped 32 of 137 lines and two exceeded 100%; the threshold is measured again on absolutes at
   build. Override per line: **even**, or **one chosen month**.
3. **Cents:** each (account, month) cell is rounded to cents in local currency; the remainder goes
   to the cell **largest by absolute value**, so every line sums **exactly** to its annual figure in
   local currency. USD is converted per cell and is not forced to a total.

The preview shows each line's 12-month row; nothing is written until Publish.

### 3.4 Publish and un-publish — replace the year, keep a way back

**Publish**, in one transaction:
1. Take the builder's advisory lock **and** `LOCK TABLE budget_entries, budget_fx_rates IN SHARE ROW
   EXCLUSIVE MODE` (the Budget page does not take the advisory lock); refuse if anything changed
   since the preview. The token is two checksums: `md5(string_agg(row_to_json(be)::text, '|' ORDER
   BY be.id))` over the year's `budget_entries` — every column, `updated_at` included, so a
   *Recalculate* counts — **and** an md5 of the cells the preview showed, so a line edit or a
   scenario-rate change between preview and confirm is refused, not silently published.
2. Record a **publish event** and copy **every** `budget_entries` row of the target year, in full,
   into a snapshot owned by that event (not by the build — see below).
3. Delete them all — every version, NULL versions included, so the year has one set of rows after.
4. Insert the build's cells into the year's active version (create `«year» / Built` if the year has
   none), with `base_amount = ROUND(amount / rate, 2)`, `rate` = units of the currency **per USD**
   from the scenario for the target year (the engine's convention, `Rates.PLN = 3.9`).
4a. **Write the year's `budget_fx_rates`** — 12 months × each non-USD currency at that same rate —
   after snapshotting any rows already there. Without it, the next row added on the budget page, or a
   *Recalculate*, prices at a different rate and the base year sits on two.
5. Mark the build published; any earlier published build of the same year becomes superseded.

**Un-publish**, in one transaction, undoes the year's **newest publish event** (only the live build
offers it): refuse if the year's rows differ from what that publish wrote (same checksum; edits since
would be lost — say so); otherwise delete them and restore the event's snapshot
exactly — re-inserted through `jsonb_populate_record(NULL::budget_entries, row)` with the original
`id`, `created_at`, `updated_at` and `version_id` (NULLs included; nothing has a foreign key into
`budget_entries`, so reusing ids is safe), delete a `«year» / Built` version the publish created, and
restore the year's `budget_fx_rates` snapshot. The build the previous event put live is live again,
so repeated un-publishes walk back through every publish to the pre-builder budget. ⚠️ **After the annual close has run on that year**,
un-publishing moves a base scenario's base year: the confirm names the scenarios whose base year is
the target year and says each needs a regenerate.

The preview lists what will be deleted — by category, with counts — so the 12 instalments in 2027
are visible before they go. Re-publishing a new build of the same year is publish again (it
snapshots what is there then). **Publishes stack**, which is why the snapshot belongs to the event:
keyed by build, *publish v1 → publish v2 → restore v1* overwrote v1's only copy of the pre-builder
budget (found at code review, §9). One open draft per target year, as the LE does (rev 3, §10, plans to lift this).

### 3.4a Iterations — numbered builds, start from one, restore one (owner, 2026-10-16)

Every build of a year is kept and numbered — **2027 v1, v2, v3 …** — with an optional note
("after Anna's school fees"), and its status (draft · published · superseded · unpublished). Only
one is ever live (§4: a second live version would be summed with the first).

- **Start from build…** — a new draft copies an earlier build's choices: per-line policy, Fixed
  amounts, inflation overrides and split overrides. Its LE figures come from the LE the new draft
  names (default: the copied build's own LE, or a newer finalised one). A copied line whose
  (category, currency) the new LE lacks is listed as **"not in this LE"** — kept if Fixed, dropped
  otherwise, never silently.
- **Restore build…** — re-publishes an earlier build **exactly as it was published**, from its stored
  cells (§3.5), through the same preview, checksum and snapshot as any publish (§3.4). Restoring is
  a publish, so it can itself be un-published.

Un-publish undoes the most recent publish and hands *live* back to the build before it; repeating it walks further back. *Restore* jumps to any build directly.

### 3.5 Storage (one migration)

- `budget_category_policy` — `category_id` PK, `policy` (`recurring` | `one_off` | `fixed`),
  `inflation_override_pct` NULL, `split_override` (`auto` | `even` | `month`), `split_month` NULL,
  `updated_at`. This is what "remembered between years" means: the next build starts from it.
- `budget_builds` — `id`, `target_year`, `source_le_id`, `scenario_name`, `status`
  (`draft` | `published` | `superseded` | `unpublished` — `VARCHAR` + `CHECK`, not a Postgres enum,
  per the migration-070 rule), `published_at`, `build_no` (1, 2, 3 … per `target_year`, unique with it), `parent_build_id` NULL (the build it
  started from), `note` NULL.
- `budget_build_lines` — `build_id`, `category_id`, `currency`, `le_fy`, `policy`,
  `fixed_amount`, `inflation_pct`, `annual_amount`, `split_method`, `split_month`; unique on
  (`build_id`, `category_id`, `currency`).
- `budget_build_publishes` — one row per publish or restore, never deleted: `build_id`,
  `target_year`, `created_version_id` NULL (the `Built` version this publish made, deleted by its
  un-publish), `checksum_after`, `published_at`, `undone_at` NULL. The newest row with `undone_at`
  NULL is the one Un-publish reverses.
- `budget_build_snapshot` — the replaced rows of a publish, verbatim (`publish_id`, `kind`
  (`entry` | `fx_rate`), the row as `jsonb`).
- `budget_build_cells` — what a publish wrote: `build_id`, `category_id`, `account_id` NULL,
  `currency`, `month`, `amount`, `base_amount`, `fx_rate`. Written in the publish transaction; this is
  what *Restore* re-publishes. Recomputing instead would not be exact — the actuals window can change
  under a late recategorisation.

In a draft, cells are computed for the preview and not stored.

### 3.6 Prerequisites (P0, before any row is published)

1. **`fcLines.findAll`'s year-blind sum** — its callers are `routes/fcLines.js:17` and `:211`;
   `:211` (`review-structure`) reads names only, and `FCModulesEdit.jsx` takes its totals from the
   year-scoped call. Pass a year (or drop the per-category `budget_total` there), with a test over two
   years of rows. Cheap.
2. **A test that a year holds one version after publish**, since all readers but `compareToActual`
   sum every version.

### 3.7 The screen

`/budget-builder` under Budgeting. Pick target year → source LE (finalised only, newest first) →
scenario. The grid is one row per (category, currency): LE FY · policy · inflation % · annual ·
vs LE · vs this year's budget; a row opens its 12-month split. Footer totals per currency and USD.
Publish opens the preview (rows to delete, rows to insert, USD totals before / after) with one
confirm. Colour means sign; both themes rendered before shipping.

## 4. Non-goals

- The LE's actual / estimate halves (decision 1).
- Income from the forecast's own projection (decision 9 chose the same flags).
- Keeping pre-existing rows as commitments (decision 7 chose replace).
- More than one budget version per year, mobile, and editing published cells from the builder —
  published rows are ordinary budget rows, edited on the existing budget pages.
  Rev 3's variants (§10) do not change the first of these: they stay in the builder's tables, and the
  year still holds one version's rows.

## 5. Verification

On a prod dump in a throwaway database (the CR064 P2 method):
1. Build 2027 from the latest finalised LE with `2026 Base`; every line's 12 cells sum to its annual
   figure to the cent **in local currency**; Σ annual per currency equals the published
   `budget_entries` total per currency; the year's `budget_fx_rates` hold the scenario rate in all 12
   months, and adding one PLN row on the budget page prices at it.
2. Recurring = `le_fy × (1 + r)` with `r` read back from the engine's rate builder for 2027.
3. Publish: the year holds only the build's rows, in one version. Then, after a regenerate on the
   copy, **every FC line's base-year value equals the builder's published USD for that line, to the
   cent** (CR075's standard: per line, 0 mismatches), with any difference reported by name —
   excluded and parent categories included. A matching total can hide money on the wrong line.
4. Un-publish: the 12 instalment rows return byte-identical (`id`, version 3, timestamps) and the
   year's FX rows are as before; a publish after an edit to the year is refused, and so is an
   un-publish after an edit or a *Recalculate*.
4a. Iterations: publish v1, then v2 from *Start from build* (one Fixed amount changed) — v1 is
   superseded and v2 differs from it in that line only; *Restore* v1 puts back v1's cells byte-for-byte
   (amount, base_amount, account, month); un-publishing that restore returns v2.
5. A scenario with `PeriodStart` 2028 (a forward annual close, clock set to January 2027 as in
   CR064 P2's check) generates from the published 2027 budget.
6. Rendered in both themes.

## 6. Phasing

| phase | scope | gate |
|---|---|---|
| **P0** | §3.6 prerequisites | Before anything publishes ~800 rows into a year |
| **P1** | Draft, policy, inflation, FX, annual grid — preview only, nothing published | Usable early: the annual totals are the decision |
| **P2** | Account and month split, Publish / Un-publish, numbered builds with *Start from* and *Restore* (§3.4a) | Done by mid-December 2026 |

**Prod path.** Migration 084 is applied to prod **before** the code deploys
(`deploy-to-production.sh` Step 2b). The **first real Publish** happens only after a manual prod backup
taken that day — publishing may come weeks after the deploy, so the deploy-time backup does not cover
it.

**Fallback.** If P2 is not on prod by **2026-12-10**, the owner types P1's annual figures onto the
existing budget pages for 2027, and P2 ships after the close. Within P2, the lump rule and per-line
month overrides are the parts to cut first (even twelfths is acceptable: the forecast reads annual
figures by FC line). *Start from* and *Restore* (§3.4a) are cut before those — January needs one
good publish, not its history — but `budget_build_cells` and `build_no` ship regardless, so the
history exists from the first publish and the two actions can follow later. Un-publish is not cut —
it is the undo for an 800-row replace.

**Rev 3.** P2 is live, so this fallback's cut order is history; §10.7 governs what slips now.

| phase | scope | gate |
|---|---|---|
| **P3a** | V1–V3 + V7 (migration 085, including V8's columns), V4, V8 | Live on prod by about 2026-11-20 |
| **P3b** | V5 (a) totals, then (b) any two | By the 2026-12-03 freeze, else after the publish |
| **P3c** | V6 | Before the first swap over a hand edit |

## 7. Decided at review, not left open

- **Default scenario** = the base whose base year is the LE's year (`2026 Base`); it is a dropdown.
- **The 80% threshold** is re-measured on absolute amounts at build: on the prod dump (2026-10-30), 29 of the 132 lines split from actuals take the lump (§9).
- **The 67 USD `MANUAL` LE lines** are kept as typed (decision 4); folding them into a category's main
  currency is a backlog idea, not this CR.

## 8. Review log

- **Pass 1 — `cr-technical-reviewer`, 2026-10-15: *revise*, 2 blocking.** Every §2 figure re-checked
  on prod and confirmed. **B1** the budget's own `budget_fx_rates` would re-price later edits and
  *Recalculate* at a different rate than the publish → §3.4 step 4a writes and snapshots the year's
  rates, FX direction stated. **B2** no month split for lines without actuals (8 lines, from USD
  `MANUAL` LE lines) → even twelfths, fact recorded in §2. Non-blocking, all taken: match the
  transaction's own category and `t.currency`; parent-category lines flagged "not in the base year";
  the 80% rule on absolutes and opposite-sign months split evenly (answers the sign-flip question);
  the checksum defined; restore fidelity (`jsonb_populate_record`, ids, NULL versions, the created
  version, FX rows); the reader list completed and P0's consumers named; `rateAtYear` exported, PLN
  and EUR only; rounding by absolute size, USD not forced; lump keeps its account split; Fixed is
  typed per currency line; un-publish after the close warns of a regenerate; `VARCHAR` + `CHECK`.
- **Pass 2 — `cr-signoff-pm`, 2026-10-15: GO**, on the critical path to a correct January close; P1
  delivers value even if P2 slips. Conditions, all written in: (1) a parent-category line cannot be
  published as-is (§3.1); (2) verification per FC line to the cent, not one total (§5.3); (3) the prod
  path — migration first, a manual backup before the first real Publish (§6); (4) a fallback date,
  2026-12-10 (§6). Suggestions taken: rate provenance shown in the grid (§3.2); §7's questions decided
  rather than left open; CR095 not built concurrently.
- **Owner addition, 2026-10-16 (after pass 2):** numbered builds per year, *Start from build* and
  *Restore build* (§3.4a), with `budget_build_cells` storing what each publish wrote so a restore is
  exact. Not re-reviewed: it reuses §3.4's publish path unchanged and adds UI over stored rows; the
  one-live-version non-goal stands. In the P2 cut order these go first (§6).

## 9. As built (2026-10-30)

**Code.** Migration `084_budget_builder.sql` (six tables, §3.5); `services/budgetBuilder.js` (build,
split, publish, un-publish, restore); `/api/v2/budget-builder` (`v2/routes/budgetBuilder.js`); page
`/budget-builder` under Budgeting (`BudgetBuilder.jsx`). P0: `fcLines.findAll(year)` sums one year and
returns no `budget_total` without one (test over two years). Tests: `budgetBuilder.test.js` (split
arithmetic + the full DB cycle, including the stack walk-back and an edit between preview and
confirm), green on dev and on a fresh database.

**Verified on a prod dump (2026-10-30)**, §5:
- The 2027 draft from LE-09-26 / `2026 Base`: 145 lines; inflation 2.5%, PLN 3.9, EUR 0.86, all
  *carried forward from 2026* (the scenario sets no 2027 rates — the grid says so); every line's
  months sum to its annual figure exactly.
- Split sources: 132 lines from actuals (29 lumped into one month), 2 from the 2026 budget, 9 even.
- Publish: 1,499 rows in one version; per-currency totals equal the build's; **per FC line 16/16
  match to the cent, 0 mismatches**. `Other Inc` (EUR + USD, USD 860) is on no forecast line — the
  publish dialog now names it.
- The stack: v1 → v2 (one Fixed line) → restore v1 (exact) → un-publish ×3 returns v2, then v1, then
  the original 12 instalments **byte-for-byte** (entries, FX rates, versions).
- An edit to the year after a publish makes un-publish refuse; a change between preview and confirm
  makes publish refuse. UI: full publish / un-publish / restore flow in both themes, no page errors.

**Found and fixed at code review, before release.** (1) Snapshots were keyed by build, so a restore
overwrote the only copy of the pre-builder budget → `budget_build_publishes`, snapshots per event.
(2) Un-publish left the previous build marked superseded → it is made live again. (3) A restore
nulled the build's record of the version it had created (a leak) → per event. (4) The preview token
covered only the year's rows → it also hashes the cells. (5) A Budget-page write could land between
snapshot and delete → table lock. Since 084 had reached only dev (applied there by mistake through
`migrate.js --dry`, which is not the dry-run flag — that is `--dry-run`), the file was amended and dev
rolled back and re-applied, rather than adding an 085. UI review: errors now show inside the open
dialog, blockers are de-duplicated, Enter saves and the wheel no longer changes an amount, a refused
edit reverts, a Fixed amount opposite in sign to the estimate is flagged.

**Grid order (owner, v3.77.1, 2026-11-01).** The grid reads in Chart of Accounts order with group headers
(`groupLines`, over `getNestedTree`, the same order as the LE and the reports), and an *In USD* column
carries the group subtotals, because a group mixes currencies.

**Known limits, not fixed.** One account whose actuals run against the category's sign makes that
line fall back to an even split with no account (the whole grid fails validation, not just that
account). A restore writes stored cells even if a category or account was deactivated since. The
radius values on the page's own inputs (4px / 6px) are below the smallest `--radius-*` token (10px).

## 10. Rev 3 — budget variants (PLANNED 2026-11-01, not built)

### 10.1 The ask and the decisions

Owner, 2026-11-01: develop several variants of a year's budget, copy one to make another, choose which
is official, keep the earlier ones, and be able to swap the official budget for another existing
variant or a new draft later. Decided one question at a time, the same day:

| # | question | decision |
|---|---|---|
| 1 | Scope before the first real publish | All of V1–V7 below |
| 2 | Swapping over hand edits to the official budget | **Warn only**; never block, and no "save as variant" |
| 3 | The other drafts once one is published | **Stay open drafts** — editable and publishable; no freeze |
| 4 | Removing a variant | **Delete, with a clear confirmation**; no archive |
| 5 | The comparison | **Totals for every variant, plus any two line by line** with a difference column |
| 6 | Spreading a line over several chosen months (asked 2026-11-02) | **Month weights** (V8): proportions, not picked months or typed amounts |

**A variant is a build.** §3.4a already numbers builds, copies with *Start from* and swaps with
*Publish* / *Restore*; only the one-draft rule stops them being used side by side. Reports need no
change and gain no selector: they read `budget_entries`, which holds only what was published. The
§4 non-goal stands — §2 measured why a second `budget_versions` row is unsafe (ten version-blind
reader files; 131 of the 793 rows for 2026 have `version_id` NULL).

### 10.2 What is true today (read from the code, 2026-11-01; prod has 0 builds)

- A second draft is refused twice: `createBuild` (409) and the partial unique index
  `bb_one_draft_per_year`. `budgetBuilder.test.js:144` asserts the refusal.
- `budget_builds.parent_build_id` has no `ON DELETE` action and `deleteDraft` is a plain delete. A
  same-year parent is never a draft today, so this is nearly unreachable (`createBuild` does not compare
  the parent's year, so a 2027 draft can parent a 2028 one); with V1 it fails on a draft that has copies.
- `updateLine` writes `budget_category_policy` on **every line edit**, so a discarded experiment
  changes what the next from-scratch draft starts from. The table's key is `category_id` while a
  line is (category, currency); 42 categories in LE-10-26 carry more than one currency (149 lines),
  so the last edit wins.
- `getBuild` calls `scenarioRates` for **every** build, including stored ones, and `publish` calls
  `getBuild`. `budget_builds.scenario_name` is plain text and `renameScenario` does not update it. So
  after a rename or delete, `scenarioRates` throws and the build cannot be opened, previewed or
  restored, although a restore needs none of those rates. **Not forced by the annual close:**
  `annualClose.js` mints a copy and `2026 Base` survives. A manual rename or delete reaches it, and so
  does a `PUT` of the assumptions document that empties a live scenario's inflation rows, so V7 keys on
  **rates unavailable**, not on the scenario being gone.
- `getBuild` values a stored build's USD at **today's** scenario rate (`annual / fx.rate`), not the
  stored `base_amount`, so a published build's displayed USD can move after publish.
- `setNote` and `PATCH /:id` exist for every status; the page can set a note only on a new draft.

### 10.3 Changes

- **V1 — many drafts.** Drop the `createBuild` check and the index; change the test to expect two
  drafts. `bb_one_published_per_year` stays. The page opens on the newest year's live build, else
  that year's newest, on load and after a delete. **Choosing a same-year build in *Start from* prefills
  its LE and its scenario** (if that scenario still has rates; `listSources` adds `source_le_id`), so a
  copy is a copy: today the form keeps the newest LE, and once LE-11-26 is finalised a "copy" of a build
  on LE-10-26 would silently change every line. Cross-year *Start from* stays. `build_no` stays `MAX + 1` under `bb_year_no_uniq`: a concurrent
  create fails rather than duplicates (one owner, button disabled while busy).
- **V2 — safe delete.** `parent_build_id` → `ON DELETE SET NULL`. The confirm names the build and says
  it is permanent. **Any build ever published stays undeletable** — superseded and un-published ones
  included, because the publish history and its walk-back point at them — so those stay in the list for
  good. A copy holds its own line settings, so it loses only the link. A deleted draft's `build_no` can
  be reused; a published number never is.
- **V3 — remembered settings on publish.** `updateLine` no longer writes `budget_category_policy`;
  `publish` writes it from the build's lines, for a draft and a restore alike, in the same
  transaction. A category with several currency lines takes the line with the largest **`|le_fy|` in
  USD**, ties broken by currency. Ranking the estimate, not the result, matters: a One-off's annual is
  always 0, so ranking by annual would almost never remember One-off (LE-10-26: `Financial Income -
  Barkeria` PLN 128,084.62 ≈ USD 35,131 beside USD 21,000), and next year's draft would seed the large
  line as Recurring at full value. USD comes from `view.rates` for a draft and `published_rates.fx` for
  a restore; a build with NULL `published_rates` uses its cells' `fx_rate`. Un-publish does not rewind
  the table: it seeds future drafts only. Consequence: once V3 is live and before the first publish, a
  from-scratch draft starts all Recurring, unless draft edits on v3.77.0 already wrote policy rows (the
  table is empty on prod today) — *Start from* is how choices carry between variants.
- **V4 — naming.** The page's note becomes an editable **Name** on any build, over the existing PATCH.
- **V5 — comparison.** Read-only, on the builder page. (a) Every build of the year: name, status, LE,
  scenario, USD total. (b) Any two: annual per (category, currency), merged in JS from the `getBuild` shape — never a SQL
  join on `annual_amount`, which is 0 for every draft — with local amounts and USD for each and a USD
  difference. A line in one build only shows as absent, and counts as 0 in the difference, so the column
  adds up to the totals' difference. A draft's USD is rounded per line and a stored build's per cell, so
  identical variants can differ by cents: round to display precision before applying the sign colour,
  so no red "-0".
  Each side uses its own scenario's rates, and the rates are shown because two variants can differ on
  them. The official build is a side **as published**; when V6's check fires, it is labelled as edited
  since. Annual only — the month split stays on each line. A draft whose rates are unavailable (V7)
  shows no USD figure rather than failing the page; each build is loaded under its own error handling,
  so one bad build cannot fail the list. `GET /compare` is declared before `/:id`. The comparison is its
  own component under `frontend/src/features/`, with the arithmetic a pure tested function, not more
  of the 493-line page. Colour means sign; both themes rendered.
- **V6 — hand-edit warning.** `previewPublish` compares the live event's `checksum_after` with the
  year's current checksum. When they differ, the dialog says the official budget was edited after
  its last publish and that those edits are replaced; Un-publish can return them only while the year
  is not edited again. It never blocks. With no live event the existing "rows to delete" list already
  covers it. Row counts use the **event's** transaction timestamp: rows the event wrote have `created_at
  = event.published_at`; updated = `updated_at > event.published_at`; missing = the build's cells minus
  rows the event wrote. Not the `note` marker (owner-editable) and not `budget_builds.published_at`
  (overwritten and left stale). `budget_fx_rates` with `updated_at` after the event also triggers the
  warning, since the checksum covers entries only. A direct-SQL edit fires the checksum and gets the
  sentence without a count. The preview reads `liveEvent` without `FOR UPDATE` (a read path takes no lock).
  **The un-publish dialog gains the same check and `readers`**: it shows the "edited since" refusal up
  front and names the scenarios needing a regenerate, which §3.4 promised and the page does not do.
- **V7 — builds outlive their scenario.** Stored builds stop reading live rates: a new column
  `budget_builds.published_rates JSONB`, written at a build's first publish, holds what the view
  displays (inflation and FX with provenance); USD comes from `budget_build_cells.base_amount`. This
  also fixes the moving-USD fact in §10.2. It is written only at a draft's first publish, never on a
  restore: the cells are frozen, so rewriting would show today's rates beside old cells. A NULL value
  (a build published before 085) derives `fx` from `budget_build_cells.fx_rate` with inflation and
  provenance null, keeping the `rates.fx` object the page dereferences. `effectiveInflationPct` reads the
  stored rates; the "set them on Forecast Scenarios" banner is draft-only; `thisYearBudget` stays live
  by design. Stored cells are grouped into the preview's `lines`, so *Show month split* works on a stored
  build (today it returns none and the page keeps asking). A restore needs only stored cells.
  `renameScenario` updates `budget_builds.scenario_name` in its transaction. Scenario delete is not
  blocked by builds.
  **A draft whose rates are unavailable:** `scenarioRates` returns `{ inflation: null, fx: { USD: {rate:
  1}, PLN: null, EUR: null } }` instead of throwing. Fixed and overridden lines still compute; a Recurring
  line with no override has `annual`, `annualUsd`, `vsLe` and `vsThisYear` **null, not 0**, and `totals`
  and `usdTotal` are null if any contributing line is null, so no partial total reads as complete.
  **`publish()` itself refuses any null annual** — a server check, not only a preview blocker, because
  `splitLine(null)` writes no cells and the line would vanish, and the existing rate blocker tests only
  `fx[currency]`, which USD always passes. The blocker names the scenario and the missing rates. Lines stay
  editable, since `updateLine` reads no rates; *Start from* into a new draft with another scenario, or
  restoring the rates, is the way out. The page does not dereference `rates.inflation.rate` unguarded.

- **V8 — month weights.** A fourth month split, **custom**, beside *from actuals*, *even* and *one month*.
  On a custom line, opening it shows 12 boxes above its money row (choosing another split closes the row, and no other split shows them): blank means nothing in that month, and any
  non-negative numbers set the proportions (Mar 3, Aug 2 on 500,000 → 300,000 and 200,000; a 1 in four
  months → four equal payments). Weights, not amounts, because the annual still comes from the policy: a
  typed 300,000 / 200,000 lands exactly while the annual is 500,000 and rescales when it changes, so no
  total can disagree. The line's sign is applied by the split, so an expense also takes positive weights.
  At least one weight must be above zero, or the edit is refused. `splitLine` feeds them to the existing
  `allocate(accAmounts[i], weights)`, so each account keeps its share and the line sums exactly to its
  annual figure. **A single month's total can differ by cents when the line spans several accounts**,
  because each account rounds on its own. The lump rule does not apply to a custom line. *Start from*
  copies the weights. They are remembered per category under V3's rule, from the same winning line. Stored
  cells make a restore independent of them. The preview token already hashes the cells, so a weight edit
  after the preview is refused like any other.

### 10.4 Storage (migration 085, number to be claimed at build)

Fresh-DB-safe, 084 untouched: `DROP INDEX IF EXISTS bb_one_draft_per_year`; `DROP CONSTRAINT IF EXISTS
budget_builds_parent_build_id_fkey` and re-add it with `ON DELETE SET NULL`; `ADD COLUMN IF NOT EXISTS
published_rates JSONB`; V8's `split_weights NUMERIC(15,2)[]` on `budget_build_lines` and
`budget_category_policy` (length 12 when set), with `bbl_split_chk` and `bcp_split_chk` replaced to admit
`custom`, and a check that a custom split has weights. The rollback note says the index cannot return while a year has more than one
draft. v3.77.0 runs on the new schema (its own 409 check remains), so applying it to prod before the code
deploys, as §6, is safe. A build published before 085 takes V7's NULL path; prod has none today, but the
§10.7 fallback can create one. The CR097 worktree could also claim 085: check at commit time.

### 10.5 Accepted limits

- **A draft is not a frozen record** (decision 3). Its LE figure, policy, Fixed amount and scenario
  persist; its figures move with scenario rates and recategorised transactions, and the preview always
  shows current numbers. Only published builds hold exact figures.
- **A swap after the year starts rewrites budget-vs-actual for elapsed months.** Finalised LEs keep the
  budget they froze (migration 082); draft LEs and reports move; base scenarios need a regenerate, which
  the dialogs name (V6 adds this to Un-publish).
- **Reports do not name the variant.** The builder's **live** marker is the one place that says.
- **Restore ignores hand edits** (decision 2); nothing saves them as a build, because cells cannot hold
  row descriptions, day-of-month or category-less rows.
- **Published variants cannot be removed** (V2): decision 4's Delete applies to never-published drafts.

### 10.6 Verification

As §5, on a prod dump in a throwaway database, adding:
1. Three drafts of 2027, the third started from the second; editing the copy leaves the original's
   lines unchanged; deleting the second leaves the third's lines intact and its parent NULL.
2. Publish the first: the other two stay drafts and the year holds only its rows. Publish the third:
   the first is superseded with cells unchanged. Restore the first: byte-for-byte as §5.4a; the §5
   per-FC-line check still 0 mismatches after a publish that replaced another variant.
3. Line edits leave `budget_category_policy` untouched; publish writes it; a multi-currency category
   takes the deterministic line.
4. Rename and separately delete the scenario: superseded builds open, show stored USD and restore
   exactly; a rename updates `scenario_name`; a draft on a deleted scenario opens and refuses to publish.
5. After a scenario rate change, a superseded build's USD is unchanged and a draft's moves.
6. Hand-edit one budget row, delete another, *Recalculate*: the preview warns each time and does not
   block; with no edit there is no warning.
7. Comparison totals equal each build's own total; the line view shows one-sided lines as absent.
8. Custom weights on a line spanning two accounts: Mar 3, Aug 2 writes only those months at 3:2, each
   account keeps its share, and the line sums to its annual figure to the cent; changing a Fixed amount
   rescales them; *Start from* copies them; a restore after a weight edit in a later draft is unchanged.
9. Rendered in both themes.

**Automated, in `budgetBuilder.test.js`:** two drafts of a year; deleting a parent (V2 FK); V3's ranking
including a large One-off; an all-USD draft with no rates refusing to publish and writing nothing; V6's
counts after a publish, a restore and an un-publish hand-back; a pure test of the comparison arithmetic; `splitLine` with custom weights, including an expense and
an all-zero refusal.
In `forecast.renameScenario.test.js`, the rename of `scenario_name` (its fake throws on unknown SQL, so it
must be extended). The test at `:144` deletes its second draft, or the `:216` assertions break. Item 6's
*Recalculate* needs a seeded 2027 `exchange_rates` row, because 2027 has none and it returns 400.

### 10.7 Sequencing and dates

Not on the critical path: January needs one good publish, which the live code already does. Each stage
ships and is tagged on its own (§6). Order: V1–V3 + V7 → V8 + V4 + V5(a) → V5(b) → V6. V6 and V5's "edited since"
label must be live before the first swap over a hand edit, not before the first publish.

- **About 2026-11-20:** P3a on prod, leaving about three weeks of real use.
- **2026-12-03:** builder code freeze. No builder deploy between this and the first publish, so the publish
  is not the first use of fresh code. A comparison not live by then ships after it.
- **2026-12-10:** the first real publish, firm, from whatever is live. A later variant can replace it
  through the same path. The owner holds the first publish until then at the latest.

**Slips first:** V7's draft-without-rates paragraph falls back to a clear refusal naming the scenario,
while stored builds still stop reading live rates (raised with the owner if taken, and check first that
delete or *Start from* gets out of such a draft). **Slips second:** V5(b), which is deferred, not cut.
**Slips third:** V8's page and split; its columns still ship in 085, so no second migration follows.

**Before the publish.** `2026 Base` now carries 2027 rates, set by the owner on 2026-11-01. LE-10-26 and
LE-11-26 are finalised, and a from-scratch draft treats the −65,000 `Car Purchase/Sale` as Recurring until
it is flagged. A later LE is a deliberate change in the form, since *Start from* now keeps the parent's.
The owner's first draft (2027 v1, LE-11-26) had parent-category lines on `Car Expense` and `Children -
Anna` that blocked Publish; both were set to One-off on 2026-11-02, and the preview shows no blockers. After the freeze, re-run §5.3's
per-FC-line check on a fresh prod dump with the chosen draft: the 16/16 result was on LE-09-26 and
pre-rev-3 code. [CR095](cr-095-forecast-spend-currency-share.md) waits until rev 3 and the first publish
are done, because V7 changes `scenarioRates`.

### 10.9 As built — P3a (2026-11-02)

**Code.** Migration 085 (§10.4; its CHECK also refuses an empty, all-zero, negative or NULL-holding
weights array, tightened from "length 12" at `migration-reviewer`). `budgetBuilder.js`: many drafts, stored
builds read `published_rates` or their cells, null figures propagate, `policyLines` + `rememberPolicies`
at publish, `checkWeights`, custom in `splitLine`. `renameScenario` carries `scenario_name`. The page gains
*Name* on any build, a weights row on an opened draft line, *Start from* prefill and the named delete.
Choosing *month weights* in the dropdown seeds a 1 in all twelve months, which equals even, so nothing moves
until a weight is changed; boxes save when focus leaves the row. Leaving custom clears the weights.

**Found at code review, fixed before merge.** A weight rounded to two decimals moved money between months
(0.125 / 0.375 on 500,000 wrote 127,450.98 / 372,549.02), so a finer weight is refused and §10.3's "any
non-negative numbers" means to two decimals. Blanking a Fixed box published the line as nothing, a defect
from v3.77.0, now refused. A null inflation `Rate` read as 0%, now as no rate. Left alone: focus is lost
after a save while tabbing between boxes, the pattern every input on this page already has.

**Verified on a fresh prod dump in a throwaway database (§10.6 items 1–5, 8, 9).** Three drafts, copy
independent, delete leaves the copy with NULL parent. Publish, replace, restore: restore byte-for-byte on
amount, base amount, account and date, and **per FC line 16/16 at each of the three steps**, read through
`crud.getBaseYearValues`, the engine's own query, so no clock change was needed. Line edits leave the policy
table alone; publish writes it. A 20% PLN move leaves a superseded build's USD unchanged and moves a draft's.
Rename and delete of the scenario: superseded builds open and restore exactly, a draft shows no figure and
refuses to publish, writing nothing. Weights on `Car - Gas And Fuel` (PLN, two accounts): Mar 3, Aug 2 wrote
−6,682.37 / −4,454.92, summing to −11,137.29, both accounts keeping a share. Page walked in both themes on
that database (rename, prefill, new draft, weights, month split, publish, stored split, delete dialog), no
page errors. Fresh-database suite 124 suites, 1,546 passed; frontend 734 passed; ratchets at baseline.

**Not verified:** §10.6 item 6 and 7 belong to V6 and V5, which are not built. §10.6 item 3's multi-currency
ranking is proved by pure tests and one DB test, not on a named prod category.

**For the prod deploy.** Prod's `budget_category_policy` already holds 25 rows written by draft edits on
v3.77 (the table was empty when §10.3 was written), so a from-scratch draft starts from those until the first
publish overwrites the categories it covers. Drafts already open are unaffected by 085.

### 10.10 As built — P3b, V5 the comparison (2026-11-03)

**Code.** `compareYear(year)` in `budgetBuilder.js` and `GET /budget-builder/compare?year=`, declared
before `/:id`: every build of the year with its name, status, estimate, scenario, rates and USD total,
each read through `getBuild`. A build refused for a known reason (a 4xx) is listed with that reason; a
database error fails the request, so its text never reaches the page (found at code review: the first
version caught everything into a 200). The page gains **Compare builds**, which opens
`features/Budgets/BuildCompare.jsx` above the open build: (a) the year's builds with radio pickers for A
and B, (b) A and B line by line, annual and USD per side and **B − A in USD**, with *Only lines that
differ* on by default and a row giving the count and net of the hidden lines, so the visible column still
adds up to the footer. The merge is the pure `features/Budgets/buildCompare.js` (`compareBuilds`,
`displaySign`). The build open on the page is never re-fetched: its side and its list row read the page's
own view, so a line edited a moment ago is compared as it now stands (found at code review: the panel
went stale after an edit). Picks survive a rename, a new draft or a publish; opening another build makes
it B.

**Not built here:** the "edited since publish" label on the official build is V6's check, so it ships
with P3c. Until then the official build shows as published.

**Verified.** Backend builder suite 31 passed on dev, including two new tests, each falsified (reversed
order; a catch-all that swallowed a database error). Frontend 741 passed (7 new, `buildCompare.test.js`).
The six ratchets pass. Rendered on dev with two throwaway 2027 drafts (deleted after) in both themes, no
page errors: two changed lines, −65,202 and −12,936, sum to the totals' −78,138. Then, in the real page,
a policy change in the grid moved the panel's line and the open draft's total (−84,058 → −84,075), and a
rename kept the A pick. Not on a prod dump: §10.6 item 7 (comparison totals equal each build's own total)
is asserted by the DB test on seeded builds.

### 10.8 Review log

- **Owner addition, 2026-11-02 (after both passes):** V8, month weights. Not re-reviewed as design: it is a
  new input to the existing split and leaves publish unchanged. Its schema goes through `migration-reviewer`
  with the rest of 085 at build.
- **Pass 1 — `cr-technical-reviewer`, 2026-11-01: *revise*, 2 blocking.** **B1** ranking the remembered
  policy by annual made One-off nearly unwinnable → rank by `|le_fy|` in USD (V3). **B2** the no-rates draft
  produced partial totals and could drop a line from a publish → nulls propagate and `publish()` refuses
  (V7). Non-blocking, all taken: *Start from* prefills the parent's LE and scenario (V1); un-publish dialog
  gets `readers` and the edited-since check, FX-only edits warn, counts use the event timestamp (V6);
  stored builds get their month split, NULL `published_rates` is a real path, restore does not rewrite it
  (V7); comparison merged in JS, one-sided difference defined (V5); ever-published builds undeletable (V2);
  named automated tests (§10.6). Clean: FK name, migration safety, un-publish hand-back, `getBuild` per build
  (14 ms on prod, emulated on LE-10-26). No builder code was executed in the review.
- **Pass 2 — `cr-signoff-pm`, 2026-11-01: GO**, four conditions, all written in: (1) *Restore* on the live
  build to discard hand edits, proposed from pass 1, is outside the owner's decisions and has an exact
  workaround, so it moved to a roadmap bullet; (2) dates for §10.7; (3) the closing condition (header);
  (4) status, roadmap and index synced with the hold. Taken from its recommendations: V5 ahead of V6, staged
  phases (§6), the named slip order and the pre-publish steps.
