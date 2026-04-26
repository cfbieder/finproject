-- Migration 018: Category Source Mappings
-- Decouples external system category names from internal app category names.
-- Allows renaming categories in the app without breaking PocketSmith (or future Quicken) sync.
-- One-to-many: multiple external names can map to one app category.

CREATE TABLE category_source_mappings (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    source VARCHAR(50) NOT NULL,
    external_name VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, external_name)
);

CREATE INDEX idx_csm_category ON category_source_mappings(category_id);
CREATE INDEX idx_csm_source_name ON category_source_mappings(source, external_name);

-- Seed: one row per existing category for pocketsmith source
INSERT INTO category_source_mappings (category_id, source, external_name)
SELECT id, 'pocketsmith', name
FROM categories
ON CONFLICT DO NOTHING;
