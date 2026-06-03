-- 026_fidelity_activity.sql — CR024 Phase 2 (Fidelity investment-activity cash flow).
--
-- Carries the SnapTrade activity type (added to the bank-feed /v1/transactions
-- contract, 2026-06-03) through staging so the promote-time categorizer can route
-- each row (interest/dividend → income, trades → per-account treatment, contribution/
-- withdrawal → transfer, net-zero plumbing → suppressed). `suppressed` marks the
-- net-zero plumbing rows (LOAN / JOURNALED / OPTIONEXPIRATION) so they never promote
-- and aren't re-evaluated every run.
--
-- Idempotent. Apply to dev (:5434) and prod (:5433) DBs manually.

BEGIN;

ALTER TABLE bankfeed_staging
  ADD COLUMN IF NOT EXISTS activity_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT FALSE;

-- The promote query skips suppressed rows alongside the existing
-- promoted_transaction_id IS NULL filter.
CREATE INDEX IF NOT EXISTS idx_bfs_unpromoted_active
  ON bankfeed_staging(promoted_transaction_id)
  WHERE promoted_transaction_id IS NULL AND suppressed = FALSE;

COMMIT;
