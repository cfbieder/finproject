# CR Index

Status legend: **COMPLETED** · **IN-PROGRESS** · **OPEN** · **PLANNED** (scoped, not yet started) · **SUPERSEDED** / **OBSOLETE** (replaced or no longer relevant)

Each CR file's first line carries its status and links back to the matching anchor in [NEXT_STEPS.md](../FC_NEXT_STEPS.md). New CRs get the next available number. **This index is a one-line roll-up — the CR file is the spec; keep descriptions to a single line.**

**Version track:** **v4** = the unreleased multi-tenancy line — **CR027** + sub-CRs **CR027A–E** (flag-gated/dormant on `main`; see [DEV_WORKFLOW.md](../DEV_WORKFLOW.md)). Everything else is v3 / current.

## Summary by status

*Manual roll-up — update when a CR's status changes (alongside its row + CR-file header).*

| Status | Count | CRs |
|--------|------:|-----|
| COMPLETED | 25 | CR001–CR013, CR016, CR017, CR018, CR024, CR025, CR026, CR028, CR030, CR031, CR032, CR033, CR034 |
| IN-PROGRESS | 3 | CR019, CR022, CR023 |
| OPEN | 2 | CR020, CR021 |
| PLANNED | 2 | CR027 *(v4, umbrella)*, CR029 |
| SUPERSEDED | 1 | CR014 |
| OBSOLETE | 1 | CR015 |
| **Total** | **33** | |

## All CRs

