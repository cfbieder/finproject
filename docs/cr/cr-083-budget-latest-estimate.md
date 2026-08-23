# CR083 — Budget: the Latest Estimate (LE) — 🔨 IN-PROGRESS (P0a + P0b LIVE, v3.31.0)

Roadmap anchor: [project-roadmap.md#cr083](../current/project-roadmap.md#cr083). **Track: v3** —
no flags, no tenant context, nothing under `server/src/v2/db/`.
**Depends on:** [CR075](cr-075-base-year-is-the-budget.md) (the forecast base year reads
`budget_entries`; this CR's §8 is entirely about not disturbing that) ·
[CR042](cr-042-ui-look-and-feel.md) (the ≤8 nav rule — **not** `ReportTabs`; §11.1 cut the tab strip) ·
[CR054](cr-054-cash-flow-by-account.md) (the "state the currency where the number is read" rule).
**Relates to but does not overlap:** [CR064 §3](cr-064-forecast-annual-close-and-assumptions.md)
(the *forecast* annual close — a different artefact in a different table).

**Opened:** 2026-08-16 · **Migration:** ⚠️ **number claimed at build time, NOT reserved here — 072 at
the earliest.** This CR first said 071; by the time round 2 reviewed it,
`071_tax_foreign_account_year_states.sql` already existed on disk from the CR082 thread, written the
same evening. That is migration **064**'s note (*"Numbered 064, not 063 — another thread committed
mid-build"*) replayed, and §15 decision 8's parallelism is what causes it. **The migration number is
the sharpest contended resource between these two CRs**, along with `docs/current/migrations.md`,
`docs/cr/README.md`, the roadmap and `status.md` — not just the two frontend files decision 8 names. Applied **dev first, then prod, then the code
that reads it** (`Scripts/deploy-to-production.sh`, which backs up prod first) — the rule in
[git-concurrency.md](../../.claude/rules/git-concurrency.md) §6. The migration is
**append-only, fresh-DB-safe, order-independent and asserts no production data fact**
([migrations.md 046](../current/migrations.md) records what happens otherwise: a migration that
asserts a prod fact fails CI and takes the backend *and* e2e jobs with it). ⚠️ **It seeds nothing and
adds no column to `accounts`** — §2 uses the existing `accounts.is_transfer`, so there is no flag to
default and nothing to configure. Configuration inside a migration is what CR080's 065 got wrong and
what withdrew 068.

**Review passes:** technical + PM sign-off, **two rounds each, all four on 2026-08-16** — round 1 on
the draft, round 2 on the owner-revised design. See §16.

## The ask

> "In the budget section I want to create the ability to create a Latest Estimate (LE) as well. The
> LE would be on a full calendar year basis and would include actuals up to and including the last
> full month completed in the year plus an estimate for the remaining months. The estimate would be
> the budget for the remaining periods as a starting point, where the user can modify some items
> based upon run rate, at the same time the system could propose updates. This would then be saved
> and stored as LE-[MM]-[YY] — e.g. if I did an LE now in August it would be LE-08-26." — owner,
> 2026-08-16

The ask is sound and the artefact is worth building: **the owner has no number today for "where will
2026 land"**. Everything below is measured against prod on 2026-08-16 (SELECT only).

**Four parts of the ask, taken literally, produce a wrong number** — **§1.1** (the cut), **§2** (the
scope), **§3.2** (run rate) and **§6** (the name) — and each is named with the figure it costs. A
fifth was this CR's own: **§1.2** records that the first draft's replacement for the cut was
underivable too, and why, because that is exactly the failure this project keeps repeating.

**The cheapest useful thing here needs no LE at all.** The FY-landing figure is arithmetically
`budget_FY + (actual_YTD − budget_YTD)` — on this book `−137,555 + 34,556 = −102,999`, to the dollar
— and both terms are already rendered on `/budget-vs-actual`. §11's **P0a** is that subtraction plus
the §2 scope exclusions, about a day's work, and it is the cheapest possible test of whether the
owner looks at the number before the grid is built.

---

## 1. What an LE is, and the three conditions for it being correct

An LE is *the current-year P&L restated so elapsed periods carry realised money and future periods
carry the best current expectation*. It answers one question — **"where will the year land, and how
has that answer moved since the budget was set?"** It is **not** a re-budget (the budget stays
frozen as the yardstick) and **not** a forecast (it stops at 31 December).

Correctness has exactly three conditions:

1. `LE(FY) = Σ(actual months) + Σ(estimate months)` — **no month in both, no month in neither**.
2. Every month sits on **one** basis, and the basis is named on screen.
3. The **actual** half is reproducible: re-derived from the ledger it gives the same number, or the
   difference is reported as a figure (§4).

### 1.1 "The last full month completed" is not a closed month — and this is defect #1 in the ask

Fin has no period close. The last *calendar* month is not the last *accounting* month, and the gap
is not theoretical — `Unrealized G/L` for month M is written in month M+1, and months are amended
for weeks afterwards:

| P&L month | rows | net | first written | last written | tail |
|---|--:|--:|---|---|--:|
| **2026-03** | 6 | −14,029 | 2026-04-03 | **2026-07-31** | **4 months** |
| 2026-04 | 2 | +130,368 | 2026-05-02 | 2026-05-02 | — |
| 2026-05 | 4 | +71,462 | 2026-06-04 | **2026-07-30** | 2 months |
| 2026-06 | 7 | +32,600 | 2026-07-03 | **2026-07-31** | 1 month |
| 2026-07 | 5 | **−31,569** | **2026-08-02** | 2026-08-02 | — |

An LE cut on 1 August with "last full month = July" would have frozen July **before July's own
revaluation existed** — and March, the strongest case, was still being amended **four months** later.

More broadly, across P&L rows **dated 2026 and created since 2026-05-15** (n ≈ 2,478),
`created_at − transaction_date` runs **p50 2 / p90 14 / p99 103 / max 210 days**. ⚠️ **The date
filter is load-bearing and must be stated**: without `transaction_date >= 2026-01-01` the same query
returns 18,202 rows at p50 **3,293** days, because the Quicken back-import carries recent `created_at`
on 1998-era dates. Widened to 2025 the percentiles become **p99 211 / max 576** — so these figures are
*current-year*, not "overall". (The p99 17 / max 53 in [status.md](../current/status.md) is the
*feed*; manual and MTM rows are worse.)

### 1.2 …but "closed" cannot be derived either — ⛔ the first draft of this CR was wrong here

The first draft proposed deriving *closed* as *"the month has ended **and** its MTM/reconcile row
exists"*. **That does not work, and the reason is worth recording**, because it is this project's
own failure-pattern #1 appearing inside the CR that spends §13 warning about it — a mechanism
asserted from a name (`reconcile_mode`) rather than from what the code actually writes.

Measured on prod, all 113 balance-sheet accounts:

| feed `reconcile_mode` | `manual_reconcile_mode` | accounts | writes a dated row? |
|---|---|--:|---|
| `calibrate` | `calibrate` | **97** | ❌ none |
| (no feed mapping) | `calibrate` | 5 | ❌ none |
| `mtm` | `calibrate` | 5 | ✅ |
| `calibrate` | `mtm` | 4 | ✅ |
| `accrue` | `calibrate` | 2 | ✅ |

**102 of 113 accounts are `calibrate`, which writes no dated row and no audit row at all** — §4.2
says so itself, and migration 069 is the case study. So the signal exists for **11 accounts**, and
those 11 are precisely the `mtm`/`accrue` rows that §2 **excludes from the LE**. The gate would have
been derived from the one category whose numbers the LE does not contain. There is no reconcile
event log anywhere in `server/db/migrations/`.

**Corrected recommendation — drop the derivation; make the cut a calendar default and let drift
carry the load.**

- Default `actual_through` to the **last complete calendar month**, owner-overridable **backward as
  well as forward** (backward is the conservative direction and §1.1 shows why someone might want
  it).
- **L1 becomes an advisory, not a gate**, and asks the question that actually matters for the LE's
  actual half — *have the ordinary P&L transactions for month M arrived?* That is an **arrival-lag**
  question, not a reconcile question: fire when month M's row count or value is materially below the
  trailing median for the same elapsed-days window. It never blocks.
- **L2 (drift) does the real work.** Because a finalised LE is immutable and snapshots its actuals
  (§4.2), a month that keeps moving is *reported*, not silently absorbed.

This removes a table-less "close" concept from P0 and makes P0 materially smaller. **Do not ship a
warning whose trigger the schema cannot express.**

**And the measured cost of the calendar cut is small, which is what makes this affordable.** Cutting
at July on 1 August misses **85 rows / +$664** of ordinary P&L, plus the **−31,569** July MTM —
which is excluded from the LE anyway (§2). So on this book the whole "closed month" apparatus was
buying **$664 of accuracy** on a −102,999 landing, at the cost of a concept the schema cannot
express. **L2 reports the $664; nothing needs to gate on it.**

---

## 2. Scope: what is in the LE, and why the total is meaningless without this — defect #2

**In: P&L categories only** (`accounts.section = 'profit_loss'`), resolved through the **same
recursive CTE** that `fcLines.getBudgetTotals` and `forecast/crud.js:486` already use. Do **not**
write a third copy — [failure-patterns #4](../current/failure-patterns.md) (a hand-maintained
duplicate has already failed twice on one column).

**Hard-excluded.** Jan–Jul 2026 actual net, by basis:

| basis | YTD Jan–Jul |
|---|--:|
| all `profit_loss` categories | **+208,841** |
| ex `Transfer - *` | +222,870 |
| ex transfers **and** ex valuation | **+25,684** |

The exclusion moves the actual half by **183,157** on the basis §2 actually defines
(208,841 − 25,684, which is also 213,595 − 30,438). ⚠️ **The 197,186 quoted earlier — and confirmed by
the owner in §15 decision 2 — is measured from the *name-match* row (222,870), not from the
`NOT is_transfer AND id <> 88` row.** Both are real; they answer different questions. The figure that
matters is **183,157**, and it is the whole meaning of the LE:

| category | 2026 YTD | why out |
|---|--:|---|
| `Unrealized G/L` (id **88**) | **+213,595** | mark-to-market revaluation, not operating P&L. Has **no budget line at all**. Volatile — Apr **+130,368**, Jul **−31,569**. Mapped to no `fc_line`. |
| the **`Transfers` subtree** (id 200 + **13** descendants, all `profit_loss`) | −30,438 | movement between the owner's own accounts |

Taken naively the LE would land 2026 at **+44,259** against a budget of **−224,351** — a **268,610
"improvement" that is mostly unrealised market movement** (MTM alone is 213,595 of it, 79%; the
balance is YTD budget being replaced by actuals). On the correct scope it lands at **−102,999**,
favourable by 34,556. Only the second number is worth looking at.

⚠️ **Do not add a new flag, and do not match on the name — the exclusion already exists in the
schema.** `accounts.is_transfer` is **TRUE on exactly 13 accounts**, and they are precisely the 13
descendants of `Transfers` (the root itself is FALSE and has no transactions). So the entire
exclusion set is:

```sql
WHERE a.section = 'profit_loss' AND NOT a.is_transfer AND a.id <> 88
```

A name match on `Transfer - %` would have been **wrong twice over**: the subtree also contains
**`Return of Capital` (217)** and **`Valuation - Historical` (229)**, neither of which matches the
pattern — and `Valuation - Historical` is a *child of `Transfers`*, so the first draft of this CR
listed it as a separate exclusion when it was already inside the set it was excluding beside. That
also explains the arithmetic: the name match gives −14,029, the actual subtree gives **−30,438**.
`Return of Capital` has **zero 2026 activity**, which is exactly how a silent readmission ships.

**One consequence to design around:** `is_transfer` is a live flag with no snapshot, so §7.1 stores
the resolved excluded-id set on the LE header (§7.1, S8) — otherwise flipping it after finalising
leaves an "immutable" LE whose lines no longer describe the scope its total was computed on.

⚠️ **And do NOT reuse `getCashFlow`'s convention — the first draft said to, contradicting itself two
paragraphs after "do not match on the name."** `services/budget.js:611 getCashFlow` implements
`exclude | only | include`, but it is **built on the name walk**, and `extractTransferCategories` is
already **duplicated verbatim** in `services/budget.js:72` and `services/reports.js:362` —
failure-pattern #4, live today. Reusing it means a **third** copy of a name matcher; the LE uses the
predicate and hard-codes "always exclude", because an LE that could include transfers would not be an
LE. Unifying the two existing copies onto `is_transfer` is a roadmap bullet (§11.2).

**`Option Trade` (id 76) stays in, at net — but it must be refused by the proposal engine, and the
first draft of this CR was wrong about how.** It is genuinely mapped to fc_line `Dividend Income`,
net **+25,351** YTD against a 14,000 budget. Its *gross* churn is **246,994 on 201 rows in July
alone**. The first draft asserted "**L9** is what catches it" — **false by L9's own definition**: L9
fires on a sign flip or a clamp hit, and `Option Trade`'s ratio is **3.10**, comfortably *inside* the
[0.25, 4.0] clamp with signs agreeing. Nothing caught it, and it turned out to be the **single
largest driver of the proposal engine's headline**. §3.4 adds the guard that actually works.

**Balance sheet, accounts and transfers: out.** The 2026 budget contains **zero** balance-sheet rows
(76 income + 645 expense, verified). An LE of the balance sheet is the forecast's job and CR075
already owns that boundary.

### 2.1 The uncategorised account-level budget rows — ✅ RESOLVED: a plug, excluded

**First, the thing that is settled: the budget contains no balance-sheet lines at all.** Every entry
carries two dimensions — `category_id` (what the money is *for*) and `account_id` (which account it
moves *through*). For 2026, by category:

| by category | rows | FY |
|---|--:|--:|
| `profit_loss` | 721 | −137,555 |
| **no category** | **72** | **−86,796** |
| `balance_sheet` | **0** | — |

There is no "grow savings to X" or "pay the mortgage down to Y" in Fin's budget. 761 of 793 rows do
carry a balance-sheet `account_id`, but that only names the bank or card the money flows through.
**So the 72 uncategorised rows are not balance-sheet budgets — they are uncategorised P&L spend**,
which is why they belong in this CR's scope discussion at all.

They total **−86,796** for the year, of which **−35,900 falls inside an August cut's estimate
window**, and they are flat monthly allowances with **blank description and blank note**:

| account | type | rows | FY | shape |
|---|---|--:|--:|---|
| `PKO` | asset | 12 | −71,767 | one row/month, ≈ −5,980/mo |
| `LUXURY CARD` | liability | 24 | −7,200 | −500 + −100 every month, all 12 |
| `PKO VISA Infinity CB` | liability | 24 | −6,524 | two rows/month |
| `PKO Visa Gold KB` | liability | 12 | −1,305 | one row/month |

**And each of those accounts already carries a fully itemised budget**, which is what makes the
question live rather than academic:

| account | categorised budget rows | uncategorised on top |
|---|--:|--:|
| `LUXURY CARD` | 106 rows, −61,764 | +24 rows, −7,200 |
| `PKO VISA Infinity CB` | 64 rows, −25,167 | +24 rows, −6,524 |
| `PKO` | 147 rows, +174,765 | +12 rows, −71,767 |

The *actual* spend on those accounts is fully categorised too — `PKO` Jan–Jul is `Kasia Spending`
−37,254, `Anna - ASW` −25,569, `Car - Lease` −11,597, `Car - Insurance` −3,993,
`Utilities - Electricity - PL` −2,923, and so on. So this is not "categorised actuals versus
uncategorised budget"; it is **a flat monthly allowance sitting on top of an already-itemised budget
for the same account.**

The data cannot say whether that allowance is genuine incremental spend or a leftover plug from
before the itemised lines grew to cover the same money. If it is a plug, carrying it into an LE that
already holds categorised actuals **double-counts up to $35,900**.

**Owner decision, 2026-08-16: originally *"investigate first"* — now RESOLVED to *plug, excluded*
on the creation-date evidence in §2.2/§15 #1.** So:

- **The LE excludes these rows** and shows them as an *unallocated budget allowance* memo line below
  the total, never inside it. **L6** fires whenever both are present. This matches today's forecast
  behaviour — `crud.js:494` joins on `category_id`, so these rows are already invisible to the base
  year — and it means the CR is unblocked either way.
### 2.1a Two categories post transactions to a NON-LEAF, and the report cannot see them

Verified: `Car Expense` (181, **−50.00**, 5 rows) and `Children - Anna` (175, **−10.36**, 1 row) both
have children **and** carry transactions directly — **−60.36** Jan–Jul inside the LE scope.

`buildCashFlowNode` (`services/reports.js:397`) reads `categoryTotals[name]` **only on leaves**, so
`/budget-vs-actual` nets **25,743.86** for Jan–Jul while `NOT is_transfer AND id <> 88` over every
row gives **25,683.50**. The recursive CTE §2 tells the builder to reuse (`distinct_leaves`,
`services/forecast/crud.js:486`, `WHERE NOT EXISTS (child)`) is **also leaf-only**, so following §2
literally would produce the report's number, not this CR's.

**Rule: the LE counts every transaction in scope, parent-posted included.** Money posted to a parent
is money. The landing stays **−102,999**.

⚠️ **Consequence for §13's invariant.** `Σ(LE actual months) = Σ(budget-vs-actual for the same months
and scope)` is the correctness gate, and it **does not hold today** — it is off by exactly **$60.36**,
and the builder would have nothing to reconcile against. So the invariant is stated as
`Σ(LE) − Σ(report) = Σ(transactions on non-leaf categories in scope)`, which is checkable, and the
report's leaf-only blindness is a **roadmap bullet in its own right**: two categories' spend is
invisible on a page the owner reads weekly, and nothing announces it.

### 2.2 The investigation was run (2026-08-16) and it does not resolve — because the account dimension is unreliable

The reconciliation the owner asked for was attempted: for each account, itemised budget Jan–Jul vs
categorised actuals Jan–Jul (transfers and valuation excluded), asking whether the residual is
roughly the allowance.

| account | itemised budget | categorised actual | residual | allowance |
|---|--:|--:|--:|--:|
| `LUXURY CARD` | −43,189 | −40,359 | **+2,830** | −4,200 |
| `PKO VISA Infinity CB` | −16,038 | −25,719 | −9,681 | −3,828 |
| `PKO` (expense side only) | −61,801 | −97,240 | −35,439 | −42,103 |
| `PKO Visa Gold KB` | −65 | *(no activity)* | — | −766 |

At first reading that looks conclusive — aggregate allowance −50,897 against aggregate residual
−42,290, an 83% match, which would say the allowance is **real uncaptured spend**.

**It is not conclusive, and the reason invalidates the whole account-level method.** The budget's
`account_id` is incomplete:

| | rows | FY |
|---|--:|--:|
| account **and** category | 689 | −38,364 |
| account, **no category** (the allowance) | 72 | −86,796 |
| category, **no account** | **32** | **−99,191** |

**−99,191 of categorised budget carries no account at all** — including `Kasia Spending`, budgeted
**−70,000 across 12 accountless rows** (plus −9,922 on `PKO`), whose *actuals* land on `PKO`
(−37,254 Jan–Jul). So `PKO`'s −35,439 "uncaptured" residual is mostly just budget that was never
tagged to an account. The same confound applies to `Anna - ASW` (split `PKO` −28,803 /
`Fidelity Cash Mgt` −12,904), `Car - Insurance` (`PKO` / `LUXURY CARD`) and
`Healthcare - Insurance`.

**Conclusion: the allowance cannot be reconciled by account with this data, and it is not going to
become reconcilable.** Two consequences, both of which make the CR *more* certain rather than less:

1. **The LE is keyed on category, never on account.** The account dimension of `budget_entries` is
   too incomplete to carry a total (accountless −99,191, uncategorised −86,796, both-populated only
   −38,364).
2. **The exclusion default stands and is now the evidenced choice**, not a placeholder — memo line
   below the total, **L6** fires.

### 2.3 The schema does not bet on the answer

The PM pass flagged §2.1 as schema-blocking: if the allowance is ever ruled *real*, it needs
account-level rows, which would mean a nullable `category_id`, an `account_id` column and a
different unique key. **That is cheap to pre-empt and expensive to retrofit, so P0 pre-empts it** —
`budget_le_lines` ships with `category_id` **nullable**, an `account_id` column, a `CHECK` that
exactly one of the two is set, and a partial unique index per dimension (§7.1). P0 writes only
category rows and the API refuses account rows; admitting them later is **one classifier branch and
no migration.** The open question therefore does not block the migration.

---

## 3. The proposal engine

### 3.1 The finding that should drive the design

Classify the 2026 P&L categories at an August cut (transfers, `Unrealized G/L`,
`Valuation - Historical` excluded):

| bucket | n | remaining budget | YTD actual | correct method |
|---|--:|--:|--:|---|
| **A** budget fully phased **before** the cut | 21 | **0** | 173,380 | carry (= 0). Never annualise. |
| **B** nothing budgeted YTD, money still to come | 4 | **−66,381** | −805 | carry budget. Never zero. |
| **C** level monthly, present both sides | 33 | **−47,483** | −75,567 | **the only bucket where a proposal is legitimate** |
| **D** lumpy on both sides | 27 | −14,818 | −69,293 | carry + advisory |
| **E** actual, no budget at all | 8 | 0 | −2,033 | needs a method (P1) |

**The choice of method only matters on 37% of the remaining number. On the other 63% the only
correct answer is "carry the budget."** That table is the argument for defaulting to carry and
proposing narrowly.

### 3.2 Naive run-rate on this book — defect #3 in the ask

The owner asked for "modify some items based upon run rate". `YTD × 12/7` on this data:

| line | YTD actual | FY budget (months) | naive run-rate FY | error |
|---|--:|--:|--:|--:|
| `Financial Income - UB Dividend` | 191,656 | 192,266 (**1, 8**) | 328,554 | **+136,288** |
| `Taxes US` | 0 | −55,000 (**12**) | 0 | **+55,000** — a real bill vanishes |
| `Purchases - Kasia` | −33,907 | −32,500 (**5, 7**, done) | −58,126 | **−25,626** phantom |
| `Financial Income - CVC` | 48,664 | 41,000 (1, 6) | 83,423 | +42,423 |
| `Property Tax - US` | 0 | −9,800 (**11**) | 0 | **+9,800** |

At the total: budget **−137,555** · LE by carry **−102,999** · **naive run-rate +44,029**. Run-rate
is **$147,028** away from carry and reports a *profitable* year. It is not a default with caveats;
it is a wrong answer this book produces on day one. **Run rate stays — as a per-line manual
override the owner reaches for deliberately, never as the default and never auto-proposed.**

### 3.3 The methods

For a cut after month `K` (actual = 1..K, estimate `R` = K+1..12), category `c`:

| id | name | formula (per estimate month `m ∈ R`) |
|---|---|---|
| `CARRY` | Budget carried | `est[m].base_amount = budget[c][m].base_amount` — **the stored value, verbatim** (see §5.1) |
| `PHASE_TO_YTD` | Budget re-levelled to YTD | `r = actual_ytd[c] / budget_ytd[c]`; `est[m] = budget[c][m] × clamp(r, 0.25, 4.0)` |
| `TRAIL_N` | Trailing-N average | `est[m] = Σ actual[c][K−N+1..K] / N`, N default 3 |
| `ZERO` | Done for the year | `est[m] = 0` |
| `MANUAL` | Typed | the owner's figure |

**Ship these five and no more.** The first draft listed seven, and two had no caller in any phase:

- **`POT`** (annual pot consumed down) — nothing proposes it and nothing defaults to it.
- **`PY_SEASON`** (prior-year seasonality) — deferred to P2 for bucket E only, and it should be
  scrutinised even there, because **it is a level derived from a shape**, which is the thing §3.4
  argues against three paragraphs later. The data exists (2025: **6,686 P&L rows / 107 categories**;
  2024: 5,126/105); the justification does not yet.

§3.1 already shows the method choice only bites on **37%** of the remaining number and §3.4
auto-proposes exactly **one** method. Seven implementations for that is over-build.

### 3.4 Default and classifier

**Default `CARRY` on every line.** It is the owner's own stated starting point, it is the only
zero-information method (so a wrong LE can only come from an edit the owner made), and §3.1 shows it
is right on 63% of the remaining money by construction.

**Auto-propose `PHASE_TO_YTD`, only that, only on bucket C:**

```
-- COALESCE every SUM first: a category with no budget rows before the cut yields NULL, not 0.
-- Without this, bucket B never matches -- and B is exactly Taxes US and Property Tax - US,
-- which have no rows at all before August and are the -66,381 that L4 exists to protect.
budget_ytd  := COALESCE(SUM(budget WHERE month <= K), 0)
budget_rest := COALESCE(SUM(budget WHERE month >  K), 0)

