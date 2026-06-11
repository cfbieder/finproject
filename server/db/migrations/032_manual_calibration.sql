-- 032_manual_calibration.sql — CR033 Manual Calibration for non-fed accounts.
--
-- Balance Calibration (CR023) reconciles fin's computed balance against a bank's
-- reported balance pulled from a feed (`bankfeed_balances`). Many balance-sheet
-- accounts have NO direct feed (manual/legacy/parked). This adds the same
-- reconcile workflow for those accounts, except the "bank's reported balance" is
-- a figure the USER types in instead of a feed value.
--
-- Two pieces:
--   1. manual_balances — the user-entered current balance per non-fed account
--      (last-entered-per-date wins, mirroring bankfeed_balances so the recon page
--      can show an "as-of"/entered date and standing drift across sessions).
--      The figure is stored in fin's OWN signed convention (assets +, liabilities
--      −) — the same number the Computed column shows — so there is no feed_sign
--      gymnastics: expected = entered, drift = computed − entered.
--   2. accounts.manual_reconcile_mode — per-account 'calibrate' | 'mtm', the
--      non-fed analog of account_source_mappings.reconcile_mode (non-fed accounts
--      have no mapping row to hang it on).
--
-- Idempotent. Apply to dev (:5434) and prod (:5433) DBs manually, prod-before-code.

BEGIN;

CREATE TABLE IF NOT EXISTS manual_balances (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  balance       NUMERIC(20,4) NOT NULL,
  balance_date  DATE NOT NULL,
  currency      VARCHAR(3),
  note          TEXT,
  entered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, balance_date)
);

CREATE INDEX IF NOT EXISTS idx_manual_balances_acct_date
  ON manual_balances (account_id, balance_date DESC);

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS manual_reconcile_mode VARCHAR(20) NOT NULL DEFAULT 'calibrate';

COMMIT;

-- Rollback:
--   ALTER TABLE accounts DROP COLUMN IF EXISTS manual_reconcile_mode;
--   DROP TABLE IF EXISTS manual_balances;
