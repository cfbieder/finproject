-- ============================================================================
-- FIN Application: Allow ignore-without-mapping (CR022 R1 fix)
-- Migration: 024_bank_feed_ignore_unmapped.sql
-- Created: 2026-06-01
--
-- Bug: 023 added account_source_mappings.ignored, but account_id stayed
-- NOT NULL — so a row can't exist without a fin account, meaning "ignore" was
-- only settable AFTER mapping. That contradicts R1's intent: the user wants to
-- ignore feed accounts they never intend to map/import (e.g. brokerage
-- sub-accounts, test accounts). Fix: drop NOT NULL on account_id so an
-- ignored-but-unmapped row (account_id=NULL, ignored=TRUE) is legal.
--
-- Row states for source='bank-feed' after this migration:
--   mapped:   account_id=<id>,  ignored=FALSE  → promotes
--   ignored:  account_id=NULL,  ignored=TRUE   → never promotes (explicit skip)
--   (mapped+ignored: account_id=<id>, ignored=TRUE → suppress a mapped acct)
--   pending:  no row at all                    → never promotes (opt-in default)
--
-- Safety: all existing readers (pocketsmith/quicken) use
--   LEFT JOIN account_source_mappings asm ... LEFT JOIN accounts a ON asm.account_id=a.id
--   WHERE a.id IS NOT NULL  (and filter by their own source)
-- so a NULL account_id on a bank-feed row is invisible to them. Every INSERT in
-- the codebase still supplies account_id, so no write path changes.
-- ============================================================================

BEGIN;

ALTER TABLE account_source_mappings
  ALTER COLUMN account_id DROP NOT NULL;

-- Verify the constraint is gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'account_source_mappings'
      AND column_name = 'account_id'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Migration verify failed: account_source_mappings.account_id still NOT NULL';
  END IF;
END $$;

COMMIT;
