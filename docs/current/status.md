# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.

**Last updated:** 2026-07-12 · **Live version:** v3.0.84 (see `VERSION` / git tags)

## Current phase
- [CR047 — Income-Only Tax Rate Override](../cr/cr-047-module-income-tax-override.md): **shipped v3.0.84 (migration 038).** `tax_rate_override` moved a module's capital-gains AND income rate together, so "the United Beverages dividend arrives already taxed in Poland — only ~3% incremental US tax — but a future *sale* is still an ordinary capital gain" could not be expressed. New `income_tax_rate_override` applies to income only (amount- and yield-based, incl. the deferred base-year income tax); gains keep `tax_rate_override`/the scenario rate, as does the CR045 sweep liquidation tax. NULL falls back ⇒ existing modules byte-identical; **0 is a real rate**, not "unset". Opt-in only.
- [CR046 — Module Income/Expense Window + Hierarchy Breakdown Graph](../cr/cr-046-module-income-window-and-hierarchy-graph.md): **shipped v3.0.81 (migration 037).** (1) Start/end dates on a module's income and expense streams — "I own this flat today and start renting it in 2030" was inexpressible (the amount ran from the base year; only CR041's *acquisition* gate could delay it). The window bounds **when** a stream runs, never how much: the amount stays a base-year figure compounded at inflation. The owner picks a **year** (stored as July 1), and the first/last year carry **50%** — the engine's existing half-year convention; never double-halved against CR041's acquisition rule. NULL = unbounded ⇒ every existing scenario byte-identical; ownership still wins; un-started rent is no longer taxed in the base year. (2) Double-clicking any Review row now graphs the accounts **beneath** it, stacked (level 1 → its level-2s; level 2 → its leaves), on both the BS and the P&L — previously only "Net Assets" did this.
- [CR045 — Forecast Cash Warnings & Forced Liquidation](../cr/cr-045-forecast-cash-warnings-liquidation.md): **Phases 1, 1b and 2 shipped (v3.0.75–80); prod regenerated.** Started from a bank line diving to −$3.7M and turned up **four silent-wrong-number bugs** in the forecast engine: (1) `copyScenario` never copied `cash_sweep_priority`, so every **copied** scenario ran with no sweep module and left shortfalls unfunded; (2) the sweep never applied the **BaseYear cash flow** to its opening balance, holding the band a full year of NCF above the bank line the Review displays; (3) forced liquidations were **tax-free** while scheduled disposals of the same shares were taxed, and sold funds went on compounding inside the module; (4) a module that is both a sweep source *and* has scheduled disposals was **sold twice** (Fidelity Stocks, ~$950K over-committed) — the sweep now may never drive a module below zero in any future year. Phase 1's warnings pane (`/forecast-review`) found bug (2) on its first run. **Engine byte-parity deliberately broken**; prod's shortfalls are now materially larger and *correct* (House Purchase: 3 yrs/−$2.67M → 9 yrs/−$8.14M). Open: §6 Q2/Q4.
- [CR043 — Code Structure Program](../cr/cr-043-code-structure-program.md): Phases 0, 1 (all), 2.1/2.2 extraction, 2.3, 2.4, **Phase 3 (TanStack Query + useCoa, shared report hooks/mobile dedup, V1-alias dedup, eslint fix)** done. Deferred: util.js hygiene, N10 write-validation, 3.3 raw-fetch/envelope, 3.4 full lint burn-down (gate not flipped). Program substantially complete.
- [CR042 — UI Look & Feel Modernization](../cr/cr-042-ui-look-and-feel.md): **U1 (core + Forecast inline-style migration, v3.0.69/75); U2 + U3 (v3.0.70); U4 primitives + RefreshFeeds (v3.0.71) + 8/10 Forecast modals via `<Modal bare>` (v3.0.74); U5 report consolidation Balances/Cash Flow/Budget (v3.0.72–73).** Three blocking CI adoption guards (buttons, modals, inline-hex). Deferred (owner input): calibration→Settings move, "Upload PS" fate, Forecast-step sidebar collapse. Remaining code: U4's 2 heavyweight Forecast modals (FCModulesEdit, FCExpModal).
- Docs migrated to the starter-pack v1.4.0 standard (2026-07-11): `Documentation/` → `docs/`, rules in `.claude/rules/`, this file is the session entry point.

## Live infrastructure
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`). Prod `docker-compose.yml` (project `psproject`, :3005, DB :5433, volume `fin_postgres_data`); dev `docker-compose.dev.yml` (:3105/:5434); v4 `docker-compose.v4.yml` (`finv4`, :3205/:5435, flags ON, isolated volume). Prod frontend: `https://fin.tail413695.ts.net`.
- `bank-feed/` microservice (:3007, separate repo) feeds 28 accounts; ocr-llm LLM gateway at `100.66.213.40:8080` (AI Review).
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations: manual `psql -f`, registry in [migrations.md](migrations.md); runner shipped in CR043 P1.1 (`npm run migrate`).

## Recently shipped
- v3.0.80 — CR045 P2: sweep **capital-gains tax** on forced liquidation (a scheduled disposal was taxed; the forced sale of the same shares was not), sold funds **stop compounding** inside the module, and the sweep may **never drive a module below zero** in any future year (a module that was both a sweep source and had its own scheduled disposals was sold twice — Fidelity Stocks, ~$950K over-committed). Prod regenerated: House Purchase 3 yrs/−$2.67M → 9 yrs/−$8.14M — larger and correct. Previewed on a `pg_restore` copy of prod before deploying (v3.0.78 shipped straight from a green suite and had to be reverted).
- v3.0.77 — CR045 P1 + P1b: cash-health **warnings pane** on `/forecast-review` (W1–W6; the engine had written 14 unfunded shortfall entries no screen ever showed) and the **BaseYear cash flow folded into the sweep's opening cash** — it was computed, logged, then dropped, so the sweep held the band a full year of NCF above the bank line the Review displays. Found by the pane on its first healthy-scenario run.
- v3.0.76 — fix: Forecast module **Audit Trail** always 500'd (`path.join(undefined)` from a non-existent `dataPaths.fcAuditTrail`/`.baseDir`, plus a filename sanitizer that lowercased/collapsed `_+` and so could never match the writers' files). Both GET-module and DELETE routes now use `PATHS.AUDIT_TRAIL_DIR` + the writers' convention; +2 regression tests (313).
- v3.0.75 — CR042 U1 Forecast inline-style migration: FCStepNav → CSS (kills JS hover handlers); 62 naked-hex Forecast style values → theme tokens (dark-mode fix); new blocking `check-inline-hex.sh` guard.
- v3.0.74 — CR042 U4 Forecast modals: `<Modal>` gains a `bare` mode (Radix overlay/focus-trap/ESC, caller keeps its own card); 8 of 10 bespoke `fc-*-modal` overlays migrated (a11y gained, visually 1:1); fixed two latent hooks-after-return bugs. FCModulesEdit + FCExpModal deferred.
- v3.0.73 — CR042 U5 Cash Flow 2→1 + Budget-vs-Actual 3→1: shared `<ReportTabs>` primitive; `/cash-flow/:view` (Summary/By-Period), `/budget-vs-actual/:view` (Realization/Chart/Variances); old URLs redirect; 2 nav renames.
- v3.0.72 — CR042 U5 Balances 4→1: `/balances` with Summary/Periods/Trends/Net-Worth tabs (deep-linkable, old URLs redirect); sidebar Reports drops 4→1. **Owner checkpoint** before the remaining consolidations.
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
