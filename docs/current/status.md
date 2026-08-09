# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).
> **The budget is load-bearing** (216 → 60 on 2026-08-05; 122 → **94** on 2026-08-09, by lifting
> the failure table and the infrastructure block into their own files): overrun = restatement the
> CR index and roadmap already own, and it is where stale facts collect. Each cut has come from
> MOVING something that changes on a different clock, never from deleting what is true.

**Last updated:** 2026-08-09 · **Live version:** v3.25.2 (see `VERSION` / git tags)

## Current phase
**The model, since [CR069](../cr/cr-069-forecast-streams.md):** a module is *identity + optional
valuation + N first-class **streams***. Shipped since 2026-08-05 and not restated here —
[CR070](../cr/cr-070-module-inputs-by-type.md)+[CR071](../cr/cr-071-forecast-numbers-vs-intent.md)
· [CR072](../cr/cr-072-valuation-module-inputs.md) (**the balance-sheet form is CLOSED**) ·
[CR073](../cr/cr-073-two-recurrence-guards.md) ·
[CR074](../cr/cr-074-dismissible-cash-health-warnings.md) (migration 061 — a dismissal **expires
when the warning's figures change**) · [CR075](../cr/cr-075-base-year-is-the-budget.md) (**year −2
is ACTUAL, year −1 is the BUDGET**, read from `budget_entries`; one budget ⇒ one base year).

🔴 **[CR076](../cr/cr-076-forecast-model-review.md) — the five-reviewer model review; §8 COMPLETE
across v3.20.0–v3.22.0.** It corrected **our own published figures** and moved numbers eight times.
**§1 records what is SOUND and is the larger half.** §7 + §11 still hold open owner decisions.
Shipped since, all detailed in the [CR index](../cr/README.md) and the
[roadmap](project-roadmap.md): [CR077](../cr/cr-077-assumption-advisor-tab.md) (v3.23.0 — Cash
Health splits into **Integrity** vs **Assumptions to consider**, counted and dismissed separately)
· [CR078](../cr/cr-078-disposal-selling-costs.md) (v3.24.0, migration 062 — a per-row selling cost
off the cash **and** the gain; **DORMANT until a rate is typed**, and that edit needs its own
measurement) · [CR079](../cr/cr-079-real-terms-view.md) (v3.25.0 — the Review shows the plan in
**today's money**; the export stays nominal; Compare not yet covered).

**Net assets at 2062 (live, post-selling-costs):** Base **4,071,160** · Buy Business **9,102,335**
· Downside **1,893,368** · Upside **7,404,138** · SRQ **−1,392,889**. Owner decisions applied
2026-08-09: selling costs by jurisdiction (**US 7 · Spain 6 · Poland 4 · business 2%**, CVC capital
returns exempt — **−603K to −796K per scenario**, the plan had been keeping 100% of every sale);
`Social Security` → **full CPI**; `OCME` at −30 a **deliberate write-off**.

⚠️ **SRQ is now nearly −1.4M** — the selling costs cost it most precisely because it was already in
shortfall, so cash it never receives is cash the sweep cannot use.

### The recurring failure
**[failure-patterns.md](failure-patterns.md) is the canonical list** — seven shapes, each found
more than once, each having passed the gates meant to catch it. Read it before writing a rule, a
warning sentence, or any figure that asserts what the engine does. The one that has cost most:
**a restatement asserted as the engine's behaviour, found eight times.**

## Known issues
[roadmap §3](project-roadmap.md#3-known-issues) is canonical. **#18 (open):** a fresh DB enforces
`fc_lines.line_type`'s CHECK while dev and prod do not (007 auto-baselined) — a test can pass on
dev and fail only in CI; 0 violating rows, so a forward migration closes it cheaply. Worth knowing
at session start: the timezone rule (#3), the unannounced red `main` (#12), the ESLint JSX blind
spot (#10), dirty-tree deploys (#17). #2 and #15 are CLOSED.

## Live infrastructure
Moved to [guides/infrastructure.md](../guides/infrastructure.md) — hosts, ports, the deploy script,
the dev-first migration rule, and the fact that **an engine change moves nothing until the
scenarios are REGENERATED**. It changes far less often than this file does.

## Next
- **Work the 12 advisories** now visible in Cash Health → *Assumptions to consider*. The sub-1
  multipliers (`Purchases` 0.5 · `Travel` 0.8 · `Total Salary` 0.8 · `Car Expenses` 0.9) have **no
  external benchmark** — unlike Social Security, a household may genuinely spend less in real terms
  with age — so each is a belief to state or dismiss, not a defect to fix.
- **Re-examine SRQ** — at **−1,392,889** it is the scenario the selling costs hurt most, and the
  question is now whether the house purchase is viable in its current shape at all, not whether the
  arithmetic is right.
- **`Retirement Home`'s 200,000 at 2052** — a `Fixed $` row is in the money of its own year, so it
  is ~105,000 today. CR079's toggle now makes that checkable by eye rather than by arithmetic.
- **CR076 §7 remainder** — price idle cash (two scenario scalars); loss carry-forward (tax rules
  the owner would maintain; same-year netting already covers the live case).
- **Real terms on Compare** — CR079's natural next increment, and the smaller half: one
  `buildScenarioMatrix` path rather than the Review's four.
- **CR077's LLM stage** — only over the deterministic rules, never instead of them.
- **Owner QA of the P&L module inputs** — CR076 §5 and §7 are the agenda.
- **[CR066](../cr/cr-066-fc-line-mapping-completeness.md) P0** · **CR064 P2/P4/P5/P10** ·
  **CR059 P3a** → P4 cutover, then CR060's recon page.
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
