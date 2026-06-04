-- 028_reconcile_mode.sql — CR023 source-aware reconciliation.
--
-- Marks, per bank-feed account mapping, HOW fin reconciles its ledger to the
-- bank's reported balance:
--   'calibrate' (default) — CASH: re-anchor opening_balance = expected - Σtx
--                           (a one-time/occasional fix when drift appears; drift
--                           on cash usually means a missing tx, not a periodic move).
--   'mtm'                 — BROKERAGE: post a monthly Unrealized-G/L (category 88)
--                           adjustment txn (source='mtm') = feed market value -
--                           computed balance, dated month-end. Supersedes CR024's
--                           balance_from_feed read-override for gain recognition.
--
-- Set 'mtm' on the true brokerage accounts (26 IRA, 27 Stocks, 28 Options,
-- 31 Bond) via seed-cr023-reconcile-modes.js. Fidelity Cash Mgt (30) stays
-- 'calibrate' (it is a cash account). Default keeps every existing mapping 'calibrate'.
--
-- Idempotent. Apply to dev (:5434) and prod (:5433) DBs manually, prod-before-code.

BEGIN;

ALTER TABLE account_source_mappings
  ADD COLUMN IF NOT EXISTS reconcile_mode VARCHAR(20) NOT NULL DEFAULT 'calibrate';

COMMIT;

-- Rollback:
--   ALTER TABLE account_source_mappings DROP COLUMN IF EXISTS reconcile_mode;
