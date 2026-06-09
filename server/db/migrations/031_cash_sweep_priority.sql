-- Migration 031: Multi-module priority cash sweep (CR017, Phase C)
-- Extends the single cash_sweep_target boolean (012) to a priority-ordered list.
-- cash_sweep_priority: NULL = not in the sweep set; 1 = primary (deposit target +
-- first drained on shortfall); 2, 3, ... = ordered withdrawal backups.
-- cash_sweep_target is KEPT and maintained as "priority == 1" for back-compat with
-- the read sites that still reference it (aiReview, FCModulesTable, route transforms).

ALTER TABLE forecast_modules
ADD COLUMN IF NOT EXISTS cash_sweep_priority INT DEFAULT NULL;

-- Backfill: today's single target becomes priority 1 (no user action needed —
-- existing single-module scenarios keep working).
UPDATE forecast_modules
SET cash_sweep_priority = 1
WHERE cash_sweep_target = TRUE AND cash_sweep_priority IS NULL;

-- Priorities are unique within a scenario (no two modules share a rank).
CREATE UNIQUE INDEX IF NOT EXISTS idx_forecast_modules_sweep_priority
ON forecast_modules (scenario_id, cash_sweep_priority)
WHERE cash_sweep_priority IS NOT NULL;
