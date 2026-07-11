**Status:** COMPLETED — [Plan](../current/project-roadmap.md#cr013)

# CR013 — Collapse `categories` Table into `accounts`

Eliminated the parallel `categories` table to make the COA the single source of truth. Fixes drift bugs where COA renames did not propagate to category dropdowns and where new COA entries (e.g. "Transfer - Business") were missing from category-sourced selectors.

## Outcome

- Migration 021 (`server/db/migrations/021_collapse_categories_into_accounts.sql`):
  - Adds `is_transfer` and `ps_category_id` columns to `accounts`.
  - Repoints FKs from `categories(id)` → `accounts(id)` for: `transactions.category_id`, `budget_entries.category_id`, `pending_transactions.posted_category_id`, `fc_line_categories.category_id`.
  - Resolver: `COALESCE(c.mapped_account_id, name-match)` — verified pre-migration that every active category resolves.
  - Backfills `account_source_mappings` from `category_source_mappings` (handles `FX` → `Transfer - FX` rename).
  - Recursive `is_transfer = TRUE` flag on every descendant of the "Transfers" parent so accounts added directly to the COA are picked up too.
  - Drops `categories` and `category_source_mappings`.
- Code:
  - Removed `categories.js` and `categorySourceMappings.js` repos.
  - `routes/categories.js` becomes a thin alias backed by `accounts.findPLeaves()` to preserve frontend URLs.
  - All ~40 `JOIN categories` SQL JOINs swapped to `JOIN accounts` on the same column names.
  - `coa/add` no longer dual-writes; sets `is_transfer` automatically via `accounts.computeIsTransfer()` based on COA placement.
  - `ingestPs.js` PS sync now resolves category names via `account_source_mappings`.

## Verification

- 73 Jest tests pass.
- HTTP smoke test (`server/src/scripts/smoke-after-021.js`) — 17 endpoint checks pass against live server.
- Transfer Analysis modal returns all 9 transfer accounts including `Transfer - FX` and `Transfer - Business`.
- Forecast generation, cash flow, balance sheet, FC Lines, transfer-match-groups all verified end-to-end.

## Rollback

- Git tag `pre-categories-collapse` (pushed).
- `pg_dump` saved at `Backups/pre-categories-collapse/pre_categories_collapse.dump`.

## Key references

- Migration: `server/db/migrations/021_collapse_categories_into_accounts.sql`.
- Smoke test: `server/src/scripts/smoke-after-021.js`.
- Repository: `server/src/v2/repositories/accounts.js` (extended with `findPLeaves`, `computeIsTransfer`, `findByPsCategoryId`).
