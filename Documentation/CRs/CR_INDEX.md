# CR Index

Status legend: **COMPLETED** · **IN-PROGRESS** · **OPEN**

Each CR file's first line carries its status and links back to the matching anchor in [NEXT_STEPS.md](../FC_NEXT_STEPS.md). New CRs get the next available number.

| # | Status | Title | One-line description |
|---|--------|-------|----------------------|
| [CR001](CR001_MIGRATION_MONGO_TO_POSTGRES.md) | COMPLETED | MongoDB → PostgreSQL Migration | Moved all storage to PostgreSQL 16; V1 routes and `coa.json` removed. |
| [CR002](CR002_FRONTEND_REFACTOR.md) | COMPLETED | Frontend Architecture Refactor | God components decomposed; `features/` module pattern; ~22 duplicate transaction files deleted. |
| [CR003](CR003_FORECAST_MODULE.md) | COMPLETED | Forecast Module | Engine + UI for BS modules and inc/exp items across all phases (1, 2A, 2B, 3, 4, 5). |
| [CR004](CR004_FC_LINES_MAPPING.md) | COMPLETED | FC Inc/Exp Mapping Layer | User-defined FC Lines decouple budget categories from forecast outputs (Phase 2B, migration 007). |
| [CR005](CR005_CASH_SWEEP.md) | COMPLETED | Cash Sweep & Auto-Balance | Iterative sweep into a designated module with income↔sweep convergence loop (migrations 012–013). |
| [CR006](CR006_AI_REVIEW.md) | COMPLETED | AI Review of FC Plan | Conversational review via local `ocr-llm` gateway; async with polling + browser notifications (migrations 014, 020). |
| [CR007](CR007_PWA_MOBILE_SHELL.md) | COMPLETED | PWA & Mobile Simplified Shell | Installable PWA + dedicated `/m/*` mobile experience with bottom tab bar and 5 mobile pages. |
| [CR008](CR008_HIERARCHY_FILTER.md) | COMPLETED | HierarchyFilter & Transaction Pages Redesign | Two-stage cascading filter; full redesign of `/trans-actual` and `/trans-budget`. |
| [CR009](CR009_TRANSFER_ANALYSIS.md) | COMPLETED | Transfer Analysis + Manual Match Groups | Auto + manual matching of transfer pairs; `transfer_matched` flag (migrations 005–006). |
| [CR010](CR010_COA_MANAGEMENT.md) | COMPLETED | COA Management Redesign + Move | Tree view editor with toolbar, inline actions, quick-add, and Move modal. |
| [CR011](CR011_SOURCE_MAPPINGS.md) | COMPLETED | Source Mappings (Category + Account) | Decouples external system names from internal app names (migrations 018–019). |
| [CR012](CR012_OPENING_BALANCE_CALIBRATION.md) | COMPLETED | Opening Balance Calibration | Accurate balance sheet via `opening_balance + SUM(transactions)` (migration 016). |
| [CR013](CR013_COLLAPSE_CATEGORIES.md) | COMPLETED | Collapse `categories` Table into `accounts` | Single COA source of truth; FK columns repointed; legacy table dropped (migration 021). |
| [CR014](CR014_POCKETSMITH_REPLACEMENT.md) | SUPERSEDED | PocketSmith Replacement | Dual-provider in-app integration plan; superseded by [CR021](CR021_BANK_FEED_SERVICE.md) (microservice approach). |
| [CR015](CR015_PS_REEXPORT.md) | OBSOLETE | Re-export Changes Back to PocketSmith | One-way push to PS; obsoleted by [CR021](CR021_BANK_FEED_SERVICE.md) (PS removed entirely). |
| [CR016](CR016_FRONTEND_TEST_FRAMEWORK.md) | COMPLETED | Frontend Test Framework (Vitest) | Vitest + 96 unit tests across 5 helper modules; closes the largest backend/frontend test gap. |
| [CR017](CR017_CASH_SWEEP_PHASE_C.md) | OPEN | Cash Sweep Phase C — Multi-Module Priority | Withdraw from multiple modules in priority order on shortfall. |
| [CR018](CR018_BALANCE_TRENDS.md) | COMPLETED | Balance Trends Report | `/balance-trends` shows month-end USD balances for selected BS accounts over a chosen period; reuses `HierarchyFilter` + `PeriodSelector`. |
| [CR019](CR019_QUICKEN_IMPORT.md) | IN-PROGRESS | Quicken Historical Import | One-time backfill of pre-2022 Quicken history (cash + lot-level investments). Owns the investment schema CR020 depends on. Phase A migration applied to dev 2026-05-22. |
| [CR020](CR020_STOCK_INVESTMENT_MODULE.md) | OPEN | Stock Investment Module | Lot-level holdings tracking + portfolio analytics; supplements (doesn't replace) cash ledger. Depends on CR019 (Quicken Import) shipping first with shared schema. Planning skeleton. |
| [CR021](CR021_BANK_FEED_SERVICE.md) | OPEN | Bank Feed Service | Standalone microservice for Plaid/banksync.io + Excel ingestion behind a versioned REST contract; sets up the v3 PocketSmith cutover. Supersedes CR014. |
| [CR022](CR022_BANK_FEED_PARALLEL_IMPORT.md) | IN-PROGRESS | Bank Feed Parallel Import | Additive second import route into fin's `transactions` table with `source='bank-feed'`, running alongside PocketSmith. One migration (`023_bank_feed_import.sql`), new staging table, dev walkthrough gate, automated tests. Phase A (migration 023) + Phase B (converter/staging/dedup + tests) shipped in v2.8.0 (2026-05-31). Includes **R1** per-account opt-in (`account_source_mappings.ignored`, unmapped=pending) and **R2** cross-source dedup (link bank-feed↔PS rows, `BANK_FEED_DEDUP_ENABLED`). PS removal deferred to a future CR. |
