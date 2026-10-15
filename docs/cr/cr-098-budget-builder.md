# CR098 — Budget builder: next year's budget from this year's Latest Estimate — DRAFT

**Status:** DRAFT (2026-10-15) — not yet reviewed (pass 1 `cr-technical-reviewer`, pass 2 `cr-signoff-pm`).
**Track:** v3 · **Migration:** one (number claimed at build, not here — `.claude/rules/git-concurrency.md` rule 7)
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

## 3. Design

### 3.1 The unit: one line per (category, currency) of the chosen LE

A build names a **target year** (the LE's year + 1), a **source LE** (the latest finalised LE for
the current year; a draft is never offered) and a **scenario** (whose inflation and FX it uses —
default: the base scenario whose base year is the LE's year, i.e. `2026 Base`). Each build line is
one (category, currency) of the LE with its full-year local amount `le_fy = Σ amount` over the
LE's twelve months. The LE's own `excluded_category_ids` are honoured (transfers, unrealised G/L —
CR083 §2); a category the LE lacks is not invented.

### 3.2 The annual figure — layers, each shown

| column | rule |
|---|---|
| LE FY | from 3.1 |
| Policy | the category's remembered flag (§3.5); new categories default to **Recurring** |
| Inflation % | Recurring only: the scenario's rate for the target year (resolved through the engine's own rate builder, so a carried-forward rate is the engine's), or the category's override |
| **Annual** | Recurring: `le_fy × (1 + r)` · One-off: `0` · Fixed: the typed amount |
| vs LE · vs this year's budget | deltas, for reading only |

Totals by currency and in USD at the scenario's FX for the target year. A Fixed amount is typed in
the line's own currency.

### 3.3 Splitting the annual figure — accounts, then months, from one source

**Window:** the twelve months ending at the source LE's `actual_through` (for LE-09-26:
Sep 2025 – Aug 2026). That date is the LE's own declaration of what is actual; the builder does not
re-derive "closed" (CR083 §1.2 explains why it cannot).

For each line, take actual transactions in that window on the category's leaves whose **account
currency = the line's currency**, grouped by account × month:

1. **Accounts:** each account's share of the window total. A share that is negative against the
   line's sign, or a line with no actuals, falls back to the **current year's budget** split for that
   (category, currency); with neither, one row with no account (as 32 of 2026's rows already are).
2. **Months:** the window's monthly pattern per account, re-scaled to the account's share of the
   annual. If one month holds ≥ 80% of the line's window total, the whole line goes in that month
   (an annual payment). Override per line: **even** twelfths, or **one chosen month**.
3. **Cents:** each (account, month) cell is rounded to cents; the rounding remainder goes to the
   largest cell, so every line sums **exactly** to its annual figure.

The preview shows each line's 12-month row; nothing is written until Publish.

### 3.4 Publish and un-publish — replace the year, keep a way back

**Publish**, in one transaction:
1. Take the build's advisory lock; refuse if the target year's rows changed since the preview
   (count + checksum shown in the preview).
2. Copy **every** `budget_entries` row of the target year, in full, into a snapshot owned by the build.
3. Delete them all — every version, NULL versions included, so the year has one set of rows after.
4. Insert the build's cells into the year's active version (create `«year» / Built` if the year has
   none), `base_amount` at the scenario's FX for the target year.
5. Mark the build published; any earlier published build of the same year becomes superseded.

**Un-publish**, in one transaction: refuse if the year's rows differ from what the publish wrote
(edits since would be lost — say so); otherwise delete them and restore the snapshot exactly.

The preview lists what will be deleted — by category, with counts — so the 12 instalments in 2027
are visible before they go. Re-publishing a new build of the same year is publish again (it
snapshots what is there then). One open draft per target year, as the LE does.

### 3.5 Storage (one migration)

- `budget_category_policy` — `category_id` PK, `policy` (`recurring` | `one_off` | `fixed`),
  `inflation_override_pct` NULL, `split_override` (`auto` | `even` | `month`), `split_month` NULL,
  `updated_at`. This is what "remembered between years" means: the next build starts from it.
- `budget_builds` — `id`, `target_year`, `source_le_id`, `scenario_name`, `status`
  (`draft` | `published` | `superseded` | `unpublished`), `published_at`, `published_checksum`.
- `budget_build_lines` — `build_id`, `category_id`, `currency`, `le_fy`, `policy`,
  `fixed_amount`, `inflation_pct`, `annual_amount`, `split_method`, `split_month`; unique on
  (`build_id`, `category_id`, `currency`).
- `budget_build_snapshot` — the replaced rows of a publish, verbatim (`build_id`, the row as `jsonb`).

Cells are computed, not stored, until Publish writes them to `budget_entries`.

### 3.6 Prerequisites (P0, before any row is published)

1. **`fcLines.findAll`'s year-blind sum** — find the live consumer CR083 §11.4 asked for, and pass
   a year (or drop the per-category `budget_total` there if nothing reads it). Test with two years of
   rows.
2. **A guard that a year has one version after publish**, asserted by test, since every reader sums
   all versions.

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
   figure to the cent; Σ annual per currency equals the published `budget_entries` total per currency.
2. Recurring = `le_fy × (1 + r)` with `r` read back from the engine's rate builder for 2027.
3. Publish: the year holds only the build's rows, in one version; `fcLines` totals and
   `getBaseYearValues(2027)` read the new total.
4. Un-publish: the 12 instalment rows return byte-identical; a publish after an edit to the year is
   refused, and so is an un-publish after an edit.
5. A scenario with `PeriodStart` 2028 (a forward annual close, clock set to January 2027 as in
   CR064 P2's check) generates from the published 2027 budget.
6. Rendered in both themes.

## 6. Phasing

| phase | scope | gate |
|---|---|---|
| **P0** | §3.6 prerequisites | Before anything publishes ~800 rows into a year |
| **P1** | Draft, policy, inflation, FX, annual grid — preview only, nothing published | Usable early: the annual totals are the decision |
| **P2** | Account and month split, Publish / Un-publish | Done by mid-December 2026 |

## 7. Open questions for review

- **Which scenario by default** — the base whose base year is the LE's year (`2026 Base`) is
  proposed; a variant's inflation would also be valid.
- **An LE line whose sign flips across the window** (a refund-heavy category) — §3.3 falls back to
  the budget split; is that right, or should such a line be split evenly?
- **The 80% threshold** — tunable at build; measure how many 2026 categories it would place in one
  month before fixing it.
