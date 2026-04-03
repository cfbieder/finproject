-- Add optional end date for periodic disposals
ALTER TABLE forecast_module_disposals
  ADD COLUMN IF NOT EXISTS date_end DATE;
