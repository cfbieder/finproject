# CR087 — Money legibility: the currency, the column, and the write with no record

**Status:** **OPEN** — designed, nothing built.
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

**Verified:** [reports.js:188-202](server/src/services/reports.js#L188-L202) returns
`{ name, totalUSD, currency, total }` on every balance-sheet leaf — native currency **and** native
amount. [BalanceReport.jsx:125](frontend/src/features/Balances/BalanceReport.jsx#L125) renders
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
| The dry-run **already returns everything a preview needs** | [reconcileToFeed.js:585-586](server/src/v2/services/reconcileToFeed.js#L585-L586) — `{ feed_date, feed_balance, expected, sum_tx, old_opening, new_opening, applied }` |
| The write is gated on it | [:589](server/src/v2/services/reconcileToFeed.js#L589) `if (!dryRun) { … }` |
| **The UI never calls it** | [BalanceReconciliation.jsx:201-202](frontend/src/components/BalanceReconciliation/BalanceReconciliation.jsx#L201-L202) — `dryRun: false` in **both** branches |
| The confirm shows no numbers | [:184](frontend/src/components/BalanceReconciliation/BalanceReconciliation.jsx#L184) — *"re-anchor opening_balance for «name» to the bank's reported balance"*. The `old → new` figures appear at [:219](frontend/src/components/BalanceReconciliation/BalanceReconciliation.jsx#L219) — **in the toast, after the write** |
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
[bankFeed.js:319-322](server/src/v2/routes/bankFeed.js#L319-L322) runs `syncUpstream()` **and**
`ingestBalances()` on *every* call to that endpoint, **before `dryRun` is ever consulted** — and
`ingestBalances` upserts rows into `bankfeed_balances`. So a preview click hits the bank-feed
microservice and writes to fin's DB. Worse, the *apply* click re-syncs, so **the `new_opening` actually
written can differ from the one the owner just approved.** `RECONCILE_SYNC_MAX_AGE_MIN = 15` narrows
that window and does not close it. A preview that can be silently superseded by the write it authorises
is worse than no preview.

**C4 — `opening_balance` has three live app writers, not one**, so auditing `calibrate()` alone does
not deliver the guarantee [CR082](cr-082-tax-section-fbar-114.md) depends on:
[reconcileToFeed.js:600](server/src/v2/services/reconcileToFeed.js#L600) (the one named),
[reconcileManual.js:317](server/src/v2/services/reconcileManual.js#L317) (the **manual** calibrate on
`/manual-calibration` — identical defect), and
[reconcileManual.js:291](server/src/v2/services/reconcileManual.js#L291) — `SET opening_balance = 0`,
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
[Ledger.jsx:538-548](frontend/src/pages/Ledger.jsx#L538-L548) carries its own warning verbatim —
*"otherwise fall back to a client-side cumulative sum seeded at 0 (a «running total of the displayed
rows», not the true account balance)"* — and both render under the same `<th>Balance</th>` with
identical styling. An account with a $500,000 opening balance, filtered to one month, shows a closing
"Balance" of $12,400. **Change:** when `hasServerBalance` is false, rename the column to `Σ shown` and
mute it, or drop it. A ledger balance that is not the account balance is not a ledger balance. Add a
pinned `Balance brought forward` first row so `opening + Σ shown = closing` is checkable by eye —
the one check a ledger exists to support.

**4b. Variance sign is decided by a substring match on an owner-editable name.**
[BudgetRealization.jsx:243-266](frontend/src/pages/BudgetRealization.jsx#L243-L266):

```js
const topLevel = path[0];
return typeof topLevel === "string" && topLevel.toLowerCase().includes("expense");
```

Used at [:354](frontend/src/pages/BudgetRealization.jsx#L354) to choose between
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
[excelExporter.js:167-171](frontend/src/utils/excelExporter.js#L167-L171) — fix the page alone and the
screen and the exported workbook disagree.

Label the column `Variance (fav/(unfav))` so the convention is stated where the number is read — noting
that the label is truthful **only because amounts are signed**.

**4c. A failed actuals fetch renders a page of 100%-favourable variances.**
[BudgetVariances.jsx:148-151](frontend/src/pages/BudgetVariances.jsx#L148-L151) catches the actuals
failure and sets `null`; [:210](frontend/src/pages/BudgetVariances.jsx#L210) short-circuits only if
**both** sides are null; [:223](frontend/src/pages/BudgetVariances.jsx#L223) then coalesces the
missing actual with `?? 0`. Budget loads, actuals fail ⇒ every category reads `actual $0.00`,
`variance = full budget, favourable`, **no error banner.** ⚠️ **The mirror defect is unnamed in the draft (pass 1, §9 C2):**
[:222](frontend/src/pages/BudgetVariances.jsx#L222) is `leafBudgetTotals?.get(name) ?? 0` — actuals
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
  of `FCEquity`, which is false — [FCEquity.jsx:105](frontend/src/pages/FCEquity.jsx#L105) renders a
  visible *"… USD."* in its subtitle, and it is the surface to copy. Given that
  migration 064 and rule R11 exist *because* a £10,000 module was posting $10,000, the unstated
  convention is the assumption that produced the defect. One chip in the header.
- **`FCEquity` and `FCMultiCompare` are nominal-only with no basis declared.**
  [CR079](cr-079-real-terms-view.md) got this right on Review and Compare — a banner that states the
  basis where the numbers are, disabled when the scenario has no honest deflator — and never reached
  the other two. FCEquity is a 30-year equity build; a 2062 figure there is ~2× its purchasing power.
  `fcRealTerms.js` is already scenario-scoped and reusable.

## 7. Sequencing

**P0 — the write, and the variance that reads favourable when a fetch fails.** §3 (preview + the
**409-on-drift** apply + the trigger + `Last calibrated`) and §4c. ⚠️ **§4b moved to P1 in pass 1
(§9 C1)** — it is latent, not live. ⚠️ **And `reconcileManual.js:291`'s `resetOpeningBalance` → 0 joins
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
