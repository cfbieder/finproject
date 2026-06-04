-- 029_feed_balance_sign.sql — CR023 per-mapping feed balance-sign override.
--
-- The bank feed's reported BALANCE sign for a liability is not derivable from
-- account_type alone — it depends on the upstream behind fintable:
--   GoCardless/PKO (EU) reports a credit card as a POSITIVE amount owed
--     → fin (which stores liabilities negative) needs expected = -feed.
--   Plaid/SnapTrade (US, e.g. the Black Card / LUXURY CARD) reports it
--     NEGATIVE (matching fin) → expected = +feed (NO flip).
--
-- TRANSACTION signs are identical across upstreams (spending is negative), so
-- promotion is unaffected; this only governs the balance-comparison layer
-- (the balance-recon monitor and reconcileToFeed calibrate/mtm `expected`).
--
-- feed_sign = the multiplier that converts feed_balance into fin's stored sign.
--   NULL  → fall back to the account_type heuristic (liability ? -1 : +1) —
--           preserves the exact pre-029 behavior for every existing mapping.
--   +1/-1 → explicit per-mapping override (set +1 for Plaid/US liability cards).
--
-- Idempotent. Apply to dev (:5434) and prod (:5433) DBs manually, prod-before-code.

BEGIN;

ALTER TABLE account_source_mappings
  ADD COLUMN IF NOT EXISTS feed_sign SMALLINT;

COMMIT;

-- Rollback:
--   ALTER TABLE account_source_mappings DROP COLUMN IF EXISTS feed_sign;
