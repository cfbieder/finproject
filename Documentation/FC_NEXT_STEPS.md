# Development Plan (FC_NEXT_STEPS.md)

Living plan for the Fin project — open Change Requests, known issues, ongoing improvement themes, and a chronological history. Companion to [FC_PROJECT_STRUCTURE.md](FC_PROJECT_STRUCTURE.md), which describes the *current* state of the project.

For the full CR list with one-line descriptions, see [CRs/CR_INDEX.md](CRs/CR_INDEX.md).

---

## 1. Change Requests

Each CR is a self-contained markdown file under [CRs/](CRs/). The first line of each CR carries its status. The anchors below are the deep-link targets used from each CR file's "Plan" link.

### 1.1 Open / In-Progress

<a id="cr024"></a>
- **CR024 — [Fidelity Feeds: market-value balances + investment-activity cash flow](CRs/CR024_FIDELITY_FEEDS.md)** — *IN-PROGRESS — Phase 1 built + green on dev (2026-06-02); Phase 2 pending bank-feed `activity_type` handoff*. **Phase 1 as-built (dev):** migration `025_fidelity_feeds.sql` (`bankfeed_balances` cache + `account_source_mappings.balance_from_feed`/`trade_treatment`); `ingestBalances()` folds `/v1/balances` into the cache on the cron `/ingest` path; `reports.js` leaf-level read-override (feed value for as-of ≥ 2026-05-30, additive fallback earlier, parents aggregate overridden leaves); idempotent `seed-cr024-fidelity-mappings.js` maps the 5 accounts `balance_from_feed=TRUE` keeping `ignored=TRUE` (tx suppressed till Phase 2); ps-anchor already skips all 5. Verified live on dev: Bond corrected $1.01M→$1.20M, parents roll up, PKO unaffected; 178/178 backend tests. **Prod DEPLOYED + verified (v2.11.0, 2026-06-02):** migration 025 applied before the code deploy (pg_dump bracket), seed run, 13/13 balances cached; balance sheet shows feed values, parents roll up, 0 tx leaked, idempotent; daily 06:00 cron refreshes the cache. **Phase 2 built + dev-verified (2026-06-03):** bank-feed shipped `activity_type` on `/v1/transactions`; fin migration `026_fidelity_activity.sql` (`bankfeed_staging.activity_type`/`.suppressed`), `categorizeFidelityActivity` routes income/transfer/suppress/review, promote assigns `category_id` (still `accepted=FALSE`). Dev: 233 inserted, 130 suppressed, categorization exact; 188/188 tests. **Phase 2 ACTIVATED on prod (v2.13.0, 2026-06-03)** via a per-account cutover cutoff (migration `027_promote_from_date.sql`, `seed-cr024-fidelity-cutoffs.js` = PS-last-tx+1) instead of blind dedup — the dry-run showed dedup would double-count 26 ambiguous rows (reports count `accepted=FALSE` rows). Activation: promoted **60 Fidelity rows** (Dividend 15, Interest 4, Option Trade 20, Transfer-Securities-Trades 19, Transfer-Bank 2), 33 suppressed, **0 PS rows at/after cutoff → zero double-count by construction**; Phase 1 balances intact; `accepted=FALSE` for review. CR024 is now DONE on prod (both phases); CR020 still owns lot/cost-basis. Stands up the 6 Fidelity (SnapTrade-via-fintable) feeds CR022 deliberately left `ignored` (investment-side not built). Live investigation: every Fidelity account has `Σ(captured tx)=0` / no inception baseline, so `opening_balance + Σ(amount)` cannot derive any balance — the only authoritative number is bank-feed `feed_balances` (forward-only from 2026-05-30); historical market value is unrecoverable from this feed. Rich activity (`type`/`units`/`price`/`option_type`) sits in `feed_transactions.raw.parsed` but is **not** on the `/v1/transactions` contract. **Two layers, one CR (user chose single-CR):** **Phase 1** — `feed_balances` read-override on the balance sheet for the mapped Fidelity accounts (26 IRA / 27 Stocks / 28 Options / 30 Cash Mgt / Fixed-Income→29-or-31 *open*; Individual stays ignored), as-of ≥2026-05-30 else existing additive value unchanged; ingest `/v1/balances`→new `bankfeed_balances` table (no bank-feed change needed); plus ps-anchor cleanup on account 26. **Phase 2** — import + categorize the activity stream by SnapTrade `activity_type`: INTEREST→Interest Income, DIVIDEND→Dividend Income (must, all accounts); BUY/SELL→per-account `trade_treatment` (`offset` default → Transfer-Securities-Trades; `income` → cash-basis option P&L for the Options account); REI→offset; CONTRIBUTION/WITHDRAWAL→matchable Transfer (NOT income/expense — large $190K/$162K inter-account moves); LOAN/JOURNALED/OPTIONEXPIRATION→suppressed (net-zero plumbing); unknown type→review (fail-safe). All rows land `accepted=FALSE` (review queue, pre-filled suggestions). Mapping grounded in the live 338-row activity inventory. **Gated on a `Finance → bank-feed` handoff:** add an additive optional `activity_type` to `/v1/transactions` (populated from `raw.parsed.type`). Migration `025_fidelity_feeds.sql` (`bankfeed_balances`, `account_source_mappings.trade_treatment` + `.balance_from_feed`). **Non-goals:** lot/cost-basis/holdings/FIFO (stays CR020), reconstructing pre-feed historical market value, touching PS. Resolves Known Issue #4. **Mapping resolved:** Fixed Income → leaf 31 Fidelity Bond (29 "Fidelity Fixed Income" is the parent *category* rolling up 30 Cash Mgt + 31 Bond — read-override sits on the leaves, 29 aggregates; not mapped); option P&L → 76 "Option Trade" (near-dup 219 deleted from prod 2026-06-02).

