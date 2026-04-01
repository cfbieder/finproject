-- Migration 012: Add cash_sweep_target flag to forecast_modules
-- Designates one module per scenario as the target for excess cash sweeps
-- and the source for shortfall withdrawals.

ALTER TABLE forecast_modules
ADD COLUMN IF NOT EXISTS cash_sweep_target BOOLEAN NOT NULL DEFAULT FALSE;

-- Ensure only one module per scenario can be the sweep target
CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_modules_sweep_target
ON forecast_modules (scenario_id)
WHERE cash_sweep_target = TRUE;
