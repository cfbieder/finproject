-- ============================================================================
-- FIN Application: FC Lines (Forecast Income/Expense Mapping Layer)
-- Migration: 007_fc_lines.sql
-- Created: 2026-03-27
--
-- Creates fc_lines and fc_line_categories tables for the global mapping layer
-- between budget categories and forecast lines. Also adds new FK columns to
-- forecast_modules and forecast_income_expense tables.
--
-- See Documentation/FC_Module/FC_MODULE.md §7 for full design.
-- ============================================================================

-- FC Lines: user-defined forecast income/expense lines
CREATE TABLE IF NOT EXISTS fc_lines (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL UNIQUE,
    line_type       VARCHAR(30) NOT NULL DEFAULT 'unassigned'
                    CHECK (line_type IN ('bs_module_expense', 'bs_module_income', 'forecast_expense', 'forecast_income', 'unassigned')),
    display_order   INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- FC Line ↔ Category assignments (each category assigned to exactly one line)
CREATE TABLE IF NOT EXISTS fc_line_categories (
    id              SERIAL PRIMARY KEY,
    fc_line_id      INTEGER NOT NULL REFERENCES fc_lines(id) ON DELETE CASCADE,
    category_id     INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (category_id)  -- each category assigned to exactly one line
);

CREATE INDEX IF NOT EXISTS idx_fc_line_categories_line_id ON fc_line_categories(fc_line_id);
CREATE INDEX IF NOT EXISTS idx_fc_line_categories_category_id ON fc_line_categories(category_id);

-- Add FC Line FK columns to forecast_modules
ALTER TABLE forecast_modules ADD COLUMN IF NOT EXISTS expense_fc_line_id INTEGER REFERENCES fc_lines(id) ON DELETE SET NULL;
ALTER TABLE forecast_modules ADD COLUMN IF NOT EXISTS income_fc_line_id INTEGER REFERENCES fc_lines(id) ON DELETE SET NULL;
ALTER TABLE forecast_modules ADD COLUMN IF NOT EXISTS expense_growth_method VARCHAR(20) DEFAULT 'inflation'
    CHECK (expense_growth_method IN ('inflation', 'pct_of_value'));

-- Add FC Line FK and budget_source_year to forecast_income_expense
ALTER TABLE forecast_income_expense ADD COLUMN IF NOT EXISTS fc_line_id INTEGER REFERENCES fc_lines(id) ON DELETE RESTRICT;
ALTER TABLE forecast_income_expense ADD COLUMN IF NOT EXISTS budget_source_year INTEGER;
