# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [2026-09-05](../archive/status-log_2026-09-05.md) ·
> [2026-08-01](../archive/status-log_2026-08-01.md).
> **The budget is load-bearing** (216 → 60 on 2026-08-05; 122 → **94** on 2026-08-09, by lifting
> the failure table and the infrastructure block into their own files; **405 → 238 on 2026-09-05**,
> by archiving twelve *Next* bullets that were already finished — a shipped item under *Next* is
> how this file doubles): overrun = restatement the CR index and roadmap already own, and it is
> where stale facts collect. Each cut has come from MOVING something that changes on a different
> clock, never from deleting what is true. ⚠️ **Still ~4× over budget** — the remaining excess is
> live content (Current phase, Known issues, the active *Next* items), so the next cut has to come
> from a section moving to its own file, not from another sweep of finished work.

**Last updated:** 2026-09-05 · **Live version:** **v3.59.0** (see `VERSION` / git tags) — **v3.59.0: the net-worth bridge, in prose.** [CR092](../cr/cr-092-net-worth-bridge.md) **P1** is the last piece and the CR is now COMPLETE: `ocr-llm` registered `finance_networth_narration` the day it was filed, and `POST /api/v2/reports/net-worth-bridge/narration` narrates the same window on both surfaces. No migration, no new secret. **Narration-only** — `netWorthBridge.js` computes every figure and the model never calculates; **local-only by construction**, the chain declaring no cloud step at all. The deterministic summary renders first and the prose replaces it, so a slow or dead gateway costs the reader nothing. **Six runs over two windows: every figure traced to the payload, zero percentages, zero invented drivers.** 🔴 **Three defects, all found by RENDERING and none by a test** — including a fix for the leading-driver order that the model echoed back **as** the answer (*"Money spent — with the change"*): vocabulary handed to a narrator is vocabulary it will narrate. ✅ **`ocr-llm` shipped all four findings we handed back the same day** — `deadline_ms = 90000` registered (the chain now nests `~27 s < 90 s < 120 s < 150 s`), `watch_outs` de-duplicated at the task prefix, and an unknown `routing` key is now a 422 rather than silently ignored ([§3 #27](project-roadmap.md#3-known-issues), fixed). Detail: [CR092 §9](../cr/cr-092-net-worth-bridge.md) and the [roadmap](project-roadmap.md).

## Current phase
**The model, since [CR069](../cr/cr-069-forecast-streams.md):** a module is *identity + optional
valuation + N first-class **streams***. Shipped since 2026-08-05 and not restated here —
[CR070](../cr/cr-070-module-inputs-by-type.md)+[CR071](../cr/cr-071-forecast-numbers-vs-intent.md)
· [CR072](../cr/cr-072-valuation-module-inputs.md) (**the balance-sheet form is CLOSED**) ·
[CR073](../cr/cr-073-two-recurrence-guards.md) ·
[CR074](../cr/cr-074-dismissible-cash-health-warnings.md) (migration 061 — a dismissal **expires
when the warning's figures change**) · [CR075](../cr/cr-075-base-year-is-the-budget.md) (**year −2
is ACTUAL, year −1 is the BUDGET**, read from `budget_entries`; one budget ⇒ one base year).


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
the owner found all but one of their instances. **It keeps recurring, and the count is not the point — the
method is.** v3.41.0 found one this way in [CR054](../cr/cr-054-cash-flow-by-account.md) (a
`Net Cash Flow` row in `<tfoot>` that missed the frozen-column selector and scrolled its label away
from its figures; its fix was got wrong twice by reasoning about the cascade and settled by a DOM
probe). [CR092](../cr/cr-092-net-worth-bridge.md) then found **five** at P0, more at P2, and
**three more at P1** — including prose that read back the prompt's own tag words instead of any
figure, which was schema-valid and passed every test. **Every one of those was found by opening the
page, and none by a suite.** Until a display-side gate exists, rendering the change in both themes
is not polish; it is the only instrument that has ever detected this class.

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
`./Scripts/test-fresh-db.sh` catches the ambient-data class before the push. **Last piece CLOSED
2026-09-04** — the *Actions → failed workflows* email is on **and proven by making one fire** on a
throwaway PR, never touching `main`; the toggle was not the whole cause, the repo had **zero
watchers**, and GitHub needs *watching* **and** *runs you triggered*), **#23 RESOLVED 2026-09-04:** agent threads on one
shared tree commit over each other — a **third** incident took SOURCE, not prose, so the "cosmetic"
premise is dead; owner chose the **worktree** (rule §0). The deciding argument: on one tree there is
**no safe commit primitive** — pathspec takes the shared worktree, `git add` takes the shared index —
so every victim had followed the rule correctly), the ESLint JSX blind
spot (#10), dirty-tree deploys (#17). #2 and #15 are CLOSED.

## Live infrastructure
Moved to [guides/infrastructure.md](../guides/infrastructure.md) — hosts, ports, the deploy script,
the dev-first migration rule, and the fact that **an engine change moves nothing until the
scenarios are REGENERATED**. It changes far less often than this file does.

## Next
> **Twelve finished headlines were archived 2026-09-05** — CR092 P1+P2, CR093 P1, CR061 P2,
> CR090 P3, CR085, CR082, CR088 and four smaller items — lifted verbatim to
> [status-log_2026-09-05.md](../archive/status-log_2026-09-05.md). They are not repeated here: a
> shipped item under *Next* is what made this file 404 lines. Statuses are canonical in the
> [CR index](../cr/README.md), versions in [the roadmap](project-roadmap.md).

- 🔄 **[CR091](../cr/cr-091-reconnect-that-works.md) — the reconnect button failed on its first live
  use (2026-09-04); P1 + U1b SHIPPED v3.53.1 (2026-09-05), P4 still owed by bank-feed.** Three Wise consents expired, which is the event [CR060](../cr/cr-060-feed-connection-health.md)
  built **Re-authorise** for; all three were reconnected **by hand against bank-feed's API**. The error
  text blames a timeout and is misleading — nothing hung (mint returns **201 in 54 ms**). Fintable
  **429'd** and asked for **58 s**; fin's `mintConnectionLink` is the only upstream call passing no
  `timeoutMs`, so it aborted at the inherited **8000 ms**. bank-feed then honored `Retry-After: 0`
  literally and burned its retries **26 ms apart**. 🔴 A reconnect also **re-pointed a connection at a
  different account** — the Wise consent is a single-select of balances — leaving the same real account
  twice upstream under two ids with identical names; fenced by hand as `account_source_mappings`
  **id 708**, `ignored`. All three feeds are live again (**0 orphaned of 31 mappings**,
  `attention-summary` 3 → **0**), and **Fintable had not re-fetched Wise as of 07:12Z 2026-09-05**, so
  the 09-03 → now gap fills on its next daily cycle before fin's import is worth running.
  ✅ **The fix found THREE ceilings under that 58 s budget, not one:** fin's 8000 ms fired first, but
  the browser helper defaults to **30 s** and the `/api/v2/` nginx block sets **no**
  `proxy_read_timeout`, so nginx's **60 s** default sat *two seconds* above the observed chain —
  raising only the server would have moved the cut to the browser and changed nothing visible. All
  three move together; a 429 now says *"try again in about 58s"* instead of *"bank-feed request timed
  out"*. ⚠️ **Four of its five tests were worth little** — they assert the exported constant, so
  deleting `timeoutMs` from the call left it correct-and-unused and all four still passed; only the
  fake-timer wiring test fails against the unfixed code. 🔴 **The button still cannot SUCCEED during a
  rate limit** — bank-feed still honors `Retry-After: 0` literally — so P1 buys a true error, not a
  working button, until P4 lands in that repo.
- 📋 **[CR090](../cr/cr-090-investments-section.md) P2 is the other half of the Investments work** — the **live-quote overlay**,
  the "real-time" half of the original ask: only **47.5% of the portfolio by value is quotable**, so it ships as
  a labelled panel *beside* the custodian total, never as a revaluation of it — repricing the equity sleeve would
  destroy the tie that makes the Options gap legible.
- 📋 **[CR089](../cr/cr-089-month-end-observation-dating.md) P2 is now unblocked** by CR061 P1: it reads
  fin-local tables rather than a second live passthrough. ⚠️ It is still gated on its **own** §P2.3 measurement —
  two fintable price endpoints disagree by 0.65% about the same close, and the measured 0.005–1.3% bias exceeds
  the 0.7% adjacent-day separation, so *if the corrected margin does not separate, P2 does not get built*.
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
- **Re-examine SRQ** — **−476,930**: funds itself 35 of 36 years, dry in the last. Marginal, not
  hopeless. Financing would be the untested lever (all cash, no rent, sells at 7%), and testing it
  is **DECLINED** (owner, 2026-08-23) — so this is a judgement to make, not an experiment to run.
- **`Retirement Home`** — ~**105,000**/yr today for two, reasonable for assisted living, but the plan
  **double-counts** `Living Expenses` on top (~83,000) while escalating care at general inflation.
  The two errors nearly cancel — by luck, not design.
- **CR076 §7 remainder** — price idle cash (two scenario scalars); loss carry-forward (tax rules
  the owner would maintain; same-year netting already covers the live case).
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
