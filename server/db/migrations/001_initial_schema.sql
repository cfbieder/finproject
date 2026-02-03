-- ============================================================================
-- FIN Application: Initial PostgreSQL Schema
-- Migration: 001_initial_schema.sql
-- Created: 2026-01-29
--
-- This migration creates all tables required for the MongoDB -> PostgreSQL
-- migration, including tables for actuals, budgets, forecasts, and sync.
-- ============================================================================

-- ============================================================================
-- SECTION 1: ENUM TYPES
-- ============================================================================

CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');
CREATE TYPE account_section AS ENUM ('balance_sheet', 'profit_loss');

-- ============================================================================
-- SECTION 2: BASE TABLES (No Foreign Key Dependencies)
-- ============================================================================

-- Accounts (unified from coa.json and coa_traits.json)
-- Uses adjacency list pattern for hierarchy (parent_id references self)
CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES accounts(id),
    account_type account_type NOT NULL,
    section account_section NOT NULL,
    currency CHAR(3) DEFAULT 'USD',
    account_number VARCHAR(50),
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    ps_account_name VARCHAR(200),           -- Mapping to PocketSmith account name
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_accounts_parent ON accounts(parent_id);
CREATE INDEX idx_accounts_type ON accounts(account_type);

-- Categories (from PocketSmith, maps to accounts)
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL UNIQUE,
    parent_id INTEGER REFERENCES categories(id),
    ps_category_id BIGINT,                  -- PocketSmith category ID
    mapped_account_id INTEGER REFERENCES accounts(id),
    is_transfer BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_categories_parent ON categories(parent_id);
CREATE INDEX idx_categories_account ON categories(mapped_account_id);

