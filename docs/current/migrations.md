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
| 037 | `037_module_income_expense_window.sql` | **CR046** — four nullable DATE columns on `forecast_modules`: `income_start_date` / `income_end_date` / `expense_start_date` / `expense_end_date`. Bound **when** a module's amount-based income/expense stream runs; the amount stays a base-year figure compounded at inflation. NULL = unbounded = the old behavior, so every existing scenario is byte-identical. Applied dev + prod 2026-07-12 (v3.0.81). |
| 038 | `038_module_income_tax_override.sql` | **CR047** — `forecast_modules.income_tax_rate_override` (nullable): tax rate applied to a module's **income only**; realized capital gains keep `tax_rate_override` / the scenario rate. For income received already taxed abroad (United Beverages' dividend is net of Polish tax; the incremental US tax is ~3%) while a future sale is still an ordinary gain. NULL = falls back = no change. Applied dev + prod 2026-07-12 (v3.0.84). |
| 039 | `039_scenario_variants.sql` | **CR050** — scenario **variants** (inherit-unless-overridden): `forecast_scenarios.parent_scenario_id` (RESTRICT — a base with variants cannot be deleted) + `synced_at`; `origin_base_id` on `forecast_modules` / `forecast_income_expense` (the base row a variant row was materialized from; NULL = variant-local) + partial unique indexes; and `forecast_scenario_overrides` — one **JSONB patch per overridden base row**, keyed to the base row's **id** (field-level: `NULL` is already load-bearing in these columns, so "NULL = inherit" was never available). A trigger rejects a variant of a variant. All nullable/empty ⇒ **a scenario with no parent behaves exactly as it does today**; no backfill. Applied dev + prod 2026-07-14 (v3.0.108). |
| 040 | `040_fix_container_account_types.sql` | **Data fix (v3.4.6)** — corrects five accounts whose `account_type` sat on the wrong side of their (correct) `section`, surfaced by the COA Type filter: `Income` container `expense→income`; `Liabilities` / `Tax Liabilities` / `Tax Reserve - PL` / `Tax Reserve - US` `asset→liability`. Guarded by name + current type + section ⇒ idempotent, touches only the five known rows. **Report-neutral** (Balance Sheet is `section`/tree-driven; the sole forecast `account_type` branch gates `ExpensePct`, hardcoded 0; Budget/Tx use it only in `GROUP BY`). Legacy data only — the current `seedAccounts.js` already types these correctly, so no seed change. Applied dev 2026-07-23; prod via deploy runner. |
| 041 | `041_income_restatements.sql` | **CR057** — two objects for **Book Income at Source**. (1) `income_restatements` — the undo record for a three-leg restatement: `source_transaction_id` **UNIQUE** (makes the "already booked" 409 structural, not a skippable lookup), `holding_account_id`, `original_category_id`, the two created leg ids, and a `leg_snapshot` JSONB of both legs as written — undo compares field-by-field and **REFUSES** on divergence, because deleting a leg someone has since edited would move the holding's book value and silently invalidate every later `Unrealized G/L` mark (each was written as `target − book`). A dedicated table rather than reusing `transfer_match_groups`, whose user-facing **Unlink** button would delete the audit trail, whose `create()` cannot join an outer transaction, and whose membership *excludes* rows from auto-matching — it would have prevented the very match it recorded. (2) The `Transfer - Distributions` COA row under `Transfers` (200), `is_transfer = TRUE`, `skip_transfer_analysis = FALSE` — created **here**, not in `seed-cr019-coa.js` (a manual admin CLI, not a seed path): via the generic COA create path `is_transfer` DEFAULTs FALSE, which fails **silently and identically to the bug being fixed** (leg 2 would bucket as income, income would net to zero, the report would still read 0.00%, and the identity would still close because `fxEffect` is a plug). A `DO` block re-asserts the flags and raises if wrong. Both statements name-guarded ⇒ idempotent. Applied dev 2026-07-27; prod before the v3.6.0 deploy. |
| 042 | `042_valuation_anchors.sql` | **CR058** — the `Valuation - Historical` COA leaf under `Transfers` (`is_transfer=TRUE`, `skip_transfer_analysis=TRUE`) that Quicken-era valuation anchors post to, plus `quicken_import_batches.calibration_mode` (`TEXT NOT NULL DEFAULT 'ps-anchored'`, CHECK in `('ps-anchored','preserve-today')`). The leaf is **not** `Unrealized G/L`: each anchor mixes real market movement with liquidation timing, money-market sweep churn and gaps in Quicken's own share history, so routing them to CR056's unrealized numerator would manufacture a confident, wrong pre-2020 return series (CR058 §3.3). `skip_transfer_analysis` matters — an anchor has no counterparty and would otherwise sit in /transfer-analysis forever as unmatched. The parent is resolved **by name**, never a hard-coded id: that is exactly what broke 041 on CI's migrations-only database. The new column defaults every existing batch to `ps-anchored`, so nothing already promoted changes behaviour. Idempotent (name-guarded insert, `ADD COLUMN IF NOT EXISTS`, constraint added only if absent) and verified on a fresh `postgres:16-alpine` — all 42 migrations + `ci-seed.sql` apply cleanly. Applied dev 2026-07-28; **prod 2026-07-28** (rode along with the v3.6.6 deploy, ahead of the data rollout that references the leaf — verified in place as id 229 with both flags true before anchors were written). |
| 043 | `043_pin_bank_feed_promote_cutoffs.sql` | **Data fix (CR059 follow-up)** — pins the two *live* bank-feed mappings that still had `promote_from_date IS NULL`. A NULL cutoff means "promote every staged row whatever its date", which is the mechanism behind the 2026-07-14 **Black Card** incident (mapping an account back-filled its whole staged history over a period a manual upload already covered: 31 duplicates, $8.4K gross, **net only +$267**, so no balance check could see it). Each is pinned to the **earliest row already staged** for it (`531` Revolut-USD → 2026-07-26; `530` Revolut-PLN → 2026-07-30, nothing staged), so **current behavior is unchanged** — everything staged still promotes — while a row arriving *later* dated before that point is blocked. The three ignore-only rows (`366`, `369`, `440`, `account_id IS NULL`) stay NULL deliberately: nothing promotes for them and a pin set now would be stale by the time they are mapped. A `DO` block re-counts and **raises** if any mapped bank-feed row still lacks a cutoff, so a half-applied fix rolls back. Idempotent (`WHERE promote_from_date IS NULL`; re-run gives `UPDATE 0`). **Not claimed:** this does not close the Black Card class — see the CR059 §17 R5 note. Applied dev + **prod 2026-07-30**. |
| 045 | `045_retire_2000_sentinel.sql` | **Sentinel root fix (data half)** — finishes what **022** started. Every balance reads `opening_balance + SUM(amount) WHERE transaction_date >= opening_balance_date`, so that date is a **floor** and rows below it are invisible to every report. 022 moved all accounts off the `2000-01-01` sentinel and set the column DEFAULT to `1990-01-01` — but `accounts.create()` hard-coded `'2000-01-01'`, so every account created since **re-introduced the sentinel 022 removed** (11 by 2026-07-30; the code path is fixed in the same commit). Only one currently hid anything — **Chase Checking**, a 1999-12-31 row worth **1,950.61** invisible to every read — but the other ten were latent traps for any pre-2000 row added later. Lowers the floor to `1990-01-01` and reduces `opening_balance` by exactly what that makes visible, so **today's balance is preserved on every account** (same preserve-today reasoning as CR058: the current balance is feed-owned and already right, so the correction belongs in the plug). Snapshots each balance into a temp table BEFORE the change and **raises** if any moved by more than a cent, rather than re-deriving the same arithmetic and proving nothing. Applied dev + prod 2026-07-30; 11 accounts retired, 0 balances moved, 0 rows hidden anywhere afterwards, and both anchored Fidelity accounts still tie. *(044 is reserved by CR059 P3a.)* |
