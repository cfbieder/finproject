-- 089 — CR101: accounts inactive from a date.
--
-- WHAT. `accounts.inactive_from` marks an account (a sold property's categories, a finished school, a
-- closed bank) as inactive from the first of a month. NULL = active. It is NOT `is_active`, which
-- keeps meaning "deleted" and is untouched.
--
-- `account_inactive_effective` is the ONE definition of the inherited date (CR101 D6, parent wins):
-- the earliest non-null `inactive_from` on the path to the root. Every consumer joins this view and
-- never re-walks the tree. It walks ALL accounts (is_active or not), so a lookup never misses a row.
--
-- Additive: a nullable column (every row NULL, so the CHECK holds) and a view. Safe on prod before
-- the code.
--
-- Rollback (manual — the runner is forward-only):
--   DROP VIEW IF EXISTS account_inactive_effective;
--   ALTER TABLE accounts DROP COLUMN IF EXISTS inactive_from;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS inactive_from DATE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounts_inactive_from_first_chk') THEN
    ALTER TABLE accounts ADD CONSTRAINT accounts_inactive_from_first_chk
      CHECK (inactive_from IS NULL OR EXTRACT(DAY FROM inactive_from) = 1);
  END IF;
END $$;

CREATE OR REPLACE VIEW account_inactive_effective AS
WITH RECURSIVE walk AS (
    SELECT id, inactive_from AS eff
      FROM accounts
     WHERE parent_id IS NULL
    UNION ALL
    SELECT a.id, LEAST(w.eff, a.inactive_from)   -- LEAST ignores NULLs
      FROM accounts a
      JOIN walk w ON a.parent_id = w.id
)
SELECT id, eff AS inactive_from_eff FROM walk;
