# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [2026-09-14](../archive/status-log_2026-09-14.md) ·
> [2026-09-05](../archive/status-log_2026-09-05.md) · [2026-08-01](../archive/status-log_2026-08-01.md).
> **The budget is load-bearing** (216 → 60 on 2026-08-05; 122 → **94** on 2026-08-09, by lifting
> the failure table and the infrastructure block into their own files; **405 → 238 on 2026-09-05**,
> by archiving twelve *Next* bullets that were already finished; **250 on 2026-09-14**, cut by
> archiving the v3.61 headline write-ups, the closed Known-issues narrative and three shipped *Next*
> bullets; **167 → 113 on 2026-09-23**, by moving *Current phase* to
> [current-phase.md](current-phase.md) — the cut this note had been naming): overrun = restatement
> the CR index and roadmap already own, and it is where stale facts collect. Each cut has come from
> MOVING something that changes on a different clock, never from deleting what is true.
> ⚠️ **Still over budget at 113.** The remaining overrun is the *Live version* paragraph, which is a
> release log written in one line — the next cut is keeping only the current release's headline here
> and letting [roadmap §1.2](project-roadmap.md#12-completed-chronological-latest-first) own the rest,
> since it already does.

**Last updated:** 2026-09-23 · **Live version:** **v3.66.1** (see `VERSION` / git tags) — **v3.66.1: an edit no longer throws the transaction list back to the top** — the post-save reload unmounted the rows, so the scroller's height collapsed and the browser clamped its offset to 0; the table now stays mounted through a refresh. Both surfaces measured in a real browser with the fix reverted first — jsdom cannot measure a scroll offset ([roadmap §1.2](project-roadmap.md#12-completed-chronological-latest-first)). **v3.66.0: fin's own dedupe ate a real charge** — CaixaBank billed `CERT. NO RESIDENCIA` twice on 2026-09-08, the feed delivered both, fin booked one, and Caixa EUR carried a EUR 30.25 drift no re-run could clear. CR059 §22.7's content guard *claims* a candidate so two staged rows cannot consume one ledger row — but it claimed **only backwards**, never a row the same batch had just inserted, so its invariant was false for *0 held + N incoming*. All three shipped interchangeable-row tests seed HELD rows first, so none could see it. One line, two falsified regression tests, prod ledger repaired (**30.25 → 0.00**) ([§22.13](../cr/cr-059-fintable-api-ingestion.md)). **v3.65.2: on every report table, red means negative and nothing else** — a negative was ink on even rows and on totals; rows now get a light zebra ground instead. **v3.65.1: the Chart tab takes the shared preset period picker**, and Variances' period summary stops naming the whole year over a single month. **v3.65.0: Budget Analysis's Chart and Variances tabs compare against the LE too** — the Realization tab's `Act vs Bud` · `Act vs LE` · `LE vs Bud` (· `All` on Chart; Variances ranks by one pair) with the same cut and unelapsed-month warnings, now one shared hook ([roadmap §1.2](project-roadmap.md#12-completed-chronological-latest-first)). **v3.64.0: the last unpreviewed write, and one money contract** ([CR087](../cr/cr-087-money-legibility.md) P1 completes) — `/manual-calibration`'s Reset previewed figures the **browser** computed while the server computed the write; it now previews server-side and refuses an apply whose figures moved. `<Money>` settles null → `—` vs zero, pins the locale and always states the currency, on this CR's two surfaces. **v3.63.0: the live-quote overlay** ([CR090](../cr/cr-090-investments-section.md) P2, which COMPLETES it) — a panel beside each account's custodian total, never a revaluation: **47.7% of value is quotable**, quotes refresh on a schedule and a button, and a refused or missing quote is named rather than read as "didn't move". **v3.62.4: one open Latest Estimate per year** — the current month's LE stays a draft all month; a second draft is refused, and the month-end order is finalise → FX recalculate → cut ([runbook §7](../guides/month-end-reconcile.md)). **v3.62.3: the Budget Worksheet gains Budget Analysis's Unrealized and Transfers toggles**, off by default, so their actuals agree. **v3.62.2: the Budget Worksheet counts P&L budget only too** (`/budget/summary`). **v3.62.1: a budget is P&L only** — the LE drops the uncategorised memo line and L6, and gains L4 ([CR083](../cr/cr-083-budget-latest-estimate.md)). **v3.62.0: the Latest Estimate can be finalised, re-cut and checked for drift** ([CR083](../cr/cr-083-budget-latest-estimate.md), migration 082) — ⚠️ FX recalculate for 2026 answers 409 while a 2026 LE is a draft — LE-08-26 is final; LE-09-26 still is. **v3.61.7: the FDIC sweep the feed labels two ways is one security again** (migration 081, [#29](project-roadmap.md#3-known-issues)) — its 1.82% rate covers the whole balance and the Investments page lists it once. **v3.61.6: four wrong-number fixes**: the module editor dropped a disposal's selling cost on load (any save wrote NULL); Review's *Add cash transfer* wiped a module's whole Invest/Dispose schedule; the balance report valued an unconvertible currency at 1:1 (now throws); a budget copy into an occupied year doubled every budget figure (now 409). ✅ **Prod corrected and regenerated 2026-09-14 12:45Z** — the 2062 net-asset figures below predate it. Earlier v3.61.x headlines (CR091 feed health; CR093's FDIC finding — **Wells Fargo $48,380 over the insured limit**) are in [status-log_2026-09-14](../archive/status-log_2026-09-14.md) and [roadmap §1.2](project-roadmap.md#12-completed-chronological-latest-first).

## Current phase
**Moved to [current-phase.md](current-phase.md)** — it changes on a regenerate, not on a release.
It holds the CR069 module model, the CR076 review, the 2062 net-asset figures and the SRQ question.
Two things from it are worth carrying into every session:
- ⚠️ **The recurring DEFECT CLASS: state that exists, renders, and produces no visible effect, so it
  reads as absent.** Eleven instances; ten found by a person looking at the page, one by a gate. The
  engine half now has a gate; **the DISPLAY half still has none.** Rendering a change in both themes
  is not polish — it is the only instrument that has ever detected this class.
- **[failure-patterns.md](failure-patterns.md) is the canonical list** of the seven recurring shapes.
  Read it before writing a rule, a warning sentence, or any figure that asserts what the engine does.

## Known issues
[roadmap §3](project-roadmap.md#3-known-issues) is canonical; the closed narrative that sat here
(CR059 §22, #19–#21, #12, #23, the ocr-llm ack) moved to
[status-log_2026-09-14](../archive/status-log_2026-09-14.md). Worth knowing at session start:
- ✅ **Both 2026-09-20 feed alarms are CLOSED, measured 2026-09-23** — every Wise (4) and PKO (7)
  account reads `state: ok` with `days_since_upstream_sync: 0`, and PKO's 180.00 PLN cleared on the
  repaired sync rather than by calibration. ✅ **CR091 §U3's post-reconnect mapping re-check is DONE and
  clean** (2026-09-23), run through the shipped v3.61.5 diff rather than by hand: **disappeared 0**
  (no mapping points at an id the feed no longer has), **appeared 0**, and the single *duplicated*
  row is `acc_01M1R5KN…` — §U3's **own specimen**, still `ignored`, i.e. the regression fixture
  behaving. Wise's three mapped accounts still map one-to-one by currency, so the re-authorisation
  re-pointed nothing. The one account upstream still flags `needs_reconnect` is **Bank Pekao**,
  which fin deliberately ignores (`account_id = NULL`, one of 5) and has no account for, so
  `attention-summary` correctly answers 0. **The rule that buys:** *"attention-summary says 0"
  proves nothing about connections fin does not map* — it is scoped to mapped, non-ignored accounts
  by CR060's own correction. Pekao's last good sync, `2026-09-18`, is also the date this file had
  recorded as PKO's, so the PKO bullet probably named the wrong Polish bank.
- 🟡 **The feed can revise a date (or an amount) AFTER promote and the ledger keeps the old one** —
  `staging.upsert` updates staging and never resets `promoted_transaction_id`. One live date instance
  (PKO), **zero amount instances — but that path is permanent drift no re-run clears**.
  [CR094](../cr/cr-094-promote-divergence-gate.md) is the gate; it is a DRAFT, unreviewed.
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
- 🔄 **[CR087](../cr/cr-087-money-legibility.md)** — **P0 and P1 complete** (v3.38.0–v3.40.0, v3.64.0).
  Only §2's deferred `BalanceReport` **`Local` column** remains: native amounts with a mixed-currency
  marker, needing `ARRAY_AGG(DISTINCT t.currency)` and migration 064's unanimity predicate. The
  22-call-site `toLocaleString` sweep stays [CR086](../cr/cr-086-ui-visual-system.md)'s.
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
