-- 092 — CR098 follow-up: roll a non-USD builder line into the category's USD line.
--
-- WHAT. A category paid in two currencies (FL - Groceries: PLN and USD) is budgeted once, in USD:
-- the rolled line contributes 0 and its estimate, converted at the build's rate, joins the USD
-- line's base. Derived on every read, never stored as an amount.
--   budget_build_lines.rolled_into_usd   — the draft's per-line choice (never on a USD line).
--   budget_category_policy.roll_into_usd — the currencies a category rolled at its last publish, so
--                                          next year's build starts rolled (owner, 2026-11-18).
--
-- Additive, defaulted; safe on prod before the code (v3.92 reads explicit columns and never sees it).
--
-- Rollback (manual — the runner is forward-only):
--   ALTER TABLE budget_build_lines DROP COLUMN IF EXISTS rolled_into_usd;
--   ALTER TABLE budget_category_policy DROP COLUMN IF EXISTS roll_into_usd;

ALTER TABLE budget_build_lines ADD COLUMN IF NOT EXISTS rolled_into_usd BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bbl_roll_not_usd_chk') THEN
    ALTER TABLE budget_build_lines ADD CONSTRAINT bbl_roll_not_usd_chk
      CHECK (NOT rolled_into_usd OR TRIM(currency) <> 'USD');
  END IF;
END $$;

ALTER TABLE budget_category_policy ADD COLUMN IF NOT EXISTS roll_into_usd TEXT[] NOT NULL DEFAULT '{}';
