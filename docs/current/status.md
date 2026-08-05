# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).
>
> **Cut from 216 lines to this shape 2026-08-05** (owner decision): the overrun was restatement
> the [CR index](../cr/README.md) and [roadmap §1.2](project-roadmap.md#12-completed-chronological-latest-first)
> already own, and it was where that day's docs audit found most of its stale facts.

**Last updated:** 2026-08-05 · **Live version:** v3.14.2 (see `VERSION` / git tags)

## Current phase
**[CR069](../cr/cr-069-forecast-streams.md) is COMPLETE and live (v3.13.1 → v3.14.1, migrations
057–060).** A module is *identity + optional valuation + N first-class **streams***; one
evaluator replaced three; the Expenditures step, ~2,770 lines of `FCExp*` and four tables are
gone. Every phase gated on per-(scenario, account, year) `forecast_entries` sums **identical to
the cent**. Detail: [CR069 §12–16](../cr/cr-069-forecast-streams.md).

**[CR070](../cr/cr-070-module-inputs-by-type.md) (module inputs per type) and
[CR071](../cr/cr-071-forecast-numbers-vs-intent.md) (seven places the numbers disagree with
intent, ranked **above** CR070) are drafted and two-pass reviewed; neither is built.** Owner
decision on record: customize all nine types, once CR070's residue detector is generalized to
flag any unrendered field holding a value ([§14 Q0](../cr/cr-070-module-inputs-by-type.md)).

**[CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) remains the live engineering
thread** — P2/P4/P5/P10 are **unblocked** now CR069 P2 has shipped, and the annual close is not
needed before the 2026→2027 boundary. **[CR066](../cr/cr-066-fc-line-mapping-completeness.md) P0
is next at the owner's request**, with its central question now answered: `Rental - Spain`
(+31,306) is **genuinely unmapped**, not modelled through the SP modules.

## Known issues
[roadmap §3](project-roadmap.md#3-known-issues) is canonical. **#15 (migrations reaching prod
before dev) was fixed 2026-08-05** — the deploy refuses a migration absent from both ledgers.
Worth knowing at session start: the timezone rule (#3), the unannounced red `main` (#12), the
ESLint JSX blind spot (#10), and dirty-tree deploys (#17).

## Live infrastructure
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`). Prod
  `docker-compose.yml` (project `psproject`, :3005, DB :5433, volume `fin_postgres_data`); dev
  `docker-compose.dev.yml` (:3105/:5434); v4 `docker-compose.v4.yml` (`finv4`, :3205/:5435,
  flags ON, isolated volume). Prod frontend: `https://fin.tail413695.ts.net`.
- `bank-feed/` microservice (:3007, separate repo) feeds 28 accounts; ocr-llm LLM gateway at
  `100.66.213.40:8080` (AI Review).
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations: **dev first,
  through `migrate.js`** — a `psql -f` apply writes no ledger row and is invisible to the guard.
  The deploy applies pending files to prod at Step 2b, and **Step 2b(i) refuses any file absent
  from BOTH ledgers**. Registry: [migrations.md](migrations.md). *A deploy's Step 1 backup
  predates its Step 2b migration, so restoring from one lands a migration short.*
- The prod container runs as **root** and writes root-owned audit CSVs under
  `components/data/auditTrail/`, so a host-run forecast generation fails with EACCES. Generate
  through the container, or under a separate project root.
- **Gates:** counts live in [test-overview.md](test-overview.md) — restated elsewhere they
  drift, and did. Lint **blocking** (0 errors), plus six ratchets that may only shrink
  (lint-debt, api-envelope, buttons, modals, hex, tokens).

## Next
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
- **Owner action outstanding:** rotate the Anthropic API key — v3.14.2 removed it from the
  appdata document and stopped the endpoint serving it.
- Full plan: [project-roadmap.md](project-roadmap.md).

## Conventions
Docs layout & rules: [documentation standard](../documentation-standard.md) · working rules load
from `.claude/rules/` (collaboration, git-concurrency, migrations, compose-safety, env-secrets,
data-import) · procedures: `/close`, `/question`,
[month-end reconcile](../guides/month-end-reconcile.md) · dual-track v3/v4:
[dev-workflow](../guides/dev-workflow.md) · permissions:
[claude-code-permissions](../guides/claude-code-permissions.md).

## Drills & reviews
Last restore drill: **2026-07-13 — PASSED** ([runbook + log](../guides/restore.md)) — a real prod
dump restored in 3 s / 0 errors, and the balance sheet **and** a regenerated forecast came back
byte-identical to prod. Secrets inventory: [secrets-inventory.md](secrets-inventory.md).
