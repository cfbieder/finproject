# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).
> **The budget is load-bearing** (216 → 60 on 2026-08-05; 122 → **94** on 2026-08-09, by lifting
> the failure table and the infrastructure block into their own files): overrun = restatement the
> CR index and roadmap already own, and it is where stale facts collect. Each cut has come from
> MOVING something that changes on a different clock, never from deleting what is true.

**Last updated:** 2026-08-20 · **Live version:** **v3.32.0** (see `VERSION` / git tags) — CR085's sensitivity tornado live (migration 073); CR083's Latest Estimate (072); CR082 and CR084 complete

## Current phase
**The model, since [CR069](../cr/cr-069-forecast-streams.md):** a module is *identity + optional
valuation + N first-class **streams***. Shipped since 2026-08-05 and not restated here —
[CR070](../cr/cr-070-module-inputs-by-type.md)+[CR071](../cr/cr-071-forecast-numbers-vs-intent.md)
· [CR072](../cr/cr-072-valuation-module-inputs.md) (**the balance-sheet form is CLOSED**) ·
[CR073](../cr/cr-073-two-recurrence-guards.md) ·
[CR074](../cr/cr-074-dismissible-cash-health-warnings.md) (migration 061 — a dismissal **expires
when the warning's figures change**) · [CR075](../cr/cr-075-base-year-is-the-budget.md) (**year −2
is ACTUAL, year −1 is the BUDGET**, read from `budget_entries`; one budget ⇒ one base year).

**New this release — [CR085](../cr/cr-085-forecast-sensitivity.md) (v3.32.0, migration 073):**
`/forecast-sensitivity` ranks **which assumption the plan rests on**, every bar a real engine build
on CR084's scratch harness. It also closed two defects that predate it — a scratch scenario was
visible in all seven pickers, and `copyScenario` still had two hand-kept child column lists (the
class that once made a copy read ~890K better than its original). ⚠️ **The CR's own §4 filed
`growth_rate` as a rate; the engine says it is a MULTIPLIER of inflation.**

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
everywhere), earns **no rent** against 45,000/yr, and sells at 7%. **Financing is the untested lever.**

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
- **Run the SRQ financing experiment.** `House Morgage` is `setup_status='exclude'` in **all five**
  scenarios while carrying a fully specified loan (**500,000 @ 6.0% to 2048**), so testing "is SRQ
  viable with financing" is **one field flip plus a regenerate** — and CR084's preview shows the
  delta before it is committed. [CR085's sign-off](../cr/cr-085-forecast-sensitivity.md) made this
  the precondition for building its page; the page was built first, at owner instruction, so this is
  now owed rather than pending. SRQ is a **breakeven** question and a tornado cannot answer one.
- **[CR085](../cr/cr-085-forecast-sensitivity.md) leftovers** — the picker opens **empty** (§15
  cut 5's default knob set was not built), and P2 (the sweep view, the `Spread %` list knobs) is
  untouched.
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
- **Re-examine SRQ** — **−476,930**: funds itself 35 of 36 years, dry in the last. Marginal, not
  hopeless. **Financing is the untested lever** (all cash, no rent, sells at 7%).
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
