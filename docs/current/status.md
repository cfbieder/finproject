# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).
> **The budget is load-bearing** (216 → 60 on 2026-08-05; 122 → **94** on 2026-08-09, by lifting
> the failure table and the infrastructure block into their own files): overrun = restatement the
> CR index and roadmap already own, and it is where stale facts collect. Each cut has come from
> MOVING something that changes on a different clock, never from deleting what is true.

**Last updated:** 2026-09-02 · **Live version:** **v3.49.1** (see `VERSION` / git tags) — **v3.49.1: an expired bank consent now REACHES you — Home-strip item + a SessionStart hook. 🔴 [CR060](../cr/cr-060-feed-connection-health.md) had left this open on a false premise (*"a push path already exists from CR006"* — CR006's is a browser notification that needs fin already open). ⚠️ Deliberately NOT a cron writing to a log: that is the shape that cost 74 days of backups two days earlier. A log is not an alert**; — **v3.49.0: 🔴 [CR080](../cr/cr-080-feed-accrual-reconcile-mode.md) §B2's own safety claim was FALSE — the pairing rule could over-claim, because containing a window is not matching it. `Wise - USD` refused for days at −4.76%/yr and the gap was neither yield nor a missing transaction: the observation was synced mid-08-31 and already held that day's spend. The direction that saved us is not the dangerous one — a DEPOSIT under ~5.29 would have been filed as income permanently, inside the band, unseen. The engine now walks back to an observation whose window is clean; Wise - USD books +1.52 at 3.59%/yr automatically. Also: connections key on `external_id` (the drift that forked 31 rows out of 13 is closed), and the orphan pill links to the page that fixes it**; — **v3.48.3: the Feed health page was reporting 31 feeds for 13 connections, ALL STALE, with one error worn by thirteen — owner-found against fintable's dashboard, and fintable was right. 18 ghost `bank_connections` rows (the upsert keys on a column that has meant three different things) plus service-wide sync stats printed on every card. 🔴 CR060's OWN page was the one lying, while the `upstream` block it added kept `/balance-calibration` correct — the page you open BECAUSE you suspect something was the one that could not be trusted**; — **v3.48.2: the account-mapping table names the bank — five feed accounts share the `Christopher Biedermann (…)` form across Revolut and Wise, and a shared display name is what once rerouted a whole feed**; — **v3.48.1: the orphan guard reaches the reconcile page and disarms the button there. An orphaned account was ALREADY in that table looking normal — the row does not go blank, it FREEZES, because fin's balance cache keeps the old id's rows — and the health badge structurally could not see it, so the page said `ALL FEEDS HEALTHY` beside a dead account. `feed gone` now outranks `reconciled`, and reconciling one is refused**; — **v3.48.0: connect and re-authorise a bank from inside fin ([CR060](../cr/cr-060-feed-connection-health.md)). 🔴 Its finding is a FALSE PREMISE IN OUR OWN RECORD: the reconnect was fenced out of that CR as needing a write credential, and Fintable says twice that minting a link is a `read` operation — because minting connects nothing. The guard ships first, because the button is the cheap half: a reconnect can mint new fintable account ids, which is exactly what `account_source_mappings.external_name` keys on, so a re-consent can leave an account not feeding in SILENCE (it already did, for seven weeks). `orphaned_mappings` names them — 0 of 27 today, so preventive. Fintable's OAuth Applications is NOT the route: it exists to let other users authorise a published app and grants the same API our PAT already reaches**; — **v3.47.1: a REFUSED reconcile now says so. [CR080 B3.1](../cr/cr-080-feed-accrual-reconcile-mode.md) — the confirm dialog read a `refused` flag the feed engine never set, so a routinely-refused accrue rendered as a proposal with a live `Apply` that wrote nothing. An ACTION offered that can have no effect: [CR085](../cr/cr-085-forecast-sensitivity.md)'s defect class one step over, owner-found on the page again. Also: `backup-to-remote.sh` RETIRED (failing silently 74 days, and its dead pre-flight had silently stopped the docker prune too) and pre-deploy snapshots given retention (424 files / 1.5 GB / 177 days of plaintext prod dumps, 422 of them unable to serve any rollback)**; — **[CR088](../cr/cr-088-budget-vs-actual-le-table.md) COMPLETE — ELEVEN report pages now share one table look and one page header (`Budget Analysis`, renamed in P5): SEVEN report tables share one stylesheet and the LE grid's typography — they drew hierarchy in colour and OPACITY, dimming money — NINE pages now render one page-title treatment, and `/budget-vs-actual`'s budget column gains a three-state comparison, `vs Actual` · `vs LE` · `Both`. ⚠️ Its last defect was found by the OWNER READING THE PAGE: a variance column named after the wrong benchmark ([§11](../cr/cr-088-budget-vs-actual-le-table.md))**; — **[CR054](../cr/cr-054-cash-flow-by-account.md): the By-Account totals row rejoins the frozen column, the report grows a `Total`, and its account chips gain [CR008](../cr/cr-008-hierarchy-filter.md)'s `multiGroup` so a selection can span two groups**; — **CR086 §3 (the money colours) + CR087's P0 COMPLETE (P0a the `opening_balance` audit trail, migration 074 · P0b two ways a variance could be wrong · P0c the preview and its 409) + P1's reconcile half (the queue speaks currency)**; — **CR085 COMPLETE with NO unbuilt scope** (tornado + trajectory + multi-band + owner-typed bands + the knob sweep + stream schedules + a starting set, migration 073); CR083's Latest Estimate (072); CR082 and CR084 complete

## Current phase
**The model, since [CR069](../cr/cr-069-forecast-streams.md):** a module is *identity + optional
valuation + N first-class **streams***. Shipped since 2026-08-05 and not restated here —
[CR070](../cr/cr-070-module-inputs-by-type.md)+[CR071](../cr/cr-071-forecast-numbers-vs-intent.md)
· [CR072](../cr/cr-072-valuation-module-inputs.md) (**the balance-sheet form is CLOSED**) ·
[CR073](../cr/cr-073-two-recurrence-guards.md) ·
[CR074](../cr/cr-074-dismissible-cash-health-warnings.md) (migration 061 — a dismissal **expires
when the warning's figures change**) · [CR075](../cr/cr-075-base-year-is-the-budget.md) (**year −2
is ACTUAL, year −1 is the BUDGET**, read from `budget_entries`; one budget ⇒ one base year).

**[CR085](../cr/cr-085-forecast-sensitivity.md) is COMPLETE, with no unbuilt scope** (v3.32.0 →
v3.37.1, migration 073). `/forecast-sensitivity` ranks **which assumption the plan rests on** —
every bar a real engine build on CR084's scratch harness. **Measured on `2026 Base`: 154 knobs —
143 move the plan, 8 do not, 0 can kill a run.** That count is a fact about the DATA, not the page:
prod offers 153, because one disposal there carries no selling cost and the schema-floor gate
correctly withholds it. As-built detail is §17–§25 of the CR; the release
notes are in the [roadmap](project-roadmap.md).

⚠️ **Its durable lesson is a DEFECT CLASS, not a feature: state that exists, renders, and produces
no visible effect, so it reads as absent.** In the engine that is a knob which writes, builds and
moves nothing, drawing a zero-length bar that says *"this assumption does not matter"* in a chart
whose whole claim is that the bars are ranked. In the UI it is a control too subtle to find, a
picker that cannot say what is selected, a marker painted the colour of its own fill, or six
measurements built and two drawn. **ELEVEN instances. TEN were found by a person looking at the
page; ONE by a gate.** The engine half now HAS a gate —
`Scripts/sweep-sensitivity-knobs.js` ([§22](../cr/cr-085-forecast-sensitivity.md)) applies every
offered knob, rebuilds for real and hashes the entries, so a dead knob is measured rather than
argued about; it caught two of its own author's fixes hiding working knobs. ⚠️ **The DISPLAY half
still has none** — nothing checks that a chart draws everything it was handed — and that is where
the owner found all but one of their instances. **v3.41.0 adds a TWELFTH, owner-found the same way**
([CR054](../cr/cr-054-cash-flow-by-account.md)): the By-Account `Net Cash Flow` row sat in `<tfoot>`,
missed the more-specific half of the frozen-column selector, and scrolled its label away from its own
figures. ⚠️ **Its fix was got wrong twice by reasoning about the cascade and settled by a DOM probe** —
the "clean" version tied on specificity and silently unpinned the whole body column.

🔴 **[CR076](../cr/cr-076-forecast-model-review.md) — the five-reviewer model review; §8 COMPLETE
across v3.20.0–v3.22.0.** It corrected **our own published figures** and moved numbers eight times.
**§1 records what is SOUND and is the larger half.** §7 + §11 still hold open owner decisions.
Shipped since, all detailed in the [CR index](../cr/README.md) and the
[roadmap](project-roadmap.md): [CR077](../cr/cr-077-assumption-advisor-tab.md) (v3.23.0 — Cash
Health splits into **Integrity** vs **Assumptions to consider**, counted and dismissed separately)
· [CR078](../cr/cr-078-disposal-selling-costs.md) (v3.24.0, migration 062 — a per-row selling cost
off the cash **and** the gain; rates live since 2026-08-09) ·
[CR079](../cr/cr-079-real-terms-view.md) (v3.25.0 the Review, **v3.26.0 Compare** — the plan in
**today's money** on both; the export stays nominal).

**Net assets at 2062 (live):** Base **4,071,160** · Buy Business **9,102,335** · Downside
**1,893,368** · Upside **7,404,138** · SRQ **−476,930**. Owner decisions applied 2026-08-09:
selling costs by jurisdiction (**US 7 · Spain 6 · Poland 4 · business 2%**, CVC capital returns
exempt — **−603K to −796K per scenario**, the plan had been keeping 100% of every sale);
`Social Security` → **full CPI**; `OCME` at −30 a **deliberate write-off**. **2026-08-10:
`Sarasota House` growth **0 → 1.0**** — the only US property not at full CPI, and an unset field
rather than a belief (owner); only SRQ moved, **−1,392,889 → −476,930**, the other four
**byte-identical** ([v3.26.1](project-roadmap.md)).

⚠️ **SRQ is still −476,930.** It is bought **entirely for cash** (`House Morgage` is `exclude`
everywhere), earns **no rent** against 45,000/yr, and sells at 7%. Financing is the untested lever,
and testing it is **DECLINED** (owner, 2026-08-23) — not needed.

### The recurring failure
**[failure-patterns.md](failure-patterns.md) is the canonical list** — seven shapes, each found
more than once, each having passed the gates meant to catch it. Read it before writing a rule, a
warning sentence, or any figure that asserts what the engine does. The one that has cost most:
**a restatement asserted as the engine's behaviour, found TEN times** — the ninth
([CR059 §22](../cr/cr-059-fintable-api-ingestion.md)) is the first to reach the **ledger**, and the
tenth (§22.9) is the first where the restatement is of a **measurement**, not the engine.

## Known issues
[roadmap §3](project-roadmap.md#3-known-issues) is canonical. 🔴 **A feed duplicate REACHED PROD
2026-08-11** ([CR059 §22](../cr/cr-059-fintable-api-ingestion.md)) — 28 rows, **+2,888.80 phantom
income**, net-of-transfers invisible to a balance check. Fixed at source and cleaned up; a forced
sweep reclaimed all 108 exposed rows, 0 inserted. **The class is closed too, v3.28.1**
([§22.7](../cr/cr-059-fintable-api-ingestion.md)): `promote()` now dedups on **content**, since no
id-keyed guard can recognise a row whose id it has never seen — it *claims* candidates so 2 held + 3
incoming still inserts the third, and matches on exact date because a false match drops real money
silently. **The floor is fixed too (§22.9–22.10, 2026-08-12)** — NOT by raising it: the "1–2 day"
arrival lag it rested on is really **p99 17 / max 53**, so a fixed floor was silently dropping late
arrivals. It now **rolls** at 30d from **one** function feeding both the fetch and the carry-over, and
there turned out to be a **third** floor — fin's own cron asked for 14 days. **§22 is now fully closed** — items 4–5 shipped too
([§22.11](../cr/cr-059-fintable-api-ingestion.md)): the insert ceiling scales with the batch (a flat 300
could never fire on a 40-row tick), and a **generation detector** catches one transaction held under two
id schemes — the one shape the carry-over reports as `already_known` and can never see. It found 2 groups
on run one (§18+§22 compounding; **fin correct throughout**) and carries a reasoned exception list whose
stale check caught its own author within a run. **All owner checks are COMPLETE (2026-08-12): all 42 duplicate
candidates are GENUINE** — 16,058 gross, **zero fin defects, zero wrong money** ([§22.8](../cr/cr-059-fintable-api-ingestion.md)),
and the best evidence yet for the content guard's exact-date/claiming bias, since a looser guard would have eaten them. **#19 and #20 CLOSED 2026-08-11
(v3.27.0):** the module-currency defect closed at its source — migration **064** relabels the eight
rollup accounts whose children are unanimously non-USD (`Tax Liabilities` left alone, genuinely
mixed), the engine now **throws** on a currency it cannot convert (falsified: a £10,000 module was
posting **$10,000**), and `fcWarnings` **R11** reports a module whose currency disagrees with its
account — the one shape no engine guard can see, because the values agree and are simply wrong.
**#20 was a red `main` nothing announced:** `crud.openingBankCash.test.js` threw on a `Bank Accounts`
root that `ci-seed.sql` never creates, so **five consecutive CI runs failed** while every local run
passed; the suite now seeds and cleans up its own root. **#18 (open):** a fresh DB enforces
`fc_lines.line_type`'s CHECK while dev and prod do not (007 auto-baselined) — a test can pass on
dev and fail only in CI; 0 violating rows, so a forward migration closes it cheaply. **#21 FIXED
2026-08-11:** CR080's new `reconcileAccrue` suite hardcoded `INTEREST_INCOME = 74` — the id on
**dev only** (a CI-built DB gives it **11**) — so all 12 of its tests failed on the FK the day they
shipped; the id is now resolved by name. Fifth instance of #12, and the first where the seed
already carried the row: the **id**, not the row, was the borrowed fact. Worth knowing
at session start: the timezone rule (#3), the red `main` nobody announced (#12 — **mostly closed
2026-08-12**: a SessionStart hook now puts `main`'s verdict in front of every session, deploy
**Step 0b** refuses a red/unfinished/unverified gate, `./Scripts/check-ci.sh` asks on demand, and
`./Scripts/test-fresh-db.sh` catches the ambient-data class before the push. **Owner action, the
last piece:** turn on GitHub's *Actions → failed workflows* email — a webhook was offered and
declined, and no agent can set or verify that toggle), **#23 (new):** agent threads on one shared
tree commit over each other — twice today, cosmetic so far, needs a worktree-or-accept call, the ESLint JSX blind
spot (#10), dirty-tree deploys (#17). #2 and #15 are CLOSED.

## Live infrastructure
Moved to [guides/infrastructure.md](../guides/infrastructure.md) — hosts, ports, the deploy script,
the dev-first migration rule, and the fact that **an engine change moves nothing until the
scenarios are REGENERATED**. It changes far less often than this file does.

## Next
- 📋 **[CR061](../cr/cr-061-holdings-and-prices.md) rev 3 + [CR090](../cr/cr-090-investments-section.md) — the
  Investments work, split after two review passes.** Owner asked for a per-account portfolio view valued at
  real-time quotes; rev 2 grew into three CRs, so **CR061 is now the ingest and CR090 is the page**. The reason is
  a clock: **fintable's holdings history starts 2026-07-04 and nothing recovers a day nobody stored.**
  🔴 **The measurement is the story.** rev 1 quoted its constraints from CR059 **without calling the endpoints**;
  rev 2 called them and corrected three; **rev 3 corrects two more of its own, both found by review** — the
  classifier it proposed *could not produce its own tests' answers* (`FDIC91125` → bond, `FCNTX` → equity, no
  vocabulary value for a mutual fund at all), and it counted 29 CUSIPs where there are **37 in two accounts**, the
  8 missing ones being exactly the mis-basis that prices 100,000 face at an equity's $250.
  Five of six accounts' holdings **tie to the custodian within $10**; Options is **$33,081 short** because fintable
  does not report option contracts, and CR090's universal residual row exists to keep that legible.
  🔴 **`snapshot_date` is a POLL date, not a valuation date** ([CR089](../cr/cr-089-month-end-observation-dating.md)) —
  the 09-02 snapshot holds the 08-31 close — so positions store `polled_on` **and** `valued_on`.
  **Only 47.5% of value is quotable**, so the real-time ask ships as an overlay *beside* the custodian total, never
  as a revaluation of it. *Owner: the `Individual` account is not tracked · ⚠️ that inverted 2026-09-03 — **CR061 ships the bank-feed holdings work first**, CR089 P2 waits on it ·
  the statement backfill to 2016 is claimed by CR061.*
- ✅ **[CR085](../cr/cr-085-forecast-sensitivity.md) — everything it deferred is now BUILT.** Tier 2
  (a token focus ring app-wide, replacing a default that composited to **1.18:1** — the widest-reach
  fix on this list, and it was never really about this page) · Tier 3 (compose and read stop sharing
  the page; a search over the catalogue; multi-band nested bars) · owner-typed bands · the knob
  sweep · the `forecast_stream_changes` schedules · the starting set. **The one thing still worth
  doing is not scope: nothing checks that a CHART draws everything it was handed** — every
  display-side instance of this CR's defect class was found by the owner, not by a gate.
- 🔄 **[CR086](../cr/cr-086-ui-visual-system.md) §3 + [CR087](../cr/cr-087-money-legibility.md) P0a SHIPPED
  v3.38.0.** From a whole-app UI review whose **live render pass falsified its own instrument** (the rig
  sampled 25 rows/route while reporting true totals) and then had **22 more claims falsified by two review
  passes** — all recorded in [CR086 §12](../cr/cr-086-ui-visual-system.md) / [CR087 §9](../cr/cr-087-money-legibility.md).
  **Six tokens are 92% of every contrast failure and 44.7% of those are the two MONEY colours**, so the
  contrast problem *is* a money-legibility problem: light failures **2,364 → 1,227 (−48%)**, dark
  byte-identical, delta ties to prediction within one element. **P0a** gives `opening_balance` an audit
  trail — it is re-anchored on **20 accounts monthly** and left no record, which is how
  [CR080](../cr/cr-080-feed-accrual-reconcile-mode.md)'s fabricated −32.56 loss cost three migrations to
  undo. ⚠️ **A trigger, reversing 072's convention** (owner). **P0b (v3.38.1)** closed two ways a variance
  could be **wrong**: a failed actuals fetch rendered a page of **100%-favourable** variances with no error
  (`—` now, never `$0.00` — ⚠️ the fix could not be a null check, since `null` was also the *loading*
  state), and the sign was chosen by **substring-matching an owner-editable account name** in two files —
  verified on prod before deleting, since expenses are stored **negative on both sides** and the other
  branch was never correct for anything. ⚠️ Its source guard was **falsified before being trusted**.
  **P0c (v3.39.0) completes the P0**: Reconcile previews first — `old → new` with the delta **stated** —
  on the Radix `<Modal>`, and the apply carries the approved figures so the server returns **409** and
  writes nothing if they moved. ⚠️ **The preview was not read-only** until now (the route synced and
  upserted before `dryRun` was consulted), and the 409 exposed an **infinite loop** caught on dev: the
  preview does not sync, the apply does, so *"Preview again"* would have re-staled forever — it now shows
  the server's fresh figures instead. ⚠️ **Its refusal gate was DEAD until 2026-09-01**
  ([CR080 B3.1](../cr/cr-080-feed-accrual-reconcile-mode.md)): the dialog read a `refused` flag
  `reconcileToFeed` never set, so a **routinely** refused accrue (both Wise accounts refuse between
  month-ends, by design) rendered as a proposal with a live **Apply** that wrote nothing — an ACTION
  offered that can have no effect, CR085's defect class one step over, and **owner-found on the page
  again**. The engine now states it; the dialog drops the Apply. **P1's reconcile half (v3.40.0)** labelled the currency on every row
  and fixed a sort that was **wrong on half the queue** — it ranked raw `|drift|` across currencies, so
  **2,394 PLN ($650) outranked $848.77**, and 10 of the 20 live calibrate accounts are non-USD. It converts
  through the shared `fx.rateAsOf`, which returns **null rather than 1:1** on an unconvertible currency.
  **Next: `<Money>`** (fenced — CR087's own two surfaces; the 22-call-site sweep stays in CR086),
  `resetOpeningBalance` under the P0c preview, and §2's deferred `BalanceReport` `Local` column.
- ~~Advisories~~ · ~~Real terms on Compare~~ **BOTH DONE** — all 15 advisories walked, **every one
  already deliberate, no model change** ([CR076 §13](../cr/cr-076-forecast-model-review.md)); two
  rules firing on streams **not in the plan** guarded, 17 → 15
  ([CR077 §7](../cr/cr-077-assumption-advisor-tab.md)); Compare in today's money, v3.26.0
  ([CR079 §7](../cr/cr-079-real-terms-view.md)) — only the **Home hero** stays nominal-only.
- ~~The editor-side consequence preview~~ **DONE, v3.29.0** (spinner v3.30.1; **LIVE on prod** since v3.30.0)
  ([CR084](../cr/cr-084-save-time-consequence-preview.md)): **Save now shows what it DOES first** —
  net assets before → after, nominal **and** in today's money, plus which scenarios move and which
  do **not**. Two real engine builds on a throwaway copy, applied through the SAME body→columns
  mapping the save uses (`services/moduleWrite`, extracted) so a preview cannot differ from the
  save. **Three defects only a browser found**, incl. a preview failure that *saved anyway*.
  **CR081 stays DEFERRED** — AI-proposed-edit acceptance measured **0/15, twice**, and its one
  high-value phase needs data a local model cannot fetch.
- ✅ **[CR082](../cr/cr-082-tax-section-fbar-114.md) — a `Taxes` section, first form FinCEN 114
  (FBAR). COMPLETE, and fully on prod 2026-08-16** (migrations **070** + **071**). TY2025 carries a
  figure on every line — 16 lines, **$2,627,821**, threshold exceeded — and TY2024 is recorded as
  filed. What shipped and the four defects that closing it exposed:
  [§11c](../cr/cr-082-tax-section-fbar-114.md#11c-the-remaining-items-closed-2026-08-16); the
  security half (`/util/coa-traits` served a full account number for **all 230 accounts to any
  caller**) is [§7.1](../cr/cr-082-tax-section-fbar-114.md#71-account-numbers--and-a-claim-the-review-falsified).
  **TY2025 is FILED (2026-08-16)** — the owner entered Part I and froze the year in the UI the same
  evening, so **freeze-on-file has now been exercised on real data**, which is the one item the
  tests could only simulate. The snapshot copied **16 lines / $2,627,821**, with the account number
  and institution name on each **copied, not joined**; the diff reads **16 of 16 comparable, 0
  moved**. ⚠️ **TY2024 carries an empty draft amendment** (seq 1, 0 lines) from trying that button,
  so the 2024 page reads `draft` while the original filing — 31 lines, $1,462,652, filed
  2025-10-07 — is intact underneath. Deleting the one row restores the `filed` display.
- 🟢 **[CR083](../cr/cr-083-budget-latest-estimate.md) — the budget Latest Estimate. P0a + P0b LIVE
  (v3.31.0, migration 072).** `/budget-le`: create an LE, read it in **COA order** with parents
  rolled up (117 rows), open a category's **month-by-month worksheet** and type the estimate months;
  a new LE **carries the prior one forward**. Plus the FY-landing strip on `/budget-vs-actual` —
  landing **−102,998.92** vs a budget of **−137,554.99**, variance **+34,556.07**.
  **Its own tables, because eleven functions plus a view read `budget_entries` ignoring
  `version_id`** (incl. the CR075 base year) and `versions/:id/copy` takes the same year unguarded.
  **Scope decides the answer:** `Unrealized G/L` is +213,595 YTD with no budget line, so leaving
  valuation and transfers in lands 2026 at **+44,259** instead. **The deviations section was asked
  for as an LLM feature and ships as arithmetic** (CR081: 0/15 twice; CR077: over the rules, never
  instead) — its trigger is not "actual differs from budget" but a deviation implying the
  **remaining** months are wrong. ⚠️ **Finalise/recut NOT built, and `BUDGET FY` is read live** —
  right for a draft, wrong for a frozen artefact; snapshotting it needs a migration **before**
  finalise. **Two review rounds falsified seven of the CR's own figures**, all recorded in its §16.
- ✅ **[CR088](../cr/cr-088-budget-vs-actual-le-table.md) — COMPLETE, v3.43.0 → v3.47.0.** The owner asked
  for `/budget-vs-actual` to read like the LE grid, and the restyle was **not only cosmetic**: the page
  drew hierarchy in colour and opacity — five `!important` per-level backgrounds and
  `opacity: 0.7 / 0.6 / 0.55` **on the money cells** — which is [CR086](../cr/cr-086-ui-visual-system.md)
  §3's contrast failure put back by hand on one page. It now follows LEGrid's stated rule (*depth is
  indentation and weight, never colour*). ⚠️ **Page-scoped, because `CashFlowReport.css` is imported by
  FOUR pages** and an edit in place would have restyled three reports nobody asked about. **P2** adds the
  three-state comparison over the selected period (new `GET /budget/le/:id/cash-flow`, no migration).
  ⚠️ **Its load-bearing fact, measured on prod: before the LE's cut the LE IS the actual** — 0 of 111
  leaves differ over Jan–Jul and the sums tie to the cent, so the page **says so** instead of letting two
  columns that agree by construction read as corroboration. Past the cut it is real signal: 17 of 57
  categories carry typed estimates. **Two more instances of the CR054 cascade lesson** — a cell font-size
  and the totals-row ground both lost silently and were settled by a **DOM probe**, not by reasoning
  about specificity. **P3 (v3.44.0) then put the look on EVERY report table** — lifted into
  `components/ReportTable.css`, opted into by four surfaces over seven pages, deleted at source
  rather than overridden. ⚠️ **It exposed two defects neither of which was cosmetic:** clicking an
  account name on the Balance Sheet did **nothing** (the `<td>` and its `<span>` both toggled the
  same key, so one click turned the highlight on and straight off — only the empty padding worked,
  while the label carried `cursor: pointer`; Cash Flow's identical span had always stopped
  propagation and this one had drifted), and the highlight fill was **three colour literals kept in
  sync by hand**. ⚠️ **Three more cascade losses, all measured not reasoned** — including two
  components that got the class but not the import, so they styled correctly **only if the user had
  visited Cash Flow first**, a defect that depends on navigation order and never reproduces on a
  direct load. **P4 (v3.45.0)** then fixed the chrome the dense tables had left out of proportion —
  a banner card that on `/balances` repeated the `<h1>` **word for word** in a box taller than the
  three rows beneath it (the words moved to the `<caption>`, where they stay for screen readers and
  print), one page of seven with a title nobody chose, and **two of CR086's "six rival title
  treatments" that turned out to be the same treatment twice**. `CashFlowReport.css` — which began
  this CR governing four pages' whole appearance — reached **zero rules and is deleted**.
  🔴 **Its last defect was found by the OWNER READING THE PAGE, and is the one worth keeping:** a
  variance column named `VAR VS LE` that actually computed **LE − BUDGET**. The methodology, the
  figures and the engine were all correct — *the header was lying about them*. **CR087's defect
  class (a column that can be read wrong) reproduced in a LABEL rather than a computation**, and
  §3.2 had ANTICIPATED the confusion without preventing it: the page already said *"LE will equal
  Actual on every row"*, which made the variance look impossible rather than explaining it.
  ⚠️ **A note stating a fact the column header contradicts does not resolve the contradiction.**
  **P5 (v3.46.0) fixed the MODEL that produced that label**, at the owner's direction — the page
  compares any **two of BUDGET · ACTUAL · LE** (`Act vs Bud` · `Act vs LE` · `LE vs Bud` · `All`),
  every variance header names its own pair, and it is now titled **`Budget Analysis`** (route
  deliberately unchanged). 🔴 **Its finding is the durable one: two of the three are variances and the
  THIRD MEASURES TIME.** `ACT−LE` reads **+150,091 favourable on full-year expenses** — essentially
  all of it September–December not having happened — and is **zero by construction** before the cut.
  That is [CR087](../cr/cr-087-money-legibility.md) P0b's exact shape reached by **honest arithmetic
  rather than a bug**, which makes it harder to catch, so it ships with a guard that counts unelapsed
  months rather than a footnote. Export follows the mode too — it had hardcoded three columns *and*
  kept its own copy of the row rule, the **third** screen-vs-workbook divergence in that one file.
  **P6 (v3.47.0)** closed the last two tabs. `/balances` → Trends is **transposed** so it cannot opt
  into the shared stylesheet; it shares the type scale and ⚠️ **`--font-mono` on figures that had been
  rendering in the BODY font**. Net Worth had **no `<h1>` at all** — ⚠️ **and adding one BROKE the
  page**, caught only by rendering: `.balance-grid` is a two-column grid, so the header became a grid
  item and shoved the chart into the 260px sidebar track. 🔴 **Its durable lesson is about
  MEASUREMENT, not CSS:** sweeping ELEVEN report pages instead of nine turned up a **twelfth** rival
  title treatment. **P4's "nine pages now render one title treatment" was true and incomplete — a
  measurement is only as good as its list**, which is the same shape as CR086's rig reporting true
  totals over a 25-row sample.
- **Re-examine SRQ** — **−476,930**: funds itself 35 of 36 years, dry in the last. Marginal, not
  hopeless. Financing would be the untested lever (all cash, no rent, sells at 7%), and testing it
  is **DECLINED** (owner, 2026-08-23) — so this is a judgement to make, not an experiment to run.
- **`Retirement Home`** — ~**105,000**/yr today for two, reasonable for assisted living, but the plan
  **double-counts** `Living Expenses` on top (~83,000) while escalating care at general inflation.
  The two errors nearly cancel — by luck, not design.
- **CR076 §7 remainder** — price idle cash (two scenario scalars); loss carry-forward (tax rules
  the owner would maintain; same-year netting already covers the live case).
- ~~Real terms on Compare~~ **DONE** ([CR079 §7](../cr/cr-079-real-terms-view.md)) — one
  `buildScenarioMatrix` choke point; each scenario deflates by its OWN inflation, the anchor is
  shared. Only the **Home hero** is still nominal-only.
- ~~CR080 — the `accrue` reconcile mode~~ **DONE, v3.28.0 (2026-08-11)**
  ([CR080](../cr/cr-080-feed-accrual-reconcile-mode.md), migrations 065–067). Two **Wise Assets**
  accounts hold a money-market fund whose yield the feed reports in its BALANCE and never posts as
  a transaction; `calibrate` would fold a recurring flow into a constant at opening and `mtm` books
  it to an **expense** category. Both now book to `Interest Income` on a dated row, guarded by
  **implied annualised yield** — a missed transfer that `mtm`'s 15%-of-balance test would pass is
  refused. **Both accounts currently refuse, correctly:** the feed's day-jitter exceeds one day of
  accrual, so this runs at **month-end**, beside the MTM run. **Corrected 2026-08-11 by migration 069:** 065 had filed the
  leftover difference as an unexplained `Unrealized G/L` loss, reasoning that fin sitting ABOVE the
  feed could not be yield. It was a **calibration plug** — the owner had been calibrating for
  months, and `calibrate()` rewrites `opening_balance`, shifting every historical date by one
  constant, **with no audit row**. Moved into `opening_balance`; a fabricated −32.56 loss removed,
  `Interest Income` untouched, and **all eight anchors now tie to the feed to the cent**. Dev's
  ledger lacks 065–067/069 (applied prod-first) — `sync-db-prod-to-dev.sh` resolves it.
  **Pre-June-2026 interest: owner decided 2026-08-12 to book nothing.** No Wise interest statement
  exists; measured from PocketSmith's own `closing_balance` chain it is **+187.21 USD** (2023→May
  2026, order-independent, cross-checked two ways) — but **−504.27 on EUR, which interest cannot
  be**, so that account has a real gap, likely one missing transaction around 2026-05. ⚠️ **Balances
  are correct on both**; only the *classification* is missing (it sits in `opening_balance`, not
  `Interest Income`). Full record, including two false trails that looked convincing, in
  [CR080](../cr/cr-080-feed-accrual-reconcile-mode.md#historical-reconstruction--attempted-measured-and-declined-2026-08-12).
- **CR077's LLM stage** — only over the deterministic rules, never instead of them.
- **Owner QA of the P&L module inputs** — CR076 §5 and §7 are the agenda.
- **[CR066](../cr/cr-066-fc-line-mapping-completeness.md) P0** · **CR064 P2/P4/P5/P10** ·
  **CR060's recon page** (CR059 is **done** — cut over to the API 2026-08-10; what remains is dated,
  not built: retire the Sheet rollback ~2026-08-24 and the 2026-08-31 gate-exception expiry).
  **Fintable re-keyed every GoCardless `ext_id` 2026-08-20 — we were unaffected, because we key on
  `tx.id`** ([§22.12](../cr/cr-059-fintable-api-ingestion.md)); it makes the Sheet rollback a
  repair-before-use path, not a revert.
- **With the owner, do not start unasked:** "2026 Downside" (being redone) · CR048's equity-growth
  and FX-stress decisions · [CR058 §12.8–12.9](../cr/cr-058-quicken-valuation-anchors.md) ·
  [CR059](../cr/cr-059-fintable-api-ingestion.md)'s Chase date basis. **`House Morgage` is
  deliberately `setup_status='new'`** (owner, 2026-08-05) — parked, not broken.
- Full plan: [project-roadmap.md](project-roadmap.md).

## Conventions & drills
[Documentation standard](../documentation-standard.md) · rules auto-load from `.claude/rules/` ·
`/close`, `/question` · [month-end reconcile](../guides/month-end-reconcile.md) ·
[dev-workflow](../guides/dev-workflow.md) · [permissions](../guides/claude-code-permissions.md).
Last restore drill **2026-07-13 — PASSED** ([runbook](../guides/restore.md)): a real prod dump
restored in 3 s / 0 errors, balance sheet **and** regenerated forecast byte-identical to prod.
Secrets: [secrets-inventory.md](secrets-inventory.md).
