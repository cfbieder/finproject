-- ============================================================================
-- FIN Application: PocketSmith Staging Data Table
-- Migration: 002_psdata_staging.sql
-- Created: 2026-02-03
--
-- This migration creates the psdata_staging table for storing raw PocketSmith
-- transaction data from CSV imports and API refreshes. This replaces the
-- MongoDB psdata collection.
-- ============================================================================

-- ============================================================================
-- SECTION 1: PSDATA STAGING TABLE
-- ============================================================================

-- Raw PocketSmith transaction data (staging)
-- Mirrors the MongoDB PSdata schema for direct migration
CREATE TABLE IF NOT EXISTS psdata_staging (
    id BIGSERIAL PRIMARY KEY,
    ps_id VARCHAR(100) UNIQUE,              -- PocketSmith transaction ID (maps to ID field)
    transaction_date DATE,                   -- Date
    description1 VARCHAR(500),               -- Merchant
    description2 VARCHAR(500),               -- Merchant Changed From
    amount DECIMAL(15,4),                    -- Amount (in local currency)
    currency CHAR(3),                        -- Currency
    base_amount DECIMAL(15,4),               -- Amount in base currency
    base_currency CHAR(3) DEFAULT 'USD',     -- Base currency
    transaction_type VARCHAR(50),            -- Transaction Type
    account_name VARCHAR(200),               -- Account name (raw from PS)
    closing_balance DECIMAL(15,4),           -- Closing Balance
    category_name VARCHAR(200),              -- Category name (raw from PS)
    parent_categories VARCHAR(500),          -- Parent Categories
    labels TEXT,                             -- Labels
    memo TEXT,                               -- Memo
    note TEXT,                               -- Note
    bank VARCHAR(100),                       -- Bank
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by PS ID
CREATE INDEX IF NOT EXISTS idx_psdata_staging_ps_id ON psdata_staging(ps_id);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_psdata_staging_date ON psdata_staging(transaction_date);

-- Index for account filtering
CREATE INDEX IF NOT EXISTS idx_psdata_staging_account ON psdata_staging(account_name);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_psdata_staging_category ON psdata_staging(category_name);

-- ============================================================================
-- SECTION 2: APP DATA TABLE
-- ============================================================================

-- Application metadata (replaces MongoDB appdata collection)
CREATE TABLE IF NOT EXISTS app_data (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) UNIQUE NOT NULL,
    value JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default app data entries
INSERT INTO app_data (key, value)
VALUES
    ('lastIngest', 'null'::jsonb),
    ('lastRefresh', 'null'::jsonb)
ON CONFLICT (key) DO NOTHING;
