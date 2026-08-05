# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).
> **The budget is load-bearing** (cut from 216 lines 2026-08-05): overrun = restatement the CR
> index and roadmap already own, and it is where stale facts collect.

**Last updated:** 2026-08-05 · **Live version:** v3.16.0 (see `VERSION` / git tags)

## Current phase
**The model, since [CR069](../cr/cr-069-forecast-streams.md) (v3.13.1 → v3.14.1, migrations
057–060):** a module is *identity + optional valuation + N first-class **streams***.

**[CR070](../cr/cr-070-module-inputs-by-type.md) + [CR071](../cr/cr-071-forecast-numbers-vs-intent.md)
SHIPPED in v3.15.0**, the type filter grouped in **v3.15.1**, and in **v3.16.0** each stream card
gained the FC line's real history (actual base−1 · budget base · actual base YTD) — all 2026-08-05,
no migration. Capability-gated forms, a residue detector, 8 detection rules. Gate: sums identical
to the cent, 4,030 rows.

**A projection to fix, now that it has cost three bugs in three days:** the module LIST and DETAIL
queries are kept by hand and have drifted three times — `HasValuation` (v3.14.2), the sweep fields
(v3.15.0), `fc_line_name` (v3.16.0). Each surfaced as a form guessing at state it should have been
told. Derive both from one source.

⚠️ **Two number-moving changes are pending, and they must not land together** —
[CR071 §6](../cr/cr-071-forecast-numbers-vs-intent.md) has the measurements and both controls:
1. **The two CR071 §4 data edits** — dry run done, mechanics work, §4's direct predictions hold to
   the cent. **Owner re-confirmation is the blocker:** the cascade is ~20× §4's estimate
   (net worth at 2062 −1,992,856 across five scenarios).
2. **A regenerate — for ANY reason — moves −1,203,432 onto Property Costs** in
   `2026 SRQ House Purchase`. Prod's entries are three hours older than the last variant sync.
   That is [Known Issue #2](project-roadmap.md#3-known-issues) resolving itself, not the edits.

**[CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) remains the live engineering
thread** — P2/P4/P5/P10 are **unblocked** now CR069 P2 has shipped, and the annual close is not
needed before the 2026→2027 boundary. **[CR066](../cr/cr-066-fc-line-mapping-completeness.md) P0
is next at the owner's request** (`Rental - Spain` +31,306 is genuinely unmapped).

## Known issues
[roadmap §3](project-roadmap.md#3-known-issues) is canonical. **#15 (migrations reaching prod
before dev) was fixed 2026-08-05** — the deploy refuses a migration absent from both ledgers.
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