<a id="cr022"></a>
- **CR022 — [Bank Feed Parallel Import](CRs/CR022_BANK_FEED_PARALLEL_IMPORT.md)** — *PHASE G (observing, ≥1 month) — Phases A–F DONE; prod parallel run live since 2026-06-02.* Additive second import route in fin that consumes the CR021 bank-feed `/v1/*` contract and writes into the existing `transactions` table with `source='bank-feed'`, alongside PocketSmith. Shipped: migrations `023_bank_feed_import.sql` (`bank_feed_external_id` partial-unique col, `bankfeed_staging`, `sync_metadata` seed, `account_source_mappings.ignored`) + `024_bank_feed_ignore_unmapped.sql` (drop NOT NULL on `account_source_mappings.account_id` for ignore-without-mapping); converter/repository/orchestrator/route files under `server/src/v2/`; R1 mapping UI (typeahead `AccountPicker` + ignore toggle on the diagnostic page); 167/167 backend tests; `smoke-bank-feed.js` (7/7 live). Reuses the source-agnostic review queue and source-discriminated `account_source_mappings`. **R1** per-account opt-in — unmapped account stages but never promotes (fail-closed); ignore is a standalone skip (no mapping needed). **R2** cross-source dedup — at promote a bank-feed row links onto a matching `source='pocketsmith'` row (`(account_id, ABS(amount), currency)` ±1 day) instead of inserting, id stable; the reverse direction drops the later PS row via **one guarded `NOT EXISTS` in `ingestPs.js` `syncStagingToTransactions`** (the only PS-code edit, behind `BANK_FEED_DEDUP_ENABLED` + a column-existence self-disable — NOT `refreshPsApiV2.js`); `merged_with_ps_count` is the parallel-run health signal. **Dev walkthrough done** (§7.0): 312 live PKO tx staged, R1 fail-closed + ignore-without-mapping verified, 102 rows promoted after UI mapping, idempotent; R2 link path test-covered (PS went stale 2026-03-31 → no live twins). **Phase F DONE (2026-06-02):** prod was confirmed at 022, migrations 023+024 applied inside a pg_dump bracket, v2.8.2 deployed (healthy), smoke 7/7, 6 PKO accounts mapped / 7 ignored (5 Fidelity + business-PLN(5564)), first promote seeded the ledger (134 PS rows linked, 32 bank-feed rows in the review queue), stage-only daily cron added (06:00). Day-one reconciliation `total_ps_only=0`, matched=143 — but only after the fintable sheet history was deepened to cover the 30-day window and bank-feed re-synced (the shallow first read showed a benign old-edge backfill gap). **Now in Phase G observation:** re-read `GET /reconciliation?sinceDays=30` weekly; `ps_only` must hold at 0 for ≥1 month before opening CR023 (PS removal). 32 bank-feed review-queue rows await triage on `/refresh-ps`. **Non-goals:** removing PocketSmith, generalizing `pending_transactions`, modifying the existing `/refresh-ps` *UI*, investment-side schema. PS removal is a separate future CR after ≥1-month parallel run. **Coordinating dependency:** bank-feed's `fintableSync.js` hardcodes the PKO institution onto every account — needs a CR021-side fix before Fidelity arrives. (Bank-feed now exposes 13 accounts: PKO PLN/EUR/USD + Fidelity-side USD; cash-side CR022 maps the PKO accounts.)

<a id="cr021"></a>
- **CR021 — [Bank Feed Service](CRs/CR021_BANK_FEED_SERVICE.md)** — *IN-PROGRESS*. Standalone microservice that replaces PocketSmith, behind a versioned `/v1/*` REST contract for v3 of the main fin app. **Upstream chosen 2026-05-30: fintable.io via Google Sheets** (after Phase 0 rejected banksync.io for no-PKO catalog, moneysheets.io for no-developer-API, GoCardless direct for closed signups; Plaid Production stayed In Review). Repo: [`~/Programs/fin/bank-feed/`](../../bank-feed) (github.com/cfbieder/bank-feed, private). **Phases 0–3 shipped 2026-05-30:** skeleton + Google Sheets adapter + hourly scheduler + real-Sheet smoke (7 PKO accounts, 127 transactions, 7 balance snapshots live in `/v1/transactions`, `/v1/accounts`, `/v1/balances`). Remaining: Phase 4 (Excel/CSV upload for Fidelity), Phase 5 (gap detection + balance reconciliation + stale-feed alerts), Phase 6 (admin UI), Phase 7 (fin main-app integration spike → CR022 v3 cutover).