budget_ytd == 0 and budget_rest == 0 and actual_ytd != 0  -> E: TRAIL_3, flag "new line"
budget_rest == 0 and budget_ytd != 0                      -> A: ZERO, badge "budget fully phased before the cut"
budget_ytd == 0 and budget_rest != 0                      -> B: CARRY, badge "nothing to learn from YTD"
budget_months >= K and actual_months >= K-1               -> C: propose PHASE_TO_YTD, show r + churn
  -- budget_months / actual_months = DISTINCT months carrying rows in 1..K, not across all 12.
  -- Counted any other way the buckets do not reproduce (C is 33 with bm_ytd>=7 and am>=6).
otherwise                                                 -> D: CARRY, advisory "YTD x vs budget-YTD y"
```

⚠️ **The classifier only BADGES — it never writes a method.** Bucket A's `ZERO` and bucket E's
`TRAIL_3` are what the *advisory* offers, not what gets stored; every line is `CARRY` until the owner
acts (§11 P1 correctly calls `TRAIL_3`/`ZERO` "manual overrides"). Without this sentence the "default
`CARRY` on every line" rule and the classifier's per-bucket assignments read as contradicting.

Two further corrections the first draft needed:

- **Bucket A's action is `ZERO`, not "`CARRY` (=0)".** `CARRY` is defined as `est[m] = budget[c][m]`,
  which is not zero per month; it only *sums* to zero. Say what is meant.
- **`budget_rest == 0` is an equality on a SUM, so it tests the wrong thing.** `UB Dividend` lands in
  bucket A only because its August row is literally `0.00`; a **+50,000 September against a −50,000
  October** would also sum to zero and be badged *"budget fully phased before the cut"* while holding
  100,000 of gross movement still to come. **Test per-month presence as well as the sum.**

Guards — **four, and the fourth was missing from the first draft, which is how the largest error in
this CR got in:**

1. Refuse when `sign(actual_ytd) != sign(budget_ytd)`.
2. Clamp `r` to [0.25, 4.0] and badge when clamped.
3. Refuse when `|budget_ytd| < 500` (a tiny denominator makes a wild ratio).
4. 🔴 **Refuse when churn `Σ|amount| ÷ |Σ amount| ≥ 3.0`** — a net figure standing on enormous
   two-way gross is not a level that can be re-levelled.

**Guard 4 is not a judgement call; the data separates cleanly.** Bucket C is **33** lines (§3.1);
**26** survive guards 1 and 3; guard 4 then refuses **1**. Churn across those 26:

| line | budget YTD | budget rest | actual YTD | r | **churn** | effect |
|---|--:|--:|--:|--:|--:|--:|
| **`Option Trade`** | 8,167 | 5,833 | 25,351 | 3.10 | **29.0** | **+12,275** |
| `Interest Income` | 26,000 | 20,000 | 38,139 | 1.47 | 1.0 | +9,337 |
| `Financial Income - Dividend` | 16,000 | 12,000 | 19,493 | 1.22 | 1.0 | +2,620 |
| `Purchases - Subscriptions` | −2,924 | −2,075 | −4,768 | 1.63 | 1.3 | −1,308 |
| `Bank Fees` | −2,126 | −1,323 | −3,966 | 1.87 | 1.0 | −1,145 |
| `Kasia Spending` | −48,241 | −31,680 | −46,509 | 0.96 | 1.1 | +1,138 |
| … 20 more | | | | | 1.0–1.3 | |

**Every line in the book is churn 1.0–1.3 except `Option Trade` at 29.0.** A threshold of 3.0
refuses exactly one line, and it is the one §2 says must never be handed to a run-rate method.

**Why `PHASE_TO_YTD` and not a trailing average:** it keeps the budget's own seasonality, so the
December tax bill and the November property tax survive the adjustment, while still absorbing the
observed level shift. A trailing average is a *level*, and on a book whose largest line pays in two
months of the year a level is a fiction.

Applying it to bucket C only, carrying elsewhere (26 lines qualify, **1 refused by guard 4**):

| | remaining | FY landing | vs budget |
|---|--:|--:|--:|
| Budget (unchanged) | −128,682 | **−137,555** | — |
| LE, carry | −128,682 | **−102,999** | +34,556 |
| **LE, proposed (C only, all 4 guards)** | −119,347 | **−93,664** | **+43,891** |
| *(same, without guard 4 — the first draft)* | *−107,182* | *−81,389* | *+56,166* |
| LE, naive run-rate | — | +44,029 | +181,584 ✗ |

⚠️ **Guard 4 is worth $12,275 — 57% of the whole effect.** Without it the proposal moves the answer
+21,610 and the CR's own prose claimed that was *"driven mostly by `Interest Income` … real,
explainable level shifts."* It was not: **the largest single mover was `Option Trade`**, 940 option
trades netting 5,636 out of 246,994 of July gross. With the guard the effect is **+9,335**, and the
prose is then true — `Interest Income` (+9,337, r = 1.47) and `Financial Income - Dividend` (+2,620,
r = 1.22) really are the drivers, with the rest netting slightly against them.

That is what a proposal engine should find, and the difference between the two rows is the whole
argument for building the guard before the drawer.

**Not building:** regression, trend fitting, seasonal decomposition, confidence intervals. 85 lines,
12 months, one owner. A clamped ratio is the right amount of machinery, and it only bites on 37% of
the number anyway.

---

## 4. Provenance, and what happens when the actuals move

### 4.1 Every `(LE, category, month)` row carries

| column | values | why |
|---|---|---|
| `source` | `actual` · `budget_carry` · `manual` | the audit question. ⚠️ **The two `proposed_*` values are cut** — §10.4's advisory has no accept button, so a figure the owner takes from it is `manual`, exactly like one they typed |
| `method` | `ACTUAL` · `CARRY` · `PHASE_TO_YTD` · `TRAIL_3` · `ZERO` · `MANUAL` | reproduce the number |
| `method_input` | jsonb — `{r: 1.47, budget_ytd: 26000, actual_ytd: 38139}` | **the reason a reviewer can check it** |
| `amount` · `currency` · `base_amount` · `fx_rate` · `fx_basis` | | §5 |
| `snapshot_row_count` · `snapshot_sum` | | §4.2 |
| `note` | text | *"Kasia's second payment already made in July"* — likely the most valuable field on the screen |

`method_input` is the one that pays for itself. This project's most-repeated failure is **a
restatement asserted as the engine's behaviour, found ten times**
([failure-patterns #1](../current/failure-patterns.md)). A row carrying its own operands cannot be
paraphrased.

### 4.2 Snapshot vs live — **snapshot, plus a computed drift figure. Never a silent recompute.**

Freeze the actual months at save; on every view recompute the live actual for those months and show
**`drift`** where it differs.

- **Live recompute destroys the artefact.** "LE-08-26 vs LE-05-26" is only a comparison if LE-05-26
  still says what it said in May. A live LE is just today's report.
- **A pure freeze is quietly wrong.** July gained 85 P&L rows in the first 16 days of August.
- **The hybrid loses nothing** and turns the problem into a stated number. Use the **real** drift, not
  a placeholder: *"LE-08-26 froze Jul at **−46,115 over 520 rows**; the ledger now says **−45,451
  over 605** — **85 rows / +$663.82** have landed since."* ⚠️ Round 2 caught the version before this
  one freezing at the **post-drift** row count and inventing the "now" figure — self-consistent
  arithmetic on inverted facts, and this is the **copy spec for L2**. Failure-pattern #2 in the
  paragraph round 1 had already corrected for failure-pattern #2. Past a threshold **L2** fires and the owner
  re-cuts, which **creates a new LE — it never mutates the old one.**

This matters more than it looks: `calibrate()` rewrites `opening_balance` across all history and
writes **no audit row** ([CR080](cr-080-feed-accrual-reconcile-mode.md)), and CR082 found the same
shape again. An LE that re-reads history silently restates itself.

**A finalised LE is immutable.** `draft → final → superseded`. A correction is a new LE.

---

## 5. FX: the mixed basis is correct, and it must say so

Actual months carry transaction-rate USD; estimate months carry `budget_fx_rates`. **Keep the mix.**

**Measured — and round 2 found the measurement was of the wrong thing.** Round 1 corrected the scope
and the rate source; round 2 found the remaining error: **"estimate months carry `budget_fx_rates`"
is not what the carried numbers are.** `budget_entries.base_amount` holds each row's **last-touched**
rate, not the table's current one. Verified on the LE scope, Sep–Dec: PLN rows carry **9 distinct
implied rates** (avg **3.6733**, against a declared **3.5517**); EUR carries **3** (avg **0.8646**,
declared **0.84353**). So the three bases are:

| basis | remaining Aug–Dec |
|---|--:|
| stored `base_amount` — what the grid actually carries | **−128,682** |
| recomputed at the **declared** `budget_fx_rates` | **−129,737** |
| at the August market rate (PLN 3.7299 / EUR 0.8667) | **−129,730** |

**Against the declared budget rates, restating at market is worth +$7 — nil.** The "−$1,048 /
0.81%" is really the staleness of `base_amount` versus market, which is a different claim.

**The §5 conclusion survives; the argument for it does not.** Defer FX restatement — but because the
carried figures and the declared rates already differ by $1,054, not because the market has moved.

### 5.1 What `CARRY` copies — this must be stated or P0a and P0b will disagree

`CARRY` copies **`base_amount` verbatim**, sets `fx_basis='budget'` and stores
`fx_rate = amount / base_amount` **per row** — the rate that figure was actually computed at.

It matters because the alternative (`amount ÷ budget_fx_rates`) differs by **$1,054** on the LE's own
headline, and **P0a already uses stored `base_amount`** (that is where −137,555 comes from). Two
phases choosing differently would put two landings on the board.

⚠️ **And the banner §5 mandates would assert a rate the numbers were not computed at** — *"Estimate
months Aug–Dec at the 2026 budget rates (PLN 3.5517…)"* is false of the figures on screen. That is
failure-pattern #7 **in the banner written to prevent failure-pattern #7**. It must read, in
substance:

> Actual months Jan–Jul at transaction rates. Estimate months Aug–Dec at **the rate each budget row
> carries** — PLN 3.51–3.74 across Sep–Dec, against a declared budget rate of 3.5517 and an August
> market rate of 3.7299.

**Conceptual.** Mixing is *correct for an LE*. Actuals happened at the rate they happened at — that
is a fact and must not be restated. The estimate months are an assumption, and the budget rate is
the assumption the owner **declared**. Restating them at spot swaps a declared assumption for an
undeclared one.

**But the budget rates are already stale and the screen must say so.** `budget_fx_rates` for 2026 has
been re-rated in two passes — **Jan–May on 2026-06-03, Jun–Aug on 2026-08-05** — while Sep–Dec still
sit on the original **2026-03-13** assumption:

| currency | Sep–Dec budget rate | genuine Aug market | gap vs market |
|---|--:|--:|--:|
| PLN | 3.5517 | **3.7299** | **4.8%** |
| EUR | 0.84353 | **0.8667** | **2.7%** |
| GBP | 0.73302 | 0.7418 | 1.2% — months **1–6 were re-rated 2026-06-03**; only 7–12 sit on 2026-03-13. It was **skipped in the August pass**, not never re-rated |

⚠️ **The first draft illustrated this with the wrong line.** It said *"against a PLN 690,000
dividend"* — but that `Financial Income - UB Dividend` row is dated **2026-01-01**, so it sits wholly
in the **actual** half at transaction rates and the stale Sep–Dec rate does not touch it at all. The
largest PLN item genuinely inside an August cut's estimate window is
**`Financial Income - Barkeria`, 120,000 PLN in December** — $33,787 at the budget rate against
$32,172 at market, a **$1,615 swing**, which is more than the whole net −$1,048 because the PLN
expense lines move the other way.

⚠️ **The banner wording lives in §5.1 and NOWHERE ELSE.** This section carried its own version
asserting *"at the 2026 budget rates (PLN 3.5517…)"* — the exact text §5.1 identifies as
failure-pattern #7 committed inside the banner written to prevent it. Deleted rather than corrected,
because two mandatory banners is how the wrong one ships. **Load-bearing in P0b:** L8 is a P1 rule, so
until then the banner is the *only* disclosure that the estimate half carries nine different PLN rates.

**Store the rate on every LE row** (`fx_rate` + `fx_basis ∈ budget|transaction|spot|manual`).
CR082's most expensive finding was a plausible rate asserted as an authoritative one; the row
carrying its own rate is the fix, and it makes a P2 "restate at spot" button a one-line recompute.

⚠️ Note also that `budgetFxRates.recalculate` **rewrites `base_amount` on existing `budget_entries`**
(`v2/repositories/budgetFxRates.js:199`). Two consequences, and the second was missed entirely in the
first draft:

1. A **finalised** LE is safe — it snapshots its own `base_amount` (§4.2).
2. A **draft** LE is not. Its carried lines are copies of those same budget figures, so a recalculate
   between draft and finalise **silently changes half the estimate window with no signal** — L2
   covers actual months only. Either drift-check the estimate half too, or **refuse a recalculate
   while a draft LE exists for that year**. The second is simpler and is what P0b should do.

---

## 6. Naming and identity — defect #4 in the ask

**`MM` = the first ESTIMATE month** (`actual_through + 1`). In the normal case this *is* the
creation month and matches the owner's example exactly: an August LE with July closed is
**`LE-08-26`**, seven months actual, five estimated. Where the two diverge — an LE built in August
because July has not closed — the name is `LE-07-26`, which is honest; *creation month* would have
been a lie. The name then carries a checkable arithmetic meaning: **`LE-MM-YY` has `MM−1` actual
months.**

**The name is a label; the identity is `(budget_year, actual_through, created_at)`.** Never key
anything on the string. `forecast_assumptions` is keyed by scenario **name** and nothing in the
schema enforces that the name resolves — a live fragility this project already carries
([CR064 P1](cr-064-forecast-annual-close-and-assumptions.md)). Do not add a second instance.

- **Second LE in the same month:** the newer **supersedes** the older. Keep both; set
  `superseded_by`; pickers and the trend chart show only the latest per `MM`. Never a silent
  overwrite with an arbitrary winner — that was CR082 defect 6, in the one place a human types a
  number.
- **A January LE (K = 0): refuse it.** With zero closed months an LE *is* the budget byte for byte,
  and creating one manufactures a second copy of the budget for every future reader to disambiguate.
  Require `actual_through >= YYYY-01-31`, i.e. `MM >= 02`, and say why in the refusal.
- **`MM = 13`: refuse.** An LE after December is the actual year — point at `/budget-vs-actual`.

---

## 7. Storage — and the reason it cannot be a `budget_version`

`budget_versions` exists, `POST /budget/versions/:id/copy` exists and accepts an **arbitrary
`budget_year` including the same one, with no guard** (`server/src/v2/routes/budget.js:57-69` →
`repositories/budget.js:486 copyVersion`, which copies every entry unguarded). So "an LE is just
another budget version" is the obvious move, and it is wrong.

⚠️ **This table was itself wrong in the first draft — three citations off and three different counts
quoted in three places (five, seven, six).** That is failure-pattern #1 committed inside the CR whose
§13 warns about it, so the corrected table names the **file path in full** (there are two different
`budget.js` and the bare name is ambiguous) and the **enclosing function**, not just a line:

| reader | feeds | version filter |
|---|---|---|
| `services/forecast/crud.js:494` `getBaseYearValues` | **the forecast base year** (CR075 — year −1) | ❌ none |
| `v2/repositories/fcLines.js:44` `findAll` | FC-line list | ❌ none |
| `v2/repositories/fcLines.js:228` `findUnassignedCategories` | mapping completeness | ❌ none |
| `v2/repositories/fcLines.js:379` `getBudgetBreakdown` | the stream-card drill-down | ❌ none |
| `v2/repositories/fcLines.js:410` `getBudgetTotals` | FC-line budget totals / stream cards | ❌ none |
| `v2/repositories/budget.js:159` `findAllExtended` | `GET /budget/entries` (`routes/budget.js:208`), `services/budget.js:416` | ❌ when `versionId` omitted |
| `v2/repositories/budget.js:254` `sumByCategory` | `GET /budget/entries/summary/by-category` | ❌ when `versionId` omitted |
| `v2/repositories/budget.js:293` `sumByMonth` | `GET /budget/entries/summary/by-month` | ❌ when `versionId` omitted |
| `services/reports.js:526` `getCategoryTrend` | `/category-trend` budget series | ❌ none *(filters `entry_date` + `c.name`, not `budget_year`)* |
| `services/budget.js:320` `getSummary` | `/budget-worksheet` monthly balance | ❌ none |
| `services/budget.js:634` `getCashFlow` | `/budget-vs-actual` (all 3 tabs), `/m/budget` | ❌ none *(filters `entry_date`)* |
| `v_budget_vs_actual` (view) | | ❌ none |
| `v2/repositories/budget.js:327` `compareToActual` | | ✅ **the only one that does** |

**Eleven live functions plus the view** — twelve counting `v2/repositories/budget.js:115 findAll`,
which has the same shape, is exported, and has no live caller found. ⚠️ The first draft said five,
seven and six in three different places; round 1 corrected it to ten; round 2 found `findAllExtended`
and `findAll`. **Three rounds, three counts** — the point is not the number, it is that a count in
this CR is not trustworthy unless every row was opened. And two of the `fcLines` joins use
`($1::int IS NULL OR be.budget_year = $1)` — **`fcLines.js:45` and `:229` only**; `:379` and `:410`
use a plain `AND be.budget_year = $1`. Passed a null year those two read **every year**, which is
broader still, and §11.4 is where that bites.

The first LE saved as a version row would **double the Budget column across the product and double
the forecast base year** — a failure invisible to a balance check, showing up as a plausible plan
rather than a defect. That last row also shows the two conventions already disagree today:
`compareToActual` filters by version, so it already excludes the **131 NULL-version 2026 entries**
that every other reader counts.

`budget_versions` is effectively dead infrastructure — `BudgetWorksheetV2.jsx` contains **zero**
occurrences of "version", which is precisely why 131 of 793 rows have `version_id IS NULL`.

### 7.1 The schema

Two new tables. Nothing outside them changes, so nothing can double-count.

```sql
budget_le
  id · budget_year INT NOT NULL · actual_through DATE NOT NULL
  name TEXT NOT NULL · label TEXT
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','final','superseded'))          -- VARCHAR+CHECK, never a PG enum (070)
  superseded_by INT REFERENCES budget_le(id)
  excluded_category_ids INT[] NOT NULL                        -- the resolved scope, snapshotted.
    -- NOT `excluded_account_ids`: §2.2 keys the LE on CATEGORY and budget_le_lines has a separate
    -- account_id dimension, so the old name would get joined to the wrong column.
  note · created_at · updated_at
  CHECK (actual_through >= make_date(budget_year,1,31))        -- §6: no January LE
  CHECK (actual_through <  make_date(budget_year,12,1))        -- §6: no MM=13.
    -- NOT `< make_date(budget_year+1,1,1)`, which accepts 2026-12-31 whose first estimate month
    -- IS 13 -- the case §6 refuses in prose, let through by the CHECK labelled "no MM=13".
  CHECK (actual_through =                                      -- §6: MM = actual_through + 1 month
    (date_trunc('month',actual_through) + interval '1 month - 1 day')::date)
    -- without this, 2026-08-15 is accepted and MM is undefined.
  -- (budget_year, name) uniqueness is a PARTIAL INDEX -- see below, not a table constraint

