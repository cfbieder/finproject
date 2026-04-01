-- Migration 013: Replace target_cash with cash_sweep_low/high band
-- Cash sweep triggers when cash < low (withdraw from sweep module)
-- or cash > high (deposit into sweep module). Between low and high = no action.

ALTER TABLE forecast_scenarios ADD COLUMN IF NOT EXISTS cash_sweep_low NUMERIC DEFAULT NULL;
ALTER TABLE forecast_scenarios ADD COLUMN IF NOT EXISTS cash_sweep_high NUMERIC DEFAULT NULL;

-- Migrate existing target_cash → both low and high (same value = exact target, old behavior)
UPDATE forecast_scenarios
SET cash_sweep_low = target_cash, cash_sweep_high = target_cash
WHERE target_cash IS NOT NULL;

-- Drop old column
ALTER TABLE forecast_scenarios DROP COLUMN IF EXISTS target_cash;