| # | Status | Track | Title | One-line description |
|---|--------|-------|-------|----------------------|
| [CR001](CR001_MIGRATION_MONGO_TO_POSTGRES.md) | COMPLETED | v3 | MongoDB → PostgreSQL Migration | Moved all storage to PostgreSQL 16; V1 routes and `coa.json` removed. |
| [CR002](CR002_FRONTEND_REFACTOR.md) | COMPLETED | v3 | Frontend Architecture Refactor | God components decomposed; `features/` module pattern; ~22 duplicate transaction files deleted. |
| [CR003](CR003_FORECAST_MODULE.md) | COMPLETED | v3 | Forecast Module | Engine + UI for BS modules and inc/exp items across all phases. |
| [CR004](CR004_FC_LINES_MAPPING.md) | COMPLETED | v3 | FC Inc/Exp Mapping Layer | FC Lines decouple budget categories from forecast outputs (migration 007). |
| [CR005](CR005_CASH_SWEEP.md) | COMPLETED | v3 | Cash Sweep & Auto-Balance | Iterative sweep with income↔sweep convergence loop (migrations 012–013). |
| [CR006](CR006_AI_REVIEW.md) | COMPLETED | v3 | AI Review of FC Plan | Conversational review via local `ocr-llm` gateway; async + notifications (migrations 014, 020). |
| [CR007](CR007_PWA_MOBILE_SHELL.md) | COMPLETED | v3 | PWA & Mobile Simplified Shell | Installable PWA + dedicated `/m/*` mobile experience. |
| [CR008](CR008_HIERARCHY_FILTER.md) | COMPLETED | v3 | HierarchyFilter & Transaction Pages Redesign | Two-stage cascading filter; `/trans-actual` + `/trans-budget` redesign. |
| [CR009](CR009_TRANSFER_ANALYSIS.md) | COMPLETED | v3 | Transfer Analysis + Manual Match Groups | Auto + manual transfer matching; `transfer_matched` flag (migrations 005–006). |
| [CR010](CR010_COA_MANAGEMENT.md) | COMPLETED | v3 | COA Management Redesign + Move | Tree view editor with toolbar, inline actions, quick-add, Move modal. |
| [CR011](CR011_SOURCE_MAPPINGS.md) | COMPLETED | v3 | Source Mappings (Category + Account) | Decouples external system names from internal names (migrations 018–019). |
| [CR012](CR012_OPENING_BALANCE_CALIBRATION.md) | COMPLETED | v3 | Opening Balance Calibration | Balance sheet via `opening_balance + SUM(transactions)` (migration 016). |
| [CR013](CR013_COLLAPSE_CATEGORIES.md) | COMPLETED | v3 | Collapse `categories` into `accounts` | Single COA source of truth; FKs repointed; legacy table dropped (migration 021). |
| [CR014](CR014_POCKETSMITH_REPLACEMENT.md) | SUPERSEDED | v3 | PocketSmith Replacement | In-app dual-provider plan; superseded by CR021 (microservice). |
| [CR015](CR015_PS_REEXPORT.md) | OBSOLETE | v3 | Re-export Changes Back to PocketSmith | Obsoleted by CR021 (PS removed entirely). |
| [CR016](CR016_FRONTEND_TEST_FRAMEWORK.md) | COMPLETED | v3 | Frontend Test Framework (Vitest) | 96 unit tests across 5 helper modules. |
| [CR017](CR017_CASH_SWEEP_PHASE_C.md) | COMPLETED | v3 | Cash Sweep Phase C — Multi-Module Priority | Priority-ordered sweep set with backup cascade (migration 031; v3.0.25). |
| [CR018](CR018_BALANCE_TRENDS.md) | COMPLETED | v3 | Balance Trends Report | Period-end USD balances for selected BS accounts over a chosen range. |
| [CR019](CR019_QUICKEN_IMPORT.md) | IN-PROGRESS | v3 | Quicken Historical Import | One-time pre-2022 backfill (cash done; investment value-only); prod cutover via per-account live loop; owns the schema CR020 needs. |
| [CR020](CR020_STOCK_INVESTMENT_MODULE.md) | OPEN | v3 | Stock Investment Module | Lot-level holdings + portfolio analytics on the CR019 schema (planning skeleton). |
| [CR021](CR021_BANK_FEED_SERVICE.md) | OPEN | v3 | Bank Feed Service | Standalone microservice (fintable.io/Sheets upstream) behind a versioned `/v1/*` contract; 2 consumers. |
| [CR022](CR022_BANK_FEED_PARALLEL_IMPORT.md) | IN-PROGRESS | v3 | Bank Feed Parallel Import | Second import route (`source='bank-feed'`) alongside PS; Phases A–F done, Phase G observation (migrations 023–024). |
| [CR023](CR023_POCKETSMITH_REMOVAL.md) | IN-PROGRESS | v3 | PocketSmith Removal & PS→Feeds Cutover | Reusable cutover engine (PS-side cutoff, source-aware reconcile, feed signs); 28 fed / 2 manual; 13-account tail + deferred PS removal (migrations 028–029). |
| [CR024](CR024_FIDELITY_FEEDS.md) | COMPLETED | v3 | Fidelity Feeds | Market-value balance read-override + categorized investment-activity import (migrations 025–027). |
| [CR025](CR025_MANUAL_TRANSACTION_ENTRY.md) | COMPLETED | v3 | Manual Transaction Entry | `/manual-entry` rapid hand entry (`source='manual'`, accepted) (v3.0.4). |
| [CR026](CR026_UI_REVAMP.md) | COMPLETED | v3 | UI Revamp — Sidebar, Dark, ⌘K, Mobile, Help | Sidebar + dark mode + command palette + help + mobile read pages; ON in prod since v3.0.0. |
| [CR027](CR027_MULTI_TENANCY_FINAL_RELEASE.md) | PLANNED (umbrella) | **v4** | Multi-Tenancy & Final-Release Readiness `[v4]` | Schema-per-tenant multi-user SaaS conversion; split into CR027A–E; needs a migration runner first. |
| [CR028](CR028_SECURITIES_TRADE_NEUTRALIZATION.md) | COMPLETED | v3 | Securities-Trade Neutralization & Orphan Management | Pair-or-mirror neutralize with dry-run warning; orphan Remove/Neutralize on Transfer Analysis (v3.0.1). |
| [CR029](CR029_FINTABLE_SHEET_PRUNING.md) | PLANNED | v3 | Fintable Sheet Pruning | Guarded bank-feed admin prune of old Sheet rows (Postgres is the archive). |
| [CR030](CR030_AUTOMATED_PS_RETIREMENT.md) | COMPLETED | v3 | Retire automated PocketSmith | PS-API integration + legacy calibration removed; one-time CSV upload kept (v3.0.11). |
| [CR031](CR031_LEDGER_FILTER_PARITY_YEAR_RANGE.md) | COMPLETED | v3 | Ledger Filter Parity + Year-Range | Ledger adopts HierarchyFilter/PeriodSelector; multi-year Custom ranges (v3.0.12). |
| [CR032](CR032_CORE_CASH_SWEEP_NEUTRALIZATION.md) | COMPLETED | v3 | Fidelity Core-Cash Sweep Auto-Neutralization | Promote auto-mirrors core sweeps so they self-net; neutralize mis-pair guard (v3.0.27). |
| [CR033](CR033_MANUAL_CALIBRATION.md) | COMPLETED | v3 | Manual Calibration (non-fed accounts) | Computed vs user-typed balance with calibrate/MTM per BS leaf (migration 032; v3.0.29–33). |
| [CR034](CR034_SECURITY_HARDENING_CI.md) | COMPLETED | v3 | Security Hardening & CI Baseline | Secrets untracked + DB password rotated, compose/ports/CORS/pg_dump hardened, fresh-install migration fix, GitHub Actions CI + secret-scan gate, docs restructure (2026-06-12). |
