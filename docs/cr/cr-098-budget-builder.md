# CR098 — Budget builder: next year's budget from this year's Latest Estimate — PLANNED

**Status:** PLANNED (2026-10-15) — two-pass reviewed: pass 1 *revise* → rev 2; pass 2 **GO** with four conditions, all written in (§8). Build next, ahead of CR097 P1b. ⚠️ Do not build [CR095](cr-095-forecast-spend-currency-share.md) (same FX area) at the same time.
**Track:** v3 · **Migration:** one — 084 if still free at build, claimed then with its registry row (`.claude/rules/git-concurrency.md` rule 7)
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
1. Take the build's advisory lock; refuse if the target year's rows changed since the preview.
   The checksum is `md5(string_agg(row_to_json(be)::text, '|' ORDER BY be.id))` over the year's
   `budget_entries` — every column, `updated_at` included, so a *Recalculate* counts as a change.
2. Copy **every** `budget_entries` row of the target year, in full, into a snapshot owned by the build.
3. Delete them all — every version, NULL versions included, so the year has one set of rows after.
4. Insert the build's cells into the year's active version (create `«year» / Built` if the year has
   none), with `base_amount = ROUND(amount / rate, 2)`, `rate` = units of the currency **per USD**
   from the scenario for the target year (the engine's convention, `Rates.PLN = 3.9`).
4a. **Write the year's `budget_fx_rates`** — 12 months × each non-USD currency at that same rate —
   after snapshotting any rows already there. Without it, the next row added on the budget page, or a
   *Recalculate*, prices at a different rate and the base year sits on two.
5. Mark the build published; any earlier published build of the same year becomes superseded.

**Un-publish**, in one transaction: refuse if the year's rows differ from what the publish wrote
(same checksum; edits since would be lost — say so); otherwise delete them and restore the snapshot
exactly — re-inserted through `jsonb_populate_record(NULL::budget_entries, row)` with the original
`id`, `created_at`, `updated_at` and `version_id` (NULLs included; nothing has a foreign key into
`budget_entries`, so reusing ids is safe), delete a `«year» / Built` version the publish created, and
restore the year's `budget_fx_rates` snapshot. ⚠️ **After the annual close has run on that year**,
un-publishing moves a base scenario's base year: the confirm names the scenarios whose base year is
the target year and says each needs a regenerate.

The preview lists what will be deleted — by category, with counts — so the 12 instalments in 2027
are visible before they go. Re-publishing a new build of the same year is publish again (it
snapshots what is there then). One open draft per target year, as the LE does.

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

Un-publish still undoes only the most recent publish; *Restore* is how you go further back.

### 3.5 Storage (one migration)

- `budget_category_policy` — `category_id` PK, `policy` (`recurring` | `one_off` | `fixed`),
  `inflation_override_pct` NULL, `split_override` (`auto` | `even` | `month`), `split_month` NULL,
  `updated_at`. This is what "remembered between years" means: the next build starts from it.
- `budget_builds` — `id`, `target_year`, `source_le_id`, `scenario_name`, `status`
  (`draft` | `published` | `superseded` | `unpublished` — `VARCHAR` + `CHECK`, not a Postgres enum,
  per the migration-070 rule), `published_at`, `published_checksum`, `created_version_id` NULL,
  `build_no` (1, 2, 3 … per `target_year`, unique with it), `parent_build_id` NULL (the build it
  started from), `note` NULL.
- `budget_build_lines` — `build_id`, `category_id`, `currency`, `le_fy`, `policy`,
  `fixed_amount`, `inflation_pct`, `annual_amount`, `split_method`, `split_month`; unique on
  (`build_id`, `category_id`, `currency`).
- `budget_build_snapshot` — the replaced rows of a publish, verbatim (`build_id`, `kind`
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

## 7. Decided at review, not left open

- **Default scenario** = the base whose base year is the LE's year (`2026 Base`); it is a dropdown.
- **The 80% threshold** is re-measured on absolute amounts at build and the measured count recorded here.
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
