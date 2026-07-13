# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.

**Last updated:** 2026-07-13 · **Live version:** v3.0.95 (see `VERSION` / git tags)

## Current phase
- **Forecast hardening (CR045 → CR049), 2026-07-12/13.** Owner questions have now opened a run of
  **ten silent-wrong-number engine bugs** — all fixed, each verified against a restored copy of
  prod, all shipped and prod regenerated:
  [CR045](../cr/cr-045-forecast-cash-warnings-liquidation.md) (no sweep module on copied scenarios;
  BaseYear cash flow never reached the sweep; tax-free forced liquidations; a module sold twice) ·
  [CR046](../cr/cr-046-module-income-window-and-hierarchy-graph.md) (income/expense **window**,
  migration 037) · [CR047](../cr/cr-047-module-income-tax-override.md) (**income-only tax rate**,
  migration 038) · [CR048](../cr/cr-048-model-review-fixes.md) (conceptual review: drained sweep
  backups kept paying dividends on money that was gone; basis offset two sales) ·
  [CR049](../cr/cr-049-forecast-base-year-seed-and-final-year-tax.md) (the **final-year** sale never
  funded its own capital-gains tax — 2062 ended at −$60,521 cash beside $4.3M of sellable stock; and
  the engine's **hand-copied base-year query** had drifted from `crud.getBaseYearValues`, zeroing
  every non-liability module expense, so the sweep opened $64,717 rich for the whole horizon).
  "2026 Base" now closes 2062 **exactly on the $200K low band**, with no shortfall in any year.
- **Owner's open items:** the equity-growth experiment on `/forecast-compare` ("2026 Base" vs
  **"2026 Base - Market Returns"**: stocks 2.0× vs 1.0×); FX-stress magnitudes for Downside;
  re-type "New House"/"Sarasota House"; rank a sweep backup in **"2026 Downside"** (see Known
  issue below).
- [CR042](../cr/cr-042-ui-look-and-feel.md) / [CR043](../cr/cr-043-code-structure-program.md):
  **CR042 U4 COMPLETE** (v3.0.95 — no bespoke dialog remains under `features/Forecast`); **CR043 N10
  COMPLETE** (forecast writes reject unknown fields). Four blocking CI guards now: buttons, modals,
  inline-hex, **dead-tokens**. CR042 remainder is owner-input IA only (calibration→Settings, Upload
  PS, Forecast-step collapse); CR043's lint gate stays advisory (108 errors, 43 of them hooks
  restructures that need daylight).

## Known issue
- **"2026 Downside" has no sweep backup ranked.** `Fidelity Stocks` carries no `cash_sweep_priority`
  there (it does in the other two scenarios), so the engine reports **−$1.25M of shortfall across
  2061–62 while $1.2M of stock sits untouched**. That is CR045 §5 working as designed (unranked =
  "I cannot sell this"), but for a liquid brokerage account it is almost certainly a data slip.
  *CR049 made this larger and more visible — it was −$766K in 2062 alone, on a model that was
  $65K/yr too rich and never funded its final-year tax.* One-row fix (`cash_sweep_priority = 2`),
  left to the owner because it changes Downside's conclusions.

## Live infrastructure
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`). Prod `docker-compose.yml` (project `psproject`, :3005, DB :5433, volume `fin_postgres_data`); dev `docker-compose.dev.yml` (:3105/:5434); v4 `docker-compose.v4.yml` (`finv4`, :3205/:5435, flags ON, isolated volume). Prod frontend: `https://fin.tail413695.ts.net`.
- `bank-feed/` microservice (:3007, separate repo) feeds 28 accounts; ocr-llm LLM gateway at `100.66.213.40:8080` (AI Review).
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations: manual `psql -f`, registry in [migrations.md](migrations.md); runner shipped in CR043 P1.1 (`npm run migrate`).

## Recently shipped
- v3.0.95 — **overnight run.** CR043 **N10**: the forecast module / inc-exp write API now rejects
  unknown fields instead of silently dropping them — enumerating the contracts surfaced **four dead
  keys** (`AccountNumber`, `Expense`, `Income`, `BaseYear`) posted for months to columns that do not
  exist, the same silent-drop class that cost CR046 its window dates and CR047 its tax override.
  CR042: **U4 complete** (last 2 Forecast modals); **63 dangling design tokens** across 30 files
  fixed (a `var(--text-secondary)` lints clean and silently ignores the theme) + new blocking
  `check-dead-tokens.sh`; **Outfit self-hosted** (variable font, 2 files, SW-precached — no CDN, and
  it finally works offline); the hex guard was widened after it turned out to be missing every
  composite (66 → true count **170**, now frozen). Lint 124 → 108.
- v3.0.94 — [CR049](../cr/cr-049-forecast-base-year-seed-and-final-year-tax.md): the final-year
  sweep now **sells enough to fund its own tax** (re-entrant drain, fixed point), and the engine's
  duplicated base-year query is **deleted** in favour of the one `crud.getBaseYearValues` the
  Review already reads. Engine numbers change; prod regenerated.
- v3.0.93 — [CR048](../cr/cr-048-model-review-fixes.md): **scenario copy is one path again** — the
  per-scenario assumptions (period/inflation/FX/tax) moved server-side into `copyScenario`; an
  API-only copy used to yield a scenario with 0% inflation that the engine would build anyway.
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
- CR048 open: the equity-growth and FX-stress decisions are with the owner. *(The split-brain
  scenario-copy path is **fixed** in v3.0.93 — the assumptions copy moved server-side into
  `copyScenario`; an API-only copy now reproduces its source exactly.)*
- Rank a sweep backup in "2026 Downside" (Known issue above) — owner's call.
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
Last restore drill: **2026-07-13 — PASSED** ([runbook + log](../guides/restore.md)): a real prod dump restored in 3 s / 0 errors, the server booted against it, and the balance sheet **and** a regenerated forecast came back **byte-identical to prod**. Backups verified, not assumed.
Secrets inventory: [secrets-inventory.md](secrets-inventory.md) (escrow status open).
