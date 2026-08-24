# CR087 — Money legibility: the currency, the column, and the write with no record

**Status:** **IN-PROGRESS** — **THE P0 IS COMPLETE AND SHIPPED:** P0a v3.38.0 (migration 074) · P0b v3.38.1 · P0c v3.39.0. **P1's reconcile-page half BUILT 2026-08-24**, not yet released; `<Money>` and `resetOpeningBalance` remain.
**Track:** v3
**Migration:** **074** (071–073 taken) — the `accounts` audit trigger. Book Health needs a **second**
migration for its own dismissals table (CR074's is FK-bound to `forecast_scenarios`).
**Depends on:** [CR086](cr-086-ui-visual-system.md) for `<Money>` — ⚠️ **or the reverse, see §9 C9.**
**Roadmap anchor:** [project-roadmap.md#cr087](../current/project-roadmap.md)
**Origin:** Carved out of the whole-app UI review of 2026-08-15 (`financial_software_expert` pass),
refreshed and **independently re-verified at HEAD on 2026-08-23**. Separated from
[CR086](cr-086-ui-visual-system.md) deliberately: CR086 is how the app *looks*, this is whether a
figure can be **read wrong**. They should not share a priority queue — a visual CR gets polish
treatment, and nothing here is polish.

---

## 1. The one-sentence shape

> **Fin's server already computes the things that make a figure checkable — native currency, native
> amount, a dry-run of every reconcile write — and the UI throws them away before the screen.**

Every item below is a case where the data exists on the wire or in the query and the render drops it.
That is what makes this cheap: almost nothing here needs a new computation.

⚠️ **Provenance of every claim in this CR.** Each was raised by a subagent and then **re-verified by
hand against HEAD before being written down** — line numbers below are today's, not the reviewer's.
This project's most-repeated failure is *a restatement asserted as the engine's behaviour, found ten
times* ([status.md](../current/status.md)); a CR relaying an agent's reading of the code without
opening it is that failure with extra steps.

## 2. The book is 47% foreign and no actuals report says so

**Verified:** [reports.js:188-202](../../server/src/services/reports.js#L188-L202) returns
`{ name, totalUSD, currency, total }` on every balance-sheet leaf — native currency **and** native
amount. [BalanceReport.jsx:125](../../frontend/src/features/Balances/BalanceReport.jsx#L125) renders
`formatCurrency(account.totalUSD)` and nothing else.

Active balance-sheet accounts: **PLN 22 · EUR 13 · GBP 2 · USD 42.** A PLN mortgage of 1,650,000
renders `($412,500.00)`. The owner cannot tie a foreign account to its statement without doing the FX
in their head, and cannot tell whether a move was the asset or the zloty.

`/balance-calibration` is worse, because it is the page the month-end runbook is worked on.
`bankFeedReconciliation.js` selects `bb.currency` per account; the table renders `COMPUTED`,
`BANK (EXPECTED)` and `DRIFT` as bare digits. **The currency is smuggled into the account name** —
`Wise - USD`, `WISE - EUR`, `PKO - USD` — which is the name-as-key pattern the forecast rules already
ban. EUR 1,409.25 sits in the same unlabelled column as USD 1,166,089.24, and the queue is sorted by
`Math.abs(drift)` **across currencies**, so a 5,000 PLN drift outranks a $3,000 USD one and the owner
works it in the wrong order.

⚠️ **SPLIT at pass-2 sign-off (§10 P1) — these are two surfaces with an order-of-magnitude cost
difference, and the draft priced them as one.**

- ✅ **`/balance-calibration` — GO (P1).** `f.currency` is **already in the `balanceReconcile` SELECT and
  spread to the client**, so labelling the row is **frontend-only**. Only the USD-equivalent sort costs
  anything (a server-side FX lookup). **11 of the live fed rows are non-USD** — this is the runbook being
  worked in the wrong order today, on the page the owner *works*.
- ⏸ **`BalanceReport`'s `Local` column — DEFER.** C5a makes it a query change (`ARRAY_AGG(DISTINCT
  t.currency)`) plus a mixed-currency marker plus migration 064's unanimity predicate for the 8 relabelled
  rollups. Three moving parts on a page the owner *reads*. Different increment, possibly its own CR.

⚠️ **And re-price §1 accordingly:** *"almost nothing here needs a new computation"* is **true for the
reconcile page and false for the balance sheet.**

**The change:** `Ccy` + `Local` columns on leaf rows; `currency` beside every figure on the reconcile
row; sort the queue on USD-equivalent drift and say so in the header.

⚠️ **Two corrections from pass 1 (§9 C5), and the first makes this NOT free.**

**C5a — a naive `Local` column would print a mixed-currency sum as a native figure.**
`reports.js:82-85` computes `a.opening_balance + SUM(t.amount)` with **no** `t.currency = a.currency`
filter. Measured on dev: `CVC Fund IX` (EUR) carries a **41,564.86 USD** transaction, `Fidelity Bond`
(USD) carries 3 EUR rows totalling 14,585.99, `Misc Investments` (USD) one EUR row of 2,314.95. Today
that is invisible; label the column `Local` and three rows assert a number in a currency they are not
in — the CR037 `amount`-vs-`base_amount` class. **Add `ARRAY_AGG(DISTINCT t.currency)` and a `mixed`
flag, and render a marker rather than a number.** The precedent is in the same file:
`fetchCategoryTotals` (`reports.js:327`) already does exactly this, for exactly this reason. This means
§1's *"almost nothing here needs a new computation"* is **overstated for §2** — it is a query change.

**C5b — "blank on rollups" is wrong for eight of them.** Migration **064** relabelled 8 rollup parents
to their children's unanimous currency (`EUR Bank Accounts`, `PLN Bank Accounts`, `CVC Investments`,
`SP - Properties`, `PL Investments`, `PL - Properties`, `PLN Credit Cards`, `Other Bank Accounts`).
Those carry a correct stored currency and a meaningful native total. Adopt 064's **unanimity
predicate**: blank only genuinely mixed parents (e.g. `Tax Liabilities`).

**The pattern already exists in-house** and needs no invention: `/trans-actual` renders per-currency
KPI tiles (`PLN TOTAL` · `USD TOTAL` · `EUR TOTAL`) and an explicit `CCY` column between `AMOUNT` and
`BASE AMT`. Copy it.

## 3. `calibrate()` rewrites history with no preview and no record

**This is the highest-value item in either CR.** All four facts verified at HEAD:

| Fact | Evidence |
|---|---|
| The dry-run **already returns everything a preview needs** | [reconcileToFeed.js:585-586](../../server/src/v2/services/reconcileToFeed.js#L585-L586) — `{ feed_date, feed_balance, expected, sum_tx, old_opening, new_opening, applied }` |
| The write is gated on it | [:589](../../server/src/v2/services/reconcileToFeed.js#L589) `if (!dryRun) { … }` |
| **The UI never calls it** | [BalanceReconciliation.jsx:201-202](../../frontend/src/components/BalanceReconciliation/BalanceReconciliation.jsx#L201-L202) — `dryRun: false` in **both** branches |
| The confirm shows no numbers | [:184](../../frontend/src/components/BalanceReconciliation/BalanceReconciliation.jsx#L184) — *"re-anchor opening_balance for «name» to the bank's reported balance"*. The `old → new` figures appear at [:219](../../frontend/src/components/BalanceReconciliation/BalanceReconciliation.jsx#L219) — **in the toast, after the write** |
| No audit row is written | the only `audit_log` writer in `server/src` is `v2/services/aiReview.js` |

`calibrate()` rewrites `opening_balance`, which shifts **every historical date by one constant**. The
owner confirms it blind and learns the numbers afterwards.

**Measured on prod 2026-08-23 — this is routine, not rare.** `account_source_mappings` where
`source='bank-feed'`: **calibrate 24 · mtm 5 · accrue 2**, of which **4 calibrate rows are `ignored`
with a NULL `account_id`** (unmapped feeds, e.g. the Pekao/OCME connection — see
[CR060](cr-060-feed-connection-health.md)). So the live figure is **20 calibrate accounts, re-anchored
monthly by runbook step 5** — and **10 of the 20 are non-USD (PLN 7 · EUR 3), exactly half**, worked
from a queue that shows no currency and sorts by raw `|drift|` across currencies (§2).

⚠️ **This is not hypothetical — it is the mechanism behind a real incident.**
[CR080](cr-080-feed-accrual-reconcile-mode.md) records months of owner calibrations dragging history,
with migration 065 misreading the residue as a fabricated **−32.56 unrealized loss** before migration
069 moved it back. [CR082](cr-082-tax-section-fbar-114.md) then had to design an entire *freeze-on-file*
snapshot around the same property, recording that `calibrate()` *"writes one constant across every
historical date and for years with no audit row at all"* — and that the FBAR figures are unrecoverable
without it.

⚠️ **Pass 1 falsified this section's two cheapest assumptions (§9 C3, C4). The design below is the
corrected one.**

**C3 — `dryRun: true` is NOT side-effect free, so "no new server work" was wrong.**
[bankFeed.js:319-322](../../server/src/v2/routes/bankFeed.js#L319-L322) runs `syncUpstream()` **and**
`ingestBalances()` on *every* call to that endpoint, **before `dryRun` is ever consulted** — and
`ingestBalances` upserts rows into `bankfeed_balances`. So a preview click hits the bank-feed
microservice and writes to fin's DB. Worse, the *apply* click re-syncs, so **the `new_opening` actually
written can differ from the one the owner just approved.** `RECONCILE_SYNC_MAX_AGE_MIN = 15` narrows
that window and does not close it. A preview that can be silently superseded by the write it authorises
is worse than no preview.

**C4 — `opening_balance` has three live app writers, not one**, so auditing `calibrate()` alone does
not deliver the guarantee [CR082](cr-082-tax-section-fbar-114.md) depends on:
[reconcileToFeed.js:600](../../server/src/v2/services/reconcileToFeed.js#L600) (the one named),
[reconcileManual.js:317](../../server/src/v2/services/reconcileManual.js#L317) (the **manual** calibrate on
`/manual-calibration` — identical defect), and
[reconcileManual.js:291](../../server/src/v2/services/reconcileManual.js#L291) — `SET opening_balance = 0`,
a one-click unaudited destructive write that the draft never mentioned. Five more live in
`server/src/v2/scripts/`, and `repositories/accounts.js:360` whitelists `opening_balance` for the
generic COA update.

**The change, in four parts:**
1. **Preview**: `askReconcile` calls with `dryRun: true` and the modal shows `old → new (Δ X CCY)` plus
   `sum_tx`. `ConfirmModal.css:39` already sets `white-space: pre-line`, so a multi-line block needs no
   component change. Gate the pre-reconcile sync on `!dryRun`, or accept the write and say so.
2. **Apply refuses on drift**: the apply carries the previewed `new_opening` + `feed_date`; the server
   returns **409 with the new figures** on mismatch rather than writing a number nobody approved. This
   is the part that was missing entirely.
3. **Audit the COLUMN, not the caller** — a Postgres trigger on `accounts` for `opening_balance` /
   `opening_balance_date` → `audit_log`. One migration (**074**; 071–073 are taken), catches all three
   services, the scripts and manual `psql`, and cannot be bypassed. Precedent exists —
   `trg_fc_reject_nested_variant` is a live non-internal trigger — and **`audit_log` already has exactly
   the right shape** (`table_name, record_id, action, old_values jsonb, new_values jsonb, user_info`,
   indexed on `(table_name, record_id)`, written today by `aiReview.js:796`), so a new
   `account_opening_balance_history` table is **not** needed. The insert must be transactional with the
   UPDATE — CR037's "non-transactional multi-row writes" is the failure class.
4. **`Last calibrated` column** — ⚠️ **and decide what to do with `accounts.last_calibrated_at`, which
   already exists, is populated on 67 of 230 accounts, and has been stale since 2026-06-03** because
   nothing writes it except the generic update whitelist. Rendering it as-is would ship a lying column,
   which is [CR085](cr-085-forecast-sensitivity.md)'s own defect class. Revive it in the trigger, or
   retire it explicitly.

The in-house standard for a destructive confirm already exists: `TransferAnalysis.jsx` names account,
date, description, amount **and currency** before deleting.

## 4. Three columns that can be read wrong

**4a. The Ledger's `Balance` has two meanings under one header.**
[Ledger.jsx:538-548](../../frontend/src/pages/Ledger.jsx#L538-L548) carries its own warning verbatim —
*"otherwise fall back to a client-side cumulative sum seeded at 0 (a «running total of the displayed
rows», not the true account balance)"* — and both render under the same `<th>Balance</th>` with
identical styling. An account with a $500,000 opening balance, filtered to one month, shows a closing
"Balance" of $12,400. **Change:** when `hasServerBalance` is false, rename the column to `Σ shown` and
mute it, or drop it. A ledger balance that is not the account balance is not a ledger balance. Add a
pinned `Balance brought forward` first row so `opening + Σ shown = closing` is checkable by eye —
the one check a ledger exists to support.

**4b. Variance sign is decided by a substring match on an owner-editable name.**
[BudgetRealization.jsx:243-266](../../frontend/src/pages/BudgetRealization.jsx#L243-L266):

```js
const topLevel = path[0];
return typeof topLevel === "string" && topLevel.toLowerCase().includes("expense");
```

Used at [:354](../../frontend/src/pages/BudgetRealization.jsx#L354) to choose between
`actual − budget` and `budget − actual` — **opposite signs in the same column.** `COAManagement`
permits renaming any account. Rename `Expenses` → `Spending` and every variance under it flips sign,
silently, with no error and no visual change. Any root that is neither word already gets the inverted
convention today.

`buildCashFlowNode` returns only `{name, total, children}`, so the frontend has no better key
available — the server is complicit, and does the same thing itself (`reports.js` matching
`name.toLowerCase() === 'unrealized g/l'`; `bankFeedReconciliation.js` matching
`cat.name = 'Transfer - Securities Trades'`). ⚠️ **Severity, corrected in pass 1 (§9 C1): this defect is LATENT, not live.** Measured on dev, the
only two P&L roots that miss the substring are `Realized Gain (Historical)` and `Margin Interest`,
both carrying essentially no transactions — so no figure on screen is wrong **today**. It fires on a
rename. An earlier draft implied live wrong numbers, which is the restatement failure §1 opens by
warning about.

**And the fix is smaller than the draft proposed.** Expenses are stored **negative on both sides**
(`transactions.base_amount` for expense categories in 2026 sums −175,031.91; `budget_entries` for
expense categories runs min −71,968 / max 0), so `actual − budget` is already favourable-positive for
income *and* expense — **the `budget − actual` branch is simply wrong.** The minimal correct change is
to **delete the branch**: one file, no server change, and it aligns the four surfaces that already use
unconditional `actual − budget` (`BudgetVariances.jsx:224`, `BudgetRealizationGraph.jsx:279/290/302`,
`mobile/pages/MobileBudgetRealization.jsx:147`).

⚠️ **It is two files, not one.** The identical substring rule is duplicated at
[excelExporter.js:167-171](../../frontend/src/utils/excelExporter.js#L167-L171) — fix the page alone and the
screen and the exported workbook disagree.

Label the column `Variance (fav/(unfav))` so the convention is stated where the number is read — noting
that the label is truthful **only because amounts are signed**.

**4c. A failed actuals fetch renders a page of 100%-favourable variances.**
[BudgetVariances.jsx:148-151](../../frontend/src/pages/BudgetVariances.jsx#L148-L151) catches the actuals
failure and sets `null`; [:210](../../frontend/src/pages/BudgetVariances.jsx#L210) short-circuits only if
**both** sides are null; [:223](../../frontend/src/pages/BudgetVariances.jsx#L223) then coalesces the
missing actual with `?? 0`. Budget loads, actuals fail ⇒ every category reads `actual $0.00`,
`variance = full budget, favourable`, **no error banner.** ⚠️ **The mirror defect is unnamed in the draft (pass 1, §9 C2):**
[:222](../../frontend/src/pages/BudgetVariances.jsx#L222) is `leafBudgetTotals?.get(name) ?? 0` — actuals
load, budgets fail ⇒ every row reads budget $0 with the full actual as variance.

**Change:** a banner on either failure, and `variance = "—"` whenever an operand is missing. A variance
derived from a missing operand is not a number. ⚠️ **The banner cannot be a null check**: `null` is set
both as the *loading* state (`:134`, `:177`) and the *failure* state (`:151`, `:197`), so it needs an
explicit per-fetch error state or it will flash on every load.

## 5. Provenance: the forecast has a model, the actuals do not

[CR074](cr-074-dismissible-cash-health-warnings.md) + [CR077](cr-077-assumption-advisor-tab.md) gave
the forecast three invariants that are genuinely load-bearing — *dismissed is never invisible ·
all-dismissed is not all-clear · a dismissal expires when the warning's figures change* — and split
**Integrity** from **Assumptions to consider** so accepting six judgements cannot bury one defect.

The actuals side has `AttentionStrip`: six hard-coded counts, no severity model, no dismissal, no
expiry, fetched once on mount and never refreshed. And **no pill carries an amount** — three accounts
drifting $4 total and three drifting $150,000 render identically, while `total_transfer_imbalanced`
is already computed by `bankFeedReconciliation.js` and never exposed.

⚠️ **CUT at pass-2 sign-off (§10 P2). Book Health as designed is DEFERRED; what ships is the cheap half.**
Pass 1 left ~2 of 7 rules working on day one, and the survivors are exactly what the cheap version delivers.
**The cut line is precise: keep everything reachable from `/util/attention-summary`, drop everything that
needs new storage.** That endpoint already calls `balanceReconcile({})` and holds `drift`, `currency`,
`transfer_unpaired_legs` and `transfer_imbalance` per account — **and throws all of it away to emit six
counts.** So:

- ✅ **Ships:** amounts on the drift pills (per currency), and an **unpaired-legs pill**. A handful of lines
  in one route and one component. **No severity model, no dismissals, no second migration, no
  `reconcile_events`.** The unpaired-legs pill is the highest-value one — the runbook says clear it *before*
  the MTM, and 2026-08-02's $150,000 counter-leg is what happens when nobody does.
- ⏸ **Deferred:** the rule engine, dismissal fingerprints, severity classes. Re-propose once §3's audit has
  90 days of data behind the repeat-calibration rule — at which point it is a different, better-founded CR.
- ❌ **Dropped outright:** the **>120%-of-pro-rated** rule — [CR083](cr-083-budget-latest-estimate.md)'s
  `/budget-le` deviations engine shipped it at v3.31.0 with a materiality trigger.
- ➡️ **Moved to CR083:** the "one free item" below (days-elapsed + a pro-rated budget column on
  `/budget-vs-actual`) — that is **CR083's live surface**; it owns the FY-landing strip there and still has
  finalise/recut to build. Two threads editing that page is the collision cost that is not theoretical.

*(The superseded full design follows, kept for the rules' measurements.)*

**The change:** port the `fcWarnings` **record shape** to actuals as **Book Health**.

⚠️ **Pass 1 corrected the mechanism and noise-tested the rules (§9 C7). Both matter.**

**C7a — "port `fcWarnings`" is not architecturally available as stated.**
`features/Forecast/utils/fcWarnings.js` is a **907-line pure client function** over data `FCReview` has
already loaded. Book Health's inputs span at least four sources. Port the **record shape**
(`{id, severity, class, title, detail, amount, currency, fingerprint}`) and compute it **server-side**
as a service behind `routes/util/ops.js` — which already holds `balanceReconcile()`'s full result
including the amounts the strip drops, so the first rule is a **one-line response change**.

**C7b — three of the seven rules do not survive contact with the real book:**

| Rule | Class | Why it exists |
|---|---|---|
| unpaired securities legs > 0 | integrity | computed today, never surfaced; the runbook says clear it *before* the MTM |
| account calibrated ≥ 3× in 90 days | integrity | the [CR080](cr-080-feed-accrual-reconcile-mode.md) plug, caught early |
| MTM booked against an observation synced **before** the booking date | integrity | runbook step 3, which has no screen at all today |
| feed balance unchanged 3 consecutive days | integrity | the stalled connection the runbook warns about |
| non-USD account whose currency ≠ its feed's reported currency | integrity | the actuals twin of forecast rule **R11** |
| category > 120% of **pro-rated** budget | assumption | see below |
| no transactions in 90 days | assumption | dormant/broken feed — ⚠️ **scope to fed accounts**: 27 unscoped, **4** scoped |

⚠️ **Measured on dev, three rules are unusable as drafted:**
- **MTM vs sync date is NOT COMPUTABLE.** An MTM row records nothing about the observation it was
  marked against — `source='mtm'` and a constant `description1`, no reference to `bankfeed_balances`
  (verified: 6 mtm rows, all identical descriptions). §7 called it an input that "already exists"; it
  has none. **Fix:** generalise §3's audit into a **`reconcile_events`** table covering
  calibrate/mtm/accrue, which then serves §3, rule 2 **and** rule 3 from one migration.
- **Feed unchanged 3 days fires on 17 of 32 feed ids** — noise, and it duplicates the existing
  `staleFeeds` pill and `mtm()`'s own `stale` guard.
- **>120% of pro-rated budget fires on 40 of 84 budgeted categories** — noise. ⚠️ And
  [CR083](cr-083-budget-latest-estimate.md)'s `/budget-le` deviations engine **already solves this**
  with a materiality trigger; this CR cites it as the template two paragraphs later and then reinvents
  it. Reuse it.
- **Calibrated ≥3× / 90d** can only start firing 90 days after §3 ships. Say so.
- **Account ccy ≠ feed ccy fires on 0** — correctly silent, and the rule worth keeping.

⚠️ **Book Health needs its own dismissals table.** CR074's machinery cannot be reused:
`forecast_warning_dismissals.scenario_id` is `INTEGER NOT NULL REFERENCES forecast_scenarios(id)`
(migration 061:23). That is a second migration the draft did not mention.

**The first instance already shipped and should be the template:** `/budget-le`
([CR083](cr-083-budget-latest-estimate.md), v3.31.0) renders a **`BASIS` column** — `Mixed` /
`Budget` / `Typed` / `—` — stating per row where the figure came from, plus a deviations line
(*"5 lines worth a look · 1 refused · 1 with no budget"*). That is the actuals-side provenance pattern,
built and live. Generalise it.

**One free item while in here:** a month in progress compares a full-month budget against N days of
actuals and nothing on `/budget-vs-actual` says so. Show `12/31 days elapsed` and a pro-rated budget
column when the period includes today. It removes the single most common misreading of a budget report.

## 6. Smaller, verified, cheap

- **Home's headline has no as-of date and no currency,** and is sourced two different ways —
  `overview?.netWorth ?? lastPoint`, i.e. the balance report *as of today* if available, else the last
  point of a **monthly** series. Two as-of dates behind one figure. Render
  `Net Worth · as of YYYY-MM-DD · USD`, and put the reconciliation state beside it — with 27 fed
  accounts, "3 unreconciled" is the number's credibility and it currently lives a page away.
- **KPI cards assert `$0` while loading.** `formatKpiValue` returns `"$0"` for any non-finite value, so
  the landing page states zero income and zero spending for the first seconds of every visit.
  `NetWorthHero` already does this correctly (renders `"…"`). Return `—` and pass a loading state.
- **Balance-sheet cells are not clickable.** `CashFlowReport` has a full drill-down modal, correctly
  scoped to the report's own filters; `BalanceReport`'s only `onClick` toggles a highlight colour.
  Today "why is Chase Checking $1,950 off?" is four screens and a number held in the head. Reuse the
  modal.
- **Locale-dependent money.** **22** call sites (17 files) use `toLocaleString(undefined, …)` while others pin
  `"en-US"`. On a `pl-PL` browser the reconcile table renders `1.234,56` and the balance sheet renders
  `$1,234.56`. Fold into CR086's `<Money>` primitive — **build it once, in one CR, not twice.**
- **Two opposite null conventions.** `formatters.js` documents `formatCurrency(null) → "$0.00"` as
  intended, while `FCEquity.jsx` renders `—` for any `|v| < 0.5` — so a genuinely-zero equity, the
  interesting case, reads as missing data. Pick one: **null → `—`, zero → `0`.**
- **Two of three forecast surfaces never state their currency.** `FCReview.jsx` and `FCCompare.jsx`
  contain **no `USD` string at all**. ⚠️ **Corrected in pass 1 (§9 C6):** an earlier draft said the same
  of `FCEquity`, which is false — [FCEquity.jsx:105](../../frontend/src/pages/FCEquity.jsx#L105) renders a
  visible *"… USD."* in its subtitle, and it is the surface to copy. Given that
  migration 064 and rule R11 exist *because* a £10,000 module was posting $10,000, the unstated
  convention is the assumption that produced the defect. One chip in the header.
- **`FCEquity` and `FCMultiCompare` are nominal-only with no basis declared.**
  [CR079](cr-079-real-terms-view.md) got this right on Review and Compare — a banner that states the
  basis where the numbers are, disabled when the scenario has no honest deflator — and never reached
  the other two. FCEquity is a 30-year equity build; a 2062 figure there is ~2× its purchasing power.
  `fcRealTerms.js` is already scenario-scoped and reusable.

## 7. Sequencing

⚠️ **Re-sequenced at pass-2 sign-off (§10 P3). The build order below is the approved one.**

| Step | What | Why here |
|---|---|---|
| **P0a** ✅ **BUILT v3.38.0** | **Migration 074 (the `accounts` audit trigger) + ONE READER** — the `Last calibrated` column | Needs **no owner design decision, no CR086 dependency, no modal**. Covers all three app writers plus five scripts plus manual `psql` — coverage no UI change can reach — and gives `calibrate()` an undo path for the first time (`old_values` holds the prior anchor). ⚠️ **Applying 074 to prod ahead of any code is strictly beneficial**: it starts recording calibrations before the preview exists. ⚠️ **It must ship WITH the reader** — a trigger writing rows nobody looks at is invisible state that renders nothing, which is [CR085](cr-085-forecast-sensitivity.md)'s named defect class. Resolves the `last_calibrated_at` question (revive or retire) as part of it. |
| **P0b** ✅ **BUILT 2026-08-24** | §4c **both directions** + §4b's branch deletion + the five-surface test | Independent files, no dependency on P0a, safe in parallel |
| **P0c** ✅ **BUILT 2026-08-24** | The preview + the **409-on-drift** apply | ⚠️ **Must land before [CR086](cr-086-ui-visual-system.md) Phase 1.3** (see the ConfirmModal note below) |
| **P1** | `/balance-calibration` currency + the USD-equivalent sort + **`<Money>`** | |

⚠️ **The ConfirmModal collision, named here because neither CR contained it.** P0c writes a multi-line
numeric body into `ConfirmModal` (citing its `pre-line`); CR086 Phase 1.3 **replaces that component** with
Radix `<Modal>` — and CR086 §5 measured it as having **no Esc, no focus trap, 17 naked hex literals and a
white card in a dark app**, on the confirm that gates promote/calibrate/delete. **Either sequence P0c first
and have CR086 re-verify the preview body, or fix ConfirmModal first — but decide before starting, not
halfway through.** ⚠️ CR086's own sign-off adds that the ConfirmModal migration collides with **CR060**
rewriting `RefreshFeeds.jsx`.

**P0 (superseded framing, kept for its reasoning) — the write, and the variance that reads favourable when
a fetch fails.** §3 (preview + the **409-on-drift** apply + the trigger + `Last calibrated`) and §4c.
⚠️ **§4b: pass 1 moved it to P1 as latent; pass 2 says do it NOW as a patch, not as CR scope** — a latent
sign-flip whose fix is deleting one branch in two files is cheaper to fix than to track. It is **not** a
drive-by: it flips signs on a screen **and** an exported workbook, so it ships with the five-surface test.
Bill it as a roadmap-bullet fix landed alongside P0b. *(Original pass-1 note follows.)* ⚠️ **§4b moved to
P1 in pass 1 (§9 C1)** — it is latent, not live. ⚠️ **And `reconcileManual.js:291`'s `resetOpeningBalance` → 0 joins
P0**: a live, one-click, unaudited destructive write on the same page family that the draft omitted
entirely.

**Test plan — pass 1 flagged its absence on a money CR (§9 C8).** Minimum: a server test asserting
`dryRun: true` leaves `accounts.opening_balance` byte-identical; a test that an apply whose feed balance
moved since the preview is **refused**; a test that the audit row's `old`/`new`/`delta` tie to the row
it describes and is written **on the same client inside `db.transaction()`**; frontend tests for §4c
with budget-fails and actuals-fails as **separate** cases; and a §4b test across **all four** surfaces
plus the exporter.

**P1 — currency.** §2, both surfaces. Then §4a.

**P2 — provenance.** §5 Book Health, seeded with the four integrity rules whose inputs already exist.

**P3 — §6**, alongside CR086's `<Money>` primitive.

## 8. Not in scope

- **The IA consolidation.** The domain pass proposed 30 nav-visible routes → 12 top-level surfaces
  (fold `/ledger` + `/manual-entry` into `/transactions`; `/balance-calibration` +
  `/manual-calibration` + `/transfer-analysis` into `/reconcile`; `/forecast-multi-compare` into
  `/forecast-compare` as a tab). It is a coherent proposal and it is **not a money-legibility change**
  — it needs its own owner decision and its own CR. Two things it deliberately does *not* fold:
  `/refresh-feeds` (promote is a write against external data with a different failure posture) and the
  forecast's five numbered steps (the numbering invariant is load-bearing and `FCStepNav` derives from
  `routes.jsx`).
- **`/fxoptions`.** Both reviewers independently found it is dead — no route, no importer — yet
  `FCSettings.jsx` imports its CSS and renders `fx-options-header__title` on a page titled "FC
  Settings". Delete it; that is a roadmap bullet, not a CR.
- **The FX rate panel.** Budget FX rates are owner-editable and labelled *per 1 USD*; actuals rates are
  auto-fetched, use the inverse convention internally, are selected by *nearest date* (which can pick a
  rate dated **after** the as-of), and have **no UI at all**. Budget-vs-Actual therefore compares two
  currency translations, only one of which is inspectable. Worth doing — cheapest as a read-only
  section on `/budget-fx` retitled `FX Rates` — but it is adjacent to a live CR surface and should wait.
- **A silent FX fallback in `reports.js`.** On a rate-lookup failure the handler returns `rate: 1`, so a
  1,650,000 PLN balance would post to net worth as **$1,650,000**. It rarely fires (`exchange_rates`
  holds 6,755 daily rows back to 1999-12-30) — but it fires exactly when a *new* currency is added,
  which is when nobody is watching. The forecast engine was already fixed to **throw** on a currency it
  cannot convert (migration 064). This is the same defect on the actuals side and should be tracked as
  a roadmap known-issue until someone adds a currency.
- **Mobile.** Not inspected. The currency and null-vs-zero findings very likely apply to `/m/*` too.


---

## 9. Pass 1 technical review — what it falsified (2026-08-23)

Recorded rather than quietly patched, per the house convention. **Verdict: REVISE.** Every claim below
was re-verified against HEAD by this CR's author before being written down; where the reviewer was
itself wrong, that is recorded too.

| # | The draft said | Actually | How |
|---|---|---|---|
| **C1** | §4b implied **live** wrong variance numbers | **Latent.** The only two P&L roots missing the substring are `Realized Gain (Historical)` and `Margin Interest`, both effectively empty. And the minimal fix is to **delete the branch** (expenses are stored negative on both sides), not to add a server key — plus it is **two files**, `excelExporter.js:167-171` duplicates the rule | dev DB; `grep` |
| **C2** | §4c named one direction | The **mirror** exists at `:222` (budgets fail ⇒ full actual as variance), and `null` is overloaded loading-vs-failure | read |
| **C3** | §3: *"No new server work — the shape is already returned"* | **Wrong.** `bankFeed.js:319-322` syncs and **upserts `bankfeed_balances` before `dryRun` is consulted**, and the apply re-syncs — so the figure written can differ from the one approved. Needs a **409-on-drift** apply | read |
| **C4** | `opening_balance` has one writer worth auditing | **Three live app writers** — incl. `reconcileManual.js:291` `SET opening_balance = 0`, unaudited and unmentioned — plus five scripts and the COA update whitelist. Audit the **column** via trigger | `grep -rn "opening_balance *="` |
| **C5** | §2 is *"almost free"*; rollups blank | **a)** `reports.js:82-85` sums transactions **without a currency filter** — 3 dev accounts hold foreign rows, so a `Local` column would print a mixed sum as native. Needs `ARRAY_AGG(DISTINCT t.currency)`. **b)** Migration 064 gave **8** rollups a unanimous currency; blank only genuinely mixed ones | dev DB; read |
| **C6** | `FCEquity` renders no `USD` label | **False** — `FCEquity.jsx:105` renders *"… USD."* True for `FCReview`/`FCCompare` only (0 occurrences each) | `grep -n USD` |
| **C7** | §5: port `fcWarnings`; 7 rules, 4 inputs ready | `fcWarnings` is a **907-line client function** — port the *record shape*, compute server-side. **MTM-vs-sync-date has no input at all**; feed-unchanged fires **17/32**; >120% pro-rated fires **40/84** and CR083 already solved it | dev DB; read |
| **C8** | — | **No test plan on a money CR.** Added to §7 | — |
| **C9** | §6: build `<Money>` in CR086 | Open. CR087 **P1** needs currency-aware formatting and outranks CR086's Phase 3, in a CR that says the two must not share a queue. Options: (a) P1 depends on CR086 Ph3; (b) P1 hand-rolls; (c) **move `<Money>` into CR087 P1** and let CR086 consume it. Reviewer recommends (c) — **owner decision, pass 2** | — |
| **C10** | §8: the FX fallback *"should be tracked"* | It **already is**, `project-roadmap.md:985`, with a sharper finding (nearest-date selection). And there is a **second** silent fallback at `reports.js:176` `exchangeRates[currency] \|\| 1`. Parking it here is still correct | read |

**Verified CORRECT and unchanged:** every line of §3's evidence table (the `:583-587` summary, `:589`
gate, `:600` UPDATE, `:201-202` both branches, `:184`/`:219`, `aiReview.js` as the sole `audit_log`
writer); §2's currency mix (**PLN 22 · EUR 13 · GBP 2 · USD 42**, exact) and both file:line citations;
§4b's and §4c's citations; §5's `total_transfer_imbalanced` computed-then-dropped chain; all of §6's
citations; §8's `rate: 1`. The reviewer checked **dev**, not prod.

**Reviewer nit not accepted:** it proposed citing `reconcileToFeed.js:583-587` for the summary literal.
The two fields the text actually quotes are on `:585-586`; the citation stands.


---

## 10. Pass 2 sign-off (2026-08-23) — **GO on P0a/P0b/P0c · REVISE before P1 · DEFER §5**

**P1 — the P0 survived its steelman, and got stronger.** The freeze-on-file objection fails on **scope**:
CR082 protects *filed FBAR line items* — 16 rows, snapshotted, copied-not-joined. It protects nothing else;
net worth, the ledger, `/budget-vs-actual`, CR083's LE actual half and every unfiled year still sit on a
mutable `opening_balance` with no record. *"Only the owner clicks it"* is an argument **for**, not against —
a single-user system has no second pair of eyes, so **the record is the only reviewer**. And the toast is
the defect, not the answer: the number arrives after it is unchangeable, and C3 shows the applied figure can
differ from any figure previewed. The decisive fact is frequency (§3): **20 live calibrate accounts,
re-anchored monthly.** Cost already on the record: CR080's fabricated −32.56 loss needed **three migrations
(065 → 069) and a multi-day dig** precisely because no audit row existed to consult.

**P2 — §5 cut, §2 split, §4b as a patch.** Applied above.

**P3 — one migration, not two.** With §5 cut the dismissals table disappears. **074 alone** is justified and
unusually cheap: additive DDL, no backfill, no data mutation, reversible by `DROP TRIGGER`, and
`audit_log`'s NOT NULLs (`table_name`, `record_id`, `action`) are all trigger-fillable with no FK.
⚠️ **One convention reversal to make deliberately:** migration **072**'s own file argues *"this repo has
exactly one non-internal trigger, so a trigger would be against convention."* Auditing a column is not
enforcing an invariant, so the reversal is defensible — but it is written down and eight weeks old, and
should be an owner call, not a silent one.

**P4 — C9 settled as (c), with a fence.** `<Money>` moves to **CR087 P1**; CR086 Phase 3 consumes it. The
*behavioural* contract (native vs base currency, mixed-currency marker, null → `—` vs zero → `0`) is a
correctness decision and belongs in the CR that says a figure can be read wrong; the *visual* contract
(tabular figures, `--growth-*`) is a token CR086 already repointed, so there is **no circular dependency**.
⚠️ **The fence is load-bearing:** CR087 builds it for its own two surfaces and does **not** do the
22-call-site `toLocaleString` sweep — that stays CR086, or CR086's largest job migrates into CR087's P1.

**P5 — two build notes worth having before starting.** `f.currency` on the reconcile row is the **feed's**
currency, not the account's, so rows with no feed render blank — decide the fallback before building. And
the trigger sees the **column change, not the button**: `SET LOCAL app.actor` in the three services would let
it record *which* path wrote. Old/new/when is probably enough for CR080-class forensics; "which action" is
what tells you whether it was intentional.

**Also flagged:** §4a's pinned `Balance brought forward` row is a **new feature** — ship the rename-and-mute
alone and see if the owner asks for the rest. And **this CR's index row is ~1,000 words** against the index's
own *"keep descriptions to a single line"* — CR083's and CR086's rows are the same. The roll-up is becoming a
second spec, which is the restatement failure this project pays for most often. Worth a separate cleanup
pass, not a blocker.


---

## 11. P0a as built (v3.38.0, migration 074)

**Migration 074** — `fn_audit_account_opening_balance()` + `trg_audit_account_opening_balance`, an
**AFTER UPDATE OF `opening_balance`, `opening_balance_date` ON accounts** trigger writing old / new /
**delta** / account name / currency into the existing **`audit_log`**. Additive and inert; one
`DROP TRIGGER` reverses it. Owner chose the trigger over a per-service insert (§10 P3), deliberately
reversing migration 072's *"exactly one non-internal trigger"* convention — 072 was declining a trigger
that would **enforce an invariant**, and this one only observes.

**The reader ships with it, and that was the condition.** The reconcile table gains a **`Last
calibrated`** column: the date, the amount moved **with its currency**, and a red **`N× in 90d`** when an
account has been re-anchored three or more times — the symptom §3 exists to surface. `balanceReconcile`
returns `last_calibrated_at`, `last_calibrated_delta` and `calibrations_90d`, all sourced from
`audit_log`. ⚠️ It renders **"no record yet"**, never a dash or a zero: the trail starts empty and fills
forward, so an empty trail is **not** the same as never calibrated and the UI must not imply it is.

**`accounts.last_calibrated_at` was left in place and COMMENTed as superseded** (§10, owner decision).
It is stale since 2026-06-03 and nothing writes it, but its 67 populated rows are historical evidence.

**Verified.** 10 tests in `openingBalanceAudit.test.js` against a real DB — a no-op UPDATE writes
nothing, an unrelated column writes nothing, a date-only change fires, deltas are signed correctly, the
old→new chain is **walkable** (an undo path, not disconnected facts), `SET LOCAL app.actor` is captured,
and the write still lands. The 47-test `bankFeedImport` suite still passes. End-to-end through the API,
a real re-anchor surfaced as `moved -250.00 USD` with `90d=2`. Re-apply through the runner verified
idempotent.

⚠️ **Two notes for whoever builds P0b/P0c.**
1. **`SET LOCAL app.actor` works**, verified inside `db.transaction()`. The three services can start
   recording *which path* wrote with **no second migration** — the trigger already reads it.
2. **074 was first applied by hand with `psql -f`, which does NOT write `schema_migrations`** — the exact
   trap migration 057's registry row records. Re-run through `npm run migrate`. *Apply through the
   runner, not `psql -f`.*


---

## 12. P0b as built (2026-08-24)

**§4c — a failed fetch no longer reads as a good month.**
⚠️ The fix could not be a null check: `null` was set both when a fetch **starts** and when one **fails**,
so a banner keyed on it would flash on every load. `BudgetVariances` now carries explicit
`actualsError` / `budgetsError` state, set in each `catch` and cleared at each fetch start.
**And UNKNOWN is now distinguished from ZERO at three levels**, because conflating them *was* the defect:
a category absent from a **loaded** map genuinely has 0; a map that never loaded means the figure is
unknown. So the row yields `null` (not `?? 0`), `variance` is `null` whenever either operand is,
`formatCurrencyValue(null)` renders **`—`** rather than `$0.00`, and the totals row refuses to sum an
unknown column. Unknown rows sort last rather than as zero. A `role="alert"` banner names which side
failed.

**Verified by failing the fetch in a browser:** with actuals blocked, the page renders the real budget
(`$2,000.00`), actual **`—`**, variance **`—`**, and the banner *"Actuals could not be loaded."* A
genuinely-zero budget still renders `$0.00`, so the distinction holds. Before the change that same state
rendered actual `$0.00` and reported the full budget as a **favourable** variance with no error anywhere.

**§4b — the branch is deleted, in both files.**
⚠️ **The claim was verified on prod before anything was deleted**, since this is a sign change on money:
expense `budget_entries` run **min −71,968 / max 0 with 656 of 657 negative**, and 2026 expense
transactions sum **−180,215.35**. Expenses are stored negative on both sides, so `actual − budget` is
favourable-positive for income **and** expense, and the `budget − actual` branch was never correct for
anything — including the two prod roots that match neither substring (`Realized Gain (Historical)`,
`Margin Interest`), which were silently taking it. Both helpers are gone; the identical rule in
`excelExporter.js` went with them, so the screen and the exported workbook cannot disagree.

**16 tests** in `varianceSign.test.js`: the convention as arithmetic, the old branch kept as a **witness**
(the same underspend it called −20 the convention calls +20), and a **source guard** across all five
surfaces that no file computes `budget − actual` or keys a sign on an account-name substring.
⚠️ **The guard was falsified before being trusted** — reintroducing the branch fails it, restoring it
passes. Gates: 582 frontend tests, eslint 0 errors, 5 ratchets at baseline.

**Not swept:** `FCModulesStreams.jsx` and `CategorySelector.jsx` also substring-match `"income"`, but on
`line_type` and a control value — **not** on an owner-editable account name, so they are not this defect.


---

## 13. P0c as built (2026-08-24) — the P0 is complete

**The preview.** Clicking *Reconcile* now runs a **dry run first** and opens `ReconcilePreviewModal`
showing the feed observation, what the bank reports, what fin expects, Σ transactions, and
**`old → new` with the delta stated explicitly** — because making the reader subtract two long figures is
how a wrong one gets approved. Built on the Radix **`<Modal>`**, per the owner decision, **not**
`ConfirmModal`: CR086 §5 measured that component as having no Esc, no focus trap and a white card on a
dark page, and `nested-modal.spec.js` records it as **dead to clicks** under an open Radix layer.
⚠️ Reconcile was `ConfirmModal`'s only consumer on this page, so it is **gone from this component** — it
is *not* retired app-wide; five consumers remain and CR086 owns that behind CR060.

**The preview is now genuinely read-only, which it was not.** Pass 1's C3 found the route synced upstream
and **upserted `bankfeed_balances` before `dryRun` was consulted**. Both are now skipped on a dry run, and
the response says `_synced: "preview"` rather than `"cached"`, which would imply a sync was attempted.

**The apply refuses on drift.** It carries the approved `new_opening` **and** `feed_date`; `calibrate()`
recomputes and throws `PREVIEW_STALE` on either mismatch, which the route returns as **409 with the
current figures**. Both fields matter — the same `new_opening` from a different feed row is a coincidence,
not a match. `expect` is **opt-in**, so the cron and scripts are unaffected.

⚠️ **A design bug this found on dev, before it shipped — and it would have been an infinite loop.**
The preview deliberately does not sync; the apply does. So on any day the sync brings a newer feed row,
the apply 409s — and the draft's *"Preview again"* button would have recomputed from the same un-synced
cache and 409'd **forever**. Observed live: preview computed against feed `2026-08-23`, the apply synced
and got `2026-08-24`. The 409 already carries `current`, so the modal now **shows the server's fresh
figures** and offers **"Apply updated figures"**. One extra click on the first reconcile after a sync,
and the owner sees exactly what moved. **The alternative — letting the preview sync — is what makes a
preview write, which is the thing P0c exists to stop.**

**Also fixed while looking at it:** `Rest` threw a bare `Error` with the status discarded, so a 409 was
indistinguishable from a 400 app-wide and the UI could only say *"reconcile failed"*. It now carries
`status`, `code` and `current` — additive, nothing read them before. And a **zero delta renders neutral,
not green**: colouring `0.00` as a gain asserts something untrue about a re-anchor that moves nothing.

**Verified.** 6 DB tests in `reconcilePreview.test.js` — a dry run leaves `opening_balance`
**byte-identical with no audit row**; a matching apply writes and leaves **exactly one** audit row (P0a and
P0c meeting: the preview shows the move, the trail records it happened); a moved `new_opening` **or** a
moved `feed_date` is refused with nothing written; the refusal carries the current figures; and an apply
with no expectation still writes. Plus **340 v2 service** and **233 route** tests green, 582 frontend, six
guards at baseline, build clean, and the modal driven in a browser in **both themes**.

⚠️ **Not in P0c, deliberately:** `reconcileManual.js:291`'s `resetOpeningBalance` → 0. §10 listed it here,
but it is a **different page** (`/manual-calibration`) and a different service; folding it in would have
meant a second preview surface in the same change. Migration 074's trigger **already audits it**, so it is
recorded, not invisible. Carry it as the first item of P1.


---

## 14. P1 — the reconcile page speaks currency (built 2026-08-24)

§2's **GO** half, and the cheaper one: `f.currency` was already in the `balanceReconcile` SELECT and
spread to the client, so labelling the row was nearly free. Two things were not.

**The queue was sorted in the wrong order, and it is half the queue.** It ranked on **raw `|drift|`
across currencies**, so a 2,394 PLN drift outranked a $848.77 USD one — measured live on dev, the PLN row
sat **3rd** and belongs **5th**. 10 of the 20 live calibrate accounts are non-USD (PLN 7 · EUR 3). Sorting
now uses `drift_usd` via the **shared `fx.rateAsOf`**, and ⚠️ that helper returns **null rather than 1:1**
on a currency it cannot convert — a silent 1:1 is the defect [§8](#8-not-in-scope) records in
`reports.js`, and it would rank a foreign row on a number that is not money. An unconvertible row keeps
its native magnitude for ordering and sets `drift_usd_known: false`, so *not converted* is
distinguishable from *converted to zero*.

**The account's currency and the feed's are now both exposed, not coalesced.** They agree on every live
mapping — and where they disagree that is the actuals twin of the forecast's **R11**: the one shape no
balance check can see, because the values agree and are simply in different units. `currency_mismatch`
fires on **0** accounts today, which is the point; [§5](#5-provenance-the-forecast-has-a-model-the-actuals-do-not)
kept exactly this rule and dropped the noisy ones.

**Display:** one currency label per row rather than a column, because `COMPUTED`, `BANK (EXPECTED)` and
`DRIFT` all share it and the table already scrolls (`.recon-table-wrap`; page `scrollWidth` still equals
`clientWidth`).

**5 DB tests** in `reconcileCurrency.test.js`, incl. the unconvertible-currency case and the mismatch
flag. **838 v2 backend** + 582 frontend green, six guards at baseline.

⚠️ **Still open in P1:** `<Money>` (with §10 P4's fence — CR087 builds it for its own two surfaces, the
22-call-site `toLocaleString` sweep stays in CR086), `reconcileManual`'s `resetOpeningBalance` under the
P0c preview, and §2's **deferred** `BalanceReport` `Local` column, which needs
`ARRAY_AGG(DISTINCT t.currency)` plus a mixed marker plus migration 064's unanimity predicate.
