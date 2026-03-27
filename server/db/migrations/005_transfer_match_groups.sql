-- ============================================================================
-- FIN Application: Transfer Match Groups
-- Migration: 005_transfer_match_groups.sql
-- Created: 2026-03-27
--
-- Allows users to manually group unmatched transfer transactions into
-- matched sets (e.g., five debits that correspond to one credit).
-- A transaction can belong to at most one match group.
-- ============================================================================

CREATE TABLE IF NOT EXISTS transfer_match_groups (
    id SERIAL PRIMARY KEY,
    note VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transfer_match_group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES transfer_match_groups(id) ON DELETE CASCADE,
    transaction_id BIGINT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    UNIQUE(transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_tmgm_group_id
    ON transfer_match_group_members(group_id);

CREATE INDEX IF NOT EXISTS idx_tmgm_transaction_id
    ON transfer_match_group_members(transaction_id);
