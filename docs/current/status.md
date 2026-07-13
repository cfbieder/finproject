# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.

**Last updated:** 2026-07-13 · **Live version:** v3.0.92 (see `VERSION` / git tags)

## Current phase
- **Forecast hardening (CR045 → CR048), 2026-07-12/13.** One owner question ("why is only sweep
  priority 1 on offer?") opened a run of **eight silent-wrong-number engine bugs** — all fixed, each
  verified against a restored copy of prod, all shipped and prod regenerated:
  [CR045](../cr/cr-045-forecast-cash-warnings-liquidation.md) (no sweep module on copied scenarios;
  BaseYear cash flow never reached the sweep; tax-free forced liquidations; a module sold twice) ·
  [CR046](../cr/cr-046-module-income-window-and-hierarchy-graph.md) (income/expense **window**,
  migration 037) · [CR047](../cr/cr-047-module-income-tax-override.md) (**income-only tax rate**,
  migration 038) · [CR048](../cr/cr-048-model-review-fixes.md) (conceptual review: drained sweep
  backups kept paying dividends on money that was gone; basis offset two sales).
  "2026 with House Purchase" now reads **3 shortfall years / −$1.05M** — larger than it did on
  Monday, and for the first time trustworthy.
- **Owner's open items:** the equity-growth experiment on `/forecast-compare` ("2026 Base" vs
  **"2026 Base - Market Returns"**: stocks 2.0× vs 1.0× ⇒ $5.05M vs $1.20M in 2062); FX-stress
  magnitudes for Downside; re-type "New House"/"Sarasota House".
- [CR042](../cr/cr-042-ui-look-and-feel.md) / [CR043](../cr/cr-043-code-structure-program.md):
  substantially complete (CR042 remainder: U4's 2 heavyweight Forecast modals).

## Live infrastructure
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`). Prod `docker-compose.yml` (project `psproject`, :3005, DB :5433, volume `fin_postgres_data`); dev `docker-compose.dev.yml` (:3105/:5434); v4 `docker-compose.v4.yml` (`finv4`, :3205/:5435, flags ON, isolated volume). Prod frontend: `https://fin.tail413695.ts.net`.
- `bank-feed/` microservice (:3007, separate repo) feeds 28 accounts; ocr-llm LLM gateway at `100.66.213.40:8080` (AI Review).
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations: manual `psql -f`, registry in [migrations.md](migrations.md); runner shipped in CR043 P1.1 (`npm run migrate`).

## Recently shipped
- v3.0.92 — Forecast **Modules** + **Income/Expense**: full-width tables; details moved to a
  **modal on double-click** (the details column cost each table ~40% of the page).
- v3.0.90–91 — [CR048](../cr/cr-048-model-review-fixes.md) engine fixes + Tax/Taxes on one row.
- v3.0.84–89 — [CR047](../cr/cr-047-module-income-tax-override.md) (migration 038) + four fixes
  (module save dropped the new fields; Type unsettable when unmatched; window ignored in the base
  year; base-year half-year edge).
- v3.0.81–83 — [CR046](../cr/cr-046-module-income-window-and-hierarchy-graph.md) (migration 037) +
  hierarchy breakdown graph.
- v3.0.77–80 — [CR045](../cr/cr-045-forecast-cash-warnings-liquidation.md) warnings pane, sweep tax,
  growth carry-forward, solvency cap.
- v3.0.63–76 — [CR042](../cr/cr-042-ui-look-and-feel.md) UI (U1–U5),
  [CR043](../cr/cr-043-code-structure-program.md) code structure, audit-trail 500 fix.

## Next
- CR048 open: the equity-growth and FX-stress decisions are with the owner; the API scenario-copy
  endpoint does not copy per-scenario assumptions (the UI does that half client-side — should move
  into `copyScenario`).
- CR042 remainder (2 Forecast modals), CR043 deferred items.
- Long-running tails: [CR019](../cr/cr-019-quicken-import.md) prod cutover loop,
  [CR023](../cr/cr-023-pocketsmith-removal.md) per-account PS migration (13 left),
  [CR034](../cr/cr-034-security-hardening-ci.md): rotate `BANK_FEED_API_KEY`.
- Full plan: [project-roadmap.md](project-roadmap.md).

## Conventions
Docs layout & rules: [documentation standard](../documentation-standard.md) · working rules
load from `.claude/rules/` (collaboration, git-concurrency, migrations, compose-safety,
env-secrets, data-import) · procedures: `/close`, `/question` · dual-track v3/v4:
[dev-workflow](../guides/dev-workflow.md) · permissions setup:
[claude-code-permissions](../guides/claude-code-permissions.md).

## Drills & reviews
Last restore drill: not yet held (backups via deploy script + `Scripts/backup-to-remote.sh`) ·
Secrets inventory: [secrets-inventory.md](secrets-inventory.md) (escrow status open).
