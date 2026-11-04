-- 087 — CR098 follow-up: a "done" mark per budget-builder line.
--
-- WHAT. The owner ticks a line once they have finished deciding it, so a long grid shows what is
-- left. Planning information only: nothing reads it to compute, publish or restore a figure, and it
-- is outside the publish preview's token.
--
-- Additive, defaulted, no row written beyond the default; safe on prod before the code (v3.81 reads
-- explicit columns and never sees it).
--
-- Rollback (manual — the runner is forward-only):
--   ALTER TABLE budget_build_lines DROP COLUMN IF EXISTS done;

ALTER TABLE budget_build_lines ADD COLUMN IF NOT EXISTS done BOOLEAN NOT NULL DEFAULT FALSE;
