-- ============================================================================
-- FIN Application: Quicken Historical Import — Schema Scaffolding (CR019)
-- Migration: 022_quicken_import.sql
-- Created: 2026-05-22
--
-- Schema scaffolding for the one-time Quicken backfill (cash + investment).
-- This migration is structure-only: no rows are imported here. Parser, admin
-- UI, and promote logic ship in subsequent commits per CR019 phases B–G.
--
-- Tables created:
--   Lifecycle:    quicken_import_batches, quicken_calibration_audit
--   Staging:      quicken_staging, quicken_securities_staging,
--                 quicken_security_master_staging, quicken_price_staging
--   Investment:   securities, security_source_mappings, security_lots,
--                 security_transactions, security_lot_disposals,
--                 security_prices  (owned by CR020 §4; created here so CR020
--                 starts with a populated dataset rather than empty tables)
--   Enum:         security_tx_type
--
-- Columns added to existing tables:
--   transactions.import_batch_id          (UUID, nullable)
--   transfer_match_groups.import_batch_id (UUID, nullable)
--   transfer_match_groups.audit_provenance (JSONB, nullable)
--   accounts.skip_transfer_analysis       (BOOLEAN NOT NULL DEFAULT FALSE)
--
-- Sentinel update:
--   accounts.opening_balance_date: 2000-01-01 → 1990-01-01 (user data goes
--   back to 1998-03-21; the original sentinel would silently exclude rows.)
--
-- COA leaves seeded (idempotent — ON CONFLICT DO NOTHING):
--   Return of Capital     under Transfers, is_transfer=TRUE, skip_transfer_analysis=TRUE
--   Realized Gain (Historical)   income leaf (one consolidated, no ST/LT split)
--   Options Trading       income leaf (ShtSell + CvrShrt both route here)
--   Margin Interest       expense leaf
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. LIFECYCLE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS quicken_import_batches (
    id UUID PRIMARY KEY,
    label VARCHAR(200),
    parsed_at TIMESTAMPTZ,
    mapped_at TIMESTAMPTZ,
    promoted_at TIMESTAMPTZ,
    rolled_back_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'parsing',
        -- parsing | parsed | mapped | promoting | promoted | rolling_back | rolled_back | failed
    failure_reason TEXT,
    source_files JSONB,                       -- ["pko.QIF", "fidelity_stk_w_sec.QIF", ...]
    cutoff_overrides JSONB,                   -- {"<account_id>": "YYYY-MM-DD"} per CR019 §8.1.1
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qib_status ON quicken_import_batches(status);

CREATE TABLE IF NOT EXISTS quicken_calibration_audit (
    id SERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL REFERENCES quicken_import_batches(id),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    delta_amount DECIMAL(15,2) NOT NULL,      -- subtracted from accounts.opening_balance at promote; reversed at rollback
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(import_batch_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_qca_batch ON quicken_calibration_audit(import_batch_id);

-- ============================================================================
-- 2. STAGING TABLES (4)
-- ============================================================================

CREATE TABLE IF NOT EXISTS quicken_staging (
    id SERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL REFERENCES quicken_import_batches(id),
    source_file VARCHAR(255) NOT NULL,
    source_line INTEGER,
    quicken_account_name VARCHAR(200) NOT NULL,
    transaction_date DATE NOT NULL,
    amount DECIMAL(18,4) NOT NULL,            -- native currency; promote resolves base_amount via budget_fx_rates
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    payee VARCHAR(500),
    memo TEXT,
    quicken_category VARCHAR(200),
    transfer_target_account VARCHAR(200),     -- non-null if QIF row had L[AcctName]
    cleared_status CHAR(1),                   -- * = cleared, R = reconciled, blank = uncleared
    split_parent_id INTEGER REFERENCES quicken_staging(id),  -- non-null on children; parents are metadata-only
    raw_payload JSONB,                        -- original QIF tag dump for debug
    promoted_transaction_id BIGINT,           -- set by promote; references transactions.id
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qs_batch ON quicken_staging(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_qs_account_date ON quicken_staging(quicken_account_name, transaction_date);

CREATE TABLE IF NOT EXISTS quicken_securities_staging (
    id SERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL REFERENCES quicken_import_batches(id),
    source_file VARCHAR(255) NOT NULL,
    source_line INTEGER,
    quicken_account_name VARCHAR(200) NOT NULL,
    transaction_date DATE NOT NULL,
    quicken_action VARCHAR(20) NOT NULL,      -- BuyX, Sell, ReinvDiv, StkSplit, …
    quicken_security_name VARCHAR(200),
    shares NUMERIC(18,6),
    price NUMERIC(18,6),
    fees DECIMAL(18,4),
    gross_amount DECIMAL(18,4),
    quicken_lot_id VARCHAR(50),               -- preserved when QIF specifies a lot
    quicken_cost_basis DECIMAL(18,4),         -- Quicken's stored basis if present
    cleared_status CHAR(1),
    memo TEXT,
    raw_payload JSONB,
    promoted_security_tx_id INTEGER,          -- references security_transactions.id
    promoted_cash_tx_id BIGINT,               -- primary cash leg per §5.3 / §6.4 step 3
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qss_batch ON quicken_securities_staging(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_qss_account_date ON quicken_securities_staging(quicken_account_name, transaction_date);
CREATE INDEX IF NOT EXISTS idx_qss_security_date ON quicken_securities_staging(quicken_security_name, transaction_date);

CREATE TABLE IF NOT EXISTS quicken_security_master_staging (
    id SERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL REFERENCES quicken_import_batches(id),
    source_file VARCHAR(255) NOT NULL,
    quicken_security_name VARCHAR(200) NOT NULL,
    ticker VARCHAR(20),
    quicken_type VARCHAR(50),                 -- Stock / Bond / Mutual Fund / ETF / …
    quicken_goal VARCHAR(100),
    raw_payload JSONB,
    promoted_security_id INTEGER,             -- references securities.id after Phase 2 mapping
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(import_batch_id, quicken_security_name)
);

CREATE INDEX IF NOT EXISTS idx_qsms_batch ON quicken_security_master_staging(import_batch_id);

CREATE TABLE IF NOT EXISTS quicken_price_staging (
    id SERIAL PRIMARY KEY,
    import_batch_id UUID NOT NULL REFERENCES quicken_import_batches(id),
    source_file VARCHAR(255) NOT NULL,
    ticker VARCHAR(20) NOT NULL,
    price_date DATE NOT NULL,
    close NUMERIC(18,6) NOT NULL,
    promoted INTEGER DEFAULT 0,               -- 0 / 1 after upsert into security_prices
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qps_batch ON quicken_price_staging(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_qps_ticker_date ON quicken_price_staging(ticker, price_date);

-- ============================================================================
-- 3. INVESTMENT ENUM + TABLES (per CR020 §4; CR019 owns by name)
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE security_tx_type AS ENUM (
        'BUY', 'SELL', 'DIVIDEND', 'DIVIDEND_REINVEST',
        'SPLIT', 'TRANSFER_IN', 'TRANSFER_OUT', 'INTEREST', 'MISC'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS securities (
    id SERIAL PRIMARY KEY,
    ticker VARCHAR(20) UNIQUE,                -- nullable: private/illiquid holdings may lack a ticker
    name VARCHAR(200) NOT NULL,
    asset_class VARCHAR(20) NOT NULL DEFAULT 'stock',  -- stock / etf / bond / mf / misc
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    sector VARCHAR(50),
    country VARCHAR(50),
    exchange VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_securities_ticker ON securities(ticker) WHERE ticker IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_source_mappings (
    id SERIAL PRIMARY KEY,
    security_id INTEGER NOT NULL REFERENCES securities(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL,              -- 'quicken' | 'fidelity' | 'manual'
    external_name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, external_name)
);

CREATE INDEX IF NOT EXISTS idx_ssm_security ON security_source_mappings(security_id);
CREATE INDEX IF NOT EXISTS idx_ssm_source_name ON security_source_mappings(source, external_name);

CREATE TABLE IF NOT EXISTS security_lots (
    id SERIAL PRIMARY KEY,
    security_id INTEGER NOT NULL REFERENCES securities(id),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    acquired_date DATE NOT NULL,
    shares NUMERIC(18,6) NOT NULL,
    cost_per_share NUMERIC(18,6) NOT NULL,
    cost_total DECIMAL(18,4) NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'open',  -- open | closed
    source VARCHAR(50) NOT NULL,              -- 'quicken' | 'fidelity' | 'manual'
    handoff_marker BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE on lots open at last Quicken date per account
    import_batch_id UUID REFERENCES quicken_import_batches(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sl_security_status ON security_lots(security_id, status);
CREATE INDEX IF NOT EXISTS idx_sl_account_status ON security_lots(account_id, status);
CREATE INDEX IF NOT EXISTS idx_sl_batch ON security_lots(import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_transactions (
    id SERIAL PRIMARY KEY,
    security_id INTEGER NOT NULL REFERENCES securities(id),
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    tx_date DATE NOT NULL,
    tx_type security_tx_type NOT NULL,
    shares NUMERIC(18,6),
    price NUMERIC(18,6),
    fees DECIMAL(18,4),
    gross_amount DECIMAL(18,4),
    cash_transaction_id BIGINT REFERENCES transactions(id),
    source VARCHAR(50) NOT NULL,
    import_batch_id UUID REFERENCES quicken_import_batches(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_st_date ON security_transactions(tx_date);
CREATE INDEX IF NOT EXISTS idx_st_security_date ON security_transactions(security_id, tx_date);
CREATE INDEX IF NOT EXISTS idx_st_batch ON security_transactions(import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_lot_disposals (
    id SERIAL PRIMARY KEY,
    lot_id INTEGER NOT NULL REFERENCES security_lots(id),
    tx_id INTEGER NOT NULL REFERENCES security_transactions(id),
    shares_sold NUMERIC(18,6) NOT NULL,
    proceeds DECIMAL(18,4) NOT NULL,
    cost_basis_sold DECIMAL(18,4) NOT NULL,
    realized_gain DECIMAL(18,4) NOT NULL,
    holding_period_days INTEGER,
    import_batch_id UUID REFERENCES quicken_import_batches(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sld_lot ON security_lot_disposals(lot_id);
CREATE INDEX IF NOT EXISTS idx_sld_tx ON security_lot_disposals(tx_id);
CREATE INDEX IF NOT EXISTS idx_sld_batch ON security_lot_disposals(import_batch_id) WHERE import_batch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_prices (
    id SERIAL PRIMARY KEY,
    security_id INTEGER NOT NULL REFERENCES securities(id),
    price_date DATE NOT NULL,
    close NUMERIC(18,6) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    source VARCHAR(50) NOT NULL,              -- 'quicken' | 'tradier' | 'manual'
    import_batch_id UUID REFERENCES quicken_import_batches(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(security_id, price_date)
);

CREATE INDEX IF NOT EXISTS idx_sp_security_date ON security_prices(security_id, price_date DESC);
CREATE INDEX IF NOT EXISTS idx_sp_batch ON security_prices(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- ============================================================================
-- 4. COLUMNS ON EXISTING TABLES
-- ============================================================================

-- transactions: rollback support
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES quicken_import_batches(id);
CREATE INDEX IF NOT EXISTS idx_tx_import_batch
    ON transactions(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- transfer_match_groups: rollback support + audit provenance for Quicken matches
ALTER TABLE transfer_match_groups
    ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES quicken_import_batches(id);
ALTER TABLE transfer_match_groups
    ADD COLUMN IF NOT EXISTS audit_provenance JSONB;
CREATE INDEX IF NOT EXISTS idx_tmg_import_batch
    ON transfer_match_groups(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- accounts: per-leaf opt-out from /transfer-analysis matching
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS skip_transfer_analysis BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- 5. SENTINEL UPDATE: opening_balance_date 2000-01-01 → 1990-01-01
--    (user data goes back to 1998-03-21 per Samples/quicken/fidelity_stk.QIF;
--     the original 2000-01-01 sentinel would silently exclude pre-2000 rows
--     from the balance formula.)
--
--    Both steps required:
--      (a) UPDATE existing rows that still have the old sentinel
--      (b) ALTER COLUMN DEFAULT so future INSERTs (including the new COA leaves
--          seeded in step 6 below) pick up the new sentinel instead of being
--          stamped 2000-01-01 by the default from migration 016.
-- ============================================================================

UPDATE accounts
SET opening_balance_date = '1990-01-01'
WHERE opening_balance_date = '2000-01-01';

ALTER TABLE accounts
    ALTER COLUMN opening_balance_date SET DEFAULT '1990-01-01';

-- ============================================================================
-- 6. SEED NEW COA LEAVES (idempotent via ON CONFLICT DO NOTHING)
-- ============================================================================

DO $$
DECLARE
    transfers_parent_id INTEGER;
BEGIN
    SELECT id INTO transfers_parent_id FROM accounts WHERE name = 'Transfers' LIMIT 1;
    IF transfers_parent_id IS NULL THEN
        RAISE EXCEPTION 'Migration aborted: required "Transfers" parent account not found in COA';
    END IF;

    -- Return of Capital: under Transfers (is_transfer=TRUE applies via descendants rule from migration 021),
    -- skip_transfer_analysis=TRUE because there's no matching pair (single cash credit per RtrnCap event).
    INSERT INTO accounts (name, parent_id, account_type, section, is_transfer, skip_transfer_analysis, currency, is_active)
    VALUES ('Return of Capital', transfers_parent_id, 'expense', 'profit_loss', TRUE, TRUE, 'USD', TRUE)
    ON CONFLICT (name) DO NOTHING;

    -- Realized Gain (Historical): single consolidated income leaf for CGShort/CGLong/CGMid and ReinvLg
    -- income side. No ST/LT split. Top-level until user assigns a parent via COA management.
    INSERT INTO accounts (name, account_type, section, currency, is_active)
    VALUES ('Realized Gain (Historical)', 'income', 'profit_loss', 'USD', TRUE)
    ON CONFLICT (name) DO NOTHING;

    -- Options Trading: single P&L leaf. ShtSell credits and CvrShrt debits both route here; net = realized
    -- option P&L per period. Uses 'income' account_type (rather than 'expense') as a convention so it lives
    -- under the Income section; actual sign of net is determined by transaction amounts.
    INSERT INTO accounts (name, account_type, section, currency, is_active)
    VALUES ('Options Trading', 'income', 'profit_loss', 'USD', TRUE)
    ON CONFLICT (name) DO NOTHING;

    -- Margin Interest: expense leaf for MargInt actions (5 occurrences in sample).
    INSERT INTO accounts (name, account_type, section, currency, is_active)
    VALUES ('Margin Interest', 'expense', 'profit_loss', 'USD', TRUE)
    ON CONFLICT (name) DO NOTHING;
END $$;

-- ============================================================================
-- 7. POST-MIGRATION VERIFICATION
-- ============================================================================

DO $$
DECLARE
    expected_tables TEXT[] := ARRAY[
        'quicken_import_batches', 'quicken_calibration_audit',
        'quicken_staging', 'quicken_securities_staging',
        'quicken_security_master_staging', 'quicken_price_staging',
        'securities', 'security_source_mappings', 'security_lots',
        'security_transactions', 'security_lot_disposals', 'security_prices'
    ];
    expected_columns TEXT[][] := ARRAY[
        ['transactions',          'import_batch_id'],
        ['transfer_match_groups', 'import_batch_id'],
        ['transfer_match_groups', 'audit_provenance'],
        ['accounts',              'skip_transfer_analysis']
    ];
    t TEXT;
    col TEXT[];
    missing INTEGER;
BEGIN
    -- Tables present
    FOREACH t IN ARRAY expected_tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            RAISE EXCEPTION 'Migration verify failed: table % missing', t;
        END IF;
    END LOOP;

    -- Columns added
    FOREACH col SLICE 1 IN ARRAY expected_columns LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = col[1] AND column_name = col[2]
        ) THEN
            RAISE EXCEPTION 'Migration verify failed: column %.% missing', col[1], col[2];
        END IF;
    END LOOP;

    -- Enum present
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'security_tx_type') THEN
        RAISE EXCEPTION 'Migration verify failed: enum security_tx_type missing';
    END IF;

    -- Sentinel applied (all touched rows now at 1990-01-01; none stuck at 2000-01-01)
    SELECT COUNT(*) INTO missing FROM accounts WHERE opening_balance_date = '2000-01-01';
    IF missing > 0 THEN
        RAISE EXCEPTION 'Migration verify failed: % accounts still have opening_balance_date=2000-01-01', missing;
    END IF;

    -- New COA leaves seeded (4 expected)
    SELECT 4 - COUNT(*) INTO missing FROM accounts
        WHERE name IN ('Return of Capital', 'Realized Gain (Historical)', 'Options Trading', 'Margin Interest');
    IF missing > 0 THEN
        RAISE EXCEPTION 'Migration verify failed: % of 4 expected COA leaves missing', missing;
    END IF;
END $$;

COMMIT;
