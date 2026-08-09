# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).
> **The budget is load-bearing** (cut from 216 lines 2026-08-05): overrun = restatement the CR
> index and roadmap already own, and it is where stale facts collect.

**Last updated:** 2026-08-08 · **Live version:** v3.19.0 (see `VERSION` / git tags)

## Current phase
**The model, since [CR069](../cr/cr-069-forecast-streams.md) (v3.13.1 → v3.14.1, migrations
057–060):** a module is *identity + optional valuation + N first-class **streams***.

**Shipped since 2026-08-05**, all on the module/forecast surface — details in the
[CR index](../cr/README.md) and the [roadmap](project-roadmap.md), not restated here:
[CR070](../cr/cr-070-module-inputs-by-type.md)+[CR071](../cr/cr-071-forecast-numbers-vs-intent.md)
(v3.15.0) · [CR072](../cr/cr-072-valuation-module-inputs.md) (v3.17.0) — **the balance-sheet form
is CLOSED** · [CR073](../cr/cr-073-two-recurrence-guards.md) (v3.17.1) ·
[CR074](../cr/cr-074-dismissible-cash-health-warnings.md) (v3.18.0, migration 061) — Cash Health
warnings are **dismissible**, and a dismissal **expires when the warning's figures change**.

⚠️ **[CR075](../cr/cr-075-base-year-is-the-budget.md) — v3.19.0, and it MOVES NUMBERS** (owner
sign-off). **Year −2 is ACTUAL, year −1 is the BUDGET, the forecast starts at year 0** — but year
−1 was being derived from the modules' typed stream amounts, and a **yield** stream's amount is 0
by construction, so three income lines read zero. The base year was **152,802 short**, and that
figure is the cash sweep's **opening cash**. Now read from `budget_entries`. One budget ⇒ all
scenarios share one base year.

🔴 **[CR076](../cr/cr-076-forecast-model-review.md) — the model review (2026-08-09), and it
CORRECTED THE PUBLISHED FIGURES.** Net worth at 2062 was being quoted from a SQL roll-up that read
`Bank Accounts` — a per-module **annual cash movement** — as a balance. **The app was never wrong;
the roll-up was.** Correct: Base **4,398,898** · Buy Business **9,474,620** · Downside
**1,881,988** · Upside **7,733,471** · SRQ **−829,508**. The error is not constant (+894K to −84K),
so it contaminated comparisons too. **Any forecast figure quoted in a document must come from the
app's own exported functions or the engine — never from a SQL re-derivation written for the
occasion.** CR076 also records 3 more wrong warning rules, 8 money-moving defects and 2 swapped
input labels; §8 is the fix order.

