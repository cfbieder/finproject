-- Migration 019: Account Source Mappings
-- Decouples external system account names (PocketSmith, future Quicken) from internal app account names.
-- Allows renaming accounts in the app without breaking sync.
-- One-to-many: multiple external account names can map to one app account.

CREATE TABLE account_source_mappings (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL,
    external_name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, external_name)
);

CREATE INDEX idx_asm_account ON account_source_mappings(account_id);
CREATE INDEX idx_asm_source_name ON account_source_mappings(source, external_name);

-- Seed: one row per existing account for pocketsmith source
INSERT INTO account_source_mappings (account_id, source, external_name)
SELECT id, 'pocketsmith', name
FROM accounts
ON CONFLICT DO NOTHING;
