-- ---------------------------------------------------------------------------
-- 067_accrual_category.sql — CR080 Part B, schema only (INERT)
--
-- Adds the column the `accrue` reconcile mode reads: which income category an
-- account's yield belongs to. There is deliberately NO default — `accrue()`
-- refuses to run when it is NULL rather than falling back to anything, because a
-- fallback to `Unrealized G/L` (88) is exactly the defect CR080 exists to fix.
--
-- ── This migration does NOT set any account to 'accrue', and that is the point ──
--
-- Migrations are applied to prod BEFORE the code that uses them (the standing
-- deploy order). Until CR080's engine ships, `reconcileToFeed` routes any mode
-- that is not 'mtm' to `calibrate` — which rewrites `opening_balance`. So a
-- migration that flipped accounts 8 and 13 to 'accrue' ahead of the deploy would
-- leave a Reconcile click re-anchoring both accounts and destroying precisely the
-- history migration 065 had just booked. The CR's first draft proposed exactly
-- that, described as "inert because nothing reads 'accrue' yet"; it is not inert,
-- it is destructive, and the fall-through is the reason.
--
-- The mode flip is therefore migration **068**, applied AFTER the code deploy.
-- The same deploy hardens the fall-through itself: an unrecognised mode now
-- throws instead of silently calibrating, so this ordering trap cannot be re-set
-- by a future mode.
--
-- Idempotent. Safe on a data-free database (pure DDL, no data assumptions).
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE account_source_mappings
  ADD COLUMN IF NOT EXISTS accrual_category_id INTEGER REFERENCES accounts(id);

COMMENT ON COLUMN account_source_mappings.accrual_category_id IS
  'CR080: income category for reconcile_mode=''accrue''. NULL refuses the run — never defaulted.';

COMMIT;

-- Rollback:
--   ALTER TABLE account_source_mappings DROP COLUMN IF EXISTS accrual_category_id;