budget_le_lines
  id · le_id INT NOT NULL REFERENCES budget_le(id) ON DELETE CASCADE
  period_month DATE NOT NULL
    CHECK (EXTRACT(DAY FROM period_month) = 1)                 -- §1 condition 1, as data integrity
  category_id INT REFERENCES accounts(id)                      -- §2.3: exactly one of the two
  account_id  INT REFERENCES accounts(id)
    CHECK ((category_id IS NULL) <> (account_id IS NULL))
  currency CHAR(3) NOT NULL                                    -- part of the GRAIN, see below
  source  TEXT NOT NULL CHECK (source IN ('actual','budget_carry','manual'))
  method  TEXT NOT NULL CHECK (method IN ('ACTUAL','CARRY','PHASE_TO_YTD','TRAIL_3','ZERO','MANUAL'))
                                        -- TRAIL_3 is P1, but it goes in THIS CHECK: otherwise P1
                                        -- needs a whole migration to widen a constraint the first
                                        -- one could have got right. List every method the roadmap knows about.
  method_input jsonb                    -- the advisory's operands, kept even when not taken
  amount NUMERIC(15,2) NOT NULL · base_amount NUMERIC(15,2) NOT NULL
  fx_rate NUMERIC · fx_basis TEXT CHECK (fx_basis IN ('budget','transaction','spot','manual'))
  snapshot_row_count INT · snapshot_sum NUMERIC(15,2)          -- actual rows only; NULL on estimates
  note TEXT
  INDEX (le_id, period_month)

