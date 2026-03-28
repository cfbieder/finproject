-- Phase 4: Cash Target & Auto-Balance
-- Adds target_cash to forecast_scenarios for cash rebalancing post-processing
ALTER TABLE forecast_scenarios ADD COLUMN IF NOT EXISTS target_cash NUMERIC DEFAULT NULL;
