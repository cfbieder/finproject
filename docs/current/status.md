# Status — Fin

> The one mandatory read at session start. Keep ≤ ~60 lines; link onward, never restate.
> CR statuses live in the [CR index](../cr/README.md); the running version lives in `VERSION`.
> Older headlines: [status log](../archive/status-log_2026-08-01.md).

**Last updated:** 2026-08-02 · **Live version:** v3.11.5 (see `VERSION` / git tags)

## Current phase
**[CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) is the live thread** — P0/P1/P3 shipped in
**v3.11.3** (deployed 2026-08-02, migration **052** applied dev + prod); **P2 decided 2026-08-02 (keep minting a copy each year), designed but not built**;
P4/P5 designed. Otherwise: owner-found defects, their follow-ups, and a long thread of
brokerage-history data work. Detail lives in the CR file linked from each line.

- **[CR065](../cr/cr-065-neutralize-pair-identity.md) — a neutralize counter-leg is claimable exactly
  once.** Owner-found: Fidelity Cash Mgt showed −107,830.71 of drift and it "cannot just be MTM". It
  could not — **$108,635 was bookkeeping, $804.50 was market**. `neutralize()` tested "already has a
  counter-leg?" by *value*, which is not identity, so two genuine $150,000 CD purchases claimed the
  same mirror. Migration **053** makes the **database** refuse a double-claim. **Live in v3.11.4**
  (053 + the prod data fix applied 2026-08-02): drift **−107,830.71 → +42,169.29**, which is exactly
  the unpromoted 07/31 feed rows (41,364.79) + the real MTM (804.50), and the new per-account
  unpaired-leg check reads **0** everywhere; the 07/31 backlog is promoted. **§8 — the same defect
  recurred an hour after the deploy** because `refreshBankFeedV2`'s sweep mirror and
  `transferToAccount` also make pairs and did not record them, so their counter-legs read as
  unclaimed (+$20,000 on Fidelity Bond). Fixed, migration **054**, and *the check caught it the same
  hour*. **§9 (v3.11.5)** adds the owner-asked guard: the review queue badges a securities leg with **no offset** and all four accept paths ask before letting one through — already flagging 3 of 71 rows. **§10: Cash Mgt now reconciles at drift 0.00** (−107,830.71 → 0) — three IRA reinvestment legs neutralized and the MTM booked (−804.50). Booking it found [Known Issue #14](project-roadmap.md#3-known-issues): the stale-feed guard checks a balance's *date label*, not whether it contains that day, and proposed **+$40,150.79** on a CD ladder held at par.
- **CI is green again** — migration **050**'s `found <> 1` guard was unconditional and aborted the
  chain on a data-free database, so `main` had been red since `2d49ff3`. **Third instance of this
  class** (046 was the first, and the fix note for it says exactly this), and again nothing
  announced it — [Known Issue #12](project-roadmap.md#3-known-issues), now three incidents old.
  Amended under the migrations rule's "unavoidable" clause; the chain builds all 52 files.
- **[CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) — one question, three defects**
  (P0/P1/P3 live). *Should the other module types get a custom form like Loan's?* **No** — §5. But:
  the module editor computed foreign-currency USD at **FX = 1** and in the wrong direction (**P0**,
  an unmatched €390K property posts $390K); renaming a scenario stranded its assumptions, which two
  saves later reads as **0% inflation for 36 years, silently** (**P1**, migration **052**, five
  dead names in prod); and the two blank prod modules are **Generate**'s doing, not Cancel's —
  CR042 fixed Cancel a day before they were written (**P3**). **P2 — the annual close:** every
  module is anchored **2025-12-31** while every scenario runs `PeriodStart 2027`, and the copy path
  never moves `PeriodStart`, so each scenario carries two base years at once.

- **The Fidelity accounts now reconcile to the custodian, not to themselves** ([CR058 §12](../cr/cr-058-quicken-valuation-anchors.md), dev + prod). All four anchored to Fidelity's own statements; the stale-feed MTM marks restated; the 2023 handoff plug found and corrected; and the anchors, which are `is_transfer` rows, no longer report as capital contributions — so return percentages exist for 2020–2024 for the first time. *Open:* whether to book any of the statement-derived unrealized series ([§12.8–12.9](../cr/cr-058-quicken-valuation-anchors.md)), Fidelity Options (markable, never anchorable), and whether the feed's +2-day lag is calendar or business days.
- **[CR059](../cr/cr-059-fintable-api-ingestion.md) — fintable's REST API replaces the Google-Sheet scrape.** P0–P2 built and gate-verified; **nothing live** (`FINTABLE_SOURCE=sheets`). Remaining: P3a (31 account mappings) then P4 cutover. Retires the display-name join behind the Black Card incident. ⚠️ **Migration 044 reached prod on 2026-08-01 while still untracked** — another thread's deploy scans the migrations directory — **and was incomplete** (it missed `bankfeed_balances`, so all 27 mappings read "no feed"). Reversed by **051** on 2026-08-02; the feed stalled rather than corrupting (0 promoted, 0 ledger rows). **The real crosswalk needs a new number and all three id columns.** **050** is applied on prod (it rode the same accidental deploy) — harmless, and still correct.
- **[CR060](../cr/cr-060-feed-connection-health.md) — a broken feed announces itself.** Bank-feed side deployed; **fin's recon page still to do**.
- **A secured-asset link set inside a VARIANT was erased by the save that set it** ([CR062 §11.2](../cr/cr-062-forecast-loan-module.md), fixed in v3.11.3, prod rows repaired). Owner-found: "2026 Buy Business" read *"No asset carries debt"* with both loans secured. Two id spaces reach variant sync's link resolution — an inherited link is a **base** module id, an overridden one is a **variant** id (the picker offers the variant's own modules) — and it mapped base→variant unconditionally, so `|| null` unsecured the loan inside `interceptWrite`'s own transaction: the PUT that saved the link returned 200 with it already gone. Now resolved by which scenario the target sits in. Nothing was lost — the override patches are the record — and on prod the links **self-healed on the first read after the deploy**: the very operation that used to erase them now restores them.
- **[CR050](../cr/cr-050-forecast-scenario-variants.md) — variants** are live and adopted; §10 (v3.11.0) made a variant read as one in all seven pickers. Owner has not yet run `adopt-variant` on "2026 Downside".
- **Recent releases:** v3.11.5 · v3.11.4 ([CR065](../cr/cr-065-neutralize-pair-identity.md), migrations 053/054) · v3.11.3 ([CR064](../cr/cr-064-forecast-annual-close-and-assumptions.md) P0/P1/P3 + the variant link above, migration 052) · v3.11.2 (the red CI) · v3.11.1 (the period filter) · v3.11.0 ([CR050 §10](../cr/cr-050-forecast-scenario-variants.md)) · v3.10.0 ([CR063](../cr/cr-063-coa-ordering.md), migration 049) · v3.8.0–v3.9.2 ([CR062](../cr/cr-062-forecast-loan-module.md) loans + equity, migrations 047/048).

## Known issue
- ⚠️ **"2026 Downside" has no sweep backup ranked** — *owner is redoing this scenario themselves (2026-07-13); **do not fix it**.* `Fidelity Stocks` carries no `cash_sweep_priority` there, so the engine reports **−$1.25M of shortfall across 2061–62 while $1.2M of stock sits untouched**. That is [CR045](../cr/cr-045-forecast-cash-warnings-liquidation.md) §5 working as designed (unranked = "I cannot sell this"), but for a liquid brokerage account it is almost certainly a data slip. One-row fix, left to the owner because it changes Downside's conclusions.
- Everything else: [roadmap §3](project-roadmap.md#3-known-issues) — 14 entries, including the timezone rule (#3), the MTM stale-feed guard (#14), the pre-CR065 securities-transfer residue (#13), the 13 untriaged same-signed transfer clusters (#8), the ESLint JSX blind spot (#10), and the unannounced red `main` (#12).

## Live infrastructure
- **Dev and prod are the same host** (`192.168.1.87` / Tailscale `100.94.46.62`). Prod `docker-compose.yml` (project `psproject`, :3005, DB :5433, volume `fin_postgres_data`); dev `docker-compose.dev.yml` (:3105/:5434); v4 `docker-compose.v4.yml` (`finv4`, :3205/:5435, flags ON, isolated volume). Prod frontend: `https://fin.tail413695.ts.net`.
- `bank-feed/` microservice (:3007, separate repo) feeds 28 accounts; ocr-llm LLM gateway at `100.66.213.40:8080` (AI Review).
- Deploy: `./Scripts/deploy-to-production.sh` (DB backup first). Migrations: manual `psql -f`, registry in [migrations.md](migrations.md); runner shipped in CR043 P1.1 (`npm run migrate`).
- **Gates:** 743 backend / 298 frontend / 8 e2e tests; lint **blocking** (0 errors), plus six ratchets that may only shrink (lint-debt, api-envelope, buttons, modals, hex, tokens).

## Recently shipped
Canonical dates/versions: **[CR index](../cr/README.md)**. Per-release detail:
**[roadmap §1.2](project-roadmap.md)**. Full prior headlines: **[status log](../archive/status-log_2026-08-01.md)**.
- **v3.10–v3.11** — COA ordering (CR063, migration 049) · forecast loans + equity (CR062, migrations 047/048) · variant lineage (CR050 §10) · the period-filter fix.
- **v3.6–v3.7** — Investment Returns + IRR (CR056) · Book Income at Source (CR057, migration 041) · reset-opening (CR033) · the Revolut misattribution across both repos · the bank-feed ingest paging cap · the `Math.abs` reversal and `base_amount` sign defects · the JSX lint blind spot.

## Next
**With the owner (do not start these unasked):**
- "2026 Downside" — the owner is redoing it; also CR048's equity-growth and FX-stress decisions.
- [CR058 §12.8–12.9](../cr/cr-058-quicken-valuation-anchors.md) — whether to book any of the statement-derived unrealized series.
- [CR059](../cr/cr-059-fintable-api-ingestion.md) — the Chase date basis (`auth_date` vs posted) and the two Revolut wallets that no longer exist upstream.

**Engineering, unblocked:**
- CR059 P3a — a **new** crosswalk migration covering all three id columns (044 is reversed) → P4 cutover; CR060's fin-side recon page.
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