-- ⚠️ `UNIQUE (...) WHERE ...` is NOT a valid table constraint in Postgres. These are indexes, and
-- the point of this block is DDL that is right the first time:
CREATE UNIQUE INDEX ... ON budget_le_lines (le_id, category_id, period_month, currency)
  WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX ... ON budget_le_lines (le_id, account_id,  period_month, currency)
  WHERE account_id  IS NOT NULL;
CREATE UNIQUE INDEX ... ON budget_le      (budget_year, name)  WHERE status <> 'superseded';
CREATE        INDEX ... ON budget_le      (budget_year, actual_through DESC)
  WHERE status <> 'superseded';   -- the picker
```

⚠️ **`currency` is part of the grain, and leaving it out would have been the CR037 bug again.**
Measured on 2026 inside the LE scope, **38 budget category-months and 81 actual category-months hold
more than one currency** — `Bank Fees` holds **three (EUR, PLN, USD) in both 2026-06 and 2026-09**,
and 2026-09 is *in the estimate window*. A single `amount · currency · fx_rate` per category-month
would have been right for one slice of that cell and silently wrong for the rest, and §5's "store the
rate so restate-at-spot is a one-line recompute" would have failed with no signal. `base_amount` is
what the grid sums; `amount`/`currency`/`fx_rate` describe one currency slice.

⚠️ **The two `UNIQUE`s are partial for a reason.** With `category_id` nullable (§2.3), a plain
`UNIQUE (le_id, category_id, period_month, currency)` enforces nothing on account rows — in Postgres
every NULL is distinct, so unlimited duplicates would be accepted. This is
[migration 070](../current/migrations.md)'s `UNIQUE(account_id)` lesson, in reverse. Note also that
`budget_entries` itself has **no** unique constraint on its own grain, which is part of why 72 of its
rows drifted uncategorised.

⚠️ **`recut` is SUPERSEDE-then-INSERT, in one transaction — and the other flow this CR described is
impossible.** An earlier version of this paragraph said `recut` *"creates the draft first and marks the
old one superseded in the same transaction as the new one's finalise… between the two, the picker
shows the final LE plus its draft."* Migration review demonstrated that it cannot work: inserting a
`draft` `LE-08-26` while a `final` `LE-08-26` lives raises
`duplicate key value violates unique constraint "budget_le_year_cut_uniq"`. The index encodes
supersede-then-insert, and P0b must be built to that flow.

**The consequence to design for:** between the supersede and the insert there is no live LE for that
cut, and if the new draft is later deleted the owner is left holding only a superseded artefact
(`ON DELETE SET NULL` clears the pointer but not the status). The route owns that — either refuse to
delete the last LE of a chain, or restore its predecessor.

⚠️ **Uniqueness is keyed on the CUT, not the name.** §6 says the name is a label and *"never key
anything on the string"* — and the first schema did exactly that. Review showed the hole: `le-08-26`,
`LE-08-26 ` (trailing space) and an `LE-08-26` whose `actual_through` was 2026-02-28 were all
accepted, leaving **two live LEs on one cut**, so the supersede rule held only while the name
generator stayed byte-deterministic. `budget_le_year_cut_uniq (budget_year, actual_through)
WHERE status <> 'superseded'` now carries it; `actual_through` is already pinned to a month end, so
within a month it is uniquely determined. The name index is kept as well, and it too must be partial
or §6's supersede path is unreachable. §6 defines
`name = LE-MM-YY` from `actual_through` and says a second LE in one month *keeps both rows*. Two LEs
in one month share `MM`, so they share the name, and the second `INSERT` would raise a unique
violation. The partial index above resolves it, and the supersede must therefore be **one
transaction** (mark the old `superseded`, then insert).

**Measured, not estimated: 760 rows for an August 2026 LE** — 525 actual (93 categories, 3
currencies) + 235 estimate (66 categories, 3 currencies). The earlier "≈1,116" assumed a **dense**
93 × 12 grid; the materialisation is **sparse**, and that is a deliberate choice rather than an
accident of the query:

⚠️ **Sparse, because "no budget line" and "estimated zero" are different facts and L4 depends on
telling them apart.** A dense grid writes a zero row for every category-month with no budget, and
then `estimate_rest = 0` means both *"nothing was ever budgeted here"* and *"the owner deliberately
zeroed it"* — collapsing exactly the distinction **L4** exists to police (`budget_rest ≠ 0` and
`estimate_rest = 0` with no note, worth **−66,381** on `Taxes US` and `Property Tax - US`). Sparse
keeps the difference: a missing row is silence, a zero row is a decision.

**The grid is therefore 94 rows deep, not 93** — the union of *has actuals* (93) and *has remaining
budget* (66). **28 categories have YTD actuals but nothing budgeted for the rest of the year** (bucket
A or E), and **1 has remaining budget but no actuals** (bucket B). Both must render: the first with an
empty, editable estimate half, the second with an empty YTD. **The UI must treat an absent cell as
editable-empty and INSERT on first edit**, not as zero.

**No new exclusion flag** — §2 uses `is_transfer` (already TRUE on the right 13 accounts) plus
`id <> 88`, so the migration adds **no column to `accounts` at all** and there is nothing to seed and
nothing needing a writer endpoint. The first draft proposed `accounts.exclude_from_le`, shipping
`DEFAULT false` with no writer and no screen — which would have meant that **on day one the LE
included `Unrealized G/L` and landed at +44,259**, the exact number §2 exists to prevent, with L7
unable to say what it was warning about.

**P0 writes category rows only** and the API refuses `account_id`; the second dimension exists so
that §2.1's open question is a classifier branch rather than a migration (§2.3). A plain
`UNIQUE (le_id, category_id, period_month)` would **not** have enforced uniqueness once
`category_id` went nullable — in Postgres every NULL is distinct, so unlimited duplicate account
rows would have been accepted. Hence the two partial indexes. Note also that `budget_entries` itself
has **no** unique constraint on `(version_id, category_id, entry_date)`, which is part of why 72 of
its rows drifted uncategorised.

⚠️ **`ci-seed.sql` has nothing to build an LE on.** It is 34 lines and creates five accounts
(`Unrealized G/L` 88, `Transfer - Securities Trades`, `Financial Income - Dividend`, `Option Trade`,
`Interest Income`) and **zero `budget_entries`, zero `budget_versions`**. So every LE server test must
seed and clean up its own COA + budget rows **and resolve every category id by name** — Known Issue
#21 is this exact shape (CR080's suite hardcoded `INTEREST_INCOME = 74`, which is **11** on a
CI-built DB, so all 12 of its tests failed the day they shipped), as is #20. A DB-backed suite seeds
its own fixtures and never reads ambient data: `SELECT … LIMIT 1` passes on dev, whose database is
full, and dies in `beforeAll` on CI's.

### 7.2 API

`GET/POST /api/v2/budget/le` · `GET/PATCH/DELETE /le/:id` · `POST /le/:id/finalize` ·
`POST /le/:id/recut` (supersede + insert, **one transaction** — §7.1) · `GET /le/:id/lines` ·
`PATCH /le/:id/lines` (batch) · `GET /le/:id/advisories` · `GET /le/:id/drift` ·
`POST /le/:id/seed-budget?year=` (P2, and see §11.4). **No `/le/closed-through`** (§1.2
removed the concept) and **no `/le/compare`** (§11.1 — the comparison surface is cut).

⚠️ **Route order and file layout are gates, not style.** Any literal segment must register **before**
`GET /le/:id` or Express 5 binds it to `:id`; the existing file already gets this right
(`/entries/summary/*` at `budget.js:229` precedes `/entries/:id` at `:274`). And
`Scripts/check-api-envelope.sh` globs `server/src/v2/routes/*.js` **only**, so a nested
`routes/budgetLe/index.js` would escape the gate entirely — use a flat `routes/budgetLe.js`. Every
handler returns `{ data: … }`.

⚠️ **Transactionality is not just `recut`.** `POST /le` materialises ~1,116 rows,
`PATCH /le/:id/lines` is a batch, and `finalize` writes the snapshot columns across every actual row.
**Each runs in a single transaction.** CR037's non-transactional multi-row write is on this CR's own
risk list, and **L10 is the only thing that would ever notice a half-written LE**.

**All proposal arithmetic is server-side** and returns its operands
(`{categoryId, basis, operands, perMonth, monthsAffected, lineFyBefore, lineFyAfter, churn, reason}`
— an **advisory** payload; nothing is written until the owner acts),
inside the envelope. The frontend renders the sentence; it never re-derives money.

---

## 8. What the LE must NOT touch

### 8.1 The forecast base year (CR075) — **no. Read-only comparison only.**

1. **It contradicts the owner's own definition.** CR075 §1 records it verbatim: *"forecast year −1 =
   BUDGET"*. An LE is not a budget. Changing that definition is a different CR, and a
   scenario-moving one.
2. **A base-year error rides all 36 years.** `index.js` does `startingCash += budgetNCF +
   transfers`, and the sweep pins cash to its band every year, so it **does not wash out** — CR075
   §2 is explicit that this is the CR049 failure mode, found three times in that one function.
   Concretely: feeding the LE would move the base year from **−137,555** to **−102,999** (carry) or
   **−93,664** (proposed) — a **+34,556 to +43,891** change in opening cash, compounding to 2062. The
mechanism is `services/forecast/index.js:579`, `startingCash += budgetNCF + baseYearTransfers`, and
`getBaseYearValues(2026)` summed over `fc_lines` is **exactly −137,555**.
3. **The base year would then move every month.** Two scenarios generated in different months would
   silently carry different base years — and the project's strongest gate, before/after on an
   idempotent engine, **cannot see a wrongly-derived number**
   ([failure-patterns #3](../current/failure-patterns.md)). That is exactly how CR076 §2's five
   published figures survived.
4. **The category sets differ.** The budget covers 85 categories; the LE's actual half brings in 8
   unbudgeted ones, and unless §2's exclusions hold on *every* path, `Unrealized G/L` (+213,595,
   unmapped) and `Option Trade` (+25,351 vs a 14,000 budget).

**Build instead:** on `FCReview`, an optional **third reference column** beside the year −1 budget,
labelled `LE-08-26`, **displayed and never summed**, with a note — *"the plan's base year is the
2026 budget (−137,555); the latest LE says −102,999 (+34,556)."* That tells the owner the plan's
year −1 is stale, which is real information, without moving a stored entry. **P2.**

### 8.2 `fcLines.getBudgetTotals` — no by default; an opt-in column at most, through the identical
CTE, never summed with the budget. CR075 §3's invariant is that the base-year column and the stream
cards cannot be allowed to disagree about which accounts a line covers.

### 8.3 `reports.js` category trend and `v_budget_vs_actual` — **untouched.** They need no change at
all, because the LE lives in its own tables. That is most of the argument for §7.

---

## 9. Warnings

Each rule states the number it protects, measured on today's data.

| id | rule | trigger | protects |
|---|---|---|---|
| **L1** | `le-month-may-be-incomplete` | month `actual_through`'s row count or value is materially below the trailing median for the same elapsed-days window — **an arrival-lag test, never a reconcile test, and always advisory** (§1.2: the reconcile signal exists for 11 of 113 accounts) | the actual half. On this book it is worth **$664**, which is why it advises rather than gates |
| **L2** | `le-actuals-drifted` | live actual ≠ snapshot **per frozen MONTH, aggregated across categories** (not per line, not per currency slice, not per LE) by > $250 **or** > 5 rows. ⚠️ The grain must be stated or the rule fires always or never: July's real drift is +663.82 / 85 rows in **aggregate** and thin per line | LE-vs-LE comparability. **85 rows / +$664** landed for July in 16 days |
| **L3** | `le-annualised-a-lumpy-line` | a non-`CARRY` method on a bucket-A or bucket-B line | **$136,288** on `UB Dividend`. **Blocks** auto-propose; warns on a typed figure |
| **L4** | `le-dropped-committed-cost` | `budget_rest ≠ 0` and `estimate_rest = 0` with no `note` | **−$66,381** (`Taxes US` −55,000 Dec, `Property Tax - US` −9,800 Nov) |
| **L5** | `le-unbudgeted-actual-not-estimated` | YTD actual, no budget, no LE estimate | 8 lines / −$2,033 today; the class grows |
| **L6** | `le-uncategorised-allowance-double-count` | categorised estimates **and** uncategorised account-level budget rows for the same account/period | **−$35,900** in the Aug–Dec window (−86,796 FY) |
| **L7** *(server invariant + test, NOT a screen warning — §11.1)* | `le-excluded-category-present` | a transfer / `Unrealized G/L` / `Valuation - Historical` row reached the LE | **+$213,595** of MTM alone |
| **L8** | `le-fx-basis-stale` | the rate a carried row was computed at differs > 3% from the latest market rate (§5.1 — **the row's own rate, not the declared table rate**) | **PLN carries 3.51–3.74 against a 3.7299 market**; declared-vs-market is only **4.8%** and stored-vs-declared is **$1,054** |
| **L9** | `le-proposal-guard-fired` | any of §3.4's **four** guards refused a line — sign flip, clamp hit, tiny denominator, or **churn ≥ 3.0** | ⚠️ the first draft claimed L9 caught `Option Trade`. It did not: r = 3.10 is *inside* the clamp and the signs agree. The churn guard is what catches it, and it is worth **$12,275** |
| **L10** | `le-does-not-tie` | `Σ(month lines) ≠ header FY total`, or `Σ(actual months) ≠ live actual at snapshot time` | the reconcile invariant. **Must exist in P0** |
| ~~L11~~ | ~~`le-coverage-changed`~~ | — | **CUT with the comparison surface** (§11.1) |

⚠️ Two lessons already paid for. [failure-patterns #2](../current/failure-patterns.md): **five of
eight forecast warning rules were tested for FIRING and were wrong in their sentence** —
`unfunded-shortfall` summed a cumulative figure and showed $1.2M for a $1,017,119 gap. Every L-rule's
copy is asserted against real rows, and where it reports a quantity the quantity is asserted.
[failure-patterns #5](../current/failure-patterns.md): **L2 in particular needs a fixture where a
row lands *after* the snapshot**, falsified against the unfixed code, or it passes vacuously forever.

---

## 10. The screen

### 10.1 IA — one new page, one new nav item

```js
{ path: "/budget-le",       component: BudgetLE, label: "Latest Estimate",
  category: "Budgeting", icon: TrendingUp,
  description: "Full-year latest estimate — actuals to date plus an estimate for the rest of the year" },
```

**One route, no tab strip, no `:view` segment** — §11.1 cut the compare and versions tabs, so there
is a single screen. The LE being worked on is a **query param**: `/budget-le?le=LE-08-26`, defaulting
to the newest non-superseded LE for the current year.

Budgeting goes 3 → 4 items; top-level sections unchanged, so CR042's ≤8 holds.

**Why not the alternatives.** A fourth tab on `/budget-vs-actual` — those three tabs are three
renderings of *one period query*, all read-only, all driven by one `PeriodSelector`; an editable
full-year document would make the period control mean something different on one tab, which is the
drift CR042 removed, and it puts a write surface behind a report URL. A mode of `/budget-worksheet` —
that page is single-category, single-month, one entry at a time; an LE mode replaces the entire page
body, i.e. a new page wearing an old URL (no deep link, no ⌘K entry, back-button ambiguity).

### 10.2 The grid — remaining months only

**Owner decision, 2026-08-16: one YTD column, not seven monthly ones.** The LE's primary use is the
**landing number**, not the month-by-month series, so the actual half needs to be *present and tying*
— it does not need to be spread across columns nobody can edit. `/budget-vs-actual` already shows
the month-by-month shape, with drill-down, and does it better.

Eleven physical columns (a 260px label + ten numeric/text) on a 1440 laptop — **no horizontal scroll, prints portrait**:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Latest Estimate            [ LE-08-26 ▾ ]   Draft · 4 unsaved edits          [ Save ▾ ] │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌FY2026 landing──┐ ┌Income FY────┐ ┌Expenses FY──┐ ┌% of yr actual┐                     │
│ │   (102,999)    │ │   434,218   │ │  (537,217)  │ │  7 of 12     │                     │
│ │ ▲ +34,556 vs bd│ │ ▲ +42,356   │ │ ▼  (7,800)  │ │  Jan–Jul     │                     │
│ └────────────────┘ └─────────────┘ └─────────────┘ └──────────────┘                     │
│ Actuals Jan–Jul · Estimate Aug–Dec · USD; non-USD at the rate each row carries † (§5.1)  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ [Filters 1] [Reset]                                              [ Export ] [ Print ]   │
├──────────────────────┬──────────╥──────────────────────────────┬────────┬────────┬──────┤
│                      │  ACTUAL  ║   ESTIMATE — Aug–Dec 2026    │        │        │      │
│ CATEGORY             │ JAN–JUL  ║  AUG   SEP   OCT   NOV   DEC │FY TOTAL│ BUDGET │ VAR  │ BASIS
├──────────────────────┼──────────╫──────────────────────────────┼────────┼────────┼──────┼──────
│ ▾ Income             │  361,183 ║ ...                          │ 434,218│ 391,862│+42,356│
│    Interest Income ⓘ │   38,139 ║[ 4,000][ 4,000][ 4,000][ 4,000][ 4,000]│ 58,139│ 46,000│+12,139│Budget
│      ⓘ  YTD 38,138.55 ÷ budget-YTD 25,999.86 = 1.466875 → 5,867.47/mo → FY 67,475.90    │
│ ▾ Expense            │ (335,500)║ ...                          │(537,217)│(529,417)│(7,800)│
│    Bank Fees      ▲  │  (3,966) ║[  (413)][  (413)][  (413)][  (413)][  (413)]│(6,031)│(3,449)│(2,582)│Typed
│    Taxes US       ⚠  │        0 ║[     0][     0][     0][     0][(55,000)]│(55,000)│(55,000)│  —  │Budget
├──────────────────────┼──────────╫──────────────────────────────┼────────┼────────┼──────┼──────
│ NET                  │   25,684 ║ ...                          │(102,999)│(137,555)│+34,556│
└──────────────────────┴──────────╨──────────────────────────────┴────────┴────────┴──────┴──────
  ‖ left is fact · right is your estimate       [ ] = editable      † see /budget-fx
  ⓘ an advisory (§10.4)   ▲ you typed it   (no mark) carried from budget   ⚠ lumpy, no advisory
```

⚠️ **Column budget: 11 physical columns** — label + YTD + 5 estimate + FY + Budget + Var + Basis —
at ~89px each on 1440 with the sidebar. **That is the ceiling, and P1 must respect it.** §12 rank 3
(timing-vs-permanent) is **two figures per line** and does **not** fit: it lives in
`BudgetDetailModal` and the export, not the grid. "No horizontal scroll" is the guarantee §10.6 leans
on to delete the print hazard at its root, so breaking it in P1 would re-open a defect this CR closed.

⚠️ **Every figure in that mock ties, and it must stay that way — it is the builder's KPI spec.**
361,183 − 335,500 = **25,684**; 434,218 − 537,217 = **−102,999**; +42,356 − 7,800 = **+34,556**.
Round 2 caught the previous version where Income FY + Expenses FY came to **+128.4K** against a
stated landing of **(102,999)**, and the YTD columns to **67,800** against a stated **25,684** — the
same class as round 1's fabricated `Interest Income` budget, in the section that replaced it.
**L10 must pass on this picture before it passes on any data.**

**Double-click the YTD ACTUAL cell** → `features/Budgets/BudgetDetailModal.jsx`, the same modal
`/budget-vs-actual` already uses. That is where the month-by-month detail lives, and reusing it costs
nothing.

**No column modes, no mode toggle, no sticky first column, no horizontal scroll.** The first draft
carried three modes plus the sticky-column machinery from `PageLayout.css:2540-2585`, and the whole
of that is now unnecessary — which also removes the print-clipping hazard at its root rather than
mitigating it (§10.6).

Hierarchy rows use `BudgetRealization.jsx:552`'s `expandedPaths` (it stores *deviations from
collapsed*, so a data reload does not slam rows shut — copy that one, not the older inverted version).

### 10.3 The actual/estimate boundary — four independent signals, none of them colour alone

This is the single fact the page exists to communicate, and it must survive dark mode, a mono
printer, and a reader who has not been told the convention.

1. **A column-group header row in words** — `ACTUAL — Jan–Jul 2026` / `ESTIMATE — Aug–Dec 2026` as
   `<th colSpan>` in the existing uppercase micro-label style (`var(--muted)` on
   `var(--surface-muted)`, `DataTable.css:31-43`). Words print and cannot be misread.
2. **A 2px vertical rule** at the seam — `border-left: 2px solid var(--border-strong)` (`#D5D2C9`
   light / `#3F454C` dark; legible on its own surface in both).
3. **Ground tone, not tint** — actual `var(--surface-muted)`, estimate `var(--surface)`. The
   estimate band is the *brighter* surface in both themes, matching "this is where you work". ~2%
   luminance apart: a hint, never the sole carrier.
4. **Affordance** — actual cells are plain text, not focusable. Estimate cells are `<input>`-backed
   with a resting `1px solid var(--border)` box, `var(--primary)` on `:focus-visible` with
   `var(--shadow-focus)`.

⚠️ **Do not use `--primary-subtle` / `--success-subtle` / `--warning-subtle` for the estimate band.**
In dark they are near-black (`#233028`, `#16271F`, `#2A2415`) and read as *disabled* — exactly
inverting their light-mode meaning. That inversion is the shape of all 12 CR026 dark-audit defects.
No `rgba()` gradients, no inline hex.

**Dark-mode checklist for sign-off:** the seam rule on both surfaces · the actual/estimate surface
pair · the `ⓘ`/`▲`/`⚠` marks · the advisory row's figures against the grid beneath it · the KPI colours ·
**and one print from each theme** (browsers print the live DOM; `color: var(--ink)` = `#E2E8F0` on
white paper is near-invisible — `TaxFbar.css` forces `color: #000` in print for exactly this).

### 10.4 The advisory — no accept button

**Owner decision, 2026-08-16: advisory only.** [CR081](cr-081-ai-line-assistant.md) measured
system-proposed-edit acceptance at **0/15, twice**, and `status.md` already records that the next
build is the *consequence preview, no LLM*. Applied literally: a qualifying line shows its suggestion
and **its arithmetic** inline; the owner types the figure if they agree. There is no Accept, no
Accept-all, no drawer and no undo stack, because there is nothing to undo.

```
│    Interest Income ⓘ │   38,139 ║[ 4,000][ 4,000][ 4,000][ 4,000][ 4,000]│ 58,139│ 46,000│
│      ⓘ  YTD 38,139 ÷ budget-YTD 26,000 = 1.467.  Re-levelling the budget's own
│         monthly shape by 1.467 gives 5,868/mo → line FY 67,477 (+21,477 vs budget).
│         7 of 7 months have activity; churn 1.0.            [ use this figure ]
```

Design rules, unchanged from the first draft because they are what makes it checkable:

- **Show the operands, not a verdict.** `38,138.55 ÷ 25,999.86 = 1.466875` is verifiable in two
  seconds; "based on recent trends" is not.
- ⚠️ **State the allocation rule, and make the arithmetic tie.** The version round 2 caught printed
  *"5,868/mo → line FY 67,477"* while a reader multiplying got 5 × 5,868 = 29,340 → **67,479** —
  three numbers for one line, in the example that replaced round 1's wrong example, and **L10 would
  fire on the CR's own showcase.** The rule: **round to 2 dp per month, the last estimate month
  absorbs the residual**, and printed per-month × months must equal the printed line FY. (Aug–Dec
  `Interest Income` budget is **3,999.98**/mo — 500 + 2,000 + 1,499.98 — not 4,000.)
