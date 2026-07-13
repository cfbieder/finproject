# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.

**Last updated:** 2026-07-13 · **Live version:** v3.0.101 (see `VERSION` / git tags)

## Current phase
- **Owner acceptance + re-test loop (2026-07-13), and it earned its keep.** The owner walked the
  v3.0.96 release step by step (module save · modals · audit trail · reports · dark mode · fonts —
  **all six passed, no regressions**), then re-tested each fix one at a time. Clicking through found
  **eight bugs no test would have caught**, including one the tests actively concealed: **Modify
  Transfer had never worked** — it fetched the module *list* endpoint, which returns no
  `Invest`/`Dispose`, so it had never once displayed a transfer, while a green unit test on the
  (unreachable) year-matching predicate said otherwise. Shipped v3.0.97 → **v3.0.100**; all fixes
  owner-re-tested and passing. *Takeaway worth keeping: verify a UI fix through the UI or an
  end-to-end fetch — a unit test on a code path that never receives data is worse than no test.*
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
- **[CR042](../cr/cr-042-ui-look-and-feel.md) is ✅ COMPLETE (v3.0.101).** U1–U5 shipped and
  owner-accepted; the last IA items settled 2026-07-13 — and two of the CR's *own* proposals were
  rejected on inspection: the **calibration pages stay** under Transactions (they are recurring
  *work*, not configuration — burying work in a config menu to hit a nav-count target makes the app
  worse; only **Bank Feed Setup** and **Forecast Settings** moved to Settings), and the Forecast
  sidebar is **mirrored to the stepper, not collapsed** (collapsing costs a click on every visit to
  the busiest area of the app; the real defect was two hand-kept lists of the same six pages that
  disagreed — `FCStepNav` now *derives* from `routes.jsx`, so they cannot diverge again). "Upload
  PS": **keep**. Creating a module now opens an unsaved **draft** — no more blank rows left behind
  on Cancel.
- [CR043](../cr/cr-043-code-structure-program.md): **Phases 0–3 shipped**, incl. N10 and the first
  restore drill. Four blocking CI guards (buttons, modals, inline-hex, dead-tokens) — and they now
  ratchet *down* (buttons 123→122, hexes 170→167). The lint gate stays advisory: **64 errors** —
  `no-unused-vars` and `no-undef` are at **zero**; the rest are 36 `set-state-in-effect` + 21
  `react-refresh` + 7 hooks-rules, each a behavioral restructure that needs a browser, not a text
  edit.

## Known issue
- ⚠️ *Owner is redoing "2026 Downside" themselves (2026-07-13) — **do not fix this**; it is recorded
  so the numbers below are not mistaken for an engine fault.*
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
- v3.0.97–100 — **eight bugs, all found by the owner clicking through, none of them regressions.**
  The headline: **Modify Transfer had never worked** — it fetched the module *list* endpoint, which
  returns no `Invest`/`Dispose`, so it had never displayed a transfer for any module in any year,
  while a green unit test on the unreachable year-matching predicate said otherwise. Also: periodic
  transfers spanned `Date`→`DateEnd` but were matched on the stored year only; the same modal
  re-found rows by non-unique `Date+Flag` and could edit the wrong one; the synthetic `_cash_sweep`
  module 404'd from the breakdown *and* offered a transfer editor it could never satisfy; the SWEEP
  badge keyed off `cash_sweep_target` and so **hid the ranked backups** that the sweep will actually
  liquidate; the Review toolbar's five equally-loud buttons moved onto the shared `.btn` system; new
  modules open their editor; and **closing any modal scrolled the page away** from the cell just
  edited (Radix focus-restore on a double-click opener — fixed once in `<Modal>`, for every dialog).
  All owner-re-tested. Full detail: [roadmap §1.2](project-roadmap.md).
- v3.0.96 — **first restore drill: PASSED.** A real prod dump restored in 3 s / 0 errors; the server
  booted against it; the balance sheet **and** a regenerated forecast came back **byte-identical to
  prod**. Backups are now verified, not assumed — [runbook](../guides/restore.md) is a transcript, not
  a plan. Plus lint 108 → 64 (44 dead variables deleted; `no-unused-vars` and `no-undef` both at zero).
- v3.0.95 — **overnight run.** CR043 **N10**: the forecast module / inc-exp write API now rejects
  unknown fields instead of silently dropping them — enumerating the contracts surfaced **four dead
  keys** (`AccountNumber`, `Expense`, `Income`, `BaseYear`) posted for months to columns that do not
  exist, the same silent-drop class that cost CR046 its window dates and CR047 its tax override.
  CR042: **U4 complete** (last 2 Forecast modals); **63 dangling design tokens** across 30 files
  fixed (a `var(--text-secondary)` lints clean and silently ignores the theme) + new blocking
  `check-dead-tokens.sh`; **Outfit self-hosted** (variable font, 2 files, SW-precached — no CDN, and
  it finally works offline); the hex guard was widened after it turned out to be missing every
  composite (66 → true count **170**, now frozen). Lint 124 → 108.
- v3.0.90–94 — [CR048](../cr/cr-048-model-review-fixes.md) engine fixes + whole-scenario copy;
  [CR049](../cr/cr-049-forecast-base-year-seed-and-final-year-tax.md) final-year sweep tax + the
  deleted duplicate base-year query; full-width Forecast tables. Prod regenerated.
- v3.0.77–89 — [CR045](../cr/cr-045-forecast-cash-warnings-liquidation.md) (warnings, sweep tax,
  solvency cap) · [CR046](../cr/cr-046-module-income-window-and-hierarchy-graph.md) (migration 037)
  · [CR047](../cr/cr-047-module-income-tax-override.md) (migration 038) + four follow-on fixes.
- v3.0.63–76 — [CR042](../cr/cr-042-ui-look-and-feel.md) UI (U1–U5),
  [CR043](../cr/cr-043-code-structure-program.md) code structure, audit-trail 500 fix.
*(Detail for every release: [project-roadmap.md §1.2](project-roadmap.md).)*

## Next
**With the owner (do not start these unasked):**
- **"2026 Downside"** — the owner will redo this scenario themselves (stated 2026-07-13). Leave it,
  including the unranked-sweep-backup known issue below.
- CR048: the equity-growth and FX-stress decisions.
- CR042 IA: calibration→Settings move; collapsing the six Forecast steps in the sidebar.
- **Open design question:** creating a module now opens its editor — but the module is already
  created by then, so **Cancel leaves a blank, nameless row behind**. Should Cancel delete it?

**Engineering, unblocked:**
- CR043's lint gate: 64 errors, all hooks/react-refresh restructures. Needs the app in front of
  someone; do it incrementally with tests, never as a batch (a scripted pass in v3.0.96 produced
  *valid JS that passed the build and all 179 tests* but would have thrown on import — only
  `no-undef` caught it).
- CR043 tails: N8 `{data,meta}` envelope unification; `util.js` hygiene split; Phase 4 (TypeScript,
  Playwright).
- Long-running: [CR019](../cr/cr-019-quicken-import.md) investment-side promote,
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
