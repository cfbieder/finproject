# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).
> **The budget is load-bearing** (216 → 60 on 2026-08-05; 135 → **86** on 2026-08-09, by lifting
> the failure table into its own file): overrun = restatement the CR index and roadmap already own,
> and it is where stale facts collect. Still over — the next cut should take *Live infrastructure*
> to a guide, since it changes far less often than anything around it.

**Last updated:** 2026-08-09 · **Live version:** v3.23.0 (see `VERSION` / git tags)

## Current phase
**The model, since [CR069](../cr/cr-069-forecast-streams.md):** a module is *identity + optional
valuation + N first-class **streams***. Shipped since 2026-08-05 and not restated here —
[CR070](../cr/cr-070-module-inputs-by-type.md)+[CR071](../cr/cr-071-forecast-numbers-vs-intent.md)
· [CR072](../cr/cr-072-valuation-module-inputs.md) (**the balance-sheet form is CLOSED**) ·
[CR073](../cr/cr-073-two-recurrence-guards.md) ·
[CR074](../cr/cr-074-dismissible-cash-health-warnings.md) (migration 061 — a dismissal **expires
when the warning's figures change**) · [CR075](../cr/cr-075-base-year-is-the-budget.md) (**year −2
is ACTUAL, year −1 is the BUDGET**, read from `budget_entries`; one budget ⇒ one base year).

🔴 **[CR076](../cr/cr-076-forecast-model-review.md) — the five-reviewer model review, §8 COMPLETE
across v3.20.0–v3.22.0.** It corrected **our own published figures** and moved numbers eight times.
**§1 records what is SOUND and is the larger half** — roll-forward, basis, pro-rata disposals,
gain-at-disposal, loans, stocks-vs-flows all verified correct. §7 + §11 hold **open owner
decisions**; §14–§18 hold the measurements.

**Net assets at 2062 (live):** Base **4,674,650** · Buy Business **9,750,208** · Downside
**2,574,049** · Upside **8,047,180** · SRQ **−596,919**. Owner decisions applied 2026-08-09:
`Social Security` → **full CPI** (cuts to be modelled separately, not fused into the indexation),
and `OCME` at −30 confirmed a **deliberate write-off**.

**[CR077](../cr/cr-077-assumption-advisor-tab.md) — v3.23.0:** Cash Health is now **two tabs**,
*Integrity* (a defect to fix) and *Assumptions to consider* (a judgement to record), counted and
dismissed separately so accepting six assumptions cannot bury one real defect. 4 integrity vs 12
advisory on Base. Its LLM stage is deliberately deferred: **nothing generated may state a number or
assert what the engine does.**

⚠️ **Eleven number-moving changes in five days**, each measured before/after on a prod copy against
an engine first proven idempotent, and each matching its prediction. **That gate compares a number
to itself, so it catches a *changed* number and never a *wrongly-derived* one** — which is exactly
how five published figures stayed wrong through it (CR076 §2). **Cheapest complementary check: the
Review's bank line must sit on the sweep's band.** Engine and app derive cash differently, and that
one number caught two separate divergences (CR076 §14, §18).

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
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`) — prod
  `psproject` :3005/:5433 (volume `fin_postgres_data`), dev :3105/:5434, v4 `finv4` :3205/:5435.
  Prod: `https://fin.tail413695.ts.net`. `bank-feed/` :3007 feeds 28 accounts; ocr-llm gateway
  `100.66.213.40:8080`. Both are separate repos.
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations **dev first, through
  `migrate.js`** — a `psql -f` apply writes no ledger row and is invisible to the guard. Registry:
  [migrations.md](migrations.md). *A deploy's Step 1 backup predates its Step 2b migration.*
- **An engine change moves nothing until the scenarios are REGENERATED.** Deploy, then regenerate,
  then check the fingerprint against the dev measurement.
- The prod container runs as **root** and writes root-owned audit CSVs, so a host-run generation
  fails with EACCES — generate through the container.
- **Gates:** counts live in [test-overview.md](test-overview.md). Lint **blocking** (0 errors) plus
  six ratchets that may only shrink.

## Next
- **Work the 12 advisories** now visible in Cash Health → *Assumptions to consider*. The sub-1
  multipliers (`Purchases` 0.5 · `Travel` 0.8 · `Total Salary` 0.8 · `Car Expenses` 0.9) have **no
  external benchmark** — unlike Social Security, a household may genuinely spend less in real terms
  with age — so each is a belief to state or dismiss, not a defect to fix.
- **Selling costs on disposals** — the largest remaining §7 item and the only one that changes a
  real number: the base year alone books **1,239,753 of GROSS property proceeds** straight into the
  sweep's opening cash, with no agent fee, transfer tax or plusvalía anywhere in the model. One
  `disposal_cost_pct` per disposal row, off proceeds **and** off the gain. CR-sized (schema + form +
  engine + a measured gate).
- **CR076 §7 remainder** — price idle cash (two scenario scalars); loss carry-forward (tax rules the
  owner would maintain; same-year netting already covers the live case); and confirm whether
  `Social Security`'s 20,000 `Fixed $` was meant as **2035 dollars** (~13,300 today) — the money
  basis of `Fixed $` / `One-Off $` is a live ambiguity, not just that one row.
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
