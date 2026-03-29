-- Module setup status tracking (New / In Progress / Complete)
ALTER TABLE forecast_modules ADD COLUMN IF NOT EXISTS setup_status VARCHAR(20) DEFAULT 'new';
