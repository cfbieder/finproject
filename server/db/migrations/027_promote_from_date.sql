-- 027_promote_from_date.sql — CR024 Phase 2 cutover gate.
--
-- Per-account-mapping cutoff: a bank-feed staged row promotes only if its
-- transaction_date >= promote_from_date (NULL = no cutoff, promote all — the
-- existing PKO behavior is unchanged). Used to hand Fidelity cash flow from
-- PocketSmith (which the user uploads manually) to the bank feed without a
-- double-count overlap: PS owns dates before the cutoff, bank-feed owns from it.
--
-- Idempotent. Apply to dev (:5434) and prod (:5433) DBs manually.

BEGIN;

ALTER TABLE account_source_mappings
  ADD COLUMN IF NOT EXISTS promote_from_date DATE;

COMMIT;
