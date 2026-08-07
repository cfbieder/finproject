# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).
> **The budget is load-bearing** (cut from 216 lines 2026-08-05): overrun = restatement the CR
> index and roadmap already own, and it is where stale facts collect.

**Last updated:** 2026-08-07 · **Live version:** v3.18.1 (see `VERSION` / git tags)

## Current phase
**The model, since [CR069](../cr/cr-069-forecast-streams.md) (v3.13.1 → v3.14.1, migrations
057–060):** a module is *identity + optional valuation + N first-class **streams***.

**Shipped since 2026-08-05**, all on the module/forecast surface — details in the
[CR index](../cr/README.md) and the [roadmap](project-roadmap.md), not restated here:
[CR070](../cr/cr-070-module-inputs-by-type.md)+[CR071](../cr/cr-071-forecast-numbers-vs-intent.md)
(v3.15.0) · [CR072](../cr/cr-072-valuation-module-inputs.md) (v3.17.0) — **the balance-sheet form
is CLOSED**, the owner answered its last three readings ·
[CR073](../cr/cr-073-two-recurrence-guards.md) (v3.17.1) · [CR074](../cr/cr-074-dismissible-cash-health-warnings.md)
(v3.18.0, migration 061) — Cash Health warnings are **dismissible**, per scenario, and a dismissal
**expires when the warning's figures change**.

✅ **Three number-moving changes landed on prod 2026-08-06**, each measured before and after and
each matching its prediction: CR072 **P5**, the budget year now grows (Barkeria 2026 →
**1,024,967**); **[CR071 §7](../cr/cr-071-forecast-numbers-vs-intent.md#7-the-4-data-edits--applied-to-prod-2026-08-06)**,
CVC's phantom yield and two Fidelity amounts cleared (**Base 2062 −31.3%**, CVC's NAV unmoved);
and **Known Issue #2** materialising at `Property Costs −1,203,432.12`, predicted to the cent.

### Three lessons this week, each paid for
- ⚠️ **A warning LIED, and looked authoritative doing it** (owner-found,
  [CR071 §8](../cr/cr-071-forecast-numbers-vs-intent.md#8-r5-was-wrong--owner-found-2026-08-06-fixed-in-v3181),
  v3.18.1). R5 called Barkeria gain-free while its own output showed **334,294 realized**; it read
  basis-vs-market at the base date, the engine reads it at the disposal year. **Wrong on 30 of 35
  modules.** *A rule that asserts what the engine does must be derived from the engine's formula,
  not a restatement of it — and every gate passed because each checked the warning FIRED, none
  that what it SAID was true.* **The other 7 rules have not been audited for this.**
- **A UI test whose mock returns zero rows proves nothing about rendering rows** — it passed while
  the drill-down modal crashed the page and took both dialogs down.
- **Proof of absence needs a search that provably covered the file** — a `head -20`-truncated grep
  had me record two working buttons as never built.

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
- **Owner QA of the P&L (income/expense) module inputs** — the owner's own stated successor now
  that the balance-sheet form is closed.
- **Audit the other 7 warning rules** against `fcbuilder-*` directly, for the class CR071 §8 found:
  a claim about the engine derived from a paraphrase rather than the formula.
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
