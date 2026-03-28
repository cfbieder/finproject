-- Per-module tax rate override
-- NULL = use scenario default tax rate; set a value to override for this module only
ALTER TABLE forecast_modules ADD COLUMN IF NOT EXISTS tax_rate_override NUMERIC DEFAULT NULL;
