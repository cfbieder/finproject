# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [2026-09-14](../archive/status-log_2026-09-14.md) ·
> [2026-09-05](../archive/status-log_2026-09-05.md) · [2026-08-01](../archive/status-log_2026-08-01.md).
> **The budget is load-bearing** (216 → 60 on 2026-08-05; 122 → **94** on 2026-08-09, by lifting
> the failure table and the infrastructure block into their own files; **405 → 238 on 2026-09-05**,
> by archiving twelve *Next* bullets that were already finished; **250 on 2026-09-14**, cut by
> archiving the v3.61 headline write-ups, the closed Known-issues narrative and three shipped *Next*
> bullets): overrun = restatement the CR index and roadmap already own, and it is where stale facts
> collect. Each cut has come from MOVING something that changes on a different clock, never from
> deleting what is true. ⚠️ **Still over budget** — the next cut is *Current phase* moving to its own
> file (it changes on a regenerate, not on a release).

**Last updated:** 2026-09-15 · **Live version:** **v3.62.4** (see `VERSION` / git tags) — **v3.62.4: one open Latest Estimate per year** — the current month's LE stays a draft all month; a second draft is refused, and the month-end order is finalise → FX recalculate → cut ([runbook §7](../guides/month-end-reconcile.md)). **v3.62.3: the Budget Worksheet gains Budget Analysis's Unrealized and Transfers toggles**, off by default, so their actuals agree. **v3.62.2: the Budget Worksheet counts P&L budget only too** (`/budget/summary`). **v3.62.1: a budget is P&L only** — the LE drops the uncategorised memo line and L6, and gains L4 ([CR083](../cr/cr-083-budget-latest-estimate.md)). **v3.62.0: the Latest Estimate can be finalised, re-cut and checked for drift** ([CR083](../cr/cr-083-budget-latest-estimate.md), migration 082) — ⚠️ FX recalculate for 2026 answers 409 while a 2026 LE is a draft — LE-08-26 is final; LE-09-26 still is. **v3.61.7: the FDIC sweep the feed labels two ways is one security again** (migration 081, [#29](project-roadmap.md#3-known-issues)) — its 1.82% rate covers the whole balance and the Investments page lists it once. **v3.61.6: four wrong-number fixes**: the module editor dropped a disposal's selling cost on load (any save wrote NULL); Review's *Add cash transfer* wiped a module's whole Invest/Dispose schedule; the balance report valued an unconvertible currency at 1:1 (now throws); a budget copy into an occupied year doubled every budget figure (now 409). ✅ **Prod corrected and regenerated 2026-09-14 12:45Z** — the 2062 net-asset figures below predate it. Earlier v3.61.x headlines (CR091 feed health; CR093's FDIC finding — **Wells Fargo $48,380 over the insured limit**) are in [status-log_2026-09-14](../archive/status-log_2026-09-14.md) and [roadmap §1.2](project-roadmap.md#12-completed-chronological-latest-first).

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

**Net assets at 2062 (as of 2026-08-10 — ⚠️ stale since the v3.61.6 regenerate, which set 2% on three
business disposals; re-read from Compare):** Base **4,071,160** · Buy Business **9,102,335** · Downside
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
[roadmap §3](project-roadmap.md#3-known-issues) is canonical; the closed narrative that sat here
(CR059 §22, #19–#21, #12, #23, the ocr-llm ack) moved to
[status-log_2026-09-14](../archive/status-log_2026-09-14.md). Worth knowing at session start:
- **#29 FIXED v3.61.7** — the feed FLIPS two FDIC sweeps between a ticker and a numeric id; migration
  081 merged them. ⚠️ A **third** label for the same deposit would still mint a new twin.
- ✅ **CR059's Sheet path is retired** (2026-09-15, bank-feed `615b2bb`, [§26](../cr/cr-059-fintable-api-ingestion.md)):
  the rollback, the hourly watchdog and the `FINTABLE_SOURCE` switch are gone. ⚠️ **Owner:** revoke the
  Sheet share and delete the service-account key in Google Cloud.
- **#18** — a fresh DB enforces `fc_lines.line_type`'s CHECK while dev and prod do not, so a test can
  pass on dev and fail only in CI.
- The timezone rule (#3), the ESLint JSX blind spot (#10), dirty-tree deploys (#17). Filed back to
  ocr-llm and open: their protocols doc has **no client-abort rule**.

## Live infrastructure
Moved to [guides/infrastructure.md](../guides/infrastructure.md) — hosts, ports, the deploy script,
the dev-first migration rule, and the fact that **an engine change moves nothing until the
scenarios are REGENERATED**. It changes far less often than this file does.

## Next
> Finished headlines are archived, not repeated: twelve on 2026-09-05
> ([log](../archive/status-log_2026-09-05.md)) and CR091 P1, CR086/CR087 P0–P1 and CR083 P0 on
> 2026-09-14 ([log](../archive/status-log_2026-09-14.md)). Statuses are canonical in the
> [CR index](../cr/README.md), versions in [the roadmap](project-roadmap.md).

- 📋 **[CR089](../cr/cr-089-month-end-observation-dating.md) P2 is now unblocked** by CR061 P1: it reads
  fin-local tables rather than a second live passthrough. ⚠️ It is still gated on its **own** §P2.3 measurement —
  two fintable price endpoints disagree by 0.65% about the same close, and the measured 0.005–1.3% bias exceeds
  the 0.7% adjacent-day separation, so *if the corrected margin does not separate, P2 does not get built*.
- 🔄 **[CR087](../cr/cr-087-money-legibility.md)** — the P0 and P1's reconcile half shipped
  (v3.38.0–v3.40.0). **Next: `<Money>`** (CR087's own two surfaces; the 22-call-site sweep stays in
  [CR086](../cr/cr-086-ui-visual-system.md)), `resetOpeningBalance` under the P0c preview, and §2's
  deferred `BalanceReport` `Local` column.
- 🔄 **[CR083](../cr/cr-083-budget-latest-estimate.md)** — finalise, recut, drift L2, L1, L6 and the
  FX-recalculate refusal **shipped v3.62.0** (migration 082); L4 + L10 (as a test) v3.62.1.
  A budget is P&L only everywhere since v3.62.2 (the Budget Worksheet's summary no longer counts category-less rows). LE-08-26 was finalised 2026-09-14; **LE-09-26 stays a draft through September by owner rule** (v3.62.4) — finalise it in early October, then FX recalculate, then cut LE-10-26.
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
  **CR060's per-feed health on the reconcile page** (CR059 is **done** — cut over to the API
  2026-08-10; its dated tails are ⚠️ **OVERDUE**, see Known issues).
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
`/close`, `/question`, `/brief` · Operator brief: https://claude.ai/code/artifact/a058677e-3138-43e7-a076-a5f67d6d02ef · [month-end reconcile](../guides/month-end-reconcile.md) ·
[dev-workflow](../guides/dev-workflow.md) · [permissions](../guides/claude-code-permissions.md).
Last restore drill **2026-07-13 — PASSED** ([runbook](../guides/restore.md)): a real prod dump
restored in 3 s / 0 errors, balance sheet **and** regenerated forecast byte-identical to prod.
Secrets: [secrets-inventory.md](secrets-inventory.md) — ⚠️ **two values exposed 2026-09-08**
(`POSTGRES_PASSWORD`, `TRADIER_ACCESS_TOKEN`; owner declined rotation, logged there). It is the
**second redaction failure in three days**, and the first one's own rule would have stopped it:
there is no safe redaction of a multi-secret file — verify an `.env` edit with `grep -c` /
`cut -d= -f1` / `git diff --stat`, never by printing the region you changed.
**ocr-llm handoffs now PULL rather than needing to be remembered** — a `SessionStart` hook asks
their server what Fin owes ([guide](../guides/ocr-llm-integration.md)); silence means the inbox was
empty *and* their checkout was current, and nothing else prints nothing.
