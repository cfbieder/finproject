-- Add optional end date for periodic investments (mirrors disposal date_end)
ALTER TABLE forecast_module_investments
  ADD COLUMN IF NOT EXISTS date_end DATE;
