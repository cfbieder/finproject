# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).

**Last updated:** 2026-08-02 · **Live version:** v3.11.2 (see `VERSION` / git tags)

## Current phase
**[CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) is mid-build** (P0/P1/P3 done,
uncommitted, undeployed). Otherwise: owner-found defects, their follow-ups, and a long thread of
brokerage-history data work. Detail lives in the CR file linked from each line.

- ⛔ **CI is red on `main` and has been since `2d49ff3`** — migration **050**'s `found <> 1` guard
  aborts on a data-free database, and CI applies the whole chain to an empty Postgres before it
  seeds. **Third instance of this class** (046 was the first, and the fix note for it says exactly
  this), and again nothing announced it — [Known Issue #12](project-roadmap.md#3-known-issues).
  Amended under the migrations rule's "unavoidable" clause; the chain now builds all 52 files.
  **Leaves ledger checksum drift on dev and prod to accept deliberately** (`--accept-drift=050…`).
- **[CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) — one question, three defects.**
  *Should the other module types get a custom form like Loan's?* **No** — §5. But: the module
  editor computed foreign-currency USD at **FX = 1** and in the wrong direction (**P0**, an
  unmatched €390K property posts $390K); renaming a scenario stranded its assumptions, which two
  saves later reads as **0% inflation for 36 years, silently** (**P1**, migration **052**, five
  dead names in prod); and the two blank prod modules are **Generate**'s doing, not Cancel's —
  CR042 fixed Cancel a day before they were written (**P3**). Gates green (731 backend / 298
  frontend / six ratchets / lint 0). **P2 — the annual close — needs an owner decision** before it
  is built: every module is anchored **2025-12-31** while every scenario runs `PeriodStart 2027`,
  so each carries two base years at once. Roll **in place**, or keep **minting a copy** each year?

- **The Fidelity accounts now reconcile to the custodian, not to themselves** ([CR058 §12](../cr/cr-058-quicken-valuation-anchors.md), dev + prod). All four anchored to Fidelity's own statements; the stale-feed MTM marks restated; the 2023 handoff plug found and corrected; and the anchors, which are `is_transfer` rows, no longer report as capital contributions — so return percentages exist for 2020–2024 for the first time. *Open:* whether to book any of the statement-derived unrealized series ([§12.8–12.9](../cr/cr-058-quicken-valuation-anchors.md)), Fidelity Options (markable, never anchorable), and whether the feed's +2-day lag is calendar or business days.
- **[CR059](../cr/cr-059-fintable-api-ingestion.md) — fintable's REST API replaces the Google-Sheet scrape.** P0–P2 built and gate-verified; **nothing live** (`FINTABLE_SOURCE=sheets`). Remaining: P3a (31 account mappings, migration **044**) then P4 cutover. Retires the display-name join behind the Black Card incident. **§18 / migration 050** (v3.11.2, dev only) closes a cutover-only risk first: fintable serves four Revolut EUR transactions twice, the second copy under a wallet it labels "(USD)". ⚠️ **050 is pending on prod and the deploy runner applies every pending file** — the next `deploy-to-production.sh` will apply it whether or not P4 has happened.
- **[CR060](../cr/cr-060-feed-connection-health.md) — a broken feed announces itself.** Bank-feed side deployed; **fin's recon page still to do**.
- **A secured-asset link set inside a VARIANT was erased by the save that set it** ([CR062 §11.2](../cr/cr-062-forecast-loan-module.md), fixed locally, ⚠️ **not on prod**). Owner-found: "2026 Buy Business" read *"No asset carries debt"* with both loans secured. Two id spaces reach variant sync's link resolution — an inherited link is a **base** module id, an overridden one is a **variant** id (the picker offers the variant's own modules) — and it mapped base→variant unconditionally, so `|| null` unsecured the loan inside `interceptWrite`'s own transaction. Now resolved by which scenario the target sits in. The override patches still hold both links, so **the deploy is the repair**; a SQL patch would be re-erased by the next `syncIfStale`.
- **[CR050](../cr/cr-050-forecast-scenario-variants.md) — variants** are live and adopted; §10 (v3.11.0) made a variant read as one in all seven pickers. Owner has not yet run `adopt-variant` on "2026 Downside".
- **Recent releases:** v3.11.2 (the red CI below) · v3.11.1 (the period filter below) · v3.11.0 ([CR050 §10](../cr/cr-050-forecast-scenario-variants.md)) · v3.10.0 ([CR063](../cr/cr-063-coa-ordering.md), migration 049) · v3.8.0–v3.9.2 ([CR062](../cr/cr-062-forecast-loan-module.md) loans + equity, migrations 047/048).
- **v3.11.2 — CI had been red for two days and nothing said so (2026-08-01).** 30 pushes, three releases and a prod deploy shipped over a failing gate. Two causes, the newer hiding the older: four DB-backed suites borrowed accounts and an `fc_line` only the *dev* database holds (29 tests dead in `beforeAll`), then migration **046** asserted a production data fact unconditionally and aborted the chain on CI's empty database, killing `backend-tests` **and** `e2e` before the tests ran. Suites now seed their own fixtures, `ci-seed.sql` carries `Interest Income`, and 046 skips when there is no mapping to guard — verified on a throwaway Postgres built from the chain: 714 backend, 8 e2e. **Still open: nothing announces a red `main`** — [Known Issue #12](project-roadmap.md#3-known-issues).
- **v3.11.1 — the Transactions period filter was off by a day west of UTC (2026-07-31).** A row dated the **1st of the from-month** vanished while the **server-side** KPI tile above it still counted it — tile-vs-table disagreeing was the only place the defect surfaced. Third instance of the same class, and the guard cannot see it: the 2026-07-03 eslint ban covers `.toISOString()` — the **format** side — while `new Date("2025-12-01")` is UTC midnight and matches no rule. See [Known Issue #3](project-roadmap.md#3-known-issues), which now names the parse side and the consumers still unaudited.

## Known issue
- ⚠️ **"2026 Downside" has no sweep backup ranked** — *owner is redoing this scenario themselves (2026-07-13); **do not fix it**.* `Fidelity Stocks` carries no `cash_sweep_priority` there, so the engine reports **−$1.25M of shortfall across 2061–62 while $1.2M of stock sits untouched**. That is [CR045](../cr/cr-045-forecast-cash-warnings-liquidation.md) §5 working as designed (unranked = "I cannot sell this"), but for a liquid brokerage account it is almost certainly a data slip. One-row fix, left to the owner because it changes Downside's conclusions.
- Everything else: [roadmap §3](project-roadmap.md#3-known-issues) — 12 entries, including the timezone rule (#3), the 13 untriaged same-signed transfer clusters (#8), the ESLint JSX blind spot (#10), and the unannounced red `main` (#12).

## Live infrastructure
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`). Prod `docker-compose.yml` (project `psproject`, :3005, DB :5433, volume `fin_postgres_data`); dev `docker-compose.dev.yml` (:3105/:5434); v4 `docker-compose.v4.yml` (`finv4`, :3205/:5435, flags ON, isolated volume). Prod frontend: `https://fin.tail413695.ts.net`.
- `bank-feed/` microservice (:3007, separate repo) feeds 28 accounts; ocr-llm LLM gateway at `100.66.213.40:8080` (AI Review).
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations: manual `psql -f`, registry in [migrations.md](migrations.md); runner shipped in CR043 P1.1 (`npm run migrate`).
- **Gates:** 714 backend / 267 frontend / 8 e2e tests; lint **blocking** (0 errors), plus six ratchets that may only shrink (lint-debt, api-envelope, buttons, modals, hex, tokens).

## Recently shipped
Canonical dates/versions: **[CR index](../cr/README.md)**. Per-release detail:
**[roadmap §1.2](project-roadmap.md)**. Full prior headlines: **[status log](../archive/status-log_2026-08-01.md)**.
- **v3.10–v3.11** — COA ordering (CR063, migration 049) · forecast loans + equity (CR062, migrations 047/048) · variant lineage (CR050 §10) · the period-filter fix.
- **v3.6–v3.7** — Investment Returns + IRR (CR056) · Book Income at Source (CR057, migration 041) · reset-opening (CR033) · the Revolut misattribution across both repos · the bank-feed ingest paging cap · the `Math.abs` reversal and `base_amount` sign defects · the JSX lint blind spot.
- **v3.1–v3.5** — scenario variants (CR050) · foreign-currency expense lines (CR051) · Auto-Adjust (CR053) · Cash Flow By Account (CR054) · category-suggest backoff (CR055).
- **v3.0.x** — CR042 UI, CR043 code structure (both ✅ complete), the CR045–CR049 forecast-hardening run, and the first restore drill.

## Next
**With the owner (do not start these unasked):**
- "2026 Downside" — the owner is redoing it; also CR048's equity-growth and FX-stress decisions.
- [CR058 §12.8–12.9](../cr/cr-058-quicken-valuation-anchors.md) — whether to book any of the statement-derived unrealized series.
- [CR059](../cr/cr-059-fintable-api-ingestion.md) — the Chase date basis (`auth_date` vs posted) and the two Revolut wallets that no longer exist upstream.
- ~~Open design question: should Cancel delete the blank row it leaves behind?~~ **Answered — the
  premise was stale** ([CR064 §4.3](../cr/cr-064-forecast-annual-close-and-assumptions.md)). CR042
  made New Module a client-side draft (`11fc3b5`, 2026-07-13); both blank prod rows were written
  on 2026-07-14, by **Generate**, which saves the draft before it builds. The API now refuses a
  module with neither an account nor a name, and **Cancel needs no change**.

**Engineering, unblocked:**
- CR059 P3a (31 mappings, migration 044) → P4 cutover; CR060's fin-side recon page.
- CR043 tails: the lint-debt baseline (may only shrink), `util.js` hygiene split, Phase 4 (TypeScript).
- Long-running: [CR019](../cr/cr-019-quicken-import.md) investment-side promote · [CR023](../cr/cr-023-pocketsmith-removal.md) per-account PS migration · [CR034](../cr/cr-034-security-hardening-ci.md) rotate `BANK_FEED_API_KEY`.
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
