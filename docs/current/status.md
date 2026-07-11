# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.

**Last updated:** 2026-07-11 · **Live version:** v3.0.71 (see `VERSION` / git tags)

## Current phase
- [CR043 — Code Structure Program](../cr/cr-043-code-structure-program.md): Phases 0, 1 (all), 2.1/2.2 extraction, 2.3, 2.4, **Phase 3 (TanStack Query + useCoa, shared report hooks/mobile dedup, V1-alias dedup, eslint fix)** done. Deferred: util.js hygiene, N10 write-validation, 3.3 raw-fetch/envelope, 3.4 full lint burn-down (gate not flipped). Program substantially complete.
- [CR042 — UI Look & Feel Modernization](../cr/cr-042-ui-look-and-feel.md): **U1 core + U2 + U3 shipped v3.0.69–70; U4 primitives (`<Modal>` Radix + `<DataTable>`) + blocking CI adoption guards + RefreshFeeds migration shipped v3.0.71.** Remaining: U1 Forecast inline-style migration, U4's 9 Forecast modals, U5 report consolidation (owner-checkpointed).
- Docs migrated to the starter-pack v1.4.0 standard (2026-07-11): `Documentation/` → `docs/`, rules in `.claude/rules/`, this file is the session entry point.

## Live infrastructure
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`). Prod `docker-compose.yml` (project `psproject`, :3005, DB :5433, volume `fin_postgres_data`); dev `docker-compose.dev.yml` (:3105/:5434); v4 `docker-compose.v4.yml` (`finv4`, :3205/:5435, flags ON, isolated volume). Prod frontend: `https://fin.tail413695.ts.net`.
- `bank-feed/` microservice (:3007, separate repo) feeds 28 accounts; ocr-llm LLM gateway at `100.66.213.40:8080` (AI Review).
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations: manual `psql -f`, registry in [migrations.md](migrations.md); runner shipped in CR043 P1.1 (`npm run migrate`).

## Recently shipped
- v3.0.71 — CR042 U4: shared `<Modal>` (Radix Dialog) + `<DataTable>` primitives, two blocking CI adoption guards (button-class + bespoke-dialog), RefreshFeeds migrated (5 modals + 2 tables).
- v3.0.69–70 — CR042 UI: U1 green split (emerald money/sage brand) + flatter cards + type/spacing scales, U2 chart theme + dark-mode gradient fixes, U3 Home net-worth-hero dashboard.
- v3.0.67 — CR043 Phase 3 frontend consolidation (TanStack Query, useCoa + shared report hooks, mobile dedup, V1-alias removal, eslint config fix).
- v3.0.66 — fetch timeout (rest.js fetchWithTimeout; hung requests fail-safe instead of spinning forever).
- v3.0.65 — PWA stale-SW fix (autoUpdate + skipWaiting; Home KPIs no longer stuck on "…") + CI green (generate-transaction seeds the Bank Accounts anchor).
- v3.0.64 — CR043 Phase 2.1 + 2.2 backend route→service extraction (budget/forecast/reports; no behavior change, byte-identical engine + report output).
- v3.0.63 — three-lens review + CR043 code-structure hardening (Phases 0/1/2.3/2.4).
- [CR041](../cr/cr-041-module-ownership-gating.md) — ownership-gated module expenses/income — v3.0.62.
- [CR040](../cr/cr-040-forecast-scenario-compare.md) — Forecast Scenario Compare — v3.0.60 + v3.0.61 fix.
- [CR044](../cr/cr-044-productization-marketability.md) — decided: stay personal (decision record).

## Next
- CR043 remaining: Phase 3, plus deferred util.js hygiene + 2.1's N10 write-validation, then [CR042](../cr/cr-042-ui-look-and-feel.md) implementation.
- Long-running tails: [CR019](../cr/cr-019-quicken-import.md) prod cutover loop, [CR023](../cr/cr-023-pocketsmith-removal.md) per-account PS migration (13 left), [CR034](../cr/cr-034-security-hardening-ci.md) open item: rotate `BANK_FEED_API_KEY`.
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
