-- ============================================================================
-- FIN Application: Transfer Matched Flag
-- Migration: 006_transfer_matched_flag.sql
-- Created: 2026-03-27
--
-- Boolean flag on transactions indicating whether a transfer-category
-- transaction has been matched (auto or manual). Updated each time
-- transfer analysis runs. Allows other pages to filter by match status.
-- ============================================================================

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_matched BOOLEAN DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_matched
    ON transactions(transfer_matched)
    WHERE transfer_matched IS NOT NULL;
