-- Backfill schema drift: forecast_income_expense.setup_status existed on dev
-- and prod (added ad hoc alongside the AI review feature, 2026-04) but was
-- never captured in a migration, so fresh-from-migrations databases (CI)
-- lacked it and aiReview's base-year query failed. Mirrors 011 for this table.
ALTER TABLE forecast_income_expense ADD COLUMN IF NOT EXISTS setup_status VARCHAR(20) DEFAULT 'new';
