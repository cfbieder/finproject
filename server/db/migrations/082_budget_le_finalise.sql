-- 082 — CR083 finalise: freeze the full-year budget onto the LE, and record when it froze.
--
-- WHY A TABLE. `BUDGET FY` and the variance beside it are read LIVE from `budget_entries`
-- (services/budgetLe.js `budgetFyByCategory`). That is right for a draft and wrong for a
-- frozen artefact: the owner edits the budget in-year (30 rows since April, 22 backdated), so a
-- finalised LE would silently restate its own variance the next time the budget moved — the
-- `calibrate()` shape CR083 §4.2 exists to refuse. §17.4 said only "a column". The owner chose
-- (2026-09-14) one row per category, at exactly the grain the live query returns, rather than
-- JSON on `budget_le` (no types, no FK) or rows in `budget_le_lines` (breaks its month ×
-- currency grain, and every reader that sums lines would double-count).
--
-- WHY `finalized_at`. Two readers need to know WHEN the freeze happened: L1 (a month cut fewer
-- than 4 days after it ended may still be filling in — measured on prod, 83 of July's 85 late
-- rows landed Aug 1–3) and L2's sentence ("LE-08-26 froze Jul at …"). `updated_at` moves on
-- every edit and cannot answer it.
--
-- Written at `POST /le/:id/finalize` only; a draft has no rows here and reads live. Additive:
-- existing LEs are all drafts, which the CHECK below requires to have no `finalized_at`.
--
-- Rollback (manual — the runner is forward-only):
--   ALTER TABLE budget_le DROP CONSTRAINT IF EXISTS budget_le_finalized_agree_chk;
--   ALTER TABLE budget_le DROP COLUMN IF EXISTS finalized_at;
--   DROP TABLE IF EXISTS budget_le_budget_fy;

CREATE TABLE IF NOT EXISTS budget_le_budget_fy (
  le_id       INTEGER NOT NULL REFERENCES budget_le(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES accounts(id),
  budget_fy   NUMERIC(15,2) NOT NULL,
  PRIMARY KEY (le_id, category_id)
);

ALTER TABLE budget_le ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

-- A draft has never been frozen; anything final or superseded has. Superseded LEs keep their
-- `finalized_at`, because only a FINAL LE can be re-cut.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_le_finalized_agree_chk') THEN
    ALTER TABLE budget_le
      ADD CONSTRAINT budget_le_finalized_agree_chk
      CHECK ((status = 'draft') = (finalized_at IS NULL));
  END IF;
END $$;
