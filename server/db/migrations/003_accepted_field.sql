-- ============================================================================
-- FIN Application: Add accepted field to transactions
-- Migration: 003_accepted_field.sql
-- Created: 2026-02-17
--
-- Adds an "accepted" boolean column to the transactions table.
-- Accepted transactions are protected from overwrite during PS data refreshes,
-- allowing users to edit description/category and preserve those changes.
-- ============================================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS accepted BOOLEAN DEFAULT FALSE;

-- Partial index for efficient filtering of unaccepted transactions in review queries
CREATE INDEX IF NOT EXISTS idx_transactions_accepted
  ON transactions(accepted)
  WHERE accepted IS NOT TRUE;
