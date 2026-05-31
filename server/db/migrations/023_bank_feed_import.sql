-- ============================================================================
-- FIN Application: Bank Feed Parallel Import — Schema Scaffolding (CR022)
-- Migration: 023_bank_feed_import.sql
-- Created: 2026-05-31
--
-- Additive second import path: bank-feed (CR021 /v1/* contract) → fin's
-- canonical `transactions` table, running alongside PocketSmith. Structure-only;
-- no rows are imported here. Converter, repository, orchestrator, and routes
-- ship in subsequent commits per CR022 phases B–C.
--
-- Tables created:
--   Staging:   bankfeed_staging  (shaped 1:1 to the canonical contract)
--
-- Columns added to existing tables:
--   transactions.bank_feed_external_id     (VARCHAR(100), nullable, partial-unique)
--   account_source_mappings.ignored        (BOOLEAN NOT NULL DEFAULT FALSE)  [CR022 R1]
--
-- Indexes:
--   uq_tx_bank_feed_external_id  partial-unique on transactions(bank_feed_external_id)
--   idx_tx_source                on transactions(source)
--   + bankfeed_staging support indexes
--
-- Seed:
--   sync_metadata('bank_feed_transactions', 'pending')   (idempotent)
--
-- Design notes (CR022 §3.3, §6):
--   * source='bank-feed' is the canonical discriminator (generic; survives a
--     fintable→Plaid swap). The actual upstream lives in bankfeed_staging.source
--     and raw JSONB, never in transactions.source.
--   * bank_feed_external_id is VARCHAR (not a reuse of ps_id BIGINT) because feed
--     IDs are strings (fintable composite hash today, Plaid/GoCardless UUIDs later).
--     Partial-unique WHERE NOT NULL keeps PS rows (NULL) outside the constraint.
--   * R1 opt-in: account_source_mappings.ignored defaults FALSE so existing
--     pocketsmith/quicken mappings are unaffected. The bank-feed promote gate
--     skips ignored=TRUE and unmapped accounts (unmapped = pending, never silent).
--   * R2 cross-source dedup needs NO new column — it reuses
--     transactions.bank_feed_external_id as the link target stamped onto a
--     matching source='pocketsmith' row.
--   * No CHECK constraint on transactions.source (the PS path has none either;
--     adding one risks breaking historical 'split'/'auto-offset' values).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. EXTERNAL-ID COLUMN ON transactions (string, nullable, partial-unique)
-- ============================================================================

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS bank_feed_external_id VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_bank_feed_external_id
    ON transactions(bank_feed_external_id)
    WHERE bank_feed_external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tx_source
    ON transactions(source);

-- ============================================================================
-- 2. PARALLEL STAGING TABLE (shaped to the canonical contract, CR021 §3.2)
--    Do NOT overload psdata_staging — different column set, and CR021 §3.3
--    commits psdata_staging is "frozen in place, never touched".
-- ============================================================================

CREATE TABLE IF NOT EXISTS bankfeed_staging (
    id BIGSERIAL PRIMARY KEY,
    external_id VARCHAR(100) NOT NULL,
    source VARCHAR(20) NOT NULL,              -- 'fintable' | 'plaid' | 'excel' (actual upstream)
    feed_account_external_id VARCHAR(100),    -- bank-feed Account UUID
    transaction_date DATE NOT NULL,
    amount DECIMAL(15,4) NOT NULL,            -- signed; outflow negative per contract
    currency CHAR(3) NOT NULL,
    base_amount DECIMAL(15,4),
    base_currency CHAR(3) DEFAULT 'USD',
    description VARCHAR(500),
    merchant VARCHAR(200),
    category_hint VARCHAR(100),
    pending BOOLEAN DEFAULT FALSE,
    raw JSONB,                                -- opaque source payload (GoCardless JSON, etc.)
    promoted_transaction_id BIGINT REFERENCES transactions(id),
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_bfs_external ON bankfeed_staging(external_id);
CREATE INDEX IF NOT EXISTS idx_bfs_date ON bankfeed_staging(transaction_date);
CREATE INDEX IF NOT EXISTS idx_bfs_feed_account ON bankfeed_staging(feed_account_external_id);
CREATE INDEX IF NOT EXISTS idx_bfs_unpromoted
    ON bankfeed_staging(promoted_transaction_id)
    WHERE promoted_transaction_id IS NULL;

-- ============================================================================
-- 3. SYNC METADATA ROW (bank-feed ingest tracks last_sync_at independently)
-- ============================================================================

INSERT INTO sync_metadata (sync_type, last_sync_status)
VALUES ('bank_feed_transactions', 'pending')
ON CONFLICT (sync_type) DO NOTHING;

-- ============================================================================
-- 4. PER-ACCOUNT OPT-OUT FLAG ON account_source_mappings  [CR022 R1]
--    Default FALSE keeps every existing pocketsmith/quicken mapping unaffected.
--    bank-feed promote gate: skip ignored=TRUE; unmapped accounts stay pending.
-- ============================================================================

ALTER TABLE account_source_mappings
    ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- 5. POST-MIGRATION VERIFICATION
-- ============================================================================

DO $$
DECLARE
    expected_columns TEXT[][] := ARRAY[
        ['transactions',             'bank_feed_external_id'],
        ['account_source_mappings',  'ignored']
    ];
    col TEXT[];
BEGIN
    -- bankfeed_staging present
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'bankfeed_staging'
    ) THEN
        RAISE EXCEPTION 'Migration verify failed: table bankfeed_staging missing';
    END IF;

    -- Columns added
    FOREACH col SLICE 1 IN ARRAY expected_columns LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = col[1] AND column_name = col[2]
        ) THEN
            RAISE EXCEPTION 'Migration verify failed: column %.% missing', col[1], col[2];
        END IF;
    END LOOP;

    -- Partial-unique index present
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uq_tx_bank_feed_external_id'
    ) THEN
        RAISE EXCEPTION 'Migration verify failed: index uq_tx_bank_feed_external_id missing';
    END IF;

    -- sync_metadata seed present
    IF NOT EXISTS (
        SELECT 1 FROM sync_metadata WHERE sync_type = 'bank_feed_transactions'
    ) THEN
        RAISE EXCEPTION 'Migration verify failed: sync_metadata seed for bank_feed_transactions missing';
    END IF;

    -- R1 default sanity: existing mappings must all be ignored=FALSE
    IF EXISTS (SELECT 1 FROM account_source_mappings WHERE ignored IS NULL) THEN
        RAISE EXCEPTION 'Migration verify failed: account_source_mappings.ignored has NULLs (expected default FALSE)';
    END IF;
END $$;

COMMIT;