<a id="cr014"></a>
- **CR014 — [PocketSmith Replacement](CRs/CR014_POCKETSMITH_REPLACEMENT.md)** — *SUPERSEDED 2026-05-28 by [CR021](#cr021)*. Original plan integrated dual providers (GoCardless + Plaid) directly into the main `fin` app. Replaced by the microservice-with-contract approach.

<a id="cr015"></a>
- **CR015 — [Re-export Changes Back to PocketSmith](CRs/CR015_PS_REEXPORT.md)** — *OBSOLETE 2026-05-28*. PocketSmith is being removed entirely via [CR021](#cr021), so re-exporting to it no longer makes sense.


<a id="cr017"></a>
- **CR017 — [Cash Sweep Phase C — Multi-Module Priority Sweep](CRs/CR017_CASH_SWEEP_PHASE_C.md)** — *OPEN*. Withdraw from multiple modules in priority order on shortfall; extends CR005.

<a id="cr019"></a>
- **CR019 — [Quicken Historical Import](CRs/CR019_QUICKEN_IMPORT.md)** — *IN-PROGRESS*. One-time backfill of pre-2022 Quicken history. Cash side lands in `transactions` with per-account soft cutoff and transfer pairing; investment side builds the full lot-level schema (`securities`, `security_lots`, `security_transactions`, `security_lot_disposals`, `security_prices`, `security_source_mappings`) that CR020 depends on. Four staging tables + admin UI with three mapping surfaces + Promote with calibration. Blocks CR020. **Phases A–E shipped to dev AND prod 2026-05-22.** Parser + FX seeder at [`server/src/v2/scripts/quicken-import.js`](../server/src/v2/scripts/quicken-import.js), promote/rollback at [`quicken-promote.js`](../server/src/v2/scripts/quicken-promote.js), admin API at [`routes/quickenImport.js`](../server/src/v2/routes/quickenImport.js), admin UI at [`QuickenImport.jsx`](../frontend/src/pages/QuickenImport.jsx) (live at `/quicken-import`). **129 passing tests** including end-to-end promote+rollback on real PKO data (3,098 transactions in 3 seconds, balance preservation verified). `runPromote` guards against investment-side batches (refuses fail-loud); `findTransfers` filters by `skip_transfer_analysis`. Next: investment-side promote (lot walker, §6.4 steps 1/3/5/6/7) — schema and parser are ready, only the promote-time logic remains. **Update 2026-05-29:** cash promote pivoted to a 1→1 model (single tx per row, post-hoc Transfer Analysis matching) — dev-only, supersedes the fanout (the 3,098-tx / 129-test figures above are pre-pivot). **Update 2026-05-30:** dev walkthrough validated the 1→1 model end-to-end and **removed auto-match from promote** (it was dead code that also irreversibly mutated PS-era `transfer_matched` flags; matching is now manual via `/transfer-analysis`). Suite at 59 passing. Also cleared three §19 follow-ups same day: bulk-create is now role-aware + atomic (no orphan leaves); the quicken jest suite uses a `_qpr `-namespaced fixture (no shared-dev mapping clobber); and role-corrupting stored mappings now block promote (`findRoleInvalidMappings` + pre-flight `roleInvalid`/`canPromote`). These 05-30 changes are committed on branch `fix/cr019-remove-promote-automatch` (PR #1), dev-only — not yet on prod. **Update 2026-06-01:** investment side descoped to value-only promote (§22, no lot walker — CR020 stays blocked); calibration redesigned to PS-anchored (§22.1 — `opening_balance = PS closing_balance − Σtx`, fixes collapsed history). **Update 2026-06-02:** (a) `quicken-verify.js` balance-invariant rewritten to the PS-anchored contract (was stale, all-red false positives); (b) orphan batch `bank_pko_save` deleted, `prop_nokomis` deferred (unmapped, history missing); (c) **issue #3 resolved for non-backfill accounts** — new `ps-anchor.js` (§22.2) reconciles active BS accounts to PS `closing_balance`; 12 CLEAN anchored on dev (PKO Savings +569,970 PLN, Fidelity IRA +148,590, …), 13 DIVERGENT reported (4 Fidelity mark-to-market + likely credit-card ledger inconsistencies — held for per-account decision). **Cutover model decided: re-run-pipeline-on-prod** — all data fixes are idempotent scripts run on prod, no dump/restore, no manual SQL. **Update (later 2026-06-02):** DIVERGENT card gaps resolved (PocketSmith intra-day ordering artifact, data complete, `computed` already correct — not a bug); Fidelity brokerage routed to the bank-feed/CR022 thread (feed `feed_balances` into the balance sheet — Known Issue #4); **`retire-handoff.js` shipped (§22.3)** — scripts the formerly-manual Fidelity 635 handoff (validated on dev, idempotent), the last manual-SQL artifact for cutover. **ps-anchor skip-guard shipped** — ps-anchor now skips feed-owned brokerage containers (Fidelity), so it won't fight the feed integration. **Update (later 2026-06-02):** prop_nokomis resolved (redundant with PS, kept; verify now WARNs promoted-0-row batches → gate green); **Rollback→Delete** shipped (rolled_back batches now deletable, with a tx-count guard); **prod cutover runbook drafted (CR019 §23)** — re-run-on-prod sequence with two tooling gaps to close first (G1 a COA seed script, G2 a dev→prod staging+mapping copy or UI re-map). CR019 cutover scripts (verify/ps-anchor/retire-handoff) all complete + idempotent. **G1 + G2 closed:** `seed-cr019-coa.js` (idempotent COA seeder) and `copy-quicken-to-prod.js` (dev→prod staging+mapping copy with name-translation, validated against a throwaway target) shipped. The §23 cutover runbook is now fully scripted (seed → copy → promote → retire-handoff → ps-anchor → verify). Open: STEP 1 deploy (prod v2.8.2 lacks the PS-anchored/value-only promote code — needs a fresh release from main); execute cutover (coupled to bank-feed release); PKO/Chase real-export backfill (needs user QIFs).

### 1.2 Completed (chronological, latest first)

<a id="cr016"></a>
- **CR016 — [Frontend Test Framework (Vitest)](CRs/CR016_FRONTEND_TEST_FRAMEWORK.md)** — *COMPLETED 2026-05-20*. Vitest + `jsdom` scaffolded; 96 tests across 5 helper modules (`dateHelpers`, `formatters`, `treeTraversal`, `forecastHelpers`, `cashFlowHelpers`); `npm test` exits non-zero on failure. Component/hook tests + Playwright E2E deferred to future CRs.

<a id="cr013"></a>
- **CR013 — [Collapse `categories` Table into `accounts`](CRs/CR013_COLLAPSE_CATEGORIES.md)** — *COMPLETED 2026-04-28*. Migration 021. Single COA source of truth; FK columns repointed; legacy table dropped.

<a id="cr006"></a>
- **CR006 — [AI Review of FC Plan](CRs/CR006_AI_REVIEW.md)** — *COMPLETED 2026-04-28*. Conversational review via local `ocr-llm` gateway, async with polling, browser notifications. Migrations 014, 020.

<a id="cr012"></a>
- **CR012 — [Opening Balance Calibration](CRs/CR012_OPENING_BALANCE_CALIBRATION.md)** — *COMPLETED 2026-04*. Migration 016. Accurate balance sheet via `opening_balance + SUM(transactions)`.

<a id="cr007"></a>
- **CR007 — [PWA & Mobile Simplified Shell](CRs/CR007_PWA_MOBILE_SHELL.md)** — *COMPLETED*. Installable PWA + dedicated `/m/*` mobile experience.

<a id="cr005"></a>
- **CR005 — [Cash Sweep & Auto-Balance](CRs/CR005_CASH_SWEEP.md)** — *COMPLETED*. Iterative sweep with income↔sweep convergence loop. Migrations 012–013.

<a id="cr011"></a>
- **CR011 — [Source Mappings (Category + Account)](CRs/CR011_SOURCE_MAPPINGS.md)** — *COMPLETED*. Decouples external system names from internal app names. Migrations 018–019.

<a id="cr009"></a>
- **CR009 — [Transfer Analysis + Manual Match Groups](CRs/CR009_TRANSFER_ANALYSIS.md)** — *COMPLETED*. Auto + manual matching of transfer pairs; `transfer_matched` flag. Migrations 005–006.

<a id="cr008"></a>
- **CR008 — [HierarchyFilter & Transaction Pages Redesign](CRs/CR008_HIERARCHY_FILTER.md)** — *COMPLETED*. Two-stage cascading filter; full redesign of transaction-explorer pages.

<a id="cr010"></a>
- **CR010 — [COA Management Redesign + Move](CRs/CR010_COA_MANAGEMENT.md)** — *COMPLETED*. Tree view editor with toolbar, inline actions, quick-add, Move modal.

<a id="cr004"></a>
- **CR004 — [FC Inc/Exp Mapping Layer](CRs/CR004_FC_LINES_MAPPING.md)** — *COMPLETED*. User-defined FC Lines decouple budget categories from forecast outputs. Migration 007.

<a id="cr003"></a>
- **CR003 — [Forecast Module](CRs/CR003_FORECAST_MODULE.md)** — *COMPLETED*. Engine + UI for BS modules and inc/exp items across all phases (1, 2A, 2B, 3, 4, 5).

<a id="cr002"></a>
- **CR002 — [Frontend Architecture Refactor](CRs/CR002_FRONTEND_REFACTOR.md)** — *COMPLETED*. God components decomposed; `features/` module pattern; ~22 duplicate files deleted.

<a id="cr001"></a>
- **CR001 — [MongoDB → PostgreSQL Migration](CRs/CR001_MIGRATION_MONGO_TO_POSTGRES.md)** — *COMPLETED*. All storage moved to PostgreSQL 16; V1 routes and `coa.json` removed.

---

## 2. Open Backlog (non-CR items)

Small fixes, refactors, and one-off cleanups that don't warrant their own CR file. New work that grows beyond a line item gets promoted to a CR.

- [ ] **Forecast: `baseYears` workaround cleanup** — `baseYears` is now properly populated but a `value == null` detection pattern still lives in `FCReviewTable`. Low-priority cosmetic.
- [ ] **Frontend DRY items** still pending (full list in §3 below):
  - `collectCollapsiblePaths()` duplicated in `Balance.jsx` and `BalanceChart.jsx` — move to shared `treeHelpers.js`.
  - Month options array recreated in multiple components — move to shared constants.
  - FX rate lookup duplicated in BudgetInput and various transaction modals — move to shared `currency.js`.
- [ ] **Shared components missing** (per §3.3): `<Modal>`, `<DataTable>`, `<FormField>`, `<LoadingSpinner>`, `<ErrorMessage>`, `<ConfirmDialog>`, `<CurrencyInput>`. Tracked here as a theme; promote to a CR if a focused refactor is scheduled.
- [ ] **Backend service layer simplification** (per §4): break up `fcbuilder-module.js` (835 lines), `cashFlowFetcher.js` (619 lines). Centralize error handling with an `AppError` class. Promote to a CR when scheduled.
- [ ] **TypeScript migration** (per §3.7) — gradual: utilities → hooks/components → pages.
- [ ] **API design pass**: consistent `{ success, data, meta }` response envelope, pagination on list endpoints, structured logging via Pino.

---

## 3. Known Issues

1. **Test coverage:** 73 backend Jest tests + 17 HTTP smoke checks + 96 frontend Vitest tests across 5 helper modules ([CR016](#cr016) complete; component / hook tests + Playwright E2E deferred to future CRs). Run backend: `cd server && npm test`. Frontend: `cd frontend && npm test`. Smoke: `node server/src/scripts/smoke-after-021.js`. Full test layout: [Testing/TEST_OVERVIEW.md](Testing/TEST_OVERVIEW.md).
2. **Cloud-init ISO** still attached to the VM as a CD-ROM. Harmless but can be ejected:
   ```bash
   virsh --connect qemu:///system change-media fin sda --eject
   ```
3. **Timezone-sensitive date handling:** The `pg` library serializes JavaScript `Date` objects using the server's local timezone. Fixed globally in `postgres.js` with `types.setTypeParser(1082, val => val)` so DATE columns return plain `YYYY-MM-DD` strings. Frontend code must format local-time `Date` objects using `getFullYear()`/`getMonth()`/`getDate()` — never `.toISOString().split("T")[0]` which shifts by one day in UTC+ timezones.
4. **⤇ Cross-thread handoff (CR019 → bank-feed/CR022 thread, 2026-06-02): Fidelity brokerage balances are wrong; the fix is to feed them from `feed_balances`.** The 5 fin Fidelity balance-sheet accounts compute balance as `opening_balance + Σtx` from PocketSmith data, which is a *half-finished trade-neutralization* (only 7 of thousands of 2020–2026 trades neutralized via the `neutralize()`/`auto-offset` button; missing pre-2020 opening balances; partial "Unrealized" market rows). Result: wrong balances — e.g. Fidelity Bond reads **$1.01M** vs the real **$1.20M**. **Authoritative values already exist** in the bank-feed `feed_balances` (fresh daily, `source=fintable`, bank-feed DB `localhost:5435`). **Root cause:** the 5 fin accounts are mapped only to `source='pocketsmith'`; their 6 Fidelity feed accounts already sit in `account_source_mappings` as `account_id=NULL, ignored=true` (CR022 deliberately deferred them as out-of-cash-scope). **This is NOT CR022 cash scope and NOT full CR020 lot-tracking — it's a distinct, small piece: read `feed_balances` for brokerage/fed accounts on the v3 balance sheet (the bank-feed migration's stated intent: "the v3 balance sheet reads from feed_balances when available"). Needs triage as a new small CR or CR020 sub-item.** Precise mapping (feed `external_id` → fin account): `5216d738-82a9-4956-9b23-aff70d07c827` Rollover IRA→26; `4edb12ab-749d-4e1f-bbe4-5d31aaee30d8` Stocks→27; `3bd9f941-8d06-4302-8950-35b532cebbaa` Options→28; `e5a23070-13bb-49af-8f2d-e552e159b570` Cash Management→30; `e420ad75-9a54-4c3b-b98a-5adbd8b6061e` Fixed Income→31; `190d7bf1-c77d-43bc-9061-b7646669b176` Individual→**leave ignored** (user instruction). **Cleanup:** CR019's `ps-anchor.js` wrongly anchored fin **26 (Fidelity IRA)** to PS's stale April closing_balance ($266,853) as "CLEAN" — once 26 is fed from `feed_balances`, run `DELETE FROM transactions WHERE account_id=26 AND source='ps-anchor'`. Brokerage accounts should be excluded from `ps-anchor` entirely; the feed owns them. Full analysis in memory `cr019_quicken_import_progress.md` and CR019 §22.2.

---

## 4. Frontend Improvement Themes (ongoing)

### 4.1 DRY Violations (remaining)

1. ~~Transaction filter logic duplicated across TransActual, TransBudget, useTransactions~~ — *Resolved* (CR002).
2. `collectCollapsiblePaths()` duplicated in `Balance.jsx` and `BalanceChart.jsx` — move to shared `treeHelpers.js`.
3. ~~Date initialization logic in BudgetInput~~ — *Resolved* via `PeriodSelector`.
4. Month options array recreated in multiple components — move to shared constants.
5. FX rate lookup duplicated in BudgetInput and transaction modals — move to shared `currency.js`.

### 4.2 Missing Shared Components

| Component | Used in | Current state |
|-----------|---------|---------------|
| `<Modal>` | 5+ places | Each modal custom-built |
| `<DataTable>` | 6+ places | Tables custom each time |
| ~~`<FilterPanel>`~~ | 4+ places | Partially via `HierarchyFilter` (CR008) and `PeriodSelector` |
| `<FormField>` | 10+ places | Inputs custom per form |
| `<LoadingSpinner>` | All pages | "Loading..." text varies |
| `<ErrorMessage>` | All pages | Error display inconsistent |
| `<ConfirmDialog>` | 5+ places | Delete confirms duplicated |
| ~~`<DateRangePicker>`~~ | 4+ places | Partially via `PeriodSelector` |
| `<CurrencyInput>` | 3+ places | Amount inputs inconsistent |

### 4.3 UI/UX Improvements

| Issue | State | Proposed |
|-------|-------|----------|
| Loading states | Mix of "Loading...", spinners | Unified `<LoadingSkeleton>` |
| Error display | Different per page | Unified `<ErrorBanner>` with retry |
| ~~Empty states~~ | Inconsistent | *Resolved:* `EmptyState` with 8 unDraw variants, wired into 14 pages |
| Button styles | `.generate-report-button` everywhere | Variants: primary, secondary, danger |
| Form validation | Scattered | Centralized validation with error messages |
| Date selection | Different controls per page | Partially via `PeriodSelector`; other pages pending |

### 4.4 Performance & TypeScript

- Component memoization (`React.memo`, `useMemo`, `useCallback`) for expensive components.
- Virtual scrolling (`@tanstack/react-virtual`) for tables with 1000+ rows.
- Debounced filters; SWR/stale-while-revalidate for API caching.
- TypeScript migration: utilities → hooks/components → pages.

### 4.5 Decisions Made

| Decision | Choice |
|----------|--------|
| Component library | Radix UI + custom styling |
| Charting | Recharts |
| Mobile support | Responsive (1080px / 768px / 640px breakpoints) + dedicated `/m/*` shell |
| State | Enhanced React Context (upgrade to Zustand if complexity grows) |

---

## 5. Backend Improvement Themes (ongoing)

### 5.1 Service Layer Complexity

| Service | Lines | Notes |
|---------|-------|-------|
| `fcbuilder-module.js` | 835 | Monolithic; mixes data access with business logic |
| `fcbuilder-incexp.js` | 436 | Duplicated patterns from module builder |
| `cashFlowFetcher.js` | 619 | Complex aggregation, hard to maintain |
| `balanceSheetFetcher.js` | 324 | Could be simplified with SQL views |

### 5.2 Missing Abstractions

- **Repository pattern** — partially adopted under `server/src/v2/repositories/`. Continue extracting where services still embed SQL.
- **Base repository** — common operations in a shared base class.
- **Error handling** — centralize with an `AppError` class and error-handling middleware.

### 5.3 API Design

- Consistent response envelope `{ success, data, meta }` or `{ success, error }`.
- Pagination on list endpoints (`page`, `pageSize`, `total`, `totalPages`).
- Standardize `sortBy`, `sortOrder`, `fromDate`, `toDate` across endpoints.
- Structured logging via Pino.

---

## 6. Testing Strategy

See [Testing/TEST_OVERVIEW.md](Testing/TEST_OVERVIEW.md) for the test inventory, naming conventions, and run commands.

Phased plan:

- **Phase 1 — Backend unit tests (Jest, in place):** Forecast engine, route handlers with mocked repos. 73 tests today.
- **Phase 2 — HTTP smoke tests (in place):** `smoke-after-021.js` covers all SQL JOINs rewritten by migration 021. Add new smoke scripts for major schema changes.
- **Phase 3 — Frontend unit tests (Vitest, [CR016](#cr016)):** Helpers covered. *Complete 2026-05-20: 96 tests across 5 helper modules (`dateHelpers`, `formatters`, `treeTraversal`, `forecastHelpers`, `cashFlowHelpers`). Hook tests deferred to a future CR (need React Testing Library + Context mocking).*
- **Phase 4 — E2E (Playwright, future):** Critical flows — PocketSmith sync + accept, budget entry, forecast module creation.

---

## 7. Migration History

Chronological log of substantive infrastructure / behavioural changes. Smaller user-facing features are documented in the relevant CR file or FC_PROJECT_STRUCTURE.md.

| Date | Event |
|------|-------|
| 2026-06-03 | **Released v2.13.0** (and v2.12.0) — minor; additive. **CR024 Phase 2 — Fidelity investment-activity cash flow.** bank-feed shipped additive `activity_type` on `/v1/transactions` (compute-on-read from `raw.parsed.type`). fin: migrations `026_fidelity_activity.sql` (`bankfeed_staging.activity_type`/`.suppressed`) + `027_promote_from_date.sql` (`account_source_mappings.promote_from_date` cutover gate). `categorizeFidelityActivity` routes by SnapTrade type + per-account `trade_treatment` (INTEREST/DIVIDEND→income, Options BUY/SELL→Option Trade, other trades+REI→Transfer-Securities-Trades, CONTRIBUTION/WITHDRAWAL→Transfer-Bank, LOAN/JOURNALED/OPTIONEXPIRATION→suppress, PAYMENT/unknown/null→review). Promote assigns `category_id` (fail-loud name→id), suppresses net-zero plumbing, and honours the cutoff. **v2.12.0** shipped the categorizer dormant; **v2.13.0** added the cutover gate and activated it: a dry-run found blind dedup would double-count 26 ambiguous Fidelity rows (reports count `accepted=FALSE`), so activation used a per-account cutoff = PS-last-tx+1 (26/27→05-23, 28→05-27, 30/31→05-16). Prod activation promoted 60 Fidelity rows, 33 suppressed, 0 PS-overlap → zero double-count; Phase 1 balances intact; rows `accepted=FALSE`. Backend 188/188. |
| 2026-06-02 | **Released v2.11.0** — minor; additive, no breaking changes. **CR024 Phase 1 — Fidelity market-value balances:** migration `025_fidelity_feeds.sql` (`bankfeed_balances` cache + `account_source_mappings.balance_from_feed`/`trade_treatment`); `refreshBankFeedV2.ingestBalances()` folds `/v1/balances` into the cache on the cron `/ingest` path; `reports.js` balance-sheet **read-override** — `balance_from_feed` leaf accounts return the latest `feed_balances ≤ asOfDate` instead of `opening_balance+Σtx` (pre-coverage dates fall back to additive; parent categories aggregate overridden leaves); idempotent `seed-cr024-fidelity-mappings.js` maps the 5 Fidelity accounts `balance_from_feed=TRUE` keeping `ignored=TRUE` (transactions stay suppressed until Phase 2). Backend-only. Migration 025 applied to prod **before** the code deploy (pg_dump bracket). Verified on prod: Fidelity Bond corrected ~$1.01M→$1.20M, parents roll up, PKO unaffected, 0 transactions leaked, idempotent re-ingest; 178/178 backend tests. Phase 2 (activity-stream cash-flow categorization) still gated on the `Finance → bank-feed` `activity_type` handoff. |
| 2026-06-02 | **Released v2.10.0** — minor; one additive feature on top of v2.9.0, no breaking changes. **CR022 — category suggestions from history ("learn from my selections", Approach A):** new `categorySuggest` service + `POST /api/v2/transactions/category-suggestions` derive a merchant key per description (dedupe bank-feed doubling, strip refs/IBANs/locations, leading tokens) and suggest the category most often assigned to that merchant across accepted history (≥2 samples, >50% majority; null otherwise). A **Suggest categories** button on the Refresh Feeds review queue fills uncategorized rows as *pending* (never auto-accepts); self-improving as rows are accepted. Verified on prod: 18/28 uncategorized bank-feed rows got confident, sensible suggestions (e.g. Uber→Travel-Taxi 98%/57, Green Coffee→Food and Drink 100%/14). Frontend-only UI + one new read-only endpoint; no schema/migration change. **Note:** ships off shared `main`. |
| 2026-06-02 | **Released v2.9.0** — minor; accumulated additive work since v2.8.2, no breaking changes. **CR019 (Quicken import):** the prod cutover is now fully scripted (CR019 §23) and all idempotent with no manual SQL — new `ps-anchor.js` (reconcile non-backfill PS accounts to `closing_balance`, issue #3; skips feed-owned brokerage), `retire-handoff.js` (scripts the formerly-manual Fidelity 635 handoff), `seed-cr019-coa.js` (idempotent COA seeder, G1), `copy-quicken-to-prod.js` (dev→prod staging+mapping copy with name-translation, G2); `quicken-verify.js` PS-anchored balance-invariant + benign-WARN for promoted-0-row batches; PS-anchored calibration + value-only investment promote; **Rollback → Delete** (rolled_back batches now deletable, tx-count guarded). **CR022 (bank-feed parallel import):** Phase F prod parallel run live + Phase G observation; feeds-UI rework (Refresh Feeds page, Bank Feed Setup, per-source accept), Source column in the review queue, 'Transfer to account' cross-account review action, USD `base_amount` via FX for promoted bank-feed rows, reconciliation gate refinements. **Note:** ships both threads' work off shared `main`; no new migration since `024` (already on prod). The CR019 backfill remains dev-only (its prod cutover is a separate scripted run via §23); CR022 stays additive/parallel to PocketSmith. |
| 2026-06-01 | **Cash Flow Periods (renamed) + Balance Sheet Periods (new report).** `/cash-flow-monthly` renamed to `/cash-flow-periods` (page `CashFlowMonthly.jsx` → `CashFlowPeriods.jsx`, "Monthly"/"Month-by-month" wording dropped) and gained a **Period** selector (Month / Quarter / Year); the month-span generator was generalized to emit per-period spans clamped to the selected range. New **Balance Sheet Periods** report at `/balance-sheet-periods` renders the hierarchical balance sheet as of the last day of each Month/Quarter/Year in range, one column per period end — reusing `BalanceReport` (its hard 3-column cap lifted via a new `maxPeriods` prop) and the existing `GET /reports/balance` endpoint, with Balance Trends' future-period/partial-snapshot handling. The period-end series helpers (`buildEndDateSeries`, `planColumns`, `formatColumnHeader`, etc.) were extracted from `BalanceTrends.jsx` into shared `utils/periodHelpers.js` and `BalanceTrends` refactored to import them. **Frontend-only** — no backend, schema, or API changes (both reports consume existing endpoints). Build + lint + 96 Vitest helper tests pass. Note: old `/cash-flow-monthly` bookmarks now 404; nav regenerates from `routes.jsx`. |
| 2026-05-31 | **Version scripts no longer clobber `.env`** — `bump-version.sh` and `deploy-to-production.sh` previously did `cat > .env` (whole-file overwrite with just `VITE_APP_VERSION`), which silently wiped manually-added vars; the v2.8.0 bump destroyed `BANK_FEED_URL` / `BANK_FEED_API_KEY` this way. Both scripts now `sed` the version line **in place**, preserving other vars (see [FC_PROJECT_STRUCTURE.md §13](FC_PROJECT_STRUCTURE.md#13-environment-variables)). Also noted: `.env` is in `.gitignore` but was force-added (still tracked) — `git rm --cached .env` recommended so the secret can never be staged. The actual key value was never committed (verified across all history). |
| 2026-05-31 | **Released v2.8.0** — cuts a prod release of the work accumulated since v2.7.18 (minor: new feature surfaces, all additive). Ships: **CR019** Quicken import pivot to the 1→1 cash-promote model with post-hoc Transfer Analysis matching, auto-match removed from promote, role-aware atomic bulk-create, and mapping-UX polish; **CR021** Phase 7 read-only bank-feed integration spike (proxy + diagnostic page); **CR022** Phase A (`023_bank_feed_import.sql` — `bank_feed_external_id` partial-unique column, `bankfeed_staging` table, R1 `account_source_mappings.ignored`, R2 link target) + Phase B (bank-feed converter, staging repository, cross-source dedup helper + Jest tests). Bank-feed import paths are dormant/additive (no active scheduler or route wired in this release); migration 023 runs on the prod DB. **Note:** released from the `cr022/implementation` branch ahead of the CR022 dev-walkthrough hard gate — a deliberate, owner-approved early prod push of dormant infrastructure. |
| 2026-05-31 | **CR022 R1 + R2 propagated through the full CR** ([CR022](#cr022)). The two requirements added to §2.3 on 2026-05-31 (R1 per-account opt-in via `account_source_mappings.ignored`, unmapped=pending; R2 cross-source dedup linking bank-feed rows onto matching `source='pocketsmith'` rows behind `BANK_FEED_DEDUP_ENABLED`) were flowed into §3 architecture, §4 phased plan, §5 test plan, §6 migration (`ignored` column added to `023`), §7 dev walkthrough (R1 ignore + R2 synthetic-duplicate steps + link-aware rollback), §8 risks (the old "cross-source dedup out of scope" row replaced; false-merge + R1-lockout rows added), and §9 decision log. Doc-only — no code yet. Notable correction: "PS code paths untouched" softened to "one guarded reverse-dedup lookup in `refreshPsApiV2.js`" (R2.2). |
| 2026-05-30 | **CR022 opened — Bank Feed Parallel Import** ([CR022](#cr022)). Additive second import route from CR021's bank-feed service into fin's existing `transactions` table with `source='bank-feed'`, running alongside PocketSmith. One schema migration (`023_bank_feed_import.sql` — adds `bank_feed_external_id VARCHAR(100)` partial-unique on `transactions`, parallel `bankfeed_staging` table, `sync_metadata` seed). Reuses source-agnostic review queue and source-discriminated `account_source_mappings`. PS code paths untouched. Dev walkthrough on `fin-server-dev` with `pg_dump` rollback bracket is a hard gate before prod push. PS removal deferred to a future CR after ≥1-month parallel-run observation. |
| 2026-05-30 | **CR021 Phases 0–3 shipped — bank-feed live with real PKO data.** Upstream landed on **fintable.io via Google Sheets** after a multi-round Phase 0 (banksync.io rejected for no-PKO catalog; moneysheets.io rejected for no-developer-API + single-account/single-currency template limit; GoCardless direct closed new signups; Plaid Production stayed in risk-review). Fintable's Sheet preserves the full GoCardless JSON payload per transaction. New repo at `~/Programs/fin/bank-feed/` (github.com/cfbieder/bank-feed, private): Express + Postgres + `googleapis` service-account auth + hourly scheduler. End-to-end smoke against the live Sheet ingested 7 PKO accounts, 127 transactions, 7 balance snapshots; idempotent on `(account_id, external_id)`. v3 fin cutover remains a future CR022. |
| 2026-05-28 | **CR021 opened — Bank Feed Service** ([CR021](#cr021)). Decision to replace PocketSmith via a standalone microservice exposing a versioned REST contract (`/v1/*`), rather than CR014's in-app dual-provider integration. Upstream investigation revealed banksync.io is a regulated-entity wrap over Plaid, so the practical upstream candidates collapse to Plaid (direct, free Development tier — feasibility TBD for PKO/PSD2 individual access), GoCardless (free EU-friendly tier), or banksync.io (paid, sidesteps regulatory access). Phase 0 (1 day, no code) resolves the upstream choice. CR014 marked SUPERSEDED; CR015 marked OBSOLETE. v3 main-app cutover deferred to a future CR022. |
| 2026-05-20 | **CR016 closed — Frontend test framework (Vitest) complete.** Final state: 96 tests across 5 helper modules in `frontend/src/utils/__tests__/` — `dateHelpers` (21), `formatters` (25), `treeTraversal` (17), `forecastHelpers` (20), `cashFlowHelpers` (13). Infrastructure: `vitest@^2.1.9` + `jsdom@^25` in devDeps; `npm test` / `npm run test:watch` scripts; standalone `vitest.config.js` (jsdom env, mirrors Vite path aliases); exits non-zero on failure. Deterministic via `vi.useFakeTimers()` where time-sensitive; no network, no real DB. Component/hook tests and Playwright E2E deferred to future CRs. |
| 2026-05-19 | **Balance Trends — auto-regenerate on interval change** ([CR018](#cr018)). Switching the Month/Quarter/Year pill now re-runs `handleGenerate` automatically so the column count + headers stay in sync with the selected interval (previously the table kept the prior interval's columns until the user clicked Generate). Year/month dropdowns still require an explicit Generate. |
| 2026-05-19 | **Balance Trends — year range + Interval (Month/Quarter/Year) + future-period filter** ([CR018](#cr018)). `PeriodSelector` extended with an opt-in `enableYearRange` prop that adds a Year (to) dropdown alongside Year (from) in Custom mode (no behavior change for other pages). Interval pill bar (Month default / Quarter / Year) controls column granularity. Columns whose period start is in the future are dropped; the current period is included with snapshot as-of today and its header gains an `(MTD)`/`(QTD)`/`(YTD)` suffix in primary color. Page state renamed (`monthEnds` → `columns: [{label, asOf, isPartial}]`) to model the partial-period case cleanly; `interval` state renamed to `intervalKey` to avoid shadowing the global `setInterval`. |
| 2026-05-19 | **Released v2.7.15** — Balance Trends report at `/balance-trends` (Reports & Graphs > Reports, [CR018](#cr018)). Month-end USD balances across the selected period for one or more BS accounts. Reuses `HierarchyFilter` (BS COA groups, right-click solo-select) + single-period `PeriodSelector` (no Transfers/Unrealized, budget year hidden). Table renders accounts × month-ends with a Total (selected, USD) footer row; Excel export. Reuses `Rest.fetchBalanceReport(asOfDate)` once per month-end (parallel) and flattens each tree to a leaf map. |
| 2026-05-18 | **Released v2.7.14** — HierarchyFilter checklist gains a type-to-narrow search input above the leaf list (only visible when a specific group is active; resets on group change; case-insensitive substring; empty-state message). Affects Budget Worksheet and Transaction pages that consume `HierarchyFilter`. |
| 2026-05-04 | **Forecast scenario copy — faithful field carry-over** — `copyScenario()` was inserting only a subset of source columns: `forecast_modules` missed `setup_status` / `cash_sweep_target` / `tax_rate_override`; `forecast_income_expense` missed `setup_status` / `fc_line_id` / `budget_source_year`; the new-scenario INSERT into `forecast_scenarios` missed `cash_sweep_low` / `cash_sweep_high`. Default `setup_status='new'` was silently filtered out by the generator (`COALESCE(setup_status,'new') NOT IN ('new','exclude')`), producing "Modules: 0, Entries: 0" on every copy. Sweep band loss caused ~109 fewer entries on copied scenarios (no cash sweep / no downstream rebalances). Existing-target branch now also mirrors sweep band from source. |
| 2026-05-04 | **Forecast scenario copy — "Update PY Actual values" path corrected** — when the Copy modal's PY-refresh checkbox was used, the year-end balance SQL summed `t.base_amount` (always USD) into `balance_lc`, then wrote that USD figure into `forecast_modules.base_value` (local currency) and 0 into `base_value_usd` for non-USD accounts. Engine then double-converted, halving the asset base for PLN/EUR modules. Fixed by summing `t.amount WHERE t.currency = a.currency` into `balance_lc`. Also stopped overwriting `market_value` / `market_value_usd` from ledger — those are broker-reported and can't be derived from the transaction stream. |
| 2026-04-28 | **Documentation reorganization** — split into PROJECT_STRUCTURE.md (current state) + NEXT_STEPS.md (plan) + CRs/ folder + Testing/ + Archive/. CR_INDEX.md added. CLAUDE.md cross-references updated. |
| 2026-04-28 | **Categories table collapsed into `accounts`** ([CR013](#cr013), migration 021). FK columns repointed; `categories` and `category_source_mappings` dropped. HTTP smoke test (`smoke-after-021.js`) added — 17 endpoint checks against live server. |
| 2026-04-28 | **Transfer Analysis: FX category fuzzy matching now triggers in production:** The `isFxCategory` predicate in `GET /api/v2/transactions/transfer-analysis` checked `name === 'FX'`, but the production category is named `Transfer - FX` (id 208), so the FX branch (1% amount tolerance, 1-day window) never fired and every FX pair fell into the standard exact-match path. Result: a full screen of unmatched WISE EUR↔USD transfers. Fixed by accepting both names. |
| 2026-04-28 | **AI Review context restructured to prevent flow-vs-balance misreads** — `buildForecastContext()` split into three explicit sections: (1) Annual P&L Flows by Year (with sign convention; `Bank Accounts` clarified as flow not balance), (2) Balance Sheet — Year-End Market Value, (3) Cash Account & Cash Sweep Activity. Sweep entries excluded from P&L Flows. |
| 2026-04-28 | **nginx 301 trailing-slash bug broke + New Review:** `location /api/v2/ai-review/` triggered nginx's directory-canonicalization redirect; browsers convert 301-redirected POSTs to GETs. Fixed via regex location `~ ^/api/v2/ai-review(/|$)`. |
| 2026-04-28 | **AI Review made async with polling + browser notifications** ([CR006](#cr006), migration 020). 202 returned immediately; background worker; 8s polling; browser notification when tab hidden; pulsing red dot for unread. nginx `proxy_read_timeout` raised to 360s. |
| 2026-04-27 | **AI Review migrated from Anthropic API to local `ocr-llm` gateway** ([CR006](#cr006)). Local-only fallback chain `ollama_heavy → ollama_mid`. `LLM_GATEWAY_URL` env var. Anthropic SDK removed. Cross-repo coordinated via `ocr-llm/HANDOFFS.md`. |
| 2026-04-13 | **Ledger date filter fix + duplicate detection** — backend now accepts `fromDate`/`toDate` (was silently ignoring); duplicate-finder client-side analysis (same amount+currency within 3 days, or identical descriptions). |
| 2026-04-04 | **Graph Quick Adjustments (FC Exp + FC Module)** — double-clicking a forecast graph point opens an inline adjustment modal. FC Exp modal edits periodic changes (Fixed/Percent/One-Off); FC Module modal edits Invest/Dispose transfers. Save & Regenerate refreshes graph. |
| 2026-04-04 | **Income-Sweep Convergence** ([CR005](#cr005)) — Step 7b iterative loop in `index.js` converges yield income with sweep-adjusted MV. Mirrors Excel Goal Seek for the income↔sweep circular dependency. |
| 2026-04-03 | **Global DATE timezone fix** — root-cause fix in `postgres.js` (`types.setTypeParser(1082, val => val)`) plus frontend uses local-time `getFullYear()`/`getMonth()`/`getDate()` instead of `.toISOString().split("T")[0]`. Affected pages: Budget Realization drilldown, Budget Worksheet popups, Balance pages, date helpers. |
| 2026-04-02 | **AI Review API key security fix** — moved Anthropic key from `appdata.json` to `ANTHROPIC_API_KEY` env var (later replaced entirely by `LLM_GATEWAY_URL`). |
| 2026-04-02 | **AI Review UX fixes** — context moved into first user message, per-review delete buttons, drawer z-index above nav. |
| 2026-04-02 | **FC Review enhancements** — account double-click graph; graph base year fix via shared `resolveCashValue()` / `resolveBalanceValue()` helpers. |
| 2026-03-29 | **Ledger category filter + amount total** — category dropdown populated client-side; total Amount in table footer for filtered rows. |
| 2026-03-28 | **Budget Worksheet filters → HierarchyFilter** ([CR008](#cr008)) — pill-style filters with leaf counts; CategorySelector retained only for right-click quick-pick. |
| 2026-03-28 | **FC Module Phase 2B-5 Engine Update** ([CR003](#cr003)) — engine resolves FC Lines; `expense_growth_method` (`inflation` vs `pct_of_value`); 6 new tests. |
| 2026-03-28 | **FC Module Phase 2B-4b Add from Actuals** — replaces "Seed from Actuals"; tree view with leaf pre-selection and parent aggregation. |
| 2026-03-28 | **FC Module Phase 2B-4 Forecast Expenses Integration** — "Add from FC Lines" replaces "Seed Budget" + "Coverage". |
| 2026-03-28 | **Unmatched modules endpoint fix** — exclude children of matched parent accounts. |
| 2026-03-27 | **Manual Match Groups** ([CR009](#cr009), migration 005) — persistent many-to-one transfer matching. |
| 2026-03-27 | **`transfer_matched` flag + Actuals Transfer Status filter** ([CR009](#cr009), migration 006). |
| 2026-03-27 | **HierarchyFilter component** ([CR008](#cr008)) — two-stage cascading filter for transaction pages. |
| 2026-03-27 | **Day-level date editing in transaction edit modals** — `TransactionDateSelector` now includes Day with leap-year-aware clamping. |
| 2026-03-26 | **Balance Sheet page redesign** — KPI cards, inline period controls, expand/collapse icon buttons, Net Worth footer. |
| 2026-03-26 | **Budget Worksheet page redesign** — two-panel side-by-side layout, KPI cards, right-click category quick-pick. |
| 2026-03-26 | **COA Management page redesign + Move feature** ([CR010](#cr010)). |
| 2026-03-26 | **Transaction pages redesign** ([CR008](#cr008)) — `/trans-actual` and `/trans-budget` with KPI cards, slide-in drawers, contextual selection bar. |
| 2026-03-16 | **Trans-Actual filter & account selector fixes** + leaf-only account filtering (`leafOnly` param on `GET /api/v2/accounts`). |
| 2026-03-15 | **Per-row action buttons in TransactionTable** — Split/Neutralize/Change Category moved from top-bar to per-row. |
| 2026-03-15 | **Category Trend graph** at `/category-trend` (Reports & Graphs > Graphs) — actual vs budget grouped bar chart. |
| 2026-03-14 | **Neutralize Transaction for brokerage accounts** — one-click offset entry tagged "Transfer - Securities Trades". |
| 2026-03-13 | **Forecast FX moved to Forecasting category & income/expense FX fix** in `fcbuilder-incexp.js`. |
| 2026-03-13 | **Monthly Budget FX Rates** at `/budget-fx` (migration 004). |
| 2026-03-13 | **Docker cleanup in backup cron** — prunes build cache + dangling images > 48h. |
| 2026-03-11 | **KPI Summary Cards** — `KpiCards.jsx` with Recharts mini-charts on Budget Realization and Forecast Review. |
| 2026-03-11 | **Export to Excel** — SheetJS-based exports on Balance Sheet, Cash Flow, Budget Realization, Actual + Budget Transactions. |
| 2026-03-11 | **Liability expense percent fix** in `fcbuilder-module.js`. |
| 2026-03-03 | **Quick Add for missing categories** in COA Management. |
| 2026-02-28 | **Split Transaction feature** on `/refresh-ps` and `/trans-actual`. |
| 2026-02-21 | **Full responsive/mobile-friendly UI** — `@media` breakpoints across 14 CSS files; `backdrop-filter` fix for slide-out drawer. |
| 2026-02-17 | **Clear Filters button** on `/trans-actual` and `/trans-budget`. |
| 2026-02-17 | **Transaction edit modal improvements** — restricted to Description + Category on `/trans-actual`; hierarchical CategorySelector. |
| 2026-02-17 | **Transaction acceptance** (migration 003) — `accepted` flag protects manual edits from PS refresh overwrite. |
| 2026-02-16 | **Balance Sheet UI improvements** — Net Worth footer, P1/P2/P3 pill badges, single-row filter bar. |
| 2026-02-16 | **Transaction table column optimization** — `noWrap` on date/amount columns; description ellipsis. |
| 2026-02-16 | **Route reorganization** — `/refresh-ps` moved from Database to Transactions category. |
| 2026-02-16 | **Transaction pages filter bar redesign** — shared `PeriodSelector`/`CategorySelector`/`AccountSelector`. |
| 2026-02-16 | **RefreshPS page enhancements** — Review & Edit New tab; integrated CategorySelector in TransactionEditModal. |
| 2026-02-16 | **Budget Worksheet UI overhaul** — three reusable shared selectors created. |
| 2026-02-15 | **Budget Variances page** at `/budget-variances`. |
| 2026-02-15 | **Frontend refactoring** ([CR002](#cr002)) — unified Transaction module, hook extraction, ~2,200 net LOC reduction. |
| 2026-02-14 | **V1 compat removal** + endpoint fixes + V1 retirement + COA migration to SQL + timezone fix + data fixes ([CR001](#cr001)). |
| 2026-02-13 | Version bumped to v2.0.6. Documentation updates. |
| 2026-02-08 | Decommissioned dev machine; VM is sole environment. Database restored to VM via `pg_dump`/`pg_restore`. Server Dockerfile fixed (`postgresql-client-16`). VM recreated after loss; provisioning scripts added. |
| 2026-02-07 | Migrated from dev machine to KVM VM at `192.168.1.82`. |
| Earlier | Migrated from MongoDB to PostgreSQL 16 ([CR001](#cr001)). |
| Earlier | UI overhaul: Lucide icons, shared layout, category landing pages. |

---

*Last updated: 2026-06-01*