- **State the consequence at line level** — the resulting line FY and its delta vs budget — because
  a suggestion whose effect you cannot see is a suggestion you cannot judge.
- **Say why it is NOT re-levelling**, when it is not: `Option Trade` (churn 29.0) and
  `UB Dividend` (budgeted in 2 of 12 months) render the refusal and the number the naive method
  *would* have given (+12,275 and +136,288), because the refusal is more useful than silence.
- `[ use this figure ]` writes `source='manual'` — it is a typing shortcut, not an acceptance
  workflow — but **`method='PHASE_TO_YTD'` with `method_input={r, budget_ytd, actual_ytd,
  per_month}`**, ⚠️ **not `method='MANUAL'`**. Round 2 caught the contradiction: with `MANUAL`,
  nothing in the system ever writes `PHASE_TO_YTD`, so `method_input` has **no writer**,
  `PHASE_TO_YTD` is a dead CHECK value, and §4.1's *"a row carrying its own operands cannot be
  paraphrased"* — the strongest correctness argument in this CR — has no implementation. `source`
  says who chose it; `method` + `method_input` say how the number was derived. Both are needed, and
  keeping them costs one field in the write payload.

**If the owner ends up using the shortcut on most advisories, the accept/reject drawer is then
justified by evidence** and is a small addition on top. That is the order CR081 argues for.

### 10.5 Provenance, editing, versions

**Provenance: one glyph + one *text* column, never cell colour.**