⚠️ **Four number-moving changes have landed in four days** (CR072 P5, CR071 §7's data edits,
Known Issue #2 materialising, and now CR075). Each was measured before and after on a prod copy
against an engine first proven idempotent, and each matched its prediction. That gate is the only
reason any of them is trustworthy — do not ship a fifth without it. **CR076 §2 is the limit of what
that gate proves:** it compares a number to itself, so it catches a changed number and never a
wrongly-derived one.

### The recurring failure, now found FIVE times
A rule or a figure that asserts something about the engine, derived from a **restatement** rather
than from the engine's own formula or the real input:

| | what it claimed | what was true |
|---|---|---|
| [CR071 §8](../cr/cr-071-forecast-numbers-vs-intent.md#8-r5-was-wrong--owner-found-2026-08-06-fixed-in-v3181) | R5: "sold without realizing any gain" | 334,294 realized — wrong on **30 of 35** modules |
| [CR075 §5](../cr/cr-075-base-year-is-the-budget.md) | R7 compared against PeriodStart | it got PeriodStart−2 — **20 disposals** missed |
| CR075 §1 | the base year was the budget | it was the modules' typed amounts |
| CR073 | LIST and DETAIL agreed | they drifted three times in three days |
| [CR076 §2](../cr/cr-076-forecast-model-review.md) | a roll-up summing entries gave net worth | it read a **flow** (`Bank Accounts`) as a **stock** — 5 published figures wrong by up to 894K |

**5 of the 8 detection rules have now been found wrong this way** (CR076 §3 adds R7, W2 and R5's
loss branch), and every gate passed each time because they checked a warning FIRED, never that
what it SAID was true. **CR076 §1 records what is sound** — the roll-forward, basis, pro-rata
disposals, gain-at-disposal, loans and stocks-vs-flows all verified correct.

**Two more, cheaper:** a UI test whose mock returns **zero rows** proves nothing about rendering
rows (it passed while the modal crashed the page); and **proof of absence needs a search that
provably covered the file** — a `head -20`-truncated grep had me record two working buttons as
never built.

**[CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) remains the live engineering
thread** — P2/P4/P5/P10 are **unblocked** now CR069 P2 has shipped, and the annual close is not
needed before the 2026→2027 boundary. **[CR066](../cr/cr-066-fc-line-mapping-completeness.md) P0
is next at the owner's request** (`Rental - Spain` +31,306 is genuinely unmapped).

## Known issues
[roadmap §3](project-roadmap.md#3-known-issues) is canonical. **#15 (migrations reaching prod
before dev) was fixed 2026-08-05** — the deploy refuses a migration absent from both ledgers.
**#2 (an amount with no FC line) was CLOSED 2026-08-06** by CR073's guard. **#18 (2026-08-06, open):**
a fresh DB enforces `fc_lines.line_type`'s CHECK while dev and prod have no such constraint (007 was
auto-baselined on both) — a test can pass on dev and fail only in CI, which is how it was found;
0 violating rows live, so a forward migration would close it cheaply.
Worth knowing at session start: the timezone rule (#3), the unannounced red `main` (#12), the
ESLint JSX blind spot (#10), and dirty-tree deploys (#17).

## Live infrastructure
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`) — prod
  `psproject` :3005/:5433 (volume `fin_postgres_data`), dev :3105/:5434, v4 `finv4` :3205/:5435
  flags ON. Prod: `https://fin.tail413695.ts.net`. `bank-feed/` :3007 feeds 28 accounts; ocr-llm
  gateway `100.66.213.40:8080`. Both are separate repos.
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations: **dev first, through
  `migrate.js`** — a `psql -f` apply writes no ledger row and is invisible to the guard; Step 2b(i)
  refuses any file absent from BOTH ledgers. Registry: [migrations.md](migrations.md). *A deploy's
  Step 1 backup predates its Step 2b migration, so restoring from one lands a migration short.*
- The prod container runs as **root** and writes root-owned audit CSVs under
  `components/data/auditTrail/`, so a host-run forecast generation fails with EACCES. Generate
  through the container, or under a separate project root.
- **Gates:** counts live in [test-overview.md](test-overview.md) — restated elsewhere they
  drift, and did. Lint **blocking** (0 errors), plus six ratchets that may only shrink
  (lint-debt, api-envelope, buttons, modals, hex, tokens).

## Next
- **[CR076](../cr/cr-076-forecast-model-review.md) §8, in order** — D1 (the convergence loop's
  stale growth formula, one line, −39,715), the R7/W2/R5 sentences, the sweep CSV written before
  convergence, then the swapped growth hint. The money-moving ones (D2–D6) one at a time, each
  behind CR075's gate.
- **Owner QA of the P&L (income/expense) module inputs** — the owner's own stated successor now
  that the balance-sheet form is closed. CR076 §5 and §7 are the agenda.
- **The warning-rule audit is DONE** (CR076 §3): 5 of 8 wrong, 6 more latent divergences recorded.
- **[CR066](../cr/cr-066-fc-line-mapping-completeness.md) P0** — decide an FC line for each of
  the twelve unmapped categories, or record it as deliberately excluded. A decision per row.
- **CR064 P2/P4/P5/P10** — unblocked; P2 owns the `has_valuation` filter on
  `refreshModulesFromActuals` ([CR070 §4](../cr/cr-070-module-inputs-by-type.md)).
- **CR059 P3a** — a new crosswalk migration covering all three id columns (044 is reversed) →
  P4 cutover; then CR060's fin-side recon page.
- **With the owner, do not start unasked:** "2026 Downside" (being redone) · CR048's
  equity-growth and FX-stress decisions ·
  [CR058 §12.8–12.9](../cr/cr-058-quicken-valuation-anchors.md) ·
  [CR059](../cr/cr-059-fintable-api-ingestion.md)'s Chase date basis. **`House Morgage` carries
  6% and a derived interest line but is deliberately left `setup_status='new'`** (owner decision
  2026-08-05) — parked, not broken.
- Full plan: [project-roadmap.md](project-roadmap.md).

## Conventions
[Documentation standard](../documentation-standard.md) · working rules auto-load from
`.claude/rules/` · `/close`, `/question` ·
[month-end reconcile](../guides/month-end-reconcile.md) ·
[dev-workflow](../guides/dev-workflow.md) (dual-track v3/v4) ·
[permissions](../guides/claude-code-permissions.md).

## Drills & reviews
Last restore drill: **2026-07-13 — PASSED** ([runbook + log](../guides/restore.md)) — a real prod
dump restored in 3 s / 0 errors, and the balance sheet **and** a regenerated forecast came back
byte-identical to prod. Secrets inventory: [secrets-inventory.md](secrets-inventory.md).
