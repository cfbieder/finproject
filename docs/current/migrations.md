# Database Migrations Registry

One line per migration, in apply order. The SQL files in
[`server/db/migrations/`](../../server/db/migrations/) are the source of truth —
keep this list in sync when adding a migration (CI applies the whole chain to
a fresh database, so a migration that only works on a data-bearing DB will
fail there).

**How migrations run today:** a real runner exists (CR043 Phase 1.1, pulled
forward from CR027A) — `server/db/migrate.js`, `npm run migrate` (dry-run:
`npm run migrate:dry`). It records applied files in a `schema_migrations`
ledger (filename + md5 checksum + baselined flag) and applies only the gap,
each file in its own transaction; it warns on checksum drift (an applied file
edited afterward — the class that bit CI in 4931b2a). On its **first** run
against an already-populated DB it *auto-baselines*: records every current
migration as applied without executing it (also correct for a fresh volume,
where initdb.d has already run them). `deploy-to-production.sh` runs it as
Step 2b (after backup, before rebuild), so prod adopts the ledger on the next
deploy. Dev adopted it 2026-07-11 (36 baselined). Postgres
`docker-entrypoint-initdb.d` still auto-applies `*.sql` on a fresh empty
volume; the runner and initdb.d coexist (the runner baselines whatever initdb
already ran). Wiring the runner into container **start** is a possible
follow-up; not done (deploy-time application is the v3-safe payoff).

**CI baseline:** [`server/db/ci-seed.sql`](../../server/db/ci-seed.sql) (not a
migration) seeds the few COA rows engines reference by hardcoded id/name
(`accounts.id=88` Unrealized G/L; `Transfer - Securities Trades`;
`Financial Income - Dividend`; `Option Trade`) so the test suite runs on a
fresh DB.

| # | File | What it does | CR |
|---|------|--------------|----|
| 001 | `001_initial_schema.sql` | Core schema: accounts, transactions, budget, forecast scenarios/modules, exchange rates | — |
| 002 | `002_psdata_staging.sql` | PocketSmith staging table | — |
| 003 | `003_accepted_field.sql` | `transactions.accepted` review flag | — |
| 004 | `004_budget_fx_rates.sql` | `budget_fx_rates` (monthly budget FX per currency/year) | — |
| 005 | `005_transfer_match_groups.sql` | Manual transfer match groups | — |
| 006 | `006_transfer_matched_flag.sql` | `transactions.transfer_matched` flag | — |
| 007 | `007_fc_lines.sql` | `fc_lines` + `fc_line_categories` + module FK columns (forecast mapping layer) | FC |
| 008 | `008_drop_old_fc_columns.sql` | Drops `expense_category`/`income_category`/`expense_pct` (replaced by FC Lines) | FC |
| 009 | `009_target_cash.sql` | `target_cash` on scenarios (cash auto-balance) | FC |
| 010 | `010_tax_rate_override.sql` | Per-module `tax_rate_override` | FC |
| 011 | `011_setup_status.sql` | `setup_status` on modules (income_expense was altered ad hoc, never in this file — backfilled by 036) | FC |
| 012 | `012_cash_sweep_target.sql` | Single `cash_sweep_target` flag per scenario | CR005 |
| 013 | `013_cash_sweep_band.sql` | `cash_sweep_low/high` band replacing `target_cash` | CR005 |
| 014 | `014_ai_reviews.sql` | `ai_reviews` conversation storage | FC |
| 015 | `015_disposal_date_end.sql` | Optional end date for periodic disposals | FC |
| 016 | `016_opening_balance.sql` | `opening_balance` calibration columns on accounts | — |
| 017 | `017_investment_date_end.sql` | Optional end date for periodic investments (mirrors 015) | FC |
| 018 | `018_category_source_mappings.sql` | `category_source_mappings` (external↔internal category names) | — |
| 019 | `019_account_source_mappings.sql` | `account_source_mappings` (external↔internal account names) | — |
| 020 | `020_ai_review_async.sql` | Async status tracking on AI reviews (poll via `GET /:reviewId/status`) | FC |
| 021 | `021_collapse_categories_into_accounts.sql` | Collapses `categories` into `accounts` (P&L leaves carry `is_transfer`/`ps_category_id`; FKs repointed; `categories` + `category_source_mappings` dropped) | — |
| 022 | `022_quicken_import.sql` | Quicken import scaffolding: 12 tables (4 staging, 6 investment, batches, audit), `security_tx_type` enum, `import_batch_id`, `skip_transfer_analysis`, sentinel `opening_balance_date` → 1990-01-01, 4 COA leaves; creates the `Transfers` root on a fresh DB | CR019 |
| 023 | `023_bank_feed_import.sql` | Bank-feed parallel import: `bank_feed_external_id`, `bankfeed_staging`, `sync_metadata`, `account_source_mappings.ignored` | CR022 |
| 024 | `024_bank_feed_ignore_unmapped.sql` | Drop NOT NULL on `account_source_mappings.account_id` (ignore-without-mapping) | CR022 |
| 025 | `025_fidelity_feeds.sql` | `bankfeed_balances` cache + `balance_from_feed`/`trade_treatment` mapping flags | CR024 |
| 026 | `026_fidelity_activity.sql` | `bankfeed_staging.activity_type`/`.suppressed` (SnapTrade activity routing) | CR024 |
| 027 | `027_promote_from_date.sql` | Per-mapping promote cutoff date (cutover gate) | CR024 |
| 028 | `028_reconcile_mode.sql` | `reconcile_mode` (`calibrate` \| `mtm`) per mapping (source-aware reconciliation) | CR023 |
| 029 | `029_feed_balance_sign.sql` | `feed_sign` per-mapping balance-sign override (Plaid negative-liability cards) | CR023 |
| 030 | `030_feed_negate_tx.sql` | `feed_negate_tx` per-mapping transaction-sign flip (e.g. Chase purchases-positive) | CR028 |
| 031 | `031_cash_sweep_priority.sql` | `cash_sweep_priority` ordered sweep set (backfills `cash_sweep_target` → priority 1) | CR017 |
| 032 | `032_manual_calibration.sql` | `manual_balances` table + `accounts.manual_reconcile_mode` (non-fed calibration) | CR033 |
| 033 | `033_feed_source_synced_at.sql` | `bankfeed_balances.source_synced_at` — true upstream connection sync time | CR035 |
| 034 | `034_forecast_assumptions.sql` | Drops the never-used 001-era `forecast_assumptions` and recreates it as the CR039 document store (key/JSON value/ord) replacing `FCAssump.json`; **after applying, run `node server/src/v2/scripts/import-fc-assumptions.js`** | CR039 |
| 035 | `035_ai_review_compare.sql` | Adds nullable `fc_ai_reviews.compare_scenario_id` (FK → forecast_scenarios, CASCADE) + index so Compare-page AI conversations persist their scenario pair; NULL = plain single-scenario review | CR040 |
| 036 | `036_incexp_setup_status.sql` | Backfills schema drift: `forecast_income_expense.setup_status` (existed on dev/prod since the 2026-04 AI review work but never in a migration; broke CI's fresh-from-migrations DB once aiReviewCompare tests exercised the query). No-op where the column already exists | — |