| state | mark | `Basis` column |
|---|---|---|
| carried from budget | none | `Budget` |
| user-typed | `▲` `var(--accent)` | `Typed` |
| *(an advisory is available on this line)* | `ⓘ` `var(--info)` | — *(the line's own basis is unchanged until the owner acts)* |

⚠️ **There is no `proposed, accepted` state.** §11.1 collapsed `source` to
`actual | budget_carry | manual`, so a figure taken from an advisory is `manual` — identical to one
typed by hand, because that is exactly what it is (§10.4). `ⓘ` marks *availability*, not provenance,
and it disappears once the line is edited.

`--info` (`#8B7BB5`/`#A99BC9`) and `--accent` (`#6B8E6B`/`#8CB68C`) are distinct hues defined in both
themes and collide with neither `--growth-positive` nor `--growth-negative`. The `Basis` column being
**text** is what fixes CR082 defect 3 (two states, one colour) and defect 5 (prose under a `$`
heading) in one move — it prints, it exports, it reads in greyscale. Mixed rows read `Mixed`.
**Roll-up rows carry no mark** — they are sums, and marking them implies an edit that does not exist.

**Editing.** A cell edit applies to **that month only** — a number typed into Sep that silently
rewrites Oct–Dec cannot be attributed by the reader. **The `FY TOTAL` cell is read-only**: §11.1 cut
the spread edit, because it is a second editing model and the *Apply run rate to remaining* row action
already covers the need. Math expressions use
**`frontend/src/utils/amountFormula.js` (`evaluateAmountFormula`)** — the safe recursive-descent
parser with the thousands-comma rule — **not** `evaluateMathInput`
(`features/BudgetEntry/utils/budgetInputUtils.js:428`), which is `new Function(...)`. Two evaluators
already exist; a 1,000-cell editable grid adopts the safe one and the worksheet migration is a
follow-up bullet. Enter commits and moves down; Tab right; Esc reverts; ⌘Z undoes.

Row menu — **two actions, not five** (§11.1 cut *Scale remaining by %*, *Set remaining to 0* and
*Copy Aug across*), each showing its resulting line FY total: **_Apply run rate to remaining_** (the
one the owner asked for by name — and it carries §3.4's four guards, since a manual invocation on a
lumpy line is exactly what L3 exists to stop) and **_Revert line to budget_**, which takes a
`ConfirmModal`.

**Double-click an actual cell → `features/Budgets/BudgetDetailModal.jsx`.** Verifying the actual half
is half of trusting the estimate half, and it costs nothing new.

**Saved LEs are a picker, not a tab** (§11.1 cut the Compare and Versions tabs — they served the
frozen-series reading the owner did not pick). The header dropdown lists
`NAME · ACTUALS THROUGH · FY NET · STATUS`, newest first, with *Delete* behind a `ConfirmModal`. On
day one it holds exactly one row, which is the whole argument against building two tabs for it.

**Headline KPIs** (`components/KpiCards.jsx`): FY landing (vs Budget) · Income FY · Expenses FY
(`positiveIsGood: false`) · **% of year actual**. Under them a **text strip, not a fifth card** — *"Actuals
Jan–Jul (7 of 12 months, 58% of the year) · Estimate Aug–Dec · All figures USD"*; % of year actual
is on the card here because §11.1 cut the *vs prior LE* card with the series. Pass `chartColor="var(--chart-emerald)"`, **never** a hex literal — `BudgetRealizationContent.jsx` carries four (`:97` `#5B8C5B`, `:111`
`#C0504D`, `:125` `#567856`, `:142` `#8b5cf6`), all in the `check-inline-hex.sh` baseline, and new
ones fail CI. (The first draft said all four were `#5B8C5B` and cited `:110`.) `formatKpiValue` compacts to `$1.2M`: fine on a
card, never the only place a number appears.

### 10.6 Print and export — the hazard is now removed, not mitigated

The first draft needed a bespoke landscape print stylesheet, because a 12-month grid in a
`overflow:auto` container with a sticky first column is exactly the shape that clipped the money
column off CR082's FBAR working papers. **§10.2's ten-column grid does not scroll sideways at all**,
so the class of defect cannot occur. Three requirements remain, all cheap:

1. **A print-only header block** naming the LE, the fiscal year, the actual/estimate boundary, the
   currency and FX basis, and the print date. Pattern: `.tfb-printhead`, `pages/TaxFbar.css:304-320`
   — there, the tax year lived only inside an `<input>`, which print hides, so the sheet never said
   which year it was for. Here the LE name lives in a picker. Same bug, one line of prevention.
2. **The bands become rules, not tints** — tinted panels turn to grey mush on a mono printer (already
   fixed once for `.tfb-rates`). Keep the seam rule, the group-header words and the `Basis` column;
   drop the surface tints. And print once **from dark mode**: browsers print the live DOM, and
   `color: var(--ink)` = `#E2E8F0` on white paper is near-invisible, which is why `TaxFbar.css`
   forces `color: #000` in print.
3. Hide the KPI cards, toolbar, buttons and filters (`Layout.css:75-103` already removes the
   shell); `tr { page-break-inside: avoid; }`.

⚠️ **Still worth recording for whoever touches the neighbours:** `PageLayout.css` contains **zero**
`@media print` blocks (verified) while `.budget-realization-scroll` at `:2425` is `overflow:auto` +
`max-height` with a sticky `thead` at `:2540-2585`. So `/budget-vs-actual` and `/cash-flow-periods`
carry the CR082 print defect **today**. CR083 no longer inherits it; it does not fix it either. One
roadmap bullet.

**Export** — `exportLatestEstimate` in `frontend/src/utils/excelExporter.js`. Header rows: LE name +
label, FY, actuals-through, currency + FX basis, generated timestamp. Then per category: path,
**YTD Actual**, Aug…Dec, FY Total, Budget FY, Var, **`Basis`**, **`Provenance`**. Values through
`formatNum` (raw rounded — parenthesised negatives break `SUM`). The last two columns are the reason
the export is worth anything three months later.

### 10.7 Mobile — **nothing in P0/P1.**

A grid with five editable month columns on a phone is horizontal scroll, which the mobile shell's contract forbids,
and building an LE is deliberate desk work. **P2, optional:** a read-only block appended to
`/m/budget` (`mobile/pages/MobileBudgetRealization.jsx`) — three figures in the existing `m-kpi`
markup plus the top 8 lines by |LE − Budget| in the existing `m-var` list. **No new route and no 6th
`MobileTabBar` tab** — v3.4.8 blanked the whole app on a mobile-shell regression.

### 10.8 Reuse ledger

**Reuse:** `config/routes.jsx` (the single nav source) ·
`components/KpiCards.jsx` · `components/DataTable/DataTable.jsx` (+ its `@media print` block as the
model) · `components/Modal/Modal.jsx` · `components/ConfirmModal/ConfirmModal.jsx` ·
`components/buttons.css` · `components/HierarchyFilter/` + `utils/hierarchyFilterGroups.js`
(**`BudgetWorksheetV2.jsx:135-172` hand-rolls what that module already exports — import it, do not
make a third copy**) · `EmptyState` / `LoadingSpinner` / `ErrorBoundary` ·
`features/Budgets/BudgetDetailModal.jsx` · `budgetInputUtils` (`formatCurrencyValue`,
`MONTH_OPTIONS`) · `utils/amountFormula.js` · `hooks/useCoa.js` (`plTree`) · `js/rest.js`
(`Rest.unwrap`) + TanStack Query (**not** `BudgetRealization.jsx`'s raw `useEffect`+`fetch`) ·
`utils/excelExporter.js` · `utils/chartTheme.jsx`.

**Genuinely new — four files** (the drawer is cut with §11.1, and the grid is now ten columns):
`pages/BudgetLE.jsx` · `features/BudgetLE/LEGrid.jsx` · `LECell.jsx` · `LEGrid.css` (with its
`@media print` written at the same time as the screen styles). `DataTable` supports neither grouped
headers, `tfoot`, hierarchy nor a frozen column; bending it into an editable matrix would degrade
the primitive for its 10 current callers. `LEGrid` reuses the `.data-table` class names and visual
language, as its own component.

**CI gates this design could trip:** `check-button-css.sh` (no `le-*-btn` — CR082 defect 1 was
exactly this) · `check-modal-adoption.sh` · `check-inline-hex.sh` · `check-dead-tokens.sh` (zero
baseline; every token named above was verified defined in both themes) · `check-lint-debt.sh`. **None
should need a baseline bump; if one does, this CR must say why.**

---

## 11. Phasing

**Owner decisions, 2026-08-16 (§15):** the LE is **primarily a landing number**, secondarily an input
to next year's budget build — *not* a frozen series. **P0a and P0b are committed together.** It runs
**in parallel with the CR082 TY2025 remainder**, in a **git worktree** (Known Issue #23 — agent
threads on one shared tree have already committed over each other twice; the contended files are
`config/routes.jsx` and `utils/excelExporter.js`).

| | scope | why this gate |
|---|---|---|
| **P0a** | **No schema, no new page, and it does NOT re-base the existing page.** An **FY-landing KPI on `/budget-vs-actual`** — *"FY2026 landing at carry: (102,999) · budget (137,555) · YTD variance +34,556"* — which **computes §2's scope itself (`NOT is_transfer AND id <> 88`) and names it beside the figure**. The table below it keeps its current numbers and its current transfer convention. See §11.2. | Delivers the **primary** use in about half a day, purely additive, and moves no number the owner already reads. |
| **P0b** | Migration **072+** (the two tables, nothing seeded). **Drift (`L2`) ships HERE, not in P1** — see §11.3. The **calendar-month cut** (§1.2), overridable both ways. Scope per §2, keyed on category (§2.2). **The grid (§10.2): one YTD ACTUAL column + Aug–Dec editable + FY / Budget / Var / Basis — ten columns, no modes, no sticky column, no horizontal scroll.** Per-cell editing, two row actions (*Apply run rate to remaining*, *Revert line to budget*), the boundary treatment (§10.3), the FX banner, print + export (§10.6). Warnings **L1 + L2 + L4 + L6 + L10** — L1 and L6 had no phase at all in the first pass, and L6 is
the one guarding §2.1's −35,900 double-count, whose memo line P0b ships. Plus §5's **refusal to run
`budgetFxRates.recalculate` while a draft LE exists** for that year. Finalise → immutable; **`POST /le/:id/recut`** (supersede + insert, one transaction). **No proposal machinery.** | The artefact itself. The narrowed grid removes about a third of the frontend work *and* the print-clipping hazard at its root. |
| **P1** | The bucket classifier + `PHASE_TO_YTD` **as an inline advisory with no accept button** (§10.4), including the four guards and the refusal copy. `TRAIL_3` / `ZERO` as manual overrides. **The timing-vs-permanent variance split** (§12 rank 3). Warnings **L3, L5, L8, L9**. | The advisory is a fraction of the drawer and tests the premise CR081 measured at 0/15 twice. The variance split is what makes P1 more than cosmetic. |
| **P2** | 🆕 **Seed next year's budget from an LE** — the owner's stated secondary use, **not in the first draft at all and NOT YET SPECIFIED ENOUGH TO SCHEDULE (§11.4)**. Plus the read-only LE reference column on `FCReview` (§8.1) — displayed, never summed. Optional restate-at-spot; optional read-only `/m/budget` block. | Wants a real LE to exist first. **The seed is the only data-mutating thing in this CR** and it does not get scheduled until §11.4's gaps are closed. |

### 11.1 Cut by the owner's answers — do not build these

- **The Compare tab, the Versions tab, the LE-vs-prior-LE walk, the trend chart, `PY_SEASON` and
  `L11`.** All of them serve the *frozen series* reading, which the owner explicitly did **not**
  pick. A minimal saved-LE list is still needed to re-open one; a comparison surface is not.
- **The accept/reject drawer, `proposed_amount`, the `proposed_accepted` / `proposed_rejected`
  sources and the undo stack** — superseded by §10.4's advisory. `source` collapses to
  `actual | budget_carry | manual` — **and `method` is NOT collapsed with it.** `method` keeps
  `PHASE_TO_YTD` and gains `TRAIL_3`: the advisory writes `source='manual'` with
  `method='PHASE_TO_YTD'` and its `method_input` (§10.4/B9), so both values are live. ⚠️ This bullet
  used to say the advisory writes `MANUAL` and to *"update §7.1's CHECK lists accordingly"* —
  following that would have re-created the dead-value defect B9 fixed **and** dropped `TRAIL_3` from
  the CHECK round 2 deliberately widened.
- **Three column modes, the mode toggle, the sticky first column and the landscape print block**
  (§10.2, §10.6).
- **The FY-total spread edit and three of the five row-menu actions** (*Scale by %*, *Set remaining
  to 0*, *Copy Aug across*).
- **L7 as a screen warning** — if an excluded category reaches the LE the *query* is wrong. That is a
  server-side invariant plus a test, not something to ask the owner to catch.

### 11.2 P0a's blast radius — additive, and the reason is FRAGILITY, not wrong figures

⚠️ **The first version of this section asserted two "verified consequences" that are both false, and
they were its entire justification.** Round 2 falsified them; recorded here rather than patched away,
because this is the CR's fourth instance of failure-pattern #1 and the first where the wrong claim
had already been repeated to the owner.

What was claimed, and what is true:

| claimed | actually |
|---|---|
| `extractTransferCategories` *"misses `Return of Capital` (217) and `Valuation - Historical` (229)"* | ❌ **False.** It matches the **parent** node `Transfers` on `.includes('transfer')`, then `collectLeaves(node.children)` pushes **all 13** leaf descendants (`services/budget.js:86-101`). Verified live: `transfers=exclude` → 110 leaves, both absent; `transfers=include` → 122 leaves, both present, delta exactly **−30,437.52** — the full subtree |
| *"does not exclude `Unrealized G/L` (88) at all … the +213,595 is in those figures today"* | ❌ **False.** `reports.js:251` defaults `includeUnrealizedGL = false` and `:404` drops the node; `MobileBudgetRealization.jsx:91,97` pass `false` explicitly. It is **not** in those figures. (The budget side has no such option, but there are **zero** 2026 budget rows on 88.) |

**So `/budget-vs-actual` is not wrong today, and P0a is still additive — for a different reason.** The
difference between the two exclusions is **mechanism**, and the name walk is fragile in two ways the
predicate is not:

- rename `Transfers` and the exclusion **silently stops working**;
- add a `profit_loss` leaf named `Transfer - x` **outside** the subtree and it is **silently
  excluded**.

`accounts.is_transfer` is TRUE on exactly the right 13 accounts and survives both. But swapping a
live page onto a different predicate is a change to numbers the owner reads weekly, needs a
before/after on four surfaces, and is not this CR's job.

| | scope | cost |
|---|---|---|
| **(a) additive KPI — CHOSEN** | The KPI computes `NOT is_transfer AND id <> 88` itself and **states that scope on the card**. The existing table keeps its own convention. | ~½ day, moves nothing |
| (b) re-base the page | Switch `getCashFlow` to `is_transfer`. | 1.5–2 days, four surfaces to re-check, and it fixes fragility rather than a live wrong number |

⚠️ **Two conventions on one screen is a real cost, and the KPI will NOT tie to the table beneath
it** — by **$60.36** today (§2.1a's parent-posted rows, which the report cannot see) and by **$1,054**
if P0a and P0b pick different FX bases (§5.1 fixes that: both carry stored `base_amount`). **The card
states its own scope and says it differs**, or it derives from the same service as the table. Silently
putting two differently-derived numbers on one screen is how a reader loses trust in both. The re-basing is a roadmap bullet.

⚠️ **And `extractTransferCategories` is duplicated verbatim** in `services/budget.js:72` and
`services/reports.js:362` — failure-pattern #4, live, today. Also a roadmap bullet.

### 11.3 Why drift (L2) moved from P1 into P0b

§4.2 is the CR's own correctness argument: *"a pure freeze is quietly wrong"*, evidenced by July
gaining **85 rows / +$663.82 in 16 days**. P0b ships the freeze — finalise → immutable, actuals
snapshotted — and the first draft put the figure that makes that freeze *honest* in P1. Between the
two, a finalised LE can diverge from the ledger **with no signal**, and since only P0a and P0b are
committed, that gap had no end date.

Drift is a query over `snapshot_row_count` / `snapshot_sum`, which the migration already stores. It
is hours, not days. **Shipping an immutable artefact without it is shipping a number that can quietly
stop being true.**


### 11.4 P2's seed-next-year is not schedulable yet — three gaps and a risk the CR did not name

`POST /budget/le/:id/seed-budget?year=2027` would write a `budget_versions` row plus ~800
`budget_entries` from the LE's FY shape. **It is the only data-mutating operation in this CR**, into a
table eleven functions aggregate. Unspecified today, and all three must be closed before it is scheduled:

1. **What seeds** — the LE's per-month shape, or the FY total re-spread? Is inflation applied?
2. **Idempotency and collision** — **2027 already holds 12 rows**, and `budget_entries` has **no unique
   constraint on its own grain** (§7.1), so a double-run duplicates *silently*. That is the
   back-fill-duplicate shape that has already cost this project real money
   ([CR059 §22](cr-059-fintable-api-ingestion.md)). **A dry-run/preview and a delete path are
   prerequisites, not polish.**
3. **Reversibility** — how the owner undoes a seed they did not want.

⚠️ **The risk the CR missed, verified in code.** §7 records `budget_entries`' **eleven** readers as
*version*-blind. `fcLines.findAll` is also **year-blind**:

```sql
LEFT JOIN budget_entries be ON be.category_id = dl.id
  AND ($1::int IS NULL OR be.budget_year = $1)          -- repositories/fcLines.js:44
```

`routes/fcLines.js:17` passes **`null`** when `budgetYear` is absent, and
`FCModulesEdit.jsx:402` calls `Rest.get("/fc-lines")` with **no year**. So the per-category
`budget_total` inside `findAll`'s `categories[]` sums `budget_entries` across **every year**.

⚠️ **Corrected on round 2 — the path first cited here was wrong.** `FCModulesEdit.jsx:407-408`
builds its `totMap` from the **second, year-scoped** call (`/fc-lines/budget-totals?budgetYear=…` at
`:403`), and `FCLineMapping.jsx:48` always passes a year. **The year-blind figure is real and
reachable; the specific consumer named was not.** Today 2027 holds **12 rows / −3,600** and the
contamination is trivial; **seeding ~800 rows into 2027 is what makes it material**, so the seed is
the thing that turns a latent year-blindness into a wrong number. Find the live consumer before
building P2.

⚠️ **And a second-order reversal to state deliberately rather than discover.** §8.1 gives four
arguments for refusing to let the LE feed the forecast base year. Once [CR064 P2](cr-064-forecast-annual-close-and-assumptions.md)'s
annual close moves `PeriodStart` to 2028, [CR075](cr-075-base-year-is-the-budget.md) makes the base
year the **2027 budget** — which, if P2 seeded it, is LE-derived. **The refusal holds this year and
quietly reverses the next.** Decide it on purpose.


## 12. The headline figures, ranked

Re-ranked after the owner's 2026-08-16 answers: the **landing number is the point**, the series is
not, so what was rank 4 drops out of the build entirely (§11.1).

| rank | figure | why it earns the space |
|---|---|---|
| **1** | **FY landing, with the actual/estimate split shown** — `−102,999 = +25,684 actual (7m) + −128,682 estimate (5m)` | the number the feature exists to produce, and it reconciles on its face. **P0a delivers exactly this** |
| **2** | **LE vs Budget, FY and by line, with the driver** — `+34,556 favourable` | the decision: better or worse, and because of what |
| **3** | **Variance split: timing vs permanent** — per line, `budget_ytd − actual_ytd` (realisation) vs `budget_rest − estimate_rest` (a changed view) | stops the owner acting on a phasing artefact. `Purchases - Kasia` is −1,407 unfavourable YTD with **zero** remaining; `Taxes US` is 0/0 YTD with −55,000 still to come. Opposite situations that rank 2 alone cannot tell apart |
| ~~4~~ | ~~LE vs prior LE — the walk~~ | **CUT.** The owner's primary use is the landing number, not the series (§11.1) |
| ~~5~~ | ~~LE vs prior-year actual, as a column~~ | **CUT from the grid** — it would be an eleventh column against §10.2's "ten columns, no horizontal scroll", and the constraint is what removes the print hazard. Available in the **export** instead, where width is free |
| **6** | Cash-flow landing | needs the transfer/balance-sheet scope this CR excludes. Not scheduled |

Every one states **nominal** and **after tax** — this book's `Taxes US` / `Taxes SP` /
`Taxes Preparation` are P&L expense lines, so the LE total is *after* those taxes. Say so.

## 13. Failure patterns this CR is specifically at risk of

| pattern | the risk here | counter-practice |
|---|---|---|
| **#1** a restatement asserted as engine behaviour (×10) | ⚠️ **This CR committed it twice and had to be corrected on review** — §7's reader table cited three functions wrongly and quoted three different counts in three places, and §1.2's cut was derived from a `reconcile_mode` name rather than from what the code writes. The count is **eleven live functions plus the view** (§7), each named with its **full path and enclosing function**, because there are two different `budget.js`. Likewise never write *"the LE freezes closed months"* without stating what "closed" derives from — the answer turned out to be *nothing*. |
| **#4** two copies of one formula | The category→line recursive CTE lives in `crud.js` **and** `fcLines.js` and is documented as *"the same CTE, so the two cannot disagree"*. A third copy in the LE breaks that guarantee. Call the existing one. |
| **#5** a fixture that cannot exhibit the bug | The boundary test must seed a transaction **in the estimate window**, a budget row **in the actual window**, and a late row landing **after the snapshot**. CR075 §7 records a base-year test that passed vacuously because no budget row existed. |
| **#3** the before/after gate cannot see a wrongly-derived number | Derive the headline through the app's own exported function, never a SQL re-derivation written for this CR. Check the independent invariant — but the **exact** form, not the naive one:
`Σ(LE actual months) − Σ(budget-vs-actual, same months and scope) = Σ(rows on non-leaf categories)`,
which is **$60.36** today (§2.1a). The naive equality fails and would send the builder hunting. |
| **#7** a label stating the opposite of the arithmetic | `LE-08-26` never appears without "Jan–Jul actual, Aug–Dec estimate" adjacent; every column header states `actual_through` and the FX basis. |
| **#2** warnings tested for firing, never for truth | §9's note. Assert each L-rule's sentence and its quantity against real rows. |

---

## 14. Deliberately not doing

- **Storing the LE as a `budget_versions` row** (§7) — it doubles the forecast base year and every
  budget report, and it resurrects a mechanism the primary editing surface has never used.
- **A close-the-books workflow** — derive "closed" and warn. One owner does not need period locks.
- **Statistical forecasting** — regression, seasonal decomposition, confidence bands. 85 lines, one
  owner; the method only bites on 37% of the number.
- **Naive run rate as the default** (§3.2) — $147,028 wrong, and it reports a profitable year.
- **FX restatement of the estimate months in P0** (§5) — and the price is **+$7**, not the −$1,048 an
  earlier version quoted: against the *declared* budget rates the market restatement is nil, and the
  −$1,048 is the staleness of stored `base_amount` versus market (§5.1). Store the rate on every row;
  defer the restatement.
- **Letting the LE feed the forecast base year** (§8.1) — the one change here that could move
  published net-worth figures, by **$34,556–$43,891** in year −1 with 36 years of compounding behind it.
- **An LE of the balance sheet or cash flow in P0** — the forecast's job; CR075 owns that boundary.
- **Sub-monthly LE granularity** — the budget is monthly and the arrival lag is p99 103 days
  overall. Precision presented as rigour.
- **An LE prompt on Home in P1** — LE is a monthly ritual *after* the close, not part of the weekly
  refresh → review → reconcile loop. Revisit once the feature has been used twice.

---

## 15. Owner decisions — ALL RESOLVED 2026-08-16

| # | question | answer |
|---|---|---|
| **1** | The 72 uncategorised budget rows (−86,796 FY; −35,900 Aug–Dec) — genuine incremental spend, or a plug from before the itemised lines covered the same money? | ✅ **Plug — excluded.** Owner first said *"investigate first"*; the investigation (§2.2) showed the account dimension cannot answer it, but the **creation dates can**: all 72 are from the **2026-01-29 initial import** and **none** has been added since, while the owner has added **131 itemised categorised rows on top of them** in the months after. Legacy, not incremental. Memo line below the total, **L6** fires. |
| **2** | Confirm the exclusion set — `Unrealized G/L` + the `Transfers` subtree (§2). It moves the actual half by **183,157** *(the CR said 197,186 when asked; that figure is measured off the name-match basis, not the one §2 defines — §2's note. The decision is unaffected: both say "exclude")*. | ✅ **Excluded**, via `NOT is_transfer AND id <> 88` — no new flag, no name match. |
| **3** | Confirm the LE must **not** feed the forecast base year (§8.1). | ✅ **Not fed.** Read-only reference column on `FCReview` is the P2 form of the link. |
| **4** | `MM` = first **estimate** month (§6). | ✅ **First estimate month.** With §1.2's calendar cut the two readings coincide in the normal case, so an August LE is `LE-08-26` exactly as asked; they diverge only on a deliberate backward override. |
| **5** | Second LE in one month: supersede, or keep both as variants? | ✅ **Supersede** — and §11.1 cutting the comparison surface makes it clearly right; two LEs per month would only have mattered for a series the owner is not building. |
| **6** | 🆕 **What is the LE primarily FOR?** | ✅ **Primarily a landing number**; *secondarily* an input to next year's budget build. **Explicitly not a frozen series.** This is the answer that reshaped §10.2, §10.4, §11 and §12 — see §11.1 for what it cut. |
| **7** | Sequencing — P0a first with a checkpoint, or commit to both? | ✅ **Commit to both now.** |
| **8** | Queue position against the CR082 TY2025 remainder (deadline 2026-10-15)? | ✅ **In parallel** — the file overlap is `config/routes.jsx` and `utils/excelExporter.js` only. **Develop in a git worktree**, because Known Issue #23 is live. |
| **9** | Grid width — full 12 months, or remaining only? | ✅ **Remaining months only** (§10.2). One YTD ACTUAL column, Aug–Dec editable. Removes the mode toggle, the sticky column and the landscape print block. |
| **10** | Proposals — accept/reject drawer, or advisory? | ✅ **Advisory only, no accept button** (§10.4). |

**Nothing is blocking. The design is closed and buildable.**

---

## 16. Review record — both passes, 2026-08-16

Both returned **revise**, and the technical pass **falsified three of this CR's own headline
figures**. They are recorded here rather than quietly patched, because that is the practice CR082
established and because two of the three are instances of the failure patterns §13 warns about.

**Reproduced to the unit** (23 figures re-derived against prod): the §3.1 bucket table, all five
§3.2 run-rate lines, the §2 three-basis table, §2.1's split, the MTM lag table, the 85-rows/+$663.82
late-arrival figure, `getBaseYearValues(2026) = −137,555`, and every frontend citation in §10.8.

### What was wrong

| # | the claim | what is true | cost |
|---|---|---|--:|
| **1** | *"the proposal is driven mostly by `Interest Income` … real, explainable level shifts"*, and *"**L9** is what catches `Option Trade`"* | **`Option Trade` passed all three original guards** (r = 3.10 is *inside* the clamp, signs agree, denominator 8,167) and was the **largest single driver**. L9 could never have fired. Guard 4 (churn ≥ 3.0) added — and the data separates cleanly, 29.0 against 1.0–1.3 everywhere else | **$12,275**, 57% of the effect. Landing −81,389 → **−93,664** |
| **2** | §10.4's showcase drawer: `Interest Income` *"budget 4,333/mo, line FY 52,000"*, proposed *"5,447/mo"* labelled `Re-levelled to YTD r=1.47` | **52,000 is not in the database** — FY is **46,000**; Aug–Dec is 3,999.98/mo and Jan–Jul is 3,714/mo (25,999.86 over 7), so no single monthly rate describes the year. And **5,447 = 38,139 ÷ 7**, a *run-rate* level — the method §3.2 spends a section forbidding — shown under the label of the method being recommended. `PHASE_TO_YTD` gives **5,868/mo, FY 67,477** | failure-pattern **#7** in the showcase |
| **3** | §5: restating at FX moves *"$881 / 0.68%"* against *"a PLN 690,000 dividend"*, and PLN is *"5.0% from the realised August rate"* | Numerator on LE scope, **denominator on the uncategorised-inclusive scope**; "realised August" was the **budget table quoting itself**. Corrected: **−$1,048 / 0.81%, unfavourable**, PLN **4.8%** vs the real market rate. And the 690,000 dividend is dated **2026-01-01** — wholly in the *actual* half, untouched by the stale rate. The real exposure is `Financial Income - Barkeria`, 120,000 PLN in December | the §4 warning about stale rates, committed in §5 |

### Also corrected

- **§1.2** — the closed-month cut. The first draft's derivation was underivable (11 of 113 accounts).
  Both passes found this independently.
- **§7** — the version-blind reader table cited three functions wrongly, missed three more, and
  quoted **three different counts in three places** (five, seven, six). Round 1 said ten; round 2 found
  two more. It is **eleven live functions plus
  the view**. The architectural conclusion is unaffected; the supporting claim was loose, which is
  failure-pattern #1 inside the CR that warns about it.
- **§2** — the exclusion needed no new flag: `accounts.is_transfer` is already TRUE on exactly the
  right 13 accounts. A `Transfer - %` name match would have missed **`Return of Capital`** and
  **`Valuation - Historical`** (which is itself *inside* the Transfers subtree, so the first draft
  listed it twice). Subtree total is **−30,438**, not the −14,029 the name match gives. The proposed
  `exclude_from_le` flag had **no writer and no screen**, so day one would have landed at +44,259 —
  the exact number §2 exists to prevent.
- **§7.1** — `currency` added to the grain (**38 budget and 81 actual category-months are
  multi-currency**; `Bank Fees` holds three in 2026-09, inside the estimate window); FKs, four
  `CHECK`ed pseudo-enums, month-start and year-range checks, the picker index; `UNIQUE (budget_year,
  name)` made **partial**, without which §6's supersede path raises a unique violation and is
  unreachable.
- **§3.4** — `COALESCE` on the SUMs (without it bucket B *never* matches, and B is exactly the
  −66,381 that L4 protects); bucket A's action is `ZERO`, not "`CARRY` (=0)"; per-month presence
  tested, not just the sum.
- **§5** — a `recalculate` between draft and finalise silently rewrites the estimate half; P0b
  refuses it while a draft exists for that year.
- **§1.1** — the arrival-lag percentiles need `transaction_date >= 2026-01-01` stated, or the query
  returns 18,202 rows at p50 3,293 days (the Quicken back-import). They are current-year, not
  "overall": to 2025 they become p99 211 / max 576.
- **§4.2** — the drift example showed *zero* drift. Replaced with the measured 85 rows / +$663.82.
- **§3.3** — seven methods trimmed to five; `POT` had no caller and `PY_SEASON` is a level derived
  from a shape, which §3.4 argues against.
- **§7.2** — any literal segment registers before `/:id`, flat file so
  `Scripts/check-api-envelope.sh` sees it; `/le/closed-through` dropped with §1.2 and `/le/compare`
  with §11.1.
- **§11** — P0a extracted; Compare/Versions tabs, two column modes, the FY-total spread edit and
  three row-menu actions deferred; L7 demoted to a server invariant.

### Resolved after both passes

**All ten owner decisions are closed (§15, 2026-08-16)** — including the one the PM pass rated the
highest-value unanswered question in the CR (*"is the LE primarily a landing number, a frozen series,
or an input to next year's budget?"*). The answer — **landing number first, budget input second,
series not at all** — cut the Compare tab, the Versions tab, the LE-to-LE walk, the trend chart,
`PY_SEASON`, `L11`, the accept/reject drawer and two thirds of the grid. See §11.1.

One item stays open as a **build-time** decision, not an owner one:

- **A 2027 LE is unspecified.** `budget_entries` already holds **12 rows for `budget_year = 2027`;
  §6 keys identity on `(budget_year, actual_through, created_at)` but nothing requires a budget to
  exist, and 12 rows put every line in bucket B or E. Decide before someone tries it.

### Round 2 — 2026-08-16, on the owner-revised design

Both passes re-ran after the ten owner decisions, because the reviewed document and the committed one
differed by about a third of the scope. **PM: GO**, gated on a consistency pass rather than rework.

The finding worth recording: **§11.1 cut the design but never reconciled itself back into the body**,
so four places still described what had been removed — and one of them was the **CR header block**,
still telling a builder to add an `exclude_from_le` column and a seeder that §2 and §7.1 had deleted.
That is a stale sentence in a spec, implemented as written: the exact shape §13 exists to warn about,
committed by the document that warns about it, for the third time. All four are now reconciled
(§10.3, §10.5, §7.1's `method` CHECK, §12 rank 5).

Also from round 2, all verified in code before applying:

- **P0a's blast radius was unbounded** (§11.2). It was written as an additive KPI while costing a
  re-basing of `/budget-vs-actual`, whose transfer exclusion is a **name-string** match missing
  `Return of Capital` and `Valuation - Historical`, and which never excludes `Unrealized G/L` at all.
  P0a is now explicitly additive; the re-basing is a roadmap bullet.
- **Drift (L2) moved from P1 into P0b** (§11.3). P0b ships an immutable artefact; L2 is what keeps it
  honest, and only P0a+P0b are committed, so the gap had no end date. Hours of work, not days.
- **`TRAIL_3` added to the migration's `method` CHECK** — P1 would otherwise have needed a whole
  migration to widen a constraint the first one could get right.
- **P2 is not schedulable** (§11.4) — three unspecified behaviours, no dry-run, no delete path, into a
  table with **no unique constraint on its own grain**. Plus a risk the CR had not named: the FC-line
  budget hint is **year-blind** as well as version-blind (`fcLines.js:44` with a null `budgetYear`,
  reached from `FCModulesEdit.jsx:402`), and seeding ~800 rows into 2027 is what makes that material.
  And §8.1's refusal to feed the forecast **quietly reverses** once CR064 P2 moves `PeriodStart` and
  CR075 makes the 2027 budget the base year.

**Owner action outstanding, and it is not something an agent should do unasked:** prod is running
**untagged `main`, several commits past `v3.28.3`** (CR082 deployed without a bump). Tag it before
CR083's first commit, or "what is on prod" becomes unanswerable with two concurrent streams.

### Round 2, technical pass — nine blocking findings, four of them new wrong numbers

The technical pass **re-derived every round-1 correction against prod and all of them reproduce to
the cent** (the churn guard's +9,335 / −93,664 / +43,891, `Interest Income` 46,000, the Aug market
rates, `is_transfer` = the 13 subtree descendants, the multi-currency grain, `getBaseYearValues` =
−137,554.99, the §3.1 buckets, all five §3.2 run-rate lines, and every frontend citation).

**But the sections rewritten after round 1 introduced four new figure errors of exactly the class
this CR exists to prevent**, which is the finding that matters more than any individual fix:

| # | what was wrong | now |
|---|---|---|
| **B3** | §11.2 asserted `/budget-vs-actual` *"misses `Return of Capital` and `Valuation - Historical`"* and *"does not exclude `Unrealized G/L` at all"*. **Both false** — the name walk matches the **parent** `Transfers` and collects all 13 leaves; `includeUnrealizedGL` defaults `false`. **This wrong claim had already been repeated to the owner.** | §11.2 rewritten on **fragility**, which is true, instead of wrong figures, which was not |
| **B7** | §10.2's mock: Income FY + Expenses FY = **+128.4K** against a stated landing of **(102,999)**; YTD columns summed to **67,800** against **25,684** | every figure now ties; it is the KPI spec, so **L10 must pass on the picture** |
| **B5** | §10.4's advisory printed "5,868/mo → FY 67,477" while 5 × 5,868 = **67,479** — three numbers for one line, in the example that replaced round 1's wrong example | exact operands, plus a stated allocation rule (2 dp, last month absorbs the residual) |
| **B6** | §4.2's drift example froze July at the **post-drift** row count and invented the "now" figure — self-consistent arithmetic on inverted facts, and it is **L2's copy spec** | the measured endpoints: −46,115 over 520 → −45,451 over 605 |

**Three of those four are in paragraphs round 1 had just corrected for the same failure pattern.**
That is the finding to carry into the build: *a correction is not a fix until its replacement is
verified too.*

Also blocking, and all applied:

- **B1 — migration 071 was already taken** by the CR082 thread, on disk, the same evening (§ header).
  The number is now claimed at build time. This is migration **064**'s note replayed, caused by the
  parallelism §15 decision 8 chose, and it shows decision 8's "the file overlap is two frontend files
  **only**" was wrong: `server/db/migrations/`, `migrations.md`, the CR index, the roadmap and
  `status.md` are all contended, and **the migration number is the sharpest**.
- **B2 — the headline does not tie to `/budget-vs-actual`**, by exactly **$60.36**: `Car Expense` and
  `Children - Anna` post to **non-leaf** categories and `buildCashFlowNode` reads leaves only. §2.1a
  states the rule (the LE counts them) and §13's invariant is restated in its exact form.
- **B4 — `base_amount` is at each row's last-touched rate**, not the declared budget rate (Sep–Dec PLN
  carries **9 distinct rates**). Against the declared rates, restating at market is worth **+$7**, not
  −$1,048. §5.1 now pins what `CARRY` copies, because P0a and P0b choosing differently would put two
  landings on the board.
- **B8** — `CHECK (actual_through < make_date(budget_year+1,1,1))` accepted **2026-12-31**, whose
  first estimate month is 13 — the case its own comment said it refused. Plus nothing forced a month
  end, and `UNIQUE (…) WHERE …` is not a valid table constraint in Postgres.
- **B9** — with `[ use this figure ]` writing `method='MANUAL'`, nothing ever wrote `PHASE_TO_YTD`, so
  `method_input` had **no writer** and §4.1's reproducibility argument had no implementation. The
  advisory now writes `source='manual'`, `method='PHASE_TO_YTD'`, `method_input={…}`.

Fourteen should-fix items applied too, including: the version-blind count is **eleven live functions
plus the view** (round 1 said ten, the draft said five/seven/six — **three rounds, three counts**);
only **two** `fcLines` joins are year-blind, not three; §11.4's cited consumer was wrong even though
the year-blindness is real; the 197,186 exclusion figure is measured off the name-match basis and the
right number is **183,157**; L2's threshold needed a grain; `excluded_account_ids` holds **category**
ids; and §12 rank 3 does not fit the eleven-column grid, so it lives in the drill-down and the export.

### Round 2 sign-off (PM, delta) — GO for P0a, five gates for P0b

**Verdict: GO** — P0a immediately, P0b gated on a consistency pass. The nine technical corrections
were judged sound and none changed a load-bearing decision. The finding was that **the corrections
were inserted without retiring what they replaced** — the same defect as §11.1 cutting the design
without reconciling it back into the body. Five live contradictions, each a sentence a builder would
implement as written. All now closed:

1. **Two mandatory FX banners**, and the *falsified* one was still mandatory — §5 carried the "at the
   2026 budget rates" wording that §5.1 identifies as failure-pattern #7. Deleted; §5.1 owns it, and
   the grid mock's third copy is corrected. Load-bearing because L8 is P1, so in P0b **the banner is
   the only disclosure of the 9-rate spread**.
2. **§11.1 still told the builder to undo B9** — "the advisory writes `MANUAL`… update §7.1's CHECK
   lists accordingly", which would have re-created the dead-value defect *and* dropped `TRAIL_3`.
3. **`recut` was in P1 while L2 moved to P0b** — the warning's only remedy in the next phase, and the
   manual workaround blocked by the partial unique. Moved to P0b.
4. **L1 and L6 were in no phase at all**, and L6 guards §2.1's −35,900. Both now P0b, along with §5's
   refusal to run `recalculate` while a draft LE exists.
5. **"Ten functions" survived in three places** against §7's eleven — in the document that says a
   count here is untrustworthy unless every row was opened.

**On whether this document is converging:** structurally yes — across three rounds nothing
load-bearing has moved. Every falsification has been an *illustrative figure or a count*, and the
cause is structural: the CR restates the same number in five to eight places, so each correction
leaves 4–7 stale copies and each rewrite mints prose that then needs verifying. It is being used as
spec **and** lab notebook. **The remedy adopted: ship P0a and let prod adjudicate** — if the running
KPI reproduces the headline, it is verified by code rather than by a fifth reading.

**It did.** `getFyLanding({year: 2026})` against prod returns cut **2026-07-31** (7 months), actual
YTD **25,683.50**, budget rest **−128,682.42**, landing **−102,998.92**, budget FY **−137,554.99**,
variance **+34,556.07**.

**Sequencing changed under us, in our favour.** CR082 and CR084 both **COMPLETED** and released
(v3.30.0, v3.30.1) while this was in review, and nothing IN-PROGRESS touches the budget surface,
`budget_entries` or `/budget-vs-actual`. So the worktree is now hygiene rather than a requirement,
migration **072** is free and clean, and prod is tagged — which closes the one outstanding owner
action. **Position: P0a → P0b, no interleave.**


---

## 17. What shipped — v3.31.0, 2026-08-18

**P0a and P0b, both live.** Migration **072** (dev 2026-08-17, prod with this release).

**P0a — the FY landing.** `GET /api/v2/budget/fy-landing?year=` plus a strip on
`/budget-vs-actual`. Derived through the service against prod: cut **2026-07-31** (7 months),
actual YTD **25,683.50**, budget rest **−128,682.42**, landing **−102,998.92**, budget FY
**−137,554.99**, variance **+34,556.07** — the CR's headline, produced by running code rather than a
fourth reading of this document. Deliberately **additive**: it computes §2's scope itself and names
it, and does **not** re-base the existing page (§11.2).

**P0b — the LE itself**, at **`/budget-le`**. Create an LE for a year, read it in
Chart-of-Accounts order, open any category's month-by-month worksheet and type the estimate months.
Nine endpoints under `/budget/le`.

### 17.1 What the owner changed after seeing it

Three requests, all shipped, and the third was the sharpest:

1. **One estimate column, not five.** The summary is **seven columns**; the month detail moved to
   the worksheet where it can be edited. Width stays the load-bearing constraint — measured in a
   browser at 1440, `scrollWidth == innerWidth` — because no scroll container and no sticky column is
   what keeps §10.6's print block simple instead of re-solving CR082's clipping.
2. **Chart-of-Accounts order, with the categories.** Rows come from `getNestedTree`
   (CR063's `display_order`), parents included and rolled up. **117 rows against 93 leaves.** A
   parent's figures are its subtree **plus anything posted directly to it**, and the NET line sums
   only depth-0 rows or parents and children double-count.
3. **A new LE carries the PRIOR one forward**, falling back to budget only where it has none. The
   point of a series is that LE-09 starts where LE-08 finished. **No new `source` value was needed:
   the provenance travels with the number** — a month the owner typed stays `manual`, a month carried
   from budget stays `budget_carry`.

### 17.2 Two defects the owner found that no gate could

- **A category that only spends AFTER the cut was invisible — and unestimable.**
  `Purchases - IT Costs` has no 2026 budget line, so it had nothing in either half and the
  "drop empty subtrees" rule removed it. There was then **no row to click**, so it could not be
  estimated at all. That is exactly the shape of a genuinely new expense. The grid now keeps any
  category with activity anywhere in the year.
- Post-cut spend is now surfaced, but **only where it says something**: flagging every category with
  August activity lit **39 of 118 rows**. Narrowed to "no estimate at all" or "already past the whole
  remaining estimate", it is **4** — including `FL - Car Costs` at 903 against an 800 estimate for the
  rest of the year.

### 17.3 The deviations section — asked for as AI, shipped as arithmetic

The owner asked for a collapsible section where the local LLM flags year-to-date deviations worth
carrying into the LE. It ships **deterministic**, and the reasoning is the point: **CR081 measured
AI-proposed edits at 0/15, twice**; `status.md` names the next build as the consequence preview
**with no LLM**; and **CR077's rule** is that an LLM stage runs *over* the deterministic rules, never
instead of them. Measured, the detection needs no model — six categories deviate by >$2,000 YTD and
every figure is a division.

**The trigger is deliberately NOT "actual differs from budget year-to-date."** A category overspent
because its budget is back-loaded needs no change; the year still lands where the budget says. What
is flagged is a deviation implying a **level shift** — §12 rank 3's timing-vs-permanent distinction —
and materiality is measured on **the effect on the remaining months**, not on the YTD gap. It is
§3.4's classifier and all four guards, arriving with P1's machinery early.

Seven flags on the live book, ranked, totalling **+13,952.49**. `Option Trade` is **refused and told
why** (churn 29.0×) rather than silently omitted — the guard whose absence made it 57% of the
proposal engine's headline in review. A figure the owner typed is tagged **"you typed this"**,
because an advisory that nags about settled decisions stops being read. **No Accept button**, by the
same CR081 evidence; the section is non-blocking, so its fetch failing leaves the grid untouched.

**Where a model would genuinely add something, and it is not what CR081 measured:** reading
transaction *descriptions* to tell a one-off from a new recurring cost. `Purchases - Subscriptions`
jumped to **−965.79 in June**, when `CLOUDFLARE` first appears; the merchant names answer whether to
raise Aug–Dec and the totals never will. **Deferred until the flags themselves prove useful** — the
cheap test CR081 skipped.

### 17.4 Still open

- **Finalise, recut, and the remaining warnings (L1/L4/L6)** are NOT built. ⚠️ **Before finalise
  ships**, the full-year budget per category must be snapshotted onto the LE: `BUDGET FY` and the
  variance are read **live** from `budget_entries` today, which is correct for a draft and wrong for
  a frozen artefact — the owner edits the budget in-year (30 rows since April, 22 backdated). That
  needs a column, and therefore a migration.
- **P1** (the advisory's accept path, `TRAIL_3`/`ZERO`, drift **L2**) and **P2** (§11.4's seed-next-
  year, still not specified enough to schedule).