-- Forecast scenarios
CREATE TABLE forecast_scenarios (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Budget versions (named versions per year - from Q8 decision)
CREATE TABLE budget_versions (
    id SERIAL PRIMARY KEY,
    budget_year INTEGER NOT NULL,
    version_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(budget_year, version_name)
);

CREATE INDEX idx_budget_versions_year ON budget_versions(budget_year);

-- Sync metadata (tracks last sync timestamp for delta-only sync)
CREATE TABLE sync_metadata (
    id SERIAL PRIMARY KEY,
    sync_type VARCHAR(50) NOT NULL UNIQUE,  -- 'pocketsmith_transactions', etc.
    last_sync_at TIMESTAMPTZ,
    last_sync_status VARCHAR(50),           -- 'success', 'error', 'partial'
    last_sync_count INTEGER DEFAULT 0,
    last_error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SECTION 3: TRANSACTION TABLES
-- ============================================================================

-- Actual transactions from PocketSmith
CREATE TABLE transactions (
    id BIGSERIAL PRIMARY KEY,
    ps_id BIGINT UNIQUE,                    -- PocketSmith transaction ID
    transaction_date DATE NOT NULL,
    description1 VARCHAR(500),
    description2 VARCHAR(500),
    amount DECIMAL(15,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    base_amount DECIMAL(15,2),
    base_currency CHAR(3) DEFAULT 'USD',
    transaction_type VARCHAR(50),
    account_id INTEGER REFERENCES accounts(id),
    closing_balance DECIMAL(15,2),
    category_id INTEGER REFERENCES categories(id),
    labels TEXT[],                          -- PostgreSQL array type
    memo TEXT,
    note TEXT,
    bank VARCHAR(100),
    source VARCHAR(20) DEFAULT 'pocketsmith', -- 'pocketsmith', 'manual', 'import'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_date ON transactions(transaction_date);
CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_category ON transactions(category_id);
CREATE INDEX idx_transactions_ps_id ON transactions(ps_id);

-- Pending transactions: staging table for PocketSmith entries awaiting review
CREATE TABLE pending_transactions (
    id BIGSERIAL PRIMARY KEY,
    ps_id BIGINT UNIQUE NOT NULL,           -- PocketSmith transaction ID
    transaction_date DATE NOT NULL,
    description1 VARCHAR(500),
    description2 VARCHAR(500),
    amount DECIMAL(15,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    base_amount DECIMAL(15,2),
    base_currency CHAR(3) DEFAULT 'USD',
    transaction_type VARCHAR(50),
    account_id INTEGER REFERENCES accounts(id),
    closing_balance DECIMAL(15,2),
    ps_category_id INTEGER,                  -- Original PocketSmith category
    ps_category_name VARCHAR(200),           -- Original category name for display
    posted_category_id INTEGER REFERENCES categories(id),  -- User-selected category
    labels TEXT[],
    memo TEXT,
    note TEXT,
    bank VARCHAR(100),
    change_type VARCHAR(20) NOT NULL,        -- 'new', 'updated'
    changed_fields TEXT[],                   -- For 'updated': list of changed field names
    previous_amount DECIMAL(15,2),           -- Previous value if amount changed
    previous_category_id INTEGER,            -- Previous category if changed
    ps_updated_at TIMESTAMPTZ,               -- PocketSmith's updated_at timestamp
    fetched_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_change_type CHECK (change_type IN ('new', 'updated'))
);

CREATE INDEX idx_pending_date ON pending_transactions(transaction_date);
CREATE INDEX idx_pending_ps_id ON pending_transactions(ps_id);
CREATE INDEX idx_pending_change_type ON pending_transactions(change_type);

-- Budget entries
CREATE TABLE budget_entries (
    id BIGSERIAL PRIMARY KEY,
    version_id INTEGER REFERENCES budget_versions(id),
    entry_date DATE NOT NULL,
    description VARCHAR(500),
    amount DECIMAL(15,2) NOT NULL,
    currency CHAR(3) NOT NULL,
    base_amount DECIMAL(15,2),
    base_currency CHAR(3) DEFAULT 'USD',
    account_id INTEGER REFERENCES accounts(id),
    category_id INTEGER REFERENCES categories(id),
    labels TEXT[],
    note TEXT,
    budget_year INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_budget_date ON budget_entries(entry_date);
CREATE INDEX idx_budget_year ON budget_entries(budget_year);
CREATE INDEX idx_budget_category ON budget_entries(category_id);
CREATE INDEX idx_budget_version ON budget_entries(version_id);

-- ============================================================================
-- SECTION 4: FORECAST TABLES
-- ============================================================================

-- Forecast modules (balance sheet items)
CREATE TABLE forecast_modules (
    id SERIAL PRIMARY KEY,
    scenario_id INTEGER NOT NULL REFERENCES forecast_scenarios(id) ON DELETE CASCADE,
    account_id INTEGER REFERENCES accounts(id),
    name VARCHAR(200) NOT NULL,
    module_type VARCHAR(50),                -- Asset, Liability, etc.
    currency CHAR(3) DEFAULT 'USD',
    expense_category VARCHAR(100),
    expense_amount DECIMAL(15,2) DEFAULT 0,
    expense_pct DECIMAL(8,4) DEFAULT 0,
    income_category VARCHAR(100),
    income_amount DECIMAL(15,2) DEFAULT 0,
    base_date DATE,
    base_value DECIMAL(15,2) DEFAULT 0,
    market_value DECIMAL(15,2) DEFAULT 0,
    base_value_usd DECIMAL(15,2) DEFAULT 0,
    market_value_usd DECIMAL(15,2) DEFAULT 0,
    growth_rate DECIMAL(8,4) DEFAULT 0,
    comment TEXT,
    is_matched BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(scenario_id, name)
);

CREATE INDEX idx_fc_modules_scenario ON forecast_modules(scenario_id);
CREATE INDEX idx_fc_modules_account ON forecast_modules(account_id);

-- Forecast module income percentages (normalized from nested array)
CREATE TABLE forecast_module_income_pct (
    id SERIAL PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
    effective_date DATE NOT NULL,
    value DECIMAL(8,4) NOT NULL,

    UNIQUE(module_id, effective_date)
);

-- Forecast module investments (normalized from nested array)
CREATE TABLE forecast_module_investments (
    id SERIAL PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
    investment_date DATE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    flag VARCHAR(50),
    note TEXT
);

CREATE INDEX idx_fc_investments_module ON forecast_module_investments(module_id);

-- Forecast module disposals (normalized from nested array)
CREATE TABLE forecast_module_disposals (
    id SERIAL PRIMARY KEY,
    module_id INTEGER NOT NULL REFERENCES forecast_modules(id) ON DELETE CASCADE,
    disposal_date DATE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    flag VARCHAR(50),
    note TEXT
);

CREATE INDEX idx_fc_disposals_module ON forecast_module_disposals(module_id);

-- Forecast income/expense items
CREATE TABLE forecast_income_expense (
    id SERIAL PRIMARY KEY,
    scenario_id INTEGER NOT NULL REFERENCES forecast_scenarios(id) ON DELETE CASCADE,
    account_id INTEGER REFERENCES accounts(id),
    name VARCHAR(200) NOT NULL,
    item_type VARCHAR(50),                  -- Income, Expense
    currency CHAR(3) DEFAULT 'USD',
    base_date DATE,
    base_value DECIMAL(15,2) DEFAULT 0,
    base_value_usd DECIMAL(15,2) DEFAULT 0,
    growth_rate DECIMAL(8,4) DEFAULT 0,
    comment TEXT,
    is_matched BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(scenario_id, name)
);

CREATE INDEX idx_fc_incexp_scenario ON forecast_income_expense(scenario_id);

-- Forecast income/expense changes (normalized from nested array)
CREATE TABLE forecast_incexp_changes (
    id SERIAL PRIMARY KEY,
    incexp_id INTEGER NOT NULL REFERENCES forecast_income_expense(id) ON DELETE CASCADE,
    change_date DATE NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    flag VARCHAR(50),
    note TEXT
);

CREATE INDEX idx_fc_changes_incexp ON forecast_incexp_changes(incexp_id);

-- Generated forecast entries (output of forecast generation)
CREATE TABLE forecast_entries (
    id BIGSERIAL PRIMARY KEY,
    scenario_id INTEGER NOT NULL REFERENCES forecast_scenarios(id) ON DELETE CASCADE,
    forecast_year INTEGER NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    account VARCHAR(200),
    module VARCHAR(200),
    entry_type VARCHAR(50),                 -- balance, income, expense, etc.
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(scenario_id, forecast_year, account, module, entry_type)
);

CREATE INDEX idx_fc_entries_scenario_year ON forecast_entries(scenario_id, forecast_year);

-- ============================================================================
-- SECTION 5: CONFIGURATION TABLES
-- ============================================================================

-- Forecast assumptions (replaces FCAssump.json)
CREATE TABLE forecast_assumptions (
    id SERIAL PRIMARY KEY,
    scenario_id INTEGER REFERENCES forecast_scenarios(id),  -- NULL = global
    section VARCHAR(100) NOT NULL,          -- growth_rates, tax_rates, fx_rates, etc.
    key VARCHAR(100) NOT NULL,
    value JSONB NOT NULL,                   -- Flexible value storage
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(scenario_id, section, key)
);

-- Exchange rates
CREATE TABLE exchange_rates (
    id SERIAL PRIMARY KEY,
    from_currency CHAR(3) NOT NULL,
    to_currency CHAR(3) NOT NULL,
    rate DECIMAL(15,6) NOT NULL,
    rate_date DATE NOT NULL,
    source VARCHAR(50) DEFAULT 'frankfurter',
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(from_currency, to_currency, rate_date)
);

CREATE INDEX idx_fx_rates_date ON exchange_rates(rate_date);

-- Audit log for tracking changes (from Q6 decision)
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id BIGINT NOT NULL,
    action VARCHAR(20) NOT NULL,            -- INSERT, UPDATE, DELETE
    old_values JSONB,
    new_values JSONB,
    user_info VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_table ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_time ON audit_log(created_at);

-- ============================================================================
-- SECTION 6: VIEWS FOR REPORTING
-- ============================================================================

-- Balance sheet view (replaces complex aggregation)
CREATE VIEW v_balance_sheet AS
SELECT
    a.id AS account_id,
    a.name AS account_name,
    a.account_type,
    a.parent_id,
    pa.name AS parent_name,
    t.transaction_date,
    SUM(t.base_amount) AS balance
FROM accounts a
LEFT JOIN accounts pa ON a.parent_id = pa.id
LEFT JOIN categories c ON c.mapped_account_id = a.id
LEFT JOIN transactions t ON t.category_id = c.id
WHERE a.section = 'balance_sheet'
GROUP BY a.id, a.name, a.account_type, a.parent_id, pa.name, t.transaction_date;

-- Budget vs Actual comparison view
CREATE VIEW v_budget_vs_actual AS
SELECT
    DATE_TRUNC('month', t.transaction_date) AS month,
    c.name AS category,
    a.name AS account,
    SUM(t.base_amount) AS actual_amount,
    COALESCE(b.budget_amount, 0) AS budget_amount,
    SUM(t.base_amount) - COALESCE(b.budget_amount, 0) AS variance
FROM transactions t
JOIN categories c ON t.category_id = c.id
LEFT JOIN accounts a ON c.mapped_account_id = a.id
LEFT JOIN (
    SELECT
        DATE_TRUNC('month', entry_date) AS month,
        category_id,
        SUM(base_amount) AS budget_amount
    FROM budget_entries
    GROUP BY DATE_TRUNC('month', entry_date), category_id
) b ON DATE_TRUNC('month', t.transaction_date) = b.month
   AND t.category_id = b.category_id
GROUP BY DATE_TRUNC('month', t.transaction_date), c.name, a.name, b.budget_amount;

-- ============================================================================
-- SECTION 7: SEED DATA
-- ============================================================================

-- Initialize sync metadata record for PocketSmith
INSERT INTO sync_metadata (sync_type, last_sync_status)
VALUES ('pocketsmith_transactions', 'pending');

-- Create default forecast scenario
INSERT INTO forecast_scenarios (name, description, is_active)
VALUES ('Base Case', 'Default forecast scenario', TRUE);
