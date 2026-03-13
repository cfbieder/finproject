-- ============================================================================
-- FIN Application: Budget FX Rates Table
-- Migration: 004_budget_fx_rates.sql
-- Created: 2026-03-13
--
-- Monthly budget exchange rates per currency per year.
-- Rate convention: "X foreign currency per 1 USD"
-- (e.g., EUR rate = 0.8435 means 1 USD = 0.8435 EUR)
-- Formula: base_amount = amount / rate
-- ============================================================================

CREATE TABLE IF NOT EXISTS budget_fx_rates (
    id SERIAL PRIMARY KEY,
    currency CHAR(3) NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    rate DECIMAL(15,6) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(currency, year, month)
);

CREATE INDEX IF NOT EXISTS idx_budget_fx_rates_year
    ON budget_fx_rates(year);

CREATE INDEX IF NOT EXISTS idx_budget_fx_rates_currency_year
    ON budget_fx_rates(currency, year);
